// components/Pane.tsx
import React, { useEffect, useState } from "react";
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
import useRename from "../hooks/useRename";
import { renamePath } from "../utils/fsOps";
import { join } from "@tauri-apps/api/path";

type Props = { id: PaneId };

export default function Pane({ id }: Props) {
    const { view, focusPane } = usePaneView(id);
    const { rows, currentPath, rootPath, itemsCount, totalBytes, loadPath, goUp, openEntry } = useFs(view);
    const [isDropHot] = useState(false); // not used (no DnD)

    const resize = useColumnResize(null, [46, 1, 24], 8);
    const containerRef = resize.containerRef as React.RefObject<HTMLDivElement>;
    const focusDom = () => containerRef.current?.focus();

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
    } = usePaneOps({ id, rows, currentPath, loadPath, goUp, openEntry });

    const { registerActions, activePane } = useCommander();
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

    // rename hook
    const {
        renamingIndex,
        renameValue,
        setRenameValue,
        nameInputRef,
        startRename,
        cancelRename,
    } = useRename(rows);

    async function commitRename(i: number) {
        const r = rows[i];
        if (!r || (r as any).specialUp) { cancelRename(); return; }
        const oldName = r.realName || r.displayName;
        const newBase = (renameValue || "").trim();

        // basic validation
        if (!newBase || newBase === oldName || newBase.includes("/")) {
            cancelRename();
            return;
        }

        try {
            const from = await join(currentPath, oldName!);
            const to = await join(currentPath, newBase);
            await renamePath(from, to);
            await loadPath(currentPath);
            // keep selection somewhat sane
            setTimeout(() => {
                const idx = rows.findIndex(x => x.displayName === newBase || x.realName === newBase);
                if (idx > 0) sel.setCursor(idx);
            }, 0);
        } catch (e) {
            console.error(e);
            alert("Rename failed");
        } finally {
            cancelRename();
        }
    }

    // context menu
    const { pos, openAt, close } = useContextMenu();
    const openAtLocal = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        focusDom();
        const rect = (containerRef.current as HTMLElement).getBoundingClientRect();
        openAt(e.clientX - rect.left, e.clientY - rect.top);
    };
    const onContextMenuRow = (index: number, e: React.MouseEvent) => {
        if (!sel.selected.has(index)) sel.click(index, {});
        focusDom();
        openAtLocal(e);
    };

    // add Rename to menu
    const hasSelection = sel.cursor !== 0 || sel.selected.size > 0;
    const menuItems = [
        { label: "Rename…", shortcut: "F2", onClick: () => startRename(sel.cursor), disabled: sel.cursor === 0 },
        { label: "Move to other pane", shortcut: "Ctrl+Shift+M", onClick: moveToOther, disabled: !hasSelection },
        { label: "Copy to other pane", shortcut: "Ctrl+Shift+C", onClick: copyToOther, disabled: !hasSelection },
        { label: "Copy", shortcut: "Ctrl+C", onClick: copyToClipboard, disabled: !hasSelection },
        { label: "Cut", shortcut: "Ctrl+X", onClick: cutToClipboard, disabled: !hasSelection },
        { label: "Paste", shortcut: "Ctrl+V", onClick: pasteHere },
        { label: "Delete", shortcut: "Del", onClick: removeSelected, disabled: !hasSelection },
    ];

    // key handling: F2 triggers rename; Esc closes menu; rest go to pane ops
    const onKeyDownPane = (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && pos) { e.preventDefault(); close(); return; }
        if (e.key === "F2" && renamingIndex == null) { e.preventDefault(); startRename(sel.cursor); return; }
        onKeyDown(e);
    };

    useEffect(() => {
        if (id === "left") focusDom();
    }, [id]);

    return (
        <div className={`h-full w-1/2 border-2 border-white p-1 flex flex-col`}>
            <div
                ref={containerRef}
                tabIndex={0}
                onFocus={() => focusPane(id)}
                onMouseDown={() => { focusPane(id); focusDom(); }}
                onKeyDown={onKeyDownPane}
                className={`flex-1 relative border-2 border-white overflow-hidden ${isDropHot ? "ring-2 ring-yellow-300" : ""}`}
                onContextMenu={openAtLocal}
                onMouseUp={() => sel.dragEnd()}
                onMouseLeave={() => sel.dragEnd()}
            >
                <div className="absolute inset-0 overflow-y-auto" onScroll={() => pos && close()}>
                    <ColumnHeaders gridTemplate={resize.gridTemplate} isHighlight={activePane === id} />
                    <Row
                        rows={rows}
                        gridTemplate={resize.gridTemplate}
                        rowRefs={sel.rowRefs}
                        cursor={sel.cursor}
                        selected={sel.selected}
                        onClickRow={(i, e) => { sel.click(i, e); focusDom(); }}
                        onOpen={(i) => openEntry(i)}
                        onContextMenuRow={onContextMenuRow}
                        // wire drag-range helpers
                        dragStart={sel.dragStart}
                        dragOver={sel.dragOver}
                        // rename
                        renamingIndex={renamingIndex}
                        renameValue={renameValue}
                        onRenameChange={setRenameValue}
                        onRenameCommit={commitRename}
                        onRenameCancel={cancelRename}
                        nameInputRef={nameInputRef}
                        isHighlight={activePane === id}
                    />
                </div>

                {resize.cols.slice(0, -1).map((_, i) => (
                    <div
                        key={i}
                        className={`absolute top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize bg-white w-[3px] ring-2 ring-blue-400`}
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
                isHighlight={activePane === id}
            />
        </div>
    );
}
