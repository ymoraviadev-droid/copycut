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
import type { PathSizerChildEvent } from "../types/PathSizerChildEvent";
import type { PathSizerSummaryEvent } from "../types/PathSizerSummaryEvent";
import type { PathSizerProgressEvent } from "../types/PathSizerProgressEvent";

export default function useFs(view?: PaneView) {
    const [rows, setRows] = useState<RowType[]>([]);
    const [currentPath, setCurrentPath] = useState("");
    const [rootPath, setRootPath] = useState("");

    const [itemsCount, setItemsCount] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);

    // navigation / cancellation
    const loadSeqRef = useRef(0);
    const currentPathRef = useRef("");
    const currentScanKeyRef = useRef(""); // path-keyed filtering
    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);

    // per-folder bookkeeping (for *current* path)
    const knownDirBytesRef = useRef<Map<string, number>>(new Map());
    const nameToRowIndexRef = useRef<Map<string, number>>(new Map());
    const runningTotalRef = useRef<number>(0);

    // Which subdirs are actively scanning (incomplete cache)
    const scanningDirsRef = useRef<Set<string>>(new Set());

    // UI batching for progress (throttle)
    const pendingProgressRef = useRef<Map<string, number>>(new Map()); // name -> latest bytes
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFlushedBytesRef = useRef<number>(0); // for big-jump forcing
    const currentFlushScanKeyRef = useRef<string>("");

    function scheduleFlushProgress(scanKey: string) {
        // if scanKey changed, cancel old flush
        if (currentFlushScanKeyRef.current !== scanKey) {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            currentFlushScanKeyRef.current = scanKey;
            lastFlushedBytesRef.current = 0;
        }
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            flushProgressNow(scanKey);
        }, 100); // ~10fps
    }

    function flushProgressNow(expectedScanKey: string) {
        // Ignore if navigated away
        if (expectedScanKey !== currentScanKeyRef.current) {
            pendingProgressRef.current.clear();
            return;
        }
        if (pendingProgressRef.current.size === 0) return;

        let totalDelta = 0;
        const updates: Array<{ idx: number; bytes: number; name: string }> = [];

        pendingProgressRef.current.forEach((bytes, name) => {
            pendingProgressRef.current.delete(name);
            if (!scanningDirsRef.current.has(name)) return;

            const prev = knownDirBytesRef.current.get(name) ?? 0;
            const bounded = Math.max(prev, bytes); // monotonic
            if (bounded === prev) return;

            knownDirBytesRef.current.set(name, bounded);
            const idx = nameToRowIndexRef.current.get(name);
            if (idx != null) updates.push({ idx, bytes: bounded, name });
            totalDelta += (bounded - prev);
        });

        if (updates.length === 0 && totalDelta === 0) return;

        // monotonic total: never decrease
        if (totalDelta > 0) {
            runningTotalRef.current += totalDelta;
            setTotalBytes(runningTotalRef.current);
        }

        if (updates.length) {
            setRows(prev => {
                const next = [...prev];
                for (const u of updates) {
                    const r = next[u.idx];
                    if (!r) continue;
                    next[u.idx] = { ...r, size: `${fmtSize(u.bytes)} (scanning…)` };
                }
                return next;
            });
        }
    }

    const ignores: string[] = []; // add your ignores here if you expose them
    //const ignoresSig = (arr: string[]) => [...arr].sort().join(",");

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
            case "name": res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); break;
            case "size": res = (a.size || 0) - (b.size || 0); break;
            case "date": res = (a.modified || "").localeCompare(b.modified || ""); break;
            case "type":
                res = extOf(a.name).localeCompare(extOf(b.name));
                if (res === 0) res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
                break;
        }
        if (v.sortDir === "desc") res = -res;
        return res;
    }

    // ----- events barrier -----
    const eventsReadyPromiseRef = useRef<Promise<void> | null>(null);
    const eventsReadyResolveRef = useRef<(() => void) | null>(null);
    if (!eventsReadyPromiseRef.current) {
        eventsReadyPromiseRef.current = new Promise<void>((res) => { eventsReadyResolveRef.current = res; });
    }
    async function waitEventsReady() { await eventsReadyPromiseRef.current!; }

    useEffect(() => {
        let unsubs: UnlistenFn[] = [];
        (async () => {
            // PROGRESS (batched + monotonic)
            unsubs.push(
                await listen<PathSizerProgressEvent | any>("dir_size:progress", (evt) => {
                    const p = evt.payload as any;
                    if (!p || p.scan_key !== currentScanKeyRef.current) return;
                    if (!scanningDirsRef.current.has(p.name)) return;

                    // accumulate; flush throttled
                    // also force immediate flush on big jumps (>= 8MB) to keep UI lively
                    const prev = pendingProgressRef.current.get(p.name) ?? 0;
                    const nextVal = Math.max(prev, p.bytes); // keep monotonic in pending too
                    pendingProgressRef.current.set(p.name, nextVal);

                    const bigJump = (nextVal - lastFlushedBytesRef.current) >= (8 * 1024 * 1024);
                    if (bigJump) {
                        lastFlushedBytesRef.current = nextVal;
                        // immediate flush
                        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
                        flushProgressNow(currentScanKeyRef.current);
                    } else {
                        scheduleFlushProgress(currentScanKeyRef.current);
                    }
                })
            );

            // CHILD (final for a subdir) — immediate, monotonic
            unsubs.push(
                await listen<PathSizerChildEvent | any>("dir_size:child", (evt) => {
                    const p = evt.payload as any;
                    if (!p || p.scan_key !== currentScanKeyRef.current) return;

                    // remove any pending progress for this dir (we're final now)
                    pendingProgressRef.current.delete(p.name);

                    const prev = knownDirBytesRef.current.get(p.name) ?? 0;
                    const boundedFinal = Math.max(prev, p.bytes); // monotonic

                    knownDirBytesRef.current.set(p.name, boundedFinal);
                    scanningDirsRef.current.delete(p.name);

                    const delta = boundedFinal - prev;
                    if (delta > 0) {
                        runningTotalRef.current += delta;
                        setTotalBytes(runningTotalRef.current);
                    }

                    const idx = nameToRowIndexRef.current.get(p.name);
                    if (idx == null) return;

                    setRows(prevRows => {
                        const next = [...prevRows];
                        const r = next[idx];
                        if (r) next[idx] = { ...r, displayName: `${r.realName} /`, size: fmtSize(boundedFinal) };
                        return next;
                    });
                })
            );

            // SUMMARY (final for current folder)
            unsubs.push(
                await listen<PathSizerSummaryEvent | any>("dir_size:summary", (evt) => {
                    const p = evt.payload as any;
                    if (!p || p.scan_key !== currentScanKeyRef.current) return;

                    // clear any pending progress; this scan is done
                    pendingProgressRef.current.clear();
                    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }

                    // total monotonically increases or stays
                    const boundedTotal = Math.max(runningTotalRef.current, p.bytes);
                    runningTotalRef.current = boundedTotal;
                    setTotalBytes(boundedTotal);
                    scanningDirsRef.current.clear();

                    setRows(prev =>
                        prev.map(r => {
                            if (!r?.isDir || (r as any).specialUp) return r;
                            const nm = r.realName;
                            return nm ? { ...r, displayName: `${nm} /` } : r;
                        })
                    );
                })
            );

            eventsReadyResolveRef.current?.();
        })().catch(console.error);

        return () => {
            for (const u of unsubs) { try { u(); } catch { } }
            unsubs = [];
            scanningDirsRef.current.clear();
            pendingProgressRef.current.clear();
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        };
    }, []);

    // --- main loader ---
    async function loadPath(p: string) {
        const token = ++loadSeqRef.current;

        const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
        const scanKey = `${p}|${!!v.showHidden}|${[...ignores].sort().join(",")}`; // must match backend
        currentScanKeyRef.current = scanKey;

        // read dir
        const entries = (await invoke<FileEntry[]>("list_dir", { path: p })) ?? [];
        const filtered = v.showHidden ? entries : entries.filter(e => !e.name.startsWith("."));
        const sorted = [...filtered].sort(compare);

        const nameIndex = new Map<string, number>();
        const levelFilesBytes = sorted.filter(e => !e.is_dir).reduce((s, e) => s + (e.size || 0), 0);

        // Prefill from cache
        const childDirs = sorted.filter(e => e.is_dir);
        const childFullPaths = await Promise.all(childDirs.map(e => join(p, e.name)));
        let cached: Array<null | [number, number, boolean]> = [];
        try {
            cached = await invoke<Array<null | [number, number, boolean]>>("get_cached_sizes", {
                paths: childFullPaths,
                show_hidden: !!v.showHidden,
                showHidden: !!v.showHidden, // harmless extra param
                ignores: ignores as string[],
            });
        } catch {
            cached = new Array(childDirs.length).fill(null);
        }
        if (token !== loadSeqRef.current) return;

        // reset state for this path
        knownDirBytesRef.current = new Map();
        nameToRowIndexRef.current = new Map();
        scanningDirsRef.current.clear();
        pendingProgressRef.current.clear();
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }

        const up: RowType = { displayName: "..", isDir: true, size: "", date: "", specialUp: true };
        const rowsBuilt: RowType[] = [up];

        let sumCachedDirs = 0;
        let needsScan = false;

        for (let i = 0; i < sorted.length; i++) {
            const e = sorted[i];

            if (!e.is_dir) {
                rowsBuilt.push({
                    displayName: e.name,
                    isDir: false,
                    size: fmtSize(e.size || 0),
                    date: `${getDate(e.modified)} ${getTime(e.modified)}`,
                    realName: e.name,
                });
                nameIndex.set(e.name, rowsBuilt.length - 1);
                continue;
            }

            const cacheIdx = childDirs.findIndex(cd => cd.name === e.name);
            const maybe = cacheIdx >= 0 ? cached[cacheIdx] : null;

            let initialBytes = 0;
            let completed = false;

            if (maybe) {
                initialBytes = maybe[0] ?? 0;
                completed = !!maybe[2];
            }

            knownDirBytesRef.current.set(e.name, initialBytes);
            if (!completed) {
                scanningDirsRef.current.add(e.name);
                needsScan = true;
            }

            sumCachedDirs += initialBytes;

            rowsBuilt.push({
                displayName: `${e.name} /`,
                isDir: true,
                size: completed
                    ? fmtSize(initialBytes)
                    : `${fmtSize(initialBytes)}${initialBytes ? " " : ""}(scanning…)`,
                date: `${getDate(e.modified)} ${getTime(e.modified)}`,
                realName: e.name,
            });
            nameIndex.set(e.name, rowsBuilt.length - 1);
        }

        setItemsCount(sorted.length);

        // total should not drop below previous known total for this path in fast navs,
        // but since scanKey changes only on this path, we can safely reset to the
        // prefill sum here, and the batching will only increase it.
        runningTotalRef.current = levelFilesBytes + sumCachedDirs;
        setTotalBytes(runningTotalRef.current);

        nameToRowIndexRef.current = nameIndex;
        setRows(rowsBuilt);

        // set after paint
        currentPathRef.current = p;
        setCurrentPath(p);

        if (token !== loadSeqRef.current) return;
        await waitEventsReady();

        // Start backend only if needed
        if (needsScan) {
            try {
                const jobId = `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                await invoke("ensure_path_sizer", {
                    path: p,
                    jobId,
                    job_id: jobId,
                    show_hidden: !!v.showHidden,
                    showHidden: !!v.showHidden,
                    ignores: ignores as string[],
                });
            } catch (e) {
                console.error("ensure_path_sizer failed:", e);
                scanningDirsRef.current.clear();
                pendingProgressRef.current.clear();
                if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            }
        }
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
