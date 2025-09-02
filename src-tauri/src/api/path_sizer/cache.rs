use crate::api::types::{CacheEntry, CacheKey};
use once_cell::sync::Lazy;
use std::{collections::HashMap, sync::Mutex};

pub static SIZE_CACHE: Lazy<Mutex<HashMap<CacheKey, CacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Command: prefill multiple paths
pub fn get_cached_sizes(
    paths: Vec<String>,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<Vec<Option<(u64, u64, bool)>>, String> {
    use super::keys::make_cache_key;

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
