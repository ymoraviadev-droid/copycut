// src/api/path_sizer.rs
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

// Cache key is (path, show_hidden, ignores_signature)
#[derive(Hash, Eq, PartialEq, Clone)]
struct CacheKey {
    path: PathBuf,
    show_hidden: bool,
    ignores_sig: String, // comma-joined; simple for now
}

#[derive(Clone)]
struct CacheEntry {
    bytes: u64,
    items: u64,      // count of files
    completed: bool, // true when full scan done
    updated_at: SystemTime,
}

// Minimal “in-flight” marker (we’re deduping workers)
struct InFlight {
    started_at: Instant,
}

static SIZE_CACHE: Lazy<Mutex<HashMap<CacheKey, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static IN_FLIGHT: Lazy<Mutex<HashMap<CacheKey, InFlight>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn make_key(path: &str, show_hidden: bool, ignores: &[String]) -> CacheKey {
    let mut ig = ignores.to_vec();
    ig.sort();
    CacheKey {
        path: PathBuf::from(path),
        show_hidden,
        ignores_sig: ig.join(","),
    }
}

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

#[derive(Serialize, Clone)]
struct PathSizeEvent {
    path: String,
    show_hidden: bool,
    ignores_sig: String,
    bytes: u64,
    items: u64,
    completed: bool,
}

/// Ensure a single background worker is computing the size for this (path, filters).
/// If it’s already running or cached complete, this is a no-op.
/// While scanning, it emits `"path_sizer:update"` events with `PathSizeEvent`.
#[tauri::command]
pub fn ensure_path_sizer(
    app: AppHandle,
    path: String,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    let key = make_key(&path, show_hidden, &ignores);

    // If already completed in cache, nothing to do.
    {
        let cache = SIZE_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(c) = cache.get(&key) {
            if c.completed {
                return Ok(());
            }
        }
    }

    // If already in flight, nothing to do.
    {
        let mut inflight = IN_FLIGHT.lock().map_err(|e| e.to_string())?;
        if inflight.contains_key(&key) {
            return Ok(());
        }
        inflight.insert(
            key.clone(),
            InFlight {
                started_at: Instant::now(),
            },
        );
    }

    // Seed cache entry (so get_cached_sizes can reflect "0 in-progress")
    {
        let mut cache = SIZE_CACHE.lock().map_err(|e| e.to_string())?;
        cache.entry(key.clone()).or_insert(CacheEntry {
            bytes: 0,
            items: 0,
            completed: false,
            updated_at: SystemTime::now(),
        });
    }

    // Spawn the worker
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let (bytes, items) = match tauri::async_runtime::spawn_blocking({
            let path = path.clone();
            let key = key.clone();
            let ignores = ignores.clone();
            move || {
                let mut total_bytes: u64 = 0;
                let mut total_items: u64 = 0;

                let mut last_emit = Instant::now();
                let emit_every = Duration::from_millis(250);

                for entry in WalkDir::new(&path)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !show_hidden && name.starts_with('.') {
                        continue;
                    }
                    if ignores.iter().any(|ig| name.contains(ig)) {
                        continue;
                    }

                    if entry.file_type().is_file() {
                        if let Ok(md) = entry.metadata() {
                            total_bytes = total_bytes.saturating_add(md.len());
                            total_items = total_items.saturating_add(1);
                        }
                    }

                    // Throttled progress update (no borrowing issues)
                    if last_emit.elapsed() >= emit_every {
                        last_emit = Instant::now();

                        // write partial to cache
                        if let Ok(mut cache) = SIZE_CACHE.lock() {
                            cache.insert(
                                key.clone(),
                                CacheEntry {
                                    bytes: total_bytes,
                                    items: total_items,
                                    completed: false,
                                    updated_at: SystemTime::now(),
                                },
                            );
                        }

                        // fire progress event
                        let _ = app2.emit(
                            "path_sizer:update",
                            PathSizeEvent {
                                path: path.clone(),
                                show_hidden,
                                ignores_sig: key.ignores_sig.clone(),
                                bytes: total_bytes,
                                items: total_items,
                                completed: false,
                            },
                        );
                    }
                }

                // Final forced update
                if let Ok(mut cache) = SIZE_CACHE.lock() {
                    cache.insert(
                        key.clone(),
                        CacheEntry {
                            bytes: total_bytes,
                            items: total_items,
                            completed: false, // final emit below will mark true
                            updated_at: SystemTime::now(),
                        },
                    );
                }
                let _ = app2.emit(
                    "path_sizer:update",
                    PathSizeEvent {
                        path: path.clone(),
                        show_hidden,
                        ignores_sig: key.ignores_sig.clone(),
                        bytes: total_bytes,
                        items: total_items,
                        completed: false,
                    },
                );

                (total_bytes, total_items)
            }
        })
        .await
        {
            Ok(v) => v,
            Err(_) => (0, 0),
        };

        // Write final cache entry
        if let Ok(mut cache) = SIZE_CACHE.lock() {
            cache.insert(
                key.clone(),
                CacheEntry {
                    bytes,
                    items,
                    completed: true,
                    updated_at: SystemTime::now(),
                },
            );
        }

        // Final event (completed)
        let _ = app.emit(
            "path_sizer:update",
            PathSizeEvent {
                path: path.clone(),
                show_hidden,
                ignores_sig: key.ignores_sig.clone(),
                bytes,
                items,
                completed: true,
            },
        );

        // Clear in-flight marker
        if let Ok(mut inflight) = IN_FLIGHT.lock() {
            inflight.remove(&key);
        }
    });

    Ok(())
}
