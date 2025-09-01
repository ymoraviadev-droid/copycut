import { useEffect, useRef, useState } from "react";
import MenuItem from "./MenuItem";
import MenuSep from "./MenuSep";

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const closeTimer = useRef<number | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    function clearTimer() {
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
    }
    function openNow() {
        clearTimer();
        setOpen(true);
    }
    function delayedClose() {
        clearTimer();
        closeTimer.current = window.setTimeout(() => setOpen(false), 120) as unknown as number;
    }

    useEffect(() => {
        function onDocMouseDown(e: MouseEvent) {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, []);

    return (
        <div
            ref={rootRef}
            className="relative inline-block"
            onMouseEnter={openNow}
            onMouseLeave={delayedClose}
        >
            <button
                className="px-2 py-1 rounded hover:bg-blue-700"
                onClick={() => setOpen(v => !v)}
                onKeyDown={(e) => {
                    if (e.key === "Escape") setOpen(false);
                    if (e.key === "Enter" || e.key === " ") setOpen(true);
                }}
            >
                {label}
            </button>

            {/* no mt-1 gap; use top-full so there's no dead zone */}
            <div
                className={`absolute left-0 top-full z-50 min-w-56 bg-blue-900 border-2 border-white rounded-sm shadow-lg ${open ? "" : "hidden"}`}
                onMouseEnter={openNow}
                onMouseLeave={delayedClose}
            >
                {children}
            </div>
        </div>
    );
};

Menu.Item = MenuItem;
Menu.Sep = MenuSep;

export default Menu;