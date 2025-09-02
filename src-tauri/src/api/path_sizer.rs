// src/api/path_sizer.rs
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};

/// Key = (path, show_hidden, ignores_signature)
#[derive(Hash, Eq, PartialEq, Clone)]
struct CacheKey {
    path: PathBuf,
    show_hidden: bool,
    ignores_sig: String, // comma-joined; simple contains semantics
}

#[derive(Clone)]
struct CacheEntry {
    bytes: u64,
    items: u64,      // (we keep this for future UI use)
    completed: bool, // true when a full scan for that key finished
    _updated_at: SystemTime,
}

// Track a running job by id so we can cancel it cleanly.
struct Job {
    _key: CacheKey,
    cancel: Arc<AtomicBool>,
}

static SIZE_CACHE: Lazy<Mutex<HashMap<CacheKey, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static JOBS: Lazy<Mutex<HashMap<String, Job>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct ChildEvent {
    job_id: String,
    name: String,
    bytes: u64,
}

#[derive(Serialize, Clone)]
struct SummaryEvent {
    job_id: String,
    bytes: u64,
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    job_id: String,
    bytes: u64,
    name: String,
}

fn make_key(path: &str, show_hidden: bool, ignores: &[String]) -> CacheKey {
    let mut ig = ignores.to_vec();
    ig.sort();
    CacheKey {
        path: PathBuf::from(path),
        show_hidden,
        ignores_sig: ig.join(","),
    }
}

fn should_skip(name: &str, show_hidden: bool, ignores: &[String]) -> bool {
    if !show_hidden && name.starts_with('.') {
        return true;
    }
    ignores.iter().any(|ig| name.contains(ig))
}

