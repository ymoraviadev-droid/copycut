import type { RowType } from "../../types/RowType";

type Props = {
    rows: RowType[];
    gridTemplate: string;
    rowRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
    cursor: number;
    selected: Set<number>;
    onClickRow: (index: number, e: React.MouseEvent) => void;
    onOpen: (index: number) => void;
    onContextMenuRow?: (index: number, e: React.MouseEvent) => void;
    onDragStartRow?: (index: number, e: React.DragEvent) => void;
    onDragEndRow?: () => void;
};

export default function Row({
    rows,
    gridTemplate,
    rowRefs,
    cursor,
    selected,
    onClickRow,
    onOpen,
    onContextMenuRow,
    onDragEndRow,
    onDragStartRow
}: Props) {
    return (
        <div>
            {rows.map((r, i) => {
                const isSelected = selected.has(i) || (!selected.size && i === cursor);
                return (
                    <div
                        key={`row-${r.displayName}-${i}`}
                        ref={(el) => { rowRefs.current[i] = el; }}
                        className={`grid ${isSelected ? "bg-blue-700 text-white" : "text-white"}`}
                        style={{ gridTemplateColumns: gridTemplate }}
                        onClick={(ev) => onClickRow(i, ev)}
                        onDoubleClick={() => onOpen(i)}
                        onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onContextMenuRow?.(i, ev); }}
                        draggable={i !== 0}                            // don’t drag "../"
                        onDragStart={(e) => onDragStartRow?.(i, e)}
                        onDragEnd={() => onDragEndRow?.()}
                    >
                        <div className="px-4 py-1 truncate border-r-2 border-white">{r.displayName}</div>
                        <div className="px-4 py-1 truncate border-r-2 border-white">{r.size}</div>
                        <div className="px-4 py-1 truncate border-r-2 border-white">{r.date}</div>
                        <div className="px-4 py-1 truncate">{r.time}</div>
                    </div>
                );
            })}
        </div>
    );
}
