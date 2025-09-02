#[tauri::command]
pub fn exit(app: tauri::AppHandle) {
    // This will close all windows and stop the runtime loop
    app.exit(0);
}
