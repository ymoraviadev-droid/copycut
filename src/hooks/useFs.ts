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
    const currentJobIdRef = useRef("");
    useEffect(() => {
        currentPathRef.current = currentPath;
    }, [currentPath]);

    // per-folder bookkeeping
    const knownDirBytesRef = useRef<Map<string, number>>(new Map());
    const nameToRowIndexRef = useRef<Map<string, number>>(new Map());
    const runningTotalRef = useRef<number>(0);

    // Track which directories are currently being scanned
    const scanningDirsRef = useRef<Set<string>>(new Set());

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

    // ---- EVENTS READY BARRIER ---------------------------------------------------
    const eventsReadyPromiseRef = useRef<Promise<void> | null>(null);
    const eventsReadyResolveRef = useRef<(() => void) | null>(null);
    if (!eventsReadyPromiseRef.current) {
        eventsReadyPromiseRef.current = new Promise<void>((res) => {
            eventsReadyResolveRef.current = res;
        });
    }
    async function waitEventsReady() {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await eventsReadyPromiseRef.current!;
    }

    // ---- subscribe ONCE; resolve the barrier when handlers are attached --------
    useEffect(() => {
        let unsubs: UnlistenFn[] = [];
        (async () => {
            // progress: עדכון ביניים לעמודת Size ולסכום הכולל
            unsubs.push(
                await listen<PathSizerProgressEvent>("dir_size:progress", (evt) => {
                    const p = evt.payload as unknown as { job_id: string; name: string; bytes: number };
                    if (!p || p.job_id !== currentJobIdRef.current) return;

                    // אם התיקיה כבר סומנה כסיימה, נתעלם מאירועי התקדמות
                    if (!scanningDirsRef.current.has(p.name)) return;

                    const prev = knownDirBytesRef.current.get(p.name) ?? 0;
                    const nextBytes = p.bytes;

                    // שמירת ערך ביניים לתיקייה
                    knownDirBytesRef.current.set(p.name, nextBytes);

                    // עדכון דלתא ל-totalBytes
                    const delta = nextBytes - prev;
                    if (delta !== 0) {
                        runningTotalRef.current += delta;
                        setTotalBytes(runningTotalRef.current);
                    }

                    // עדכון שורת התיקייה (scanning…)
                    const idx = nameToRowIndexRef.current.get(p.name);
                    if (idx != null) {
                        setRows((prevRows) => {
                            const next = [...prevRows];
                            const r = next[idx];
                            if (r) {
                                next[idx] = {
                                    ...r,
                                    size: `${fmtSize(nextBytes)} (scanning…)`,
                                };
                            }
                            return next;
                        });
                    }
                })
            );

            // child: ערך סופי לתיקיית-בן + דלתא ל-total
            unsubs.push(
                await listen<PathSizerChildEvent>("dir_size:child", (evt) => {
                    const p = evt.payload as unknown as { job_id: string; name: string; bytes: number };
                    if (!p || p.job_id !== currentJobIdRef.current) return;

                    const prev = knownDirBytesRef.current.get(p.name) ?? 0;
                    knownDirBytesRef.current.set(p.name, p.bytes);

                    // סיום סריקת התיקיה הזו
                    scanningDirsRef.current.delete(p.name);

                    // עדכון דלתא לפני UI
                    const delta = p.bytes - prev;
                    if (delta !== 0) {
                        runningTotalRef.current += delta;
                        setTotalBytes(runningTotalRef.current);
                    }

                    const idx = nameToRowIndexRef.current.get(p.name);
                    if (idx == null) return;

                    setRows((prev) => {
                        const next = [...prev];
                        const r = next[idx];
                        if (r) {
                            next[idx] = {
                                ...r,
                                displayName: `${r.realName} /`,
                                size: fmtSize(p.bytes), // ערך סופי, בלי "(scanning…)"
                            };
                        }
                        return next;
                    });
                })
            );

            // summary: ערך סיכום סופי וניקוי מצבים
            unsubs.push(
                await listen<PathSizerSummaryEvent>("dir_size:summary", (evt) => {
                    const p = evt.payload;
                    if (!p || p.job_id !== currentJobIdRef.current) return;
                    runningTotalRef.current = p.bytes;
                    setTotalBytes(p.bytes);

                    // Clear all scanning states
                    scanningDirsRef.current.clear();

                    // ניקוי שאריות טקסט ביניים בשם התצוגה
                    setRows((prev) =>
                        prev.map((r) => {
                            if (!r?.isDir || (r as any).specialUp) return r;
                            const nm = r.realName;
                            return nm ? { ...r, displayName: `${nm} /` } : r;
                        })
                    );
                })
            );

            // listeners are attached — release the barrier
            eventsReadyResolveRef.current?.();
        })().catch(console.error);

        return () => {
            for (const u of unsubs) {
                try {
                    u();
                } catch { }
            }
            unsubs = [];
            scanningDirsRef.current.clear();
            // don't reset the barrier; listeners stay attached for the app lifetime
        };
    }, []);

    // --- main loader ------------------------------------------------------------
    async function loadPath(p: string) {
        const token = ++loadSeqRef.current;
        const jobId = `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Store current job ID for event filtering
        currentJobIdRef.current = jobId;

        knownDirBytesRef.current = new Map();
        nameToRowIndexRef.current = new Map();
        runningTotalRef.current = 0;
        scanningDirsRef.current.clear();

        const entries = (await invoke<FileEntry[]>("list_dir", { path: p })) ?? [];
        const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
        const filtered = v.showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
        const sorted = [...filtered].sort(compare);

        setItemsCount(sorted.length);
        const levelFilesBytes = sorted.filter((e) => !e.is_dir).reduce((s, e) => s + (e.size || 0), 0);
        runningTotalRef.current = levelFilesBytes;
        setTotalBytes(levelFilesBytes);

        const up: RowType = { displayName: "..", isDir: true, size: "", date: "", specialUp: true };
        const mapped: RowType[] = sorted.map((e) => ({
            displayName: `${e.name}${e.is_dir ? " /" : ""}`,
            isDir: e.is_dir,
            size: fmtSize(e.is_dir ? 0 : e.size || 0),
            date: `${getDate(e.modified)} ${getTime(e.modified)}`,
            realName: e.name,
        }));

        const nameIndex = new Map<string, number>();
        sorted.forEach((e, i) => {
            nameIndex.set(e.name, i + 1);
        });
        nameToRowIndexRef.current = nameIndex;

        setRows([up, ...mapped]);

        // set the ref BEFORE starting any sizing so early events match
        currentPathRef.current = p;
        setCurrentPath(p);

        // prefill from cache
        const childDirs = sorted.filter((e) => e.is_dir);
        const childFullPaths = await Promise.all(childDirs.map((e) => join(p, e.name)));
        try {
            const cached = await invoke<Array<null | [number, number, boolean]>>("get_cached_sizes", {
                paths: childFullPaths,
                show_hidden: !!v.showHidden,
                showHidden: !!v.showHidden,
                ignores: [] as string[],
            });

            if (token !== loadSeqRef.current) return;

            // Mark uncached directories as scanning
            childDirs.forEach((e, idx) => {
                const maybe = cached[idx];
                if (!maybe) {
                    scanningDirsRef.current.add(e.name);
                }
            });

            let added = 0;
            cached.forEach((maybe, idx) => {
                if (!maybe) return;
                const bytes = maybe[0];
                const items = maybe[1];
                const name = childDirs[idx].name;
                const rowIdx = nameIndex.get(name);
                knownDirBytesRef.current.set(name, bytes);

                if (rowIdx != null) {
                    setRows((prev) => {
                        const next = [...prev];
                        const r = next[rowIdx];
                        if (r) {
                            next[rowIdx] = {
                                ...r,
                                displayName: `${name} /`,
                                size:
                                    items != null
                                        ? `${fmtSize(bytes)} · ${items} item${items === 1 ? "" : "s"}`
                                        : fmtSize(bytes),
                            };
                        }
                        return next;
                    });
                }
                added += bytes;
            });

            if (added) {
                runningTotalRef.current = levelFilesBytes + added;
                setTotalBytes(runningTotalRef.current);
            }
        } catch {
            // If cache lookup fails, mark all dirs as scanning
            childDirs.forEach((e) => scanningDirsRef.current.add(e.name));
        }

        if (token !== loadSeqRef.current) return;

        // <<< WAIT FOR LISTENERS BEFORE STARTING THE SIZER >>>
        await waitEventsReady();

        try {
            await invoke("ensure_path_sizer", {
                path: p,
                jobId,
                job_id: jobId,
                show_hidden: !!v.showHidden,
                showHidden: !!v.showHidden,
                ignores: [] as string[],
            });
        } catch (e) {
            console.error("ensure_path_sizer failed:", e);
            scanningDirsRef.current.clear();
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
        if ((r as any).specialUp) {
            await goUp();
            return;
        }
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
