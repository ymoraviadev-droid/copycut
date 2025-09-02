// hooks/fsNav.ts
import { join } from "@tauri-apps/api/path";
import { openPath as openWithDefaultApp } from "@tauri-apps/plugin-opener";
import { RowType } from "../types/RowType";
import { parentPath } from "./fileDataHelpers";

/** Compute the folder we should navigate to when going up. */
export function resolveGoUpTarget(currentPath: string, rootPath: string): string {
    const parent = parentPath(currentPath);
    return parent.startsWith(rootPath) ? parent : rootPath;
}

/** Perform "go up" navigation. */
export async function goUpNav(
    currentPath: string,
    rootPath: string,
    loadPath: (p: string) => Promise<void>
): Promise<void> {
    const target = resolveGoUpTarget(currentPath, rootPath);
    await loadPath(target);
}

/** Open a row by index: either navigate into dir, go up, or open file with default app. */
export async function openEntryNav(
    index: number,
    rows: RowType[],
    currentPath: string,
    rootPath: string,
    loadPath: (p: string) => Promise<void>
): Promise<void> {
    const r = rows[index];
    if (!r) return;

    // ".." row
    if ((r as any).specialUp) {
        await goUpNav(currentPath, rootPath, loadPath);
        return;
    }

    const full = await join(currentPath, r.realName!);
    if (r.isDir) {
        await loadPath(full);
    } else {
        await openWithDefaultApp(full);
    }
}
