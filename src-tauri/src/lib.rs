// src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            api::fs_list::list_dir,
            api::fs_ops::copy_paths,
            api::fs_ops::move_paths,
            api::fs_ops::delete_paths,
            api::fs_ops::rename_path,
            api::devtools::toggle_devtools,
            api::path_sizer::get_cached_sizes,
            api::path_sizer::ensure_path_sizer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod api;
