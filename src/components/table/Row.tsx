// components/table/Row.tsx
import React, { RefObject } from "react";
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

    // rename wiring
    renamingIndex?: number | null;
    renameValue?: string;
    onRenameChange?: (v: string) => void;
    onRenameCommit?: (i: number) => void;
    onRenameCancel?: () => void;
    nameInputRef?: React.RefObject<HTMLInputElement | null>;

    // drag-range (from useSelection)
    // supplied by the parent: sel.dragStart / sel.dragOver / sel.dragEnd (end happens on Pane)
    // We only need dragStart + dragOver here.
    // Types inferred via prop usage (no need to import the hook here).
    dragStart?: (i: number, additive: boolean) => void;
    dragOver?: (i: number) => void;
};

export default function Row(props: Props) {
    const {
        rows, gridTemplate, rowRefs, cursor, selected,
        onClickRow, onOpen, onContextMenuRow,
        renamingIndex, renameValue, onRenameChange, onRenameCommit, onRenameCancel, nameInputRef,
        dragStart, dragOver,
    } = props;

    return (
        <div className="min-w-0">
            {rows.map((r, i) => {
                const isHeader = !!(r as any).specialUp; // the "../" row
                const isCursor = i === cursor;
                const isSel = selected.has(i);

                let rowCls = "grid items-center px-4 py-0.5 select-none text-white";
                if (!isHeader && isCursor) rowCls += " bg-blue-700";
                if (!isHeader && isSel) rowCls += " bg-blue-600";
                if (isHeader) rowCls += " opacity-90 italic";

                const handleMouseDown = (e: React.MouseEvent) => {
                    if (e.button !== 0) return;
                    // start drag-range; additive if ctrl/meta/alt held
                    dragStart?.(i, !!(e.ctrlKey || e.metaKey || e.altKey));
                    // also apply normal click semantics (single/ctrl/shift)
                    onClickRow(i, {
                        ctrlKey: e.ctrlKey,
                        metaKey: e.metaKey,
                        altKey: e.altKey,
                        shiftKey: e.shiftKey,
                    });
                    // prevent text dragging
                    e.preventDefault();
                };

                const handleMouseEnter = () => {
                    dragOver?.(i);
                };

                return (
                    <div
                        key={r.displayName + "-" + i}
                        ref={(el) => { rowRefs.current[i] = el; }}
                        className={rowCls}
                        style={{ gridTemplateColumns: gridTemplate }}
                        onDoubleClick={() => onOpen(i)}
                        onContextMenu={(e) => onContextMenuRow(i, e)}
                        onMouseEnter={handleMouseEnter}
                    >
                        {/* Name */}
                        <div className="min-w-0 truncate pr-4" onMouseDown={handleMouseDown}>
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
                        <div className="truncate pr-4" onMouseDown={handleMouseDown}>
                            <span title={r.size}>{r.size}</span>
                        </div>

                        {/* Date */}
                        <div className="truncate pr-4" onMouseDown={handleMouseDown}>
                            <span title={r.date}>{r.date}</span>
                        </div>

                        {/* Time */}
                        <div className="truncate" onMouseDown={handleMouseDown}>
                            <span title={r.time}>{r.time}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
