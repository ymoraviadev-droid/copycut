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

/// Key used for the cache (canonicalized path to avoid dup keys)
#[derive(Hash, Eq, PartialEq, Clone)]
struct CacheKey {
    path: PathBuf,
    show_hidden: bool,
    ignores_sig: String, // comma-joined; simple contains semantics; sorted
}

#[derive(Clone)]
struct CacheEntry {
    bytes: u64,
    items: u64,
    completed: bool, // true only when a full scan finished
    _updated_at: SystemTime,
}

/// A running job tracked by a stable SCAN KEY (string)
struct Job {
    _key: CacheKey,
    cancel: Arc<AtomicBool>,
}

static SIZE_CACHE: Lazy<Mutex<HashMap<CacheKey, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Active jobs keyed by SCAN KEY (not job_id!)
static JOBS: Lazy<Mutex<HashMap<String, Job>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct ChildEvent {
    // kept for compatibility (unused in new UI filtering)
    job_id: String,
    // NEW: stable key identifying this root scan (root path + options)
    scan_key: String,
    name: String,
    bytes: u64,
}

#[derive(Serialize, Clone)]
struct SummaryEvent {
    job_id: String,
    scan_key: String,
    bytes: u64,
}

#[derive(Serialize, Clone)]
struct ProgressEvent {
    job_id: String,
    scan_key: String,
    bytes: u64,
    name: String,
}

// ---------- helpers ----------

fn normalize_path(p: &str) -> PathBuf {
    // Canonicalize for cache-key stability; if it fails, fall back
    std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p))
}

/// Deterministic signature of ignores (sorted, comma-joined)
fn ignores_sig(ignores: &[String]) -> String {
    let mut ig = ignores.to_vec();
    ig.sort();
    ig.join(",")
}

fn make_cache_key(path: &str, show_hidden: bool, ignores: &[String]) -> CacheKey {
    CacheKey {
        path: normalize_path(path),
        show_hidden,
        ignores_sig: ignores_sig(ignores),
    }
}

/// SCAN KEY used in events & JOBS map — uses the RAW path (so the UI can compute it easily)
fn make_scan_key(raw_path: &str, show_hidden: bool, ignores: &[String]) -> String {
    format!("{}|{}|{}", raw_path, show_hidden, ignores_sig(ignores))
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
/// NOTE: `job_id` is deprecated for filtering; events are keyed by `scan_key`.
#[tauri::command]
pub fn ensure_path_sizer(
    app: AppHandle,
    path: String,
    job_id: String, // kept for compatibility (unused in JOBS indexing)
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    // keys
    let cache_key = make_cache_key(&path, show_hidden, &ignores);
    let scan_key = make_scan_key(&path, show_hidden, &ignores);

    // Ensure only one scan per (path+options) — cancel any existing job for this scan_key.
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

    // Spawn the worker
    tauri::async_runtime::spawn({
        let app = app.clone();
        let path = path.clone();
        async move {
            let root = PathBuf::from(&path);

            // 1) List immediate children once; sum root-level files immediately.
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

            // Limit concurrency
            let sem = Arc::new(tokio::sync::Semaphore::new(4));
            let mut tasks = Vec::with_capacity(child_dirs.len());
            let mut child_totals: HashMap<String, u64> = HashMap::new();

            // Snapshot cache
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

                // 1) snapshot: if completed, emit & skip; if partial, seed progress
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

                // 2) live cache: may have been updated by another job just now
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

                // 3) scan this child directory with a permit
                let permit = sem.clone().acquire_owned().await.unwrap();
                let app2 = app.clone();
                let job_id2 = job_id.clone();
                let cancel2 = cancel.clone();
                let root2 = root.clone();
                let name2 = name.clone();
                let ignores2 = ignores.clone();
                let scan_key2 = scan_key.clone();

                let app_for_progress = app2.clone();
                let job_id_for_progress = job_id2.clone();
                let name_for_progress = name2.clone();
                let scan_key_for_progress = scan_key2.clone();

                tasks.push(tauri::async_runtime::spawn(async move {
                    let _p = permit;
                    if cancel2.load(Ordering::SeqCst) {
                        return (name2, 0u64);
                    }

                    let dir_path = root2.join(&name2);
                    let dir_path_for_block = dir_path.clone();
                    let ignores_for_block = ignores2.clone();

                    // return (bytes, finished)
                    let (bytes, finished) = tauri::async_runtime::spawn_blocking(move || {
                        let mut sum: u64 = 0;

                        // throttle state
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
                            if cancel2.load(Ordering::SeqCst) {
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
                                        sum.saturating_sub(last_emitted_bytes) >= 8 * 1024 * 1024; // 8MB
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
                                    job_id: job_id_for_progress.clone(),
                                    scan_key: scan_key_for_progress.clone(),
                                    name: name_for_progress.clone(),
                                    bytes: sum,
                                },
                            );
                        }

                        (sum, !canceled)
                    })
                    .await
                    .unwrap_or((0, false));

                    // cache child (completed only if finished fully)
                    let child_cache_key =
                        make_cache_key(dir_path.to_string_lossy().as_ref(), show_hidden, &ignores2);
                    if let Ok(mut cache) = SIZE_CACHE.lock() {
                        cache.insert(
                            child_cache_key,
                            CacheEntry {
                                bytes,
                                items: 0,
                                completed: finished,
                                _updated_at: std::time::SystemTime::now(),
                            },
                        );
                    }

                    // emit child final
                    let _ = app2.emit(
                        "dir_size:child",
                        ChildEvent {
                            job_id: job_id2.clone(),
                            scan_key: scan_key2.clone(),
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
                let _ = JOBS.lock().map(|mut j| j.remove(&scan_key));
                return;
            }

            // Summary = root files + sum of all child totals + root-level files
            let total: u64 = root_files_total + child_totals.values().copied().sum::<u64>();

            // Cache root result as completed
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

            // Drop job
            let _ = JOBS.lock().map(|mut j| j.remove(&scan_key));
        }
    });

    Ok(())
}

/// Optional: query multiple paths from cache (used for prefill).
#[tauri::command]
pub fn get_cached_sizes(
    paths: Vec<String>,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<Vec<Option<(u64, u64, bool)>>, String> {
    let key_for = |p: &str| make_cache_key(p, show_hidden, &ignores);
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
