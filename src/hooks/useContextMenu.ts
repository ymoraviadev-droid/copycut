import { useCallback, useState } from "react";

export type MenuPos = { x: number; y: number } | null;

export default function useContextMenu() {
    const [pos, setPos] = useState<MenuPos>(null);
    const openAt = useCallback((x: number, y: number) => setPos({ x, y }), []);
    const openFromEvent = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setPos({ x: e.clientX, y: e.clientY });
    }, []);
    const close = useCallback(() => setPos(null), []);
    return { pos, openAt, openFromEvent, close };
}
