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

use crate::api::{
    path_sizer::{
        cache::SIZE_CACHE,
        jobs,
        keys::{make_cache_key, make_scan_key, should_skip},
    },
    types::{CacheEntry, ChildEvent, Job, ProgressEvent, SummaryEvent},
};

pub fn ensure_path_sizer_impl(
    app: AppHandle,
    path: String,
    job_id: String, // kept for compat; UI filters by scan_key
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    // Keys
    let cache_key = make_cache_key(&path, show_hidden, &ignores);
    let scan_key = make_scan_key(&path, show_hidden, &ignores);

    // Ensure single job per scan_key
    let cancel = Arc::new(AtomicBool::new(false));
    let inserted = jobs::insert_if_absent(
        scan_key.clone(),
        Job {
            _key: cache_key.clone(),
            _cancel: cancel.clone(),
        },
    );
    if !inserted {
        // A job for this scan_key is already running; do nothing.
        return Ok(());
    }

    // Spawn worker
    tauri::async_runtime::spawn({
        let app = app.clone();
        let path = path.clone();
        let job_id = job_id.clone();
        let scan_key = scan_key.clone();
        let ignores = ignores.clone();
        let cancel = cancel.clone();

        async move {
            let root = PathBuf::from(&path);

            // 1) enumerate immediate children + sum root files
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

            // 2) concurrency & local state
            let sem = Arc::new(tokio::sync::Semaphore::new(4));
            let mut tasks = Vec::with_capacity(child_dirs.len());
            let mut child_totals: HashMap<String, u64> = HashMap::new();

            // 3) snapshot cache for quick emits
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
                let child_cachekey =
                    make_cache_key(child_abs.to_string_lossy().as_ref(), show_hidden, &ignores);

                // Snapshot hit?
                if let Some(entry) = cache_snapshot.get(&child_cachekey) {
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

                // Live cache check (it may have been updated by another parent)
                let mut skip_scan = false;
                let mut cached_bytes = 0u64;
                if let Ok(cache) = SIZE_CACHE.lock() {
                    if let Some(entry) = cache.get(&child_cachekey) {
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

                // 4) scan this child with a permit
                // 3) scan with a permit
                let permit = sem.clone().acquire_owned().await.unwrap();

                // per-task clones (NEVER move the originals)
                let cancel_t = cancel.clone();
                let app2 = app.clone();
                let job_id2 = job_id.clone();
                let scan_key2 = scan_key.clone();
                let root2 = root.clone();
                let name2 = name.clone();
                let ignores2 = ignores.clone();

                // IMPORTANT: make dedicated copies for each place they’re needed
                let child_cachekey_for_final = child_cachekey.clone(); // used after .await
                let name_for_final_emit = name2.clone(); // used after .await

                // also pre-clone for the blocking worker
                let name_for_progress = name2.clone();
                let child_cachekey_for_progress = child_cachekey.clone();

                tasks.push(tauri::async_runtime::spawn(async move {
                    let _p = permit;

                    if cancel_t.load(Ordering::SeqCst) {
                        // we still own name2 here; return it and stop
                        return (name2, 0u64);
                    }

                    let dir_path = root2.join(&name2);
                    let dir_path_for_block = dir_path.clone();
                    let ignores_for_block = ignores2.clone();
                    let cancel_block = cancel_t.clone();

                    let app_progress = app2.clone();
                    let job_id_progress = job_id2.clone();
                    let scan_key_progress = scan_key2.clone();

                    // heavy work in blocking thread
                    let (bytes, finished) = tauri::async_runtime::spawn_blocking(move || {
                        let mut sum: u64 = 0;
                        let mut last_emit_at = Instant::now()
                            .checked_sub(Duration::from_millis(200))
                            .unwrap_or_else(Instant::now);
                        let mut last_emitted: u64 = 0;
                        let mut files_since: u32 = 0;
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

                            let fname = entry.file_name().to_string_lossy();
                            if should_skip(&fname, show_hidden, &ignores_for_block) {
                                continue;
                            }

                            if entry.file_type().is_file() {
                                if let Ok(md) = entry.metadata() {
                                    sum = sum.saturating_add(md.len());
                                    files_since += 1;

                                    let due_time =
                                        last_emit_at.elapsed() >= Duration::from_millis(100);
                                    let big_jump =
                                        sum.saturating_sub(last_emitted) >= 8 * 1024 * 1024;
                                    let many_files = files_since >= 200;

                                    if due_time || big_jump || many_files {
                                        // write partial into cache so nav-in shows > 0B
                                        if let Ok(mut cache) = SIZE_CACHE.lock() {
                                            cache.insert(
                                                child_cachekey_for_progress.clone(),
                                                CacheEntry {
                                                    bytes: sum,
                                                    items: 0,
                                                    completed: false,
                                                    _updated_at: SystemTime::now(),
                                                },
                                            );
                                        }
                                        let _ = app_progress.emit(
                                            "dir_size:progress",
                                            ProgressEvent {
                                                job_id: job_id_progress.clone(),
                                                scan_key: scan_key_progress.clone(),
                                                name: name_for_progress.clone(),
                                                bytes: sum,
                                            },
                                        );
                                        last_emit_at = Instant::now();
                                        last_emitted = sum;
                                        files_since = 0;
                                    }
                                }
                            }
                        }

                        if last_emitted != sum {
                            if let Ok(mut cache) = SIZE_CACHE.lock() {
                                cache.insert(
                                    child_cachekey_for_progress.clone(),
                                    CacheEntry {
                                        bytes: sum,
                                        items: 0,
                                        completed: false,
                                        _updated_at: SystemTime::now(),
                                    },
                                );
                            }
                            let _ = app_progress.emit(
                                "dir_size:progress",
                                ProgressEvent {
                                    job_id: job_id_progress,
                                    scan_key: scan_key_progress,
                                    name: name_for_progress,
                                    bytes: sum,
                                },
                            );
                        }

                        (sum, !canceled)
                    })
                    .await
                    .unwrap_or((0, false));

                    // final cache write uses the *final* key clone
                    if let Ok(mut cache) = SIZE_CACHE.lock() {
                        cache.insert(
                            child_cachekey_for_final,
                            CacheEntry {
                                bytes,
                                items: 0,
                                completed: finished,
                                _updated_at: SystemTime::now(),
                            },
                        );
                    }

                    // emit final child using the final name clone
                    let _ = app2.emit(
                        "dir_size:child",
                        ChildEvent {
                            job_id: job_id2,
                            scan_key: scan_key2,
                            name: name_for_final_emit.clone(),
                            bytes,
                        },
                    );

                    // return the original name2 (moved here; we don't use it after this)
                    (name2, bytes)
                }));
            }

            // Collect results
            for t in tasks {
                if let Ok((name, bytes)) = t.await {
                    child_totals.insert(name, bytes);
                    if cancel.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }

            // Canceled? drop job & bail
            if cancel.load(Ordering::SeqCst) {
                jobs::remove(&scan_key);
                return;
            }

            // Summary
            let total: u64 = root_files_total + child_totals.values().copied().sum::<u64>();

            // Cache root
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

            // Emit summary
            let _ = app.emit(
                "dir_size:summary",
                SummaryEvent {
                    job_id: job_id.clone(),
                    scan_key: scan_key.clone(),
                    bytes: total,
                },
            );

            // Done
            jobs::remove(&scan_key);
        }
    });

    Ok(())
}
