use std::path::PathBuf;

use crate::api::types::CacheKey;

pub fn normalize_path(p: &str) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p))
}

pub fn ignores_sig(ignores: &[String]) -> String {
    let mut ig = ignores.to_vec();
    ig.sort();
    ig.join(",")
}

pub fn make_cache_key(path: &str, show_hidden: bool, ignores: &[String]) -> CacheKey {
    CacheKey {
        path: normalize_path(path),
        show_hidden,
        ignores_sig: ignores_sig(ignores),
    }
}

/// SCAN KEY used for event filtering and job de-dup.
pub fn make_scan_key(raw_path: &str, show_hidden: bool, ignores: &[String]) -> String {
    format!("{}|{}|{}", raw_path, show_hidden, ignores_sig(ignores))
}

pub fn should_skip(name: &str, show_hidden: bool, ignores: &[String]) -> bool {
    if !show_hidden && name.starts_with('.') {
        return true;
    }
    ignores.iter().any(|ig| name.contains(ig))
}