/// Ensure a size worker is running for `path`. Emits:
/// - "dir_size:child" for each immediate subfolder
/// - "dir_size:summary" for the full folder total
///
/// NOTE: We accept a `job_id` so the front-end can ignore stale events after navigation.
#[tauri::command]
pub fn ensure_path_sizer(
    app: AppHandle,
    path: String,
    job_id: String,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    let key = make_key(&path, show_hidden, &ignores);

    // Register/cancel any previous job with the same id
    {
        let mut jobs = JOBS.lock().map_err(|e| e.to_string())?;
        if let Some(old) = jobs.remove(&job_id) {
            old.cancel.store(true, Ordering::SeqCst);
        }
        jobs.insert(
            job_id.clone(),
            Job {
                _key: key.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    let cancel = {
        let jobs = JOBS.lock().unwrap();
        jobs.get(&job_id).unwrap().cancel.clone()
    };

    // Spawn the worker
    tauri::async_runtime::spawn(async move {
        let root = PathBuf::from(&path);

        // 1) List immediate children once; also sum root-level files immediately.
        let mut child_dirs: Vec<String> = Vec::new();
        let mut root_files_total: u64 = 0;

        if let Ok(rd) = std::fs::read_dir(&root) {
            for ent in rd.flatten() {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let name = ent.file_name().to_string_lossy().to_string();
                if should_skip(&name, show_hidden, &ignores) {
                    continue;
                }
                match ent.metadata() {
                    Ok(md) if md.is_dir() => child_dirs.push(name),
                    Ok(md) if md.is_file() => {
                        root_files_total = root_files_total.saturating_add(md.len());
                    }
                    _ => {}
                }
            }
        }

        // Limit concurrency (be gentle on slow/remote/NTFS)
        let sem = Arc::new(tokio::sync::Semaphore::new(4));
        let mut tasks = Vec::with_capacity(child_dirs.len());
        let mut child_totals: HashMap<String, u64> = HashMap::new();

        // Snapshot cache + prepare to emit any already-completed child sizes immediately
        let cache_snapshot = SIZE_CACHE
            .lock()
            .ok()
            .map(|c| c.clone())
            .unwrap_or_default();

        for name in child_dirs {
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            // If we have the child's total cached, emit right away and skip scanning.
            let child_key = make_key(
                root.join(&name).to_string_lossy().as_ref(),
                show_hidden,
                &ignores,
            );
            if let Some(entry) = cache_snapshot.get(&child_key) {
                if entry.completed {
                    let _ = app.emit(
                        "dir_size:child",
                        ChildEvent {
                            job_id: job_id.clone(),
                            name: name.clone(),
                            bytes: entry.bytes,
                        },
                    );
                    child_totals.insert(name.clone(), entry.bytes);
                    continue;
                }
            }

            // Else, scan this child directory with a permit
            let permit = sem.clone().acquire_owned().await.unwrap();
            let app2 = app.clone();
            let job_id2 = job_id.clone();
            let cancel2 = cancel.clone();
            let root2 = root.clone();
            let name2 = name.clone();
            let ignores2 = ignores.clone();

            let app_for_progress = app2.clone();
            let job_id_for_progress = job_id2.clone();
            let name_for_progress = name2.clone();

            tasks.push(tauri::async_runtime::spawn(async move {
                let _p = permit;
                if cancel2.load(Ordering::SeqCst) {
                    return (name2, 0u64);
                }

                let dir_path = root2.join(&name2);
                let dir_path_for_block = dir_path.clone();
                let ignores_for_block = ignores2.clone();

                let bytes = tauri::async_runtime::spawn_blocking(move || {
                    let mut sum: u64 = 0;
                    let mut _file_count = 0;

                    // --- THROTTLE STATE ---
                    let mut last_emit_at = Instant::now()
                        .checked_sub(Duration::from_millis(200))
                        .unwrap_or_else(Instant::now);
                    let mut last_emitted_bytes: u64 = 0;
                    let mut files_since_emit: u32 = 0;

                    for entry in walkdir::WalkDir::new(&dir_path_for_block)
                        .follow_links(false)
                        .into_iter()
                        .filter_map(|e| e.ok())
                    {
                        // Opportunistic cancel
                        if cancel2.load(Ordering::SeqCst) {
                            break;
                        }

                        let file_name = entry.file_name().to_string_lossy();
                        if should_skip(&file_name, show_hidden, &ignores_for_block) {
                            continue;
                        }

                        if entry.file_type().is_file() {
                            if let Ok(md) = entry.metadata() {
                                sum = sum.saturating_add(md.len());
                                _file_count += 1;
                                files_since_emit += 1;

                                // Throttle conditions: time-based OR big jump OR many files
                                let due_time = last_emit_at.elapsed() >= Duration::from_millis(100);
                                let big_jump =
                                    sum.saturating_sub(last_emitted_bytes) >= 8 * 1024 * 1024; // 8MB
                                let many_files = files_since_emit >= 200;

                                if due_time || big_jump || many_files {
                                    let _ = app_for_progress.emit(
                                        "dir_size:progress",
                                        ProgressEvent {
                                            job_id: job_id_for_progress.clone(),
                                            name: name_for_progress.clone(),
                                            bytes: sum,
                                        },
                                    );
                                    last_emit_at = Instant::now();
                                    last_emitted_bytes = sum;
                                    files_since_emit = 0;
                                }
                            }
                        }
                    }

                    // Final pulse if needed
                    if last_emitted_bytes != sum {
                        let _ = app_for_progress.emit(
                            "dir_size:progress",
                            ProgressEvent {
                                job_id: job_id_for_progress.clone(),
                                name: name_for_progress.clone(),
                                bytes: sum,
                            },
                        );
                    }

                    sum
                })
                .await
                .unwrap_or(0);

                // Update cache for the child
                let child_key =
                    make_key(dir_path.to_string_lossy().as_ref(), show_hidden, &ignores2);
                if let Ok(mut cache) = SIZE_CACHE.lock() {
                    cache.insert(
                        child_key,
                        CacheEntry {
                            bytes,
                            items: 0,
                            completed: true,
                            _updated_at: std::time::SystemTime::now(),
                        },
                    );
                }

                // Emit child final event
                let _ = app2.emit(
                    "dir_size:child",
                    ChildEvent {
                        job_id: job_id2.clone(),
                        name: name2.clone(),
                        bytes,
                    },
                );

                (name2, bytes)
            }));
        }

        // Collect task results
        for t in tasks {
            if let Ok((name, bytes)) = t.await {
                child_totals.insert(name, bytes);
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
            }
        }

        // If canceled: stop (don’t emit summary), and drop the job
        if cancel.load(Ordering::SeqCst) {
            let _ = JOBS.lock().map(|mut j| j.remove(&job_id));
            return;
        }

        // 2) Summary = root files + sum of all child folder totals
        let total: u64 = root_files_total + child_totals.values().copied().sum::<u64>();

        // Cache root result as completed
        {
            if let Ok(mut cache) = SIZE_CACHE.lock() {
                cache.insert(
                    key,
                    CacheEntry {
                        bytes: total,
                        items: 0,
                        completed: true,
                        _updated_at: SystemTime::now(),
                    },
                );
            }
        }

        // Emit summary
        let _ = app.emit(
            "dir_size:summary",
            SummaryEvent {
                job_id: job_id.clone(),
                bytes: total,
            },
        );

        // Drop job
        let _ = JOBS.lock().map(|mut j| j.remove(&job_id));
    });

    Ok(())
}

/// Optional: query multiple paths from cache (used for future prefill).
#[tauri::command]
pub fn get_cached_sizes(
    paths: Vec<String>,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<Vec<Option<(u64, u64, bool)>>, String> {
    let key_for = |p: &str| make_key(p, show_hidden, &ignores);
    let cache = SIZE_CACHE.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        let k = key_for(&p);
        if let Some(entry) = cache.get(&k) {
            out.push(Some((entry.bytes, entry.items, entry.completed)));
        } else {
            out.push(None);
        }
    }
    Ok(out)
}
