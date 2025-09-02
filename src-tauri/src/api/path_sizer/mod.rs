use tauri::AppHandle;

mod cache;
mod jobs;
mod keys;
mod worker;

#[tauri::command]
pub fn ensure_path_sizer(
    app: AppHandle,
    path: String,
    job_id: String,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<(), String> {
    worker::ensure_path_sizer_impl(app, path, job_id, show_hidden, ignores)
}

#[tauri::command]
pub fn get_cached_sizes(
    paths: Vec<String>,
    show_hidden: bool,
    ignores: Vec<String>,
) -> Result<Vec<Option<(u64, u64, bool)>>, String> {
    cache::get_cached_sizes(paths, show_hidden, ignores)
}
