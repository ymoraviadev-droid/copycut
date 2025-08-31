// src/api/fs_list.rs
use crate::api::types::FileEntry;
use chrono::{DateTime, Local};
use std::{cmp::Ordering, fs, path::PathBuf, time::SystemTime};

#[tauri::command]
pub fn list_dir(path: &str) -> Result<Vec<FileEntry>, String> {
    let mut out = Vec::new();
    let dir = fs::read_dir(PathBuf::from(path)).map_err(|e| e.to_string())?;

    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let md = entry.metadata().map_err(|e| e.to_string())?;

        let is_dir = md.is_dir();
        let size = if is_dir { 0 } else { md.len() };
        let modified = md.modified().ok().and_then(|t: SystemTime| {
            let dt: DateTime<Local> = t.into();
            Some(dt.format("%Y-%m-%d %H:%M").to_string())
        });

        let name = entry.file_name().to_string_lossy().to_string();
        out.push(FileEntry {
            name,
            is_dir,
            size,
            modified,
        });
    }

    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(out)
}
