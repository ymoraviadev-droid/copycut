// src/api/dir_sizer.rs
use crate::api::types::{ChildSizeEvent, Job, SummaryEvent};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

static JOBS: Lazy<Mutex<HashMap<String, Job>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub fn cancel_dir_sizer(job_id: String) {
    if let Some(job) = JOBS.lock().unwrap().remove(&job_id) {
        job.cancel.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn start_dir_sizer(
    app: AppHandle,
    path: String,
    job_id: String,
    show_hidden: bool,
    ignores: Vec<String>, // simple contains/glob later if you want
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    JOBS.lock().unwrap().insert(
        job_id.clone(),
        Job {
            cancel: cancel.clone(),
        },
    );

    // Kick a background task that computes sizes and emits results
    tauri::async_runtime::spawn(async move {
        // Pre-scan immediate children once
        let root = PathBuf::from(&path);
        let mut child_dirs: Vec<String> = Vec::new();
        let mut root_files_total: u64 = 0;

        if let Ok(rd) = std::fs::read_dir(&root) {
            for ent in rd.flatten() {
                if let Ok(md) = ent.metadata() {
                    let name = ent.file_name().to_string_lossy().to_string();
                    if !show_hidden && name.starts_with('.') {
                        continue;
                    }
                    if ignores.iter().any(|ig| name.contains(ig)) {
                        continue;
                    }

                    if md.is_dir() {
                        child_dirs.push(name);
                    } else if md.is_file() {
                        root_files_total = root_files_total.saturating_add(md.len());
                    }
                }
            }
        }

        // Limit concurrency to a small number (good on NTFS/FUSE)
        let sem = Arc::new(tokio::sync::Semaphore::new(4));
        let mut child_totals: HashMap<String, u64> = HashMap::new();

        // Spawn one task per child folder
        let mut tasks = Vec::with_capacity(child_dirs.len());
        for name in child_dirs {
            let permit = sem.clone().acquire_owned().await.unwrap();
            let app2 = app.clone();
            let job_id2 = job_id.clone();
            let cancel2 = cancel.clone();
            let root2 = root.clone();
            let show_hidden2 = show_hidden;
            let ignores2 = ignores.clone();

            tasks.push(tauri::async_runtime::spawn(async move {
                let _p = permit; // keep permit until end
                if cancel2.load(Ordering::SeqCst) {
                    return (name, 0u64);
                }

                let dir_path = root2.join(&name);
                let bytes = tauri::async_runtime::spawn_blocking(move || {
                    let mut sum: u64 = 0;
                    for entry in WalkDir::new(&dir_path)
                        .follow_links(false)
                        .into_iter()
                        .filter_map(|e| e.ok())
                    {
                        if cancel2.load(Ordering::SeqCst) {
                            break;
                        }
                        let file_name = entry.file_name().to_string_lossy();
                        if !show_hidden2 && file_name.starts_with('.') {
                            continue;
                        }
                        if ignores2.iter().any(|ig| file_name.contains(ig)) {
                            continue;
                        }

                        if entry.file_type().is_file() {
                            if let Ok(md) = entry.metadata() {
                                sum = sum.saturating_add(md.len());
                            }
                        }
                    }
                    sum
                })
                .await
                .unwrap_or(0);

                // Emit child size (folder row)
                let _ = app2.emit(
                    "dir_size:child",
                    ChildSizeEvent {
                        job_id: job_id2,
                        name: name.clone(),
                        bytes,
                    },
                );

                (name, bytes)
            }));
        }

        // Collect children
        for t in tasks {
            if let Ok((name, bytes)) = t.await {
                child_totals.insert(name, bytes);
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
            }
        }

        // Compute summary = root files + sum(children)
        let total: u64 = root_files_total + child_totals.values().copied().sum::<u64>();

        // Emit summary
        let _ = app.emit(
            "dir_size:summary",
            SummaryEvent {
                job_id: job_id.clone(),
                bytes: total,
            },
        );

        // Remove job
        JOBS.lock().unwrap().remove(&job_id);
    });

    Ok(())
}
