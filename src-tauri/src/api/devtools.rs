// src/api/devtools.rs
use tauri::Manager;

#[tauri::command]
pub fn toggle_devtools(app: tauri::AppHandle) {
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
