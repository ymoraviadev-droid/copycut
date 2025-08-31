import { invoke } from "@tauri-apps/api/core";

export async function copyPaths(srcPaths: string[], destDir: string) {
    await invoke("copy_paths", { paths: srcPaths, destDir });
}

export async function movePaths(srcPaths: string[], destDir: string) {
    await invoke("move_paths", { paths: srcPaths, destDir });
}

export async function deletePaths(paths: string[]) {
    await invoke("delete_paths", { paths });
}

export async function renamePath(from: string, to: string) {
    if (!from || !to) return;
    return invoke("rename_path", { from, to });
}

