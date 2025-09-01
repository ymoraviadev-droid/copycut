// hooks/useFs.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { openPath as openWithDefaultApp } from "@tauri-apps/plugin-opener";
import type { FileEntry } from "../types/FileEntry";
import type { RowType } from "../types/RowType";
import { fmtSize, getDate, getTime, parentPath } from "../utils/fileDataParse";
import { PaneView } from "../types/PaneTypes";

export default function useFs(view?: PaneView) {
    const [rows, setRows] = useState<RowType[]>([]);
    const [currentPath, setCurrentPath] = useState("");
    const [rootPath, setRootPath] = useState("");

    const [itemsCount, setItemsCount] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);

    // cancel token
    const loadSeqRef = useRef(0);

    function extOf(name: string) {
        const i = name.lastIndexOf(".");
        return i > 0 ? name.slice(i + 1).toLowerCase() : "";
    }

    function compare(a: FileEntry, b: FileEntry): number {
        const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
        if (v.dirsFirst) {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
        }
        let res = 0;
        switch (v.sortKey) {
            case "name":
                res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
                break;
            case "size":
                res = (a.size || 0) - (b.size || 0);
                break;
            case "date":
                res = (a.modified || "").localeCompare(b.modified || "");
                break;
            case "type":
                res = extOf(a.name).localeCompare(extOf(b.name));
                if (res === 0) res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
                break;
        }
        if (v.sortDir === "desc") res = -res;
        return res;
    }

    async function loadPath(p: string) {
        const token = ++loadSeqRef.current;

        // 1) list entries (fast)
        const entries = (await invoke<FileEntry[]>("list_dir", { path: p })) ?? [];

        const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
        const filtered = v.showHidden ? entries : entries.filter(e => !e.name.startsWith("."));
        const sorted = [...filtered].sort(compare);

        // 2) quick stats for level files
        setItemsCount(sorted.length);
        const levelFilesBytes = sorted.filter(e => !e.is_dir).reduce((s, e) => s + (e.size || 0), 0);
        let runningTotal = levelFilesBytes; // will add each dir as it completes
        setTotalBytes(runningTotal);

        // 3) paint rows (dirs start at "0 B", get patched later)
        const up: RowType = { displayName: "..", isDir: true, size: "", date: "", specialUp: true };
        const mapped: RowType[] = sorted.map(e => ({
            displayName: `${e.name}${e.is_dir ? " /" : ""}`,
            isDir: e.is_dir,
            size: fmtSize(e.size || 0),
            date: `${getDate(e.modified)} ${getTime(e.modified)}`,
            realName: e.name,
        }));

        setRows([up, ...mapped]);
        setCurrentPath(p);

        // 4) prepare directory jobs: compute full path + target row index
        const dirInfos = (await Promise.all(
            sorted.map(async (e, i) =>
                e.is_dir ? { name: e.name, rowIdx: i + 1, full: await join(p, e.name) } : null
            )
        )).filter(Boolean) as { name: string; rowIdx: number; full: string }[];

        // helper: limited concurrency runner
        async function runLimited<T>(
            items: T[],
/*  */            limit: number,
            fn: (item: T) => Promise<void>
        ) {
            const queue = items.slice();
            const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
                while (queue.length) {
                    if (token !== loadSeqRef.current) return;
                    const item = queue.shift()!;
                    await fn(item);
                }
            });
            await Promise.all(workers);
        }

        // 5) stream sizes with concurrency (e.g., 4 at a time)
        await runLimited(dirInfos, 4, async (info) => {
            try {
                const bytes = await invoke<number>("dir_size", { path: info.full });
                if (token !== loadSeqRef.current) return;

                // patch that row
                setRows(prev => {
                    const next = [...prev];
                    const r = next[info.rowIdx];
                    if (r) next[info.rowIdx] = { ...r, size: fmtSize(bytes) };
                    return next;
                });

                // update running total (files + finished dirs so far)
                runningTotal += bytes;
                setTotalBytes(runningTotal);
            } catch {
                // leave 0 B if unreadable; keep going
            }
        });
    }

    async function goUp() {
        const parent = parentPath(currentPath);
        const target = parent.startsWith(rootPath) ? parent : rootPath;
        await loadPath(target);
    }

    async function openEntry(index: number) {
        const r = rows[index];
        if (!r) return;
        if ((r as any).specialUp) { await goUp(); return; }
        const full = await join(currentPath, r.realName!);
        if (r.isDir) await loadPath(full);
        else await openWithDefaultApp(full);
    }

    // initial load
    useEffect(() => {
        (async () => {
            const home = (await homeDir()).replace(/\\/g, "/").replace(/\/$/, "");
            setRootPath(home);
            await loadPath(home);
        })().catch(console.error);
    }, []);

    // reload on view changes
    useEffect(() => {
        if (!currentPath) return;
        loadPath(currentPath);
    }, [view?.showHidden, view?.sortKey, view?.sortDir, view?.dirsFirst]);

    const itemsCountMemo = useMemo(() => itemsCount, [itemsCount]);
    const totalBytesMemo = useMemo(() => totalBytes, [totalBytes]);

    return {
        rows,
        currentPath,
        rootPath,
        itemsCount: itemsCountMemo,
        totalBytes: totalBytesMemo,
        loadPath,
        goUp,
        openEntry,
    };
}
