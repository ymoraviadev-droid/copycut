// src/api/fs_ops.rs
use std::{
    fs,
    path::{Path, PathBuf},
};

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
pub fn copy_paths(paths: Vec<String>, dest_dir: String) -> Result<(), String> {
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
pub fn move_paths(paths: Vec<String>, dest_dir: String) -> Result<(), String> {
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
pub fn delete_paths(paths: Vec<String>) -> Result<(), String> {
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
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}
