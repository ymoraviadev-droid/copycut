// components/Pane.tsx
import React, { useEffect } from "react";
import ColumnHeaders from "./table/ColumnHeaders";
import Row from "./table/Row";
import StatusBar from "./table/StatusBar";
import useFs from "../hooks/useFs";
import useColumnResize from "../hooks/useColumnResize";
import usePaneOps from "../hooks/usePaneOps";
import useContextMenu from "../hooks/useContextMenu";
import ContextMenu from "./menus/ContextMenu";
import usePaneView from "../hooks/usePaneView";
import { useCommander } from "../store/CommanderContext";
import { PaneId } from "../types/PaneTypes";

type Props = { id: PaneId };

export default function Pane({ id }: Props) {
    // per-pane view (hidden/sort/dirsFirst) and focus tracking
    const { view, focusPane } = usePaneView(id);

    // fs with view options
    const { rows, currentPath, rootPath, itemsCount, totalBytes, loadPath, goUp, openEntry } = useFs(view);

    // column resize + container ref
    const resize = useColumnResize(null, [46, 14, 24, 16], 8);
    const containerRef = resize.containerRef as React.RefObject<HTMLDivElement>;
    const focusDom = () => containerRef.current?.focus();

    // pane ops (selection, keyboard, DnD, clipboard ops)
    const {
        sel,
        onKeyDown,
        register,
        copyToClipboard,
        cutToClipboard,
        moveToOther,
        copyToOther,
        pasteHere,
        removeSelected,
        onDragStartRow,
        onDragOverPane,
        onDropPane,
        onDragEndRow,
    } = usePaneOps({ id, rows, currentPath, loadPath, goUp, openEntry });

    // expose actions to top menu
    const { registerActions } = useCommander();
    register(() => currentPath, () => loadPath(currentPath));
    registerActions(id, {
        open: () => openEntry(sel.cursor),
        copyToOther,
        moveToOther,
        copy: copyToClipboard,
        cut: cutToClipboard,
        paste: pasteHere,
        remove: removeSelected,
        refresh: () => loadPath(currentPath),
        goUp,
    });

    // context menu state
    const { pos, openAt, close } = useContextMenu();

    // open custom menu using container-local coordinates
    const openAtLocal = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        focusDom();
        const host = (containerRef.current as HTMLElement) || (e.currentTarget as HTMLElement);
        const rect = host.getBoundingClientRect();
        openAt(e.clientX - rect.left, e.clientY - rect.top);
    };

    // right-click on a row: select it if needed, then open menu
    const onContextMenuRow = (index: number, e: React.MouseEvent) => {
        if (!sel.selected.has(index)) sel.click(index, {});
        focusDom();
        openAtLocal(e);
    };

    // keyboard: allow Esc to close menu, then delegate to pane ops (which calls sel.key)
    const onKeyDownPane = (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && pos) {
            e.preventDefault();
            close();
            return;
        }
        onKeyDown(e);
    };

    // right-click menu items
    const hasSelection = sel.selected.size > 0 || sel.cursor !== 0;
    const menuItems = [
        { label: "Move to other pane", shortcut: "Ctrl+Shift+M", onClick: moveToOther, disabled: !hasSelection },
        { label: "Copy to other pane", shortcut: "Ctrl+Shift+C", onClick: copyToOther, disabled: !hasSelection },
        { label: "Copy", shortcut: "Ctrl+C", onClick: copyToClipboard, disabled: !hasSelection },
        { label: "Cut", shortcut: "Ctrl+X", onClick: cutToClipboard, disabled: !hasSelection },
        { label: "Paste", shortcut: "Ctrl+V", onClick: pasteHere },
        { label: "Delete", shortcut: "Del", onClick: removeSelected, disabled: !hasSelection },
    ];

    // optional: auto-focus left pane at startup
    useEffect(() => {
        if (id === "left") focusDom();
    }, [id]);

    return (
        <div className="h-full w-1/2 border-2 border-white p-1 flex flex-col">
            <div
                ref={containerRef}
                tabIndex={0}
                onFocus={() => focusPane(id)}
                onMouseDown={() => {
                    focusPane(id);
                    focusDom(); // make sure arrow keys go here
                }}
                onKeyDown={onKeyDownPane}
                className="flex-1 relative border-2 border-white overflow-hidden"
                onContextMenu={openAtLocal}
                onDragOver={onDragOverPane}
                onDrop={onDropPane}
            >
                <div className="absolute inset-0 overflow-y-auto" onScroll={() => pos && close()}>
                    <ColumnHeaders gridTemplate={resize.gridTemplate} />
                    <Row
                        rows={rows}
                        gridTemplate={resize.gridTemplate}
                        rowRefs={sel.rowRefs}
                        cursor={sel.cursor}
                        selected={sel.selected}
                        onClickRow={(i, e) => {
                            sel.click(i, e);
                            focusDom(); // keep focus after clicking rows
                        }}
                        onOpen={(i) => openEntry(i)}
                        onContextMenuRow={onContextMenuRow}
                        onDragStartRow={onDragStartRow}
                        onDragEndRow={onDragEndRow}
                    />
                </div>

                {resize.cols.slice(0, -1).map((_, i) => (
                    <div
                        key={i}
                        className="absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize"
                        style={{ left: `calc(${resize.accPct(i)}%)` }}
                        onPointerDown={(e) => resize.onPointerDown(i, e)}
                        onPointerMove={resize.onPointerMove}
                        onPointerUp={resize.onPointerUp}
                    />
                ))}

                {pos && <ContextMenu x={pos.x} y={pos.y} items={menuItems} onClose={close} />}
            </div>

            <StatusBar
                currentPath={currentPath}
                rootPath={rootPath}
                rowsCount={itemsCount}
                totalBytes={totalBytes}
                loadPath={loadPath}
            />
        </div>
    );
}
