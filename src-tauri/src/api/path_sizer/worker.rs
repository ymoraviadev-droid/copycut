use crate::api::types::{CacheEntry, ChildEvent, Job, ProgressEvent, SummaryEvent};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};

use super::{
    cache::SIZE_CACHE,
    jobs::JOBS,
    keys::{make_cache_key, make_scan_key, should_skip},
};

pub fn ensure_path_sizer_impl(
    app: AppHandle,
    path: String,
    job_id: String, // kept for compat; UI filters by scan_key
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    // derive keys
    let cache_key = make_cache_key(&path, show_hidden, &ignores);
    let scan_key = make_scan_key(&path, show_hidden, &ignores);

    // ensure one job per scan_key
    {
        let mut jobs = JOBS.lock().map_err(|e| e.to_string())?;
        if let Some(old) = jobs.remove(&scan_key) {
            old.cancel.store(true, Ordering::SeqCst);
        }
        jobs.insert(
            scan_key.clone(),
            Job {
                _key: cache_key.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    let cancel = {
        let jobs = JOBS.lock().unwrap();
        jobs.get(&scan_key).unwrap().cancel.clone()
    };

    // spawn the worker
    tauri::async_runtime::spawn({
        let app = app.clone();
        let path = path.clone();
        let job_id = job_id.clone();
        let scan_key = scan_key.clone();

        async move {
            let root = PathBuf::from(&path);

            // list immediate children & sum root-level files
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

            // limit concurrency
            let sem = Arc::new(tokio::sync::Semaphore::new(4));
            let mut tasks = Vec::with_capacity(child_dirs.len());
            let mut child_totals: HashMap<String, u64> = HashMap::new();

            // snapshot cache for quick emits
            let cache_snapshot = SIZE_CACHE
                .lock()
                .ok()
                .map(|c| c.clone())
                .unwrap_or_default();

            for name in child_dirs {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }

                let child_abs = root.join(&name);
                let child_cache_key =
                    make_cache_key(child_abs.to_string_lossy().as_ref(), show_hidden, &ignores);

                // 1) snapshot check
                if let Some(entry) = cache_snapshot.get(&child_cache_key) {
                    if entry.completed {
                        let _ = app.emit(
                            "dir_size:child",
                            ChildEvent {
                                job_id: job_id.clone(),
                                scan_key: scan_key.clone(),
                                name: name.clone(),
                                bytes: entry.bytes,
                            },
                        );
                        child_totals.insert(name.clone(), entry.bytes);
                        continue;
                    } else if entry.bytes > 0 {
                        let _ = app.emit(
                            "dir_size:progress",
                            ProgressEvent {
                                job_id: job_id.clone(),
                                scan_key: scan_key.clone(),
                                name: name.clone(),
                                bytes: entry.bytes,
                            },
                        );
                    }
                }

                // 2) live cache check
                let mut skip_scan = false;
                let mut cached_bytes = 0u64;
                if let Ok(cache) = SIZE_CACHE.lock() {
                    if let Some(entry) = cache.get(&child_cache_key) {
                        if entry.completed {
                            skip_scan = true;
                            cached_bytes = entry.bytes;
                        } else if entry.bytes > 0 {
                            let _ = app.emit(
                                "dir_size:progress",
                                ProgressEvent {
                                    job_id: job_id.clone(),
                                    scan_key: scan_key.clone(),
                                    name: name.clone(),
                                    bytes: entry.bytes,
                                },
                            );
                        }
                    }
                }
                if skip_scan {
                    let _ = app.emit(
                        "dir_size:child",
                        ChildEvent {
                            job_id: job_id.clone(),
                            scan_key: scan_key.clone(),
                            name: name.clone(),
                            bytes: cached_bytes,
                        },
                    );
                    child_totals.insert(name.clone(), cached_bytes);
                    continue;
                }

                // 3) scan with a permit
                let permit = sem.clone().acquire_owned().await.unwrap();

                // per-task clones (IMPORTANT: don't move the original `cancel`)
                let cancel_task = cancel.clone();

                // values used AFTER scan (kept here)
                let app2 = app.clone();
                let job_id2 = job_id.clone();
                let scan_key2 = scan_key.clone();
                let root2 = root.clone();
                let name2 = name.clone();
                let ignores2 = ignores.clone();

                // values for the blocking worker (distinct clones)
                let app_for_progress = app2.clone();
                let job_id_for_progress = job_id2.clone();
                let scan_key_for_progress = scan_key2.clone();
                let name_for_progress = name2.clone();

                tasks.push(tauri::async_runtime::spawn(async move {
                    let _p = permit;

                    if cancel_task.load(Ordering::SeqCst) {
                        return (name2, 0u64);
                    }

                    let dir_path = root2.join(&name2);
                    let dir_path_for_block = dir_path.clone();
                    let ignores_for_block = ignores2.clone();

                    // clone for the blocking thread as well
                    let cancel_block = cancel_task.clone();

                    // compute bytes inside spawn_blocking
                    let (bytes, finished) = tauri::async_runtime::spawn_blocking(move || {
                        let mut sum: u64 = 0;

                        // throttle
                        let mut last_emit_at = Instant::now()
                            .checked_sub(Duration::from_millis(200))
                            .unwrap_or_else(Instant::now);
                        let mut last_emitted_bytes: u64 = 0;
                        let mut files_since_emit: u32 = 0;

                        let mut canceled = false;

                        for entry in walkdir::WalkDir::new(&dir_path_for_block)
                            .follow_links(false)
                            .into_iter()
                            .filter_map(|e| e.ok())
                        {
                            if cancel_block.load(Ordering::SeqCst) {
                                canceled = true;
                                break;
                            }

                            let file_name = entry.file_name().to_string_lossy();
                            if should_skip(&file_name, show_hidden, &ignores_for_block) {
                                continue;
                            }

                            if entry.file_type().is_file() {
                                if let Ok(md) = entry.metadata() {
                                    sum = sum.saturating_add(md.len());
                                    files_since_emit += 1;

                                    let due_time =
                                        last_emit_at.elapsed() >= Duration::from_millis(100);
                                    let big_jump =
                                        sum.saturating_sub(last_emitted_bytes) >= 8 * 1024 * 1024;
                                    let many_files = files_since_emit >= 200;

                                    if due_time || big_jump || many_files {
                                        let _ = app_for_progress.emit(
                                            "dir_size:progress",
                                            ProgressEvent {
                                                job_id: job_id_for_progress.clone(),
                                                scan_key: scan_key_for_progress.clone(),
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

                        if last_emitted_bytes != sum {
                            let _ = app_for_progress.emit(
                                "dir_size:progress",
                                ProgressEvent {
                                    job_id: job_id_for_progress,
                                    scan_key: scan_key_for_progress,
                                    name: name_for_progress,
                                    bytes: sum,
                                },
                            );
                        }

                        (sum, !canceled)
                    })
                    .await
                    .unwrap_or((0, false));

                    // update cache for the child
                    let child_cache_key =
                        make_cache_key(dir_path.to_string_lossy().as_ref(), show_hidden, &ignores2);
                    if let Ok(mut cache) = SIZE_CACHE.lock() {
                        cache.insert(
                            child_cache_key,
                            CacheEntry {
                                bytes,
                                items: 0,
                                completed: finished,
                                _updated_at: SystemTime::now(),
                            },
                        );
                    }

                    // emit final child
                    let _ = app2.emit(
                        "dir_size:child",
                        ChildEvent {
                            job_id: job_id2,
                            scan_key: scan_key2,
                            name: name2.clone(),
                            bytes,
                        },
                    );

                    (name2, bytes)
                }));
            }

            // collect
            for t in tasks {
                if let Ok((name, bytes)) = t.await {
                    child_totals.insert(name, bytes);
                    if cancel.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }

            // canceled? drop job & bail
            if cancel.load(Ordering::SeqCst) {
                let _ = JOBS.lock().map(|mut j| j.remove(&scan_key));
                return;
            }

            // summary
            let total: u64 = root_files_total + child_totals.values().copied().sum::<u64>();

            // cache root
            if let Ok(mut cache) = SIZE_CACHE.lock() {
                cache.insert(
                    cache_key,
                    CacheEntry {
                        bytes: total,
                        items: 0,
                        completed: true,
                        _updated_at: SystemTime::now(),
                    },
                );
            }

            // emit summary
            let _ = app.emit(
                "dir_size:summary",
                SummaryEvent {
                    job_id: job_id.clone(),
                    scan_key: scan_key.clone(),
                    bytes: total,
                },
            );

            // drop job
            let _ = JOBS.lock().map(|mut j| j.remove(&scan_key));
        }
    });

    Ok(())
}
