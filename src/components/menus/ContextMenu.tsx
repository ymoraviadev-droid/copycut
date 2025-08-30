import { ContextMenuItem } from "../../types/ContextMenuItem";

type Props = {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
};

export default function ContextMenu({ x, y, items, onClose }: Props) {
    return (
        <div className="absolute inset-0 z-50" onMouseDown={onClose}>
            <div
                className="absolute bg-blue-900 text-white border-2 border-white rounded-sm shadow-lg min-w-48 select-none"
                style={{ left: x, top: y }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {items.map((it, i) => (
                    <button
                        key={i}
                        disabled={!!it.disabled}
                        className={`flex w-full items-center justify-between gap-6 px-4 py-2 text-left hover:bg-blue-700 disabled:opacity-40`}
                        onClick={() => {
                            if (!it.disabled) it.onClick();
                            onClose();
                        }}
                    >
                        <span>{it.label}</span>
                        {it.shortcut && <span className="text-xs opacity-80">{it.shortcut}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}
