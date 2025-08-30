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
