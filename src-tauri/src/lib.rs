use chrono::{DateTime, Local};
use serde::Serialize;
use std::{
    cmp::Ordering,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::Manager;

#[derive(Serialize)]
struct FileEntry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: Option<String>,
}

#[tauri::command]
fn list_dir(path: &str) -> Result<Vec<FileEntry>, String> {
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

fn copy_one(src: &Path, dest_dir: &Path) -> Result<(), String> {
    let file_name = src.file_name().ok_or("bad source name")?;
    let target = dest_dir.join(file_name);

    if src.is_dir() {
        let mut opts = fs_extra::dir::CopyOptions::new();
        opts.overwrite = true;
        opts.copy_inside = true;
        fs_extra::dir::copy(src, &target, &opts).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn copy_paths(paths: Vec<String>, dest_dir: String) -> Result<(), String> {
    let dest = PathBuf::from(dest_dir);
    if !dest.exists() {
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    for p in paths {
        copy_one(Path::new(&p), &dest)?;
    }
    Ok(())
}

#[tauri::command]
fn move_paths(paths: Vec<String>, dest_dir: String) -> Result<(), String> {
    let dest = PathBuf::from(dest_dir);
    if !dest.exists() {
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    for p in paths {
        let src = PathBuf::from(&p);
        let file_name = src.file_name().ok_or("bad source name")?;
        let target = dest.join(file_name);
        match fs::rename(&src, &target) {
            Ok(_) => {}
            Err(_) => {
                // fallback: copy then delete
                copy_one(&src, &dest)?;
                if src.is_dir() {
                    fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(&src).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_paths(paths: Vec<String>) -> Result<(), String> {
    for p in paths {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            fs::remove_dir_all(pb).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(pb).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_devtools(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(debug_assertions)]
        {
            if win.is_devtools_open() {
                win.close_devtools();
            } else {
                win.open_devtools();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            copy_paths,
            move_paths,
            delete_paths,
            rename_path,
            toggle_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
