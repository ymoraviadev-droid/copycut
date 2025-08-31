// src/api/dir_size.rs
use std::path::PathBuf;
use walkdir::WalkDir;

#[tauri::command]
pub async fn dir_size(path: String) -> Result<u64, String> {
    let root: PathBuf = PathBuf::from(path);

    let total = tauri::async_runtime::spawn_blocking(move || {
        let mut sum: u64 = 0;
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                if let Ok(md) = entry.metadata() {
                    sum = sum.saturating_add(md.len());
                }
            }
        }
        sum
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(total)
}
