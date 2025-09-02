import { Dispatch, SetStateAction, useEffect, useRef } from "react";
import { RowType } from "../../types/RowType";
import { fmtSize } from "../../utils/fileDataHelpers";

export default function useFsProgressRefs(
    setTotalBytes: Dispatch<SetStateAction<number>>,
    setRows: Dispatch<SetStateAction<RowType[]>>,
    currentPath: string
) {
    const loadSeqRef = useRef(0);
    const currentPathRef = useRef("");
    const currentScanKeyRef = useRef(""); // path-keyed filtering

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

    // ----- events barrier -----
    const eventsReadyPromiseRef = useRef<Promise<void> | null>(null);
    const eventsReadyResolveRef = useRef<(() => void) | null>(null);

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

    useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);


    if (!eventsReadyPromiseRef.current) {
        eventsReadyPromiseRef.current = new Promise<void>((res) => { eventsReadyResolveRef.current = res; });
    }

    async function waitEventsReady() { await eventsReadyPromiseRef.current!; }

    return {
        scheduleFlushProgress, flushProgressNow, waitEventsReady,
        currentScanKeyRef,
        knownDirBytesRef, nameToRowIndexRef, runningTotalRef,
        scanningDirsRef,
        pendingProgressRef, flushTimerRef, lastFlushedBytesRef,
        loadSeqRef, currentPathRef, eventsReadyResolveRef
    };
}