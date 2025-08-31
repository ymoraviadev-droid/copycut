// hooks/useSelection.ts
import { useCallback, useEffect, useRef, useState } from "react";

type Opts = {
    onOpen: (i: number) => void;
    onUp: () => void;
};

export default function useSelection(rowCount: number, opts: Opts) {
    // focused row (acts like your old selectedRow)
    const [cursor, setCursor] = useState(0);
    // multi-select set (excludes "../" at index 0)
    const [selected, setSelected] = useState<Set<number>>(new Set());
    // anchor for range selection
    const anchorRef = useRef(0);
    // refs for scroll-into-view
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

    // --- drag-range selection state (no native DnD) ---
    const draggingRef = useRef(false);
    const dragOriginRef = useRef(0);
    const preDragRef = useRef<Set<number>>(new Set());
    const dragAdditiveRef = useRef(false);

    // keep cursor visible
    useEffect(() => {
        const el = rowRefs.current[cursor];
        if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [cursor]);

    // clamp when list shrinks
    useEffect(() => {
        if (cursor >= rowCount) setCursor(rowCount ? rowCount - 1 : 0);
    }, [rowCount, cursor]);

    const clear = () => setSelected(new Set());

    // mouse: Ctrl/Alt/Meta toggles, Shift = range, plain = single
    const click = useCallback(
        (i: number, e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) => {
            const ctrl = e.ctrlKey || e.metaKey || e.altKey;
            const shift = !!e.shiftKey;

            if (shift) {
                const start = Math.min(anchorRef.current, i);
                const end = Math.max(anchorRef.current, i);
                const next = new Set<number>();
                for (let k = start; k <= end; k++) if (k !== 0) next.add(k); // never select "../"
                setSelected(next);
            } else if (ctrl) {
                const next = new Set(selected);
                if (i !== 0) {
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                }
                setSelected(next);
                anchorRef.current = i;
            } else {
                const next = new Set<number>();
                if (i !== 0) next.add(i);
                setSelected(next);
                anchorRef.current = i;
            }
            setCursor(i);
        },
        [selected]
    );

    // keyboard: blends your old useSelection + multi-select
    const key = useCallback(
        (e: React.KeyboardEvent) => {
            if (!rowCount) return;

            // go up dir with Ctrl/Meta + ArrowUp (old behavior)
            if (e.key === "ArrowUp" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                opts.onUp();
                return;
            }

            // core handled keys
            const handled = ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Insert", " ", "Enter", "Backspace"];
            if (handled.includes(e.key)) e.preventDefault();

            // movement
            if (e.key === "ArrowDown") setCursor(i => Math.min(i + 1, rowCount - 1));
            if (e.key === "ArrowUp") setCursor(i => Math.max(i - 1, 0));
            if (e.key === "Home") setCursor(0);
            if (e.key === "End") setCursor(rowCount - 1);
            if (e.key === "PageDown") setCursor(i => Math.min(i + 15, rowCount - 1));
            if (e.key === "PageUp") setCursor(i => Math.max(i - 15, 0));

            // extend selection with Shift+Arrows
            if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                const nextIndex = e.key === "ArrowDown" ? Math.min(cursor + 1, rowCount - 1) : Math.max(cursor - 1, 0);
                const start = Math.min(anchorRef.current, nextIndex);
                const end = Math.max(anchorRef.current, nextIndex);
                const next = new Set<number>();
                for (let k = start; k <= end; k++) if (k !== 0) next.add(k);
                setSelected(next);
                setCursor(nextIndex);
            }

            // MC style: Insert toggles + moves down; Space toggles.
            if (e.key === "Insert") {
                const i = cursor;
                const next = new Set(selected);
                if (i !== 0) { next.has(i) ? next.delete(i) : next.add(i); }
                setSelected(next);
                setCursor(v => Math.min(v + 1, rowCount - 1));
            }
            if (e.key === " ") {
                const i = cursor;
                const next = new Set(selected);
                if (i !== 0) { next.has(i) ? next.delete(i) : next.add(i); }
                setSelected(next);
            }

            // open/back (old behavior)
            if (e.key === "Enter") opts.onOpen(cursor);
            if (e.key === "Backspace") opts.onUp();
        },
        [rowCount, cursor, selected, opts]
    );

    // ---- DRAG-RANGE (mouse drag only) -----------------------------------------

    function dragStart(i: number, additive: boolean) {
        draggingRef.current = true;
        dragOriginRef.current = i;
        preDragRef.current = new Set(selected);
        dragAdditiveRef.current = additive;
        anchorRef.current = i;
        setCursor(i);
        // nicer UX: avoid text selection while dragging
        document.body.style.userSelect = "none";
    }

    function dragOver(i: number) {
        if (!draggingRef.current) return;
        const start = Math.min(dragOriginRef.current, i);
        const end = Math.max(dragOriginRef.current, i);

        const range = new Set<number>();
        for (let k = start; k <= end; k++) if (k !== 0) range.add(k);

        let next: Set<number>;
        if (dragAdditiveRef.current) {
            next = new Set(preDragRef.current);
            for (const k of range) next.add(k);
        } else {
            next = range;
        }
        setSelected(next);
        setCursor(i);
    }

    function dragEnd() {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        document.body.style.userSelect = "";
    }

    // compatibility with older code that expected selectedRow + onKeyDown
    const selectedRow = cursor;
    const setSelectedRow = setCursor;
    const onKeyDown = key;

    return {
        // new API
        cursor,
        setCursor,
        selected,
        setSelected,
        click,
        key,
        rowRefs,
        clear,
        dragStart,
        dragOver,
        dragEnd,
        // old aliases
        selectedRow,
        setSelectedRow,
        onKeyDown,
    };
}
