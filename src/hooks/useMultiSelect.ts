import { useCallback, useEffect, useRef, useState } from "react";

export default function useMultiSelect(rowCount: number) {
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const anchorRef = useRef(0);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        const el = rowRefs.current[cursor];
        if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [cursor]);

    useEffect(() => {
        if (cursor >= rowCount) setCursor(rowCount ? rowCount - 1 : 0);
    }, [rowCount, cursor]);

    const clear = () => setSelected(new Set());

    const click = useCallback(
        (i: number, e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) => {
            const ctrl = e.ctrlKey || e.metaKey || e.altKey;
            const shift = !!e.shiftKey;

            if (shift) {
                const start = Math.min(anchorRef.current, i);
                const end = Math.max(anchorRef.current, i);
                const next = new Set<number>();
                for (let k = start; k <= end; k++) if (k !== 0) next.add(k);
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

    const key = useCallback(
        (e: React.KeyboardEvent) => {
            if (!rowCount) return;

            if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Insert", " "].includes(e.key)) {
                e.preventDefault();
            }

            if (e.key === "ArrowDown") setCursor(i => Math.min(i + 1, rowCount - 1));
            if (e.key === "ArrowUp") setCursor(i => Math.max(i - 1, 0));
            if (e.key === "Home") setCursor(0);
            if (e.key === "End") setCursor(rowCount - 1);
            if (e.key === "PageDown") setCursor(i => Math.min(i + 15, rowCount - 1));
            if (e.key === "PageUp") setCursor(i => Math.max(i - 15, 0));

            // shift+arrows extends selection
            if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                const nextIndex = e.key === "ArrowDown" ? Math.min(cursor + 1, rowCount - 1) : Math.max(cursor - 1, 0);
                const start = Math.min(anchorRef.current, nextIndex);
                const end = Math.max(anchorRef.current, nextIndex);
                const next = new Set<number>();
                for (let k = start; k <= end; k++) if (k !== 0) next.add(k);
                setSelected(next);
                setCursor(nextIndex);
            }

            // Insert toggles + moves down (MC style). Space toggles.
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
        },
        [rowCount, cursor, selected]
    );

    return {
        cursor,
        setCursor,
        selected,
        setSelected,
        click,
        key,
        rowRefs,
        clear,
    };
}
