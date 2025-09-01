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
    const knownDirBytesRef = useRef<Map<string, number>>(new Map()); // child name -> bytes
    const nameToRowIndexRef = useRef<Map<string, number>>(new Map()); // child name -> row index (+1 due to "..")
    const runningTotalRef = useRef<number>(0);                       // files + finished dirs

    // --- dot animation state (only for folders still computing) -----------------
    const animatingNamesRef = useRef<Set<string>>(new Set());         // names currently “spinning”
    const dotsTickRef = useRef<number>(1);                      // 1..5
    const dotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    function startDotTimer() {
        stopDotTimer();
        dotTimerRef.current = setInterval(() => {
            // advance ticker
            dotsTickRef.current = (dotsTickRef.current % 5) + 1;
            // repaint only the displayName for animating folders
            const dots = ".".repeat(dotsTickRef.current);
            setRows(prev => {
                if (!animatingNamesRef.current.size) return prev;
                const next = prev.map((r) => {
                    if (!r?.isDir || (r as any).specialUp) return r;
                    const name = r.realName || r.displayName.replace(/\s*\/.*/, "");
                    if (!name || !animatingNamesRef.current.has(name)) return r;
                    // Rebuild from realName to avoid compounding dots:
                    const base = `${name} /`;
                    return { ...r, displayName: `${base} ${dots}` };
                });
                return next;
            });
        }, 500);
    }
    function stopDotTimer() {
        if (dotTimerRef.current) {
            clearInterval(dotTimerRef.current);
            dotTimerRef.current = null;
        }
    }
    function maybeStopDots() {
        if (animatingNamesRef.current.size === 0) stopDotTimer();
    }

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
                await listen<ChildSizeEvent>("dir_size:child", async (evt) => {
                    const p = evt.payload;
                    if (!p || p.job_id !== currentJobIdRef.current) return;

                    // de-dupe: only add once per folder
                    if (knownDirBytesRef.current.has(p.name)) return;
                    knownDirBytesRef.current.set(p.name, p.bytes);

                    // stop animating this name
                    if (animatingNamesRef.current.delete(p.name)) {
                        maybeStopDots();
                    }

                    // derive row index
                    const idx = nameToRowIndexRef.current.get(p.name);
                    if (idx == null) {
                        // still bump total even if row missing
                        runningTotalRef.current = runningTotalRef.current + p.bytes;
                        setTotalBytes(runningTotalRef.current);
                        return;
                    }

                    // also compute immediate children count for the “· N items” part
                    // (respect showHidden like the list view)
                    let itemsCountForDir = 0;
                    try {
                        const full = await join(currentPath, p.name);
                        const kids = (await invoke<FileEntry[]>("list_dir", { path: full })) ?? [];
                        const v = view || { showHidden: false } as PaneView;
                        itemsCountForDir = (v.showHidden ? kids : kids.filter(e => !e.name.startsWith("."))).length;
                    } catch {
                        itemsCountForDir = 0;
                    }

                    // patch row with “<bytes> · <items>”
                    setRows((prev) => {
                        const next = [...prev];
                        const r = next[idx];
                        if (r) {
                            const name = r.realName || p.name;
                            // Remove any animation dots by rebuilding from real name
                            const display = `${name} /`;
                            next[idx] = {
                                ...r,
                                displayName: display,
                                size: `${fmtSize(p.bytes)} · ${itemsCountForDir} item${itemsCountForDir === 1 ? "" : "s"}`,
                            };
                        }
                        return next;
                    });

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

                    // Clear all remaining animations (if any)
                    animatingNamesRef.current.clear();
                    stopDotTimer();

                    // Final pass to normalize any displayNames that might still have dots
                    setRows(prev => prev.map(r => {
                        if (!r?.isDir || (r as any).specialUp) return r;
                        const nm = r.realName;
                        if (!nm) return r;
                        return { ...r, displayName: `${nm} /` };
                    }));
                })
            );
        })().catch(console.error);

        return () => {
            for (const u of unsubs) try { u(); } catch { }
            unsubs = [];
            stopDotTimer();
            animatingNamesRef.current.clear();
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
        animatingNamesRef.current.clear();
        stopDotTimer();

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
            size: fmtSize(e.is_dir ? 0 : (e.size || 0)), // replaced on child events
            date: `${getDate(e.modified)} ${getTime(e.modified)}`,
            realName: e.name,
        }));

        // map name -> row index (+1 to skip "..")
        const nameIndex = new Map<string, number>();
        sorted.forEach((e, i) => { nameIndex.set(e.name, i + 1); });
        nameToRowIndexRef.current = nameIndex;

        setRows([up, ...mapped]);
        setCurrentPath(p);

        // mark ALL folders as “animating” initially (they’ll clear as results arrive)
        for (const e of sorted) if (e.is_dir) animatingNamesRef.current.add(e.name);
        if (animatingNamesRef.current.size) {
            dotsTickRef.current = 1;
            startDotTimer();
        }

        // kick the background sizer for this directory
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        currentJobIdRef.current = jobId;

        // guard: if user navigated away very fast
        if (token !== loadSeqRef.current) return;

        try {
            await invoke("start_dir_sizer", {
                app: null,                 // AppHandle is provided by Tauri; keep null here
                path: p,
                jobId,
                showHidden: !!v.showHidden,
                ignores: [] as string[],
            });
        } catch (e) {
            console.error("start_dir_sizer failed:", e);
            // stop anim; leave 0 B (or we could fall back to single dir_size here if you want)
            animatingNamesRef.current.clear();
            stopDotTimer();
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
