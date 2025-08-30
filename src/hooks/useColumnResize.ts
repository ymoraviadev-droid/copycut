import { useMemo, useRef, useState } from "react";

export default function useColumnResize(
    containerRefExternal: React.RefObject<HTMLElement> | null,
    initial: number[] = [46, 14, 24, 16],
    minPct = 8
) {
    const containerRef = useRef<HTMLElement | null>(null);
    const targetRef = (containerRefExternal as React.RefObject<HTMLElement>) || (containerRef as any);

    const [cols, setCols] = useState<number[]>(initial);
    const dragRef = useRef<{ idx: number; startX: number; start: number[]; width: number } | null>(null);
    const gridTemplate = useMemo(() => cols.map(c => `${c}%`).join(" "), [cols]);

    function onPointerDown(i: number, e: React.PointerEvent) {
        const rect = (targetRef.current as HTMLElement).getBoundingClientRect();
        dragRef.current = { idx: i, startX: e.clientX, start: [...cols], width: rect.width };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    function onPointerMove(e: React.PointerEvent) {
        const d = dragRef.current; if (!d) return;
        const delta = ((e.clientX - d.startX) / d.width) * 100;
        const next = [...d.start], li = d.idx, ri = d.idx + 1;
        let L = next[li] + delta, R = next[ri] - delta;
        if (L < minPct) { R -= minPct - L; L = minPct; }
        if (R < minPct) { L -= minPct - R; R = minPct; }
        const other = next.reduce((s, v, idx) => (idx === li || idx === ri ? s : s + v), 0);
        const scale = 100 / (other + L + R);
        setCols(next.map((v, idx) => idx === li ? L * scale : idx === ri ? R * scale : v * scale));
    }
    function onPointerUp() { dragRef.current = null; }
    function accPct(i: number) { return cols.slice(0, i + 1).reduce((a, b) => a + b, 0); }

    return { cols, setCols, gridTemplate, onPointerDown, onPointerMove, onPointerUp, accPct, containerRef: targetRef };
}
