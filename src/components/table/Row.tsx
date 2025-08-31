import { RefObject } from "react";
import type { RowType } from "../../types/RowType";

type Props = {
    rows: RowType[];
    gridTemplate: string;
    rowRefs: RefObject<(HTMLDivElement | null)[]>;
    cursor: number;
    selected: Set<number>;
    onClickRow: (
        i: number,
        e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
    ) => void;
    onOpen: (i: number) => void;
    onContextMenuRow: (i: number, e: React.MouseEvent) => void;
    onDragStartRow?: (i: number, e: React.DragEvent) => void;
    onDragEndRow?: (i: number, e: React.DragEvent) => void;

    // rename wiring
    renamingIndex?: number | null;
    renameValue?: string;
    onRenameChange?: (v: string) => void;
    onRenameCommit?: (i: number) => void;
    onRenameCancel?: () => void;
    nameInputRef?: React.RefObject<HTMLInputElement | null>;
};

export default function Row(props: Props) {
    const {
        rows, gridTemplate, rowRefs, cursor, selected,
        onClickRow, onOpen, onContextMenuRow, onDragStartRow, onDragEndRow,
        renamingIndex, renameValue, onRenameChange, onRenameCommit, onRenameCancel, nameInputRef,
    } = props;

    return (
        <div className="min-w-0">
            {rows.map((r, i) => {
                const isHeader = !!(r as any).specialUp; // the "../" row
                const isCursor = i === cursor;
                const isSel = selected.has(i);

                let rowCls = "grid items-center px-4 py-0.5 select-none text-white";
                if (!isHeader && isCursor) rowCls += " bg-blue-700";
                if (!isHeader && isSel) rowCls += " ring-1 ring-white/50";
                if (isHeader) rowCls += " opacity-90 italic";

                return (
                    <div
                        key={r.displayName + "-" + i}
                        ref={(el) => { rowRefs.current[i] = el; }}
                        className={rowCls}
                        style={{ gridTemplateColumns: gridTemplate }}
                        onDoubleClick={() => onOpen(i)}
                        onContextMenu={(e) => onContextMenuRow(i, e)}
                        draggable={!isHeader}
                        onDragStart={(e) => { if (!isHeader) onDragStartRow?.(i, e); }}
                        onDragEnd={(e) => { if (!isHeader) onDragEndRow?.(i, e); }}
                    >
                        {/* Name */}
                        <div className="min-w-0 truncate pr-4" onMouseDown={(e) => e.button === 0 && onClickRow(i, e)}>
                            {renamingIndex === i && !isHeader ? (
                                <input
                                    ref={nameInputRef}
                                    className="w-full bg-blue-950 text-white border border-white/50 px-2 py-1 rounded-sm"
                                    value={renameValue ?? ""}
                                    onChange={(e) => onRenameChange?.(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") onRenameCommit?.(i);
                                        if (e.key === "Escape") onRenameCancel?.();
                                    }}
                                    onBlur={() => onRenameCancel?.()}
                                />
                            ) : (
                                <span className="truncate">{r.displayName}</span>
                            )}
                        </div>

                        {/* Size */}
                        <div className="truncate pr-4" onMouseDown={(e) => e.button === 0 && onClickRow(i, e)}>
                            <span title={r.size}>{r.size}</span>
                        </div>

                        {/* Date */}
                        <div className="truncate pr-4" onMouseDown={(e) => e.button === 0 && onClickRow(i, e)}>
                            <span title={r.date}>{r.date}</span>
                        </div>

                        {/* Time */}
                        <div className="truncate" onMouseDown={(e) => e.button === 0 && onClickRow(i, e)}>
                            <span title={r.time}>{r.time}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
