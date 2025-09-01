// hooks/useFs.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { openPath as openWithDefaultApp } from "@tauri-apps/plugin-opener";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileEntry } from "../types/FileEntry";
import type { RowType } from "../types/RowType";
import { fmtSize, getDate, getTime, parentPath } from "../utils/fileDataParse";
import { PaneView } from "../types/PaneTypes";

type ChildSizeEvent = { job_id: string; name: string; bytes: number };
type SummaryEvent = { job_id: string; bytes: number };

export default function useFs(view?: PaneView) {
    const [rows, setRows] = useState<RowType[]>([]);
    const [currentPath, setCurrentPath] = useState("");
    const [rootPath, setRootPath] = useState("");

    const [itemsCount, setItemsCount] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);

    // cancel/load tracking
    const loadSeqRef = useRef(0);

    // dir_sizer job tracking
    const currentJobIdRef = useRef<string | null>(null);

    // per-folder bookkeeping
    const knownDirBytesRef = useRef<Map<string, number>>(new Map()); // child name -> bytes (emitted)
    const nameToRowIndexRef = useRef<Map<string, number>>(new Map()); // child name -> row index (+1 due to "..")
    const runningTotalRef = useRef<number>(0);                       // status-bar total (files + finished dirs)

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

    // --- event wiring (once) ----------------------------------------------------
    useEffect(() => {
        let unsubs: UnlistenFn[] = [];

        (async () => {
            // per-child folder result
            unsubs.push(
                await listen<ChildSizeEvent>("dir_size:child", (evt) => {
                    const p = evt.payload;
                    // wrong job? ignore (old job after navigation)
                    if (!p || p.job_id !== currentJobIdRef.current) return;

                    // de-dupe: only add once
                    if (knownDirBytesRef.current.has(p.name)) return;
                    knownDirBytesRef.current.set(p.name, p.bytes);

                    // update row
                    const idx = nameToRowIndexRef.current.get(p.name);
                    if (idx != null) {
                        setRows((prev) => {
                            const next = [...prev];
                            const r = next[idx];
                            if (r) next[idx] = { ...r, size: fmtSize(p.bytes) };
                            return next;
                        });
                    }

                    // bump running total (files already included)
                    runningTotalRef.current = runningTotalRef.current + p.bytes;
                    setTotalBytes(runningTotalRef.current);
                })
            );

            // final summary for this directory
            unsubs.push(
                await listen<SummaryEvent>("dir_size:summary", (evt) => {
                    const p = evt.payload;
                    if (!p || p.job_id !== currentJobIdRef.current) return;
                    runningTotalRef.current = p.bytes;
                    setTotalBytes(p.bytes);
                    // job is done; backend also removes it from its map
                })
            );
        })().catch(console.error);

        return () => {
            for (const u of unsubs) try { u(); } catch { }
            unsubs = [];
        };
    }, []);

    // --- main loader ------------------------------------------------------------
    async function loadPath(p: string) {
        const token = ++loadSeqRef.current;

        // cancel previous dir_sizer job if any
        if (currentJobIdRef.current) {
            try { await invoke("cancel_dir_sizer", { jobId: currentJobIdRef.current }); } catch { }
            currentJobIdRef.current = null;
        }

        // reset per-folder state
        knownDirBytesRef.current = new Map();
        nameToRowIndexRef.current = new Map();
        runningTotalRef.current = 0;

        // list fast
        const entries = (await invoke<FileEntry[]>("list_dir", { path: p })) ?? [];
        const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
        const filtered = v.showHidden ? entries : entries.filter(e => !e.name.startsWith("."));
        const sorted = [...filtered].sort(compare);

        // quick stats for files at this level
        setItemsCount(sorted.length);
        const levelFilesBytes = sorted.filter(e => !e.is_dir).reduce((s, e) => s + (e.size || 0), 0);
        runningTotalRef.current = levelFilesBytes;
        setTotalBytes(levelFilesBytes);

        // paint rows (dir sizes start at 0 B; updated by events)
        const up: RowType = { displayName: "..", isDir: true, size: "", date: "", specialUp: true };
        const mapped: RowType[] = sorted.map(e => ({
            displayName: `${e.name}${e.is_dir ? " /" : ""}`,
            isDir: e.is_dir,
            size: fmtSize(e.is_dir ? 0 : (e.size || 0)),
            date: `${getDate(e.modified)} ${getTime(e.modified)}`,
            realName: e.name,
        }));

        // map name -> row index (+1 to skip "..")
        const nameIndex = new Map<string, number>();
        sorted.forEach((e, i) => { nameIndex.set(e.name, i + 1); });
        nameToRowIndexRef.current = nameIndex;

        setRows([up, ...mapped]);
        setCurrentPath(p);

        // kick the background sizer for this directory
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        currentJobIdRef.current = jobId;

        // show_hidden / ignores are plumbed through as you defined in Rust
        const show_hidden = !!v.showHidden;
        const ignores: string[] = []; // keep empty unless you want patterns

        // guard: if user navigated away very fast
        if (token !== loadSeqRef.current) return;

        try {
            await invoke("start_dir_sizer", {
                app: null,                 // AppHandle is supplied by Tauri under the hood; keep null here
                path: p,
                jobId,
                showHidden: show_hidden,
                ignores,
            });
        } catch (e) {
            // If the streaming job fails, we can fall back to static dir_size(p)
            // but per your ask I'll keep it minimal and just log.
            console.error("start_dir_sizer failed:", e);
        }
    }

    // --- nav helpers ------------------------------------------------------------
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // reload on view changes
    useEffect(() => {
        if (!currentPath) return;
        loadPath(currentPath);
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
