// hooks/useSelection.ts
import { useCallback, useEffect, useRef, useState } from "react";

export default function useSelection(
    rowCount: number,
    opts: { onOpen: (i: number) => void; onUp: () => void }
) {
    const [selectedRow, setSelectedRow] = useState(0);
    const frameRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<(HTMLElement | null)[]>([]);

    useEffect(() => {
        const el = rowRefs.current[selectedRow];
        if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [selectedRow]);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!rowCount) return;

        if (e.key === "ArrowUp" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); opts.onUp(); return; }

        if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp", "Enter", "Backspace"].includes(e.key))
            e.preventDefault();

        if (e.key === "ArrowDown") setSelectedRow(i => Math.min(i + 1, rowCount - 1));
        if (e.key === "ArrowUp") setSelectedRow(i => Math.max(i - 1, 0));
        if (e.key === "Home") setSelectedRow(0);
        if (e.key === "End") setSelectedRow(rowCount - 1);
        if (e.key === "PageDown") setSelectedRow(i => Math.min(i + 10, rowCount - 1));
        if (e.key === "PageUp") setSelectedRow(i => Math.max(i - 10, 0));
        if (e.key === "Enter") opts.onOpen(selectedRow);
        if (e.key === "Backspace") opts.onUp();
    }, [rowCount, selectedRow, opts]);

    return { selectedRow, setSelectedRow, frameRef, rowRefs, onKeyDown };
}
