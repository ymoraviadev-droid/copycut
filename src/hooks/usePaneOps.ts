// hooks/usePaneOps.ts
import { useCommander } from "../store/CommanderContext";
import { join } from "@tauri-apps/api/path";
import { copyPaths, movePaths, deletePaths } from "../utils/fsOps";
import useMultiSelect from "./useMultiSelect";
import type { RowType } from "../types/RowType";

type Params = {
    id: "left" | "right";
    rows: RowType[];
    currentPath: string;
    loadPath: (p: string) => Promise<void> | void;
    goUp: () => Promise<void> | void;
    openEntry: (i: number) => Promise<void> | void;

};

export default function usePaneOps({ id, rows, currentPath, loadPath, goUp, openEntry }: Params) {
    const { registerPane, getPeerPath, reloadPane, clipboard, setClipboard, dragPaths, setDragPaths } = useCommander();
    const sel = useMultiSelect(rows.length);

    async function selectedIndexesToPaths(indexes: number[]) {
        const paths: string[] = [];
        for (const i of indexes) {
            const r = rows[i];
            if (!r || !r.realName) continue;
            paths.push(await join(currentPath, r.realName));
        }
        return paths;
    }

    function effectiveIndexes() {
        if (sel.selected.size) return Array.from(sel.selected).sort((a, b) => a - b);
        return sel.cursor !== 0 ? [sel.cursor] : [];
    }

    async function copyToOther() {
        const dest = getPeerPath(id);
        if (!dest) return;
        const src = await selectedIndexesToPaths(effectiveIndexes());
        if (!src.length) return;
        await copyPaths(src, dest);
        await loadPath(currentPath);
        reloadPane(id === "left" ? "right" : "left");
    }

    async function moveToOther() {
        const dest = getPeerPath(id);
        if (!dest) return;
        const src = await selectedIndexesToPaths(effectiveIndexes());
        if (!src.length) return;
        await movePaths(src, dest);
        await loadPath(currentPath);
        reloadPane(id === "left" ? "right" : "left");
    }

    async function copyToClipboard() {
        const src = await selectedIndexesToPaths(effectiveIndexes());
        if (!src.length) return;
        setClipboard({ op: "copy", paths: src });
    }

    async function cutToClipboard() {
        const src = await selectedIndexesToPaths(effectiveIndexes());
        if (!src.length) return;
        setClipboard({ op: "cut", paths: src });
    }

    async function pasteHere() {
        if (!clipboard || !clipboard.paths.length) return;
        if (clipboard.op === "copy") {
            await copyPaths(clipboard.paths, currentPath);
            await loadPath(currentPath);
        } else {
            await movePaths(clipboard.paths, currentPath);
            await loadPath(currentPath);
            setClipboard(null);
        }
    }

    async function removeSelected() {
        const src = await selectedIndexesToPaths(effectiveIndexes());
        if (!src.length) return;
        const ok = window.confirm(`Delete ${src.length} item(s)?`);
        if (!ok) return;
        await deletePaths(src);
        await loadPath(currentPath);
        sel.clear();
    }

    async function onDragStartRow(index: number, e: React.DragEvent) {
        // ensure the row is part of selection
        if (!sel.selected.has(index)) {
            sel.click(index, { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
        }
        const idxs = effectiveIndexes();
        const paths = await selectedIndexesToPaths(idxs);
        if (!paths.length) return;
        setDragPaths(paths); // shared payload
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", "nc-dnd"); // marker (not used, but standard)
    }

    function onDragOverPane(e: React.DragEvent) {
        if (!dragPaths || !dragPaths.length) return;
        e.preventDefault(); // allow drop
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
    }

    async function onDropPane(e: React.DragEvent) {
        if (!dragPaths || !dragPaths.length) return;
        e.preventDefault();
        const dest = currentPath;
        if (e.ctrlKey) {
            await copyPaths(dragPaths, dest);
        } else {
            await movePaths(dragPaths, dest);
        }
        setDragPaths(null);
        await loadPath(currentPath);
        // refresh other pane too (the source)
        const peerId = id === "left" ? "right" : "left";
        reloadPane(peerId);
    }

    function onDragEndRow() {
        setDragPaths(null);
    }

    function onKeyDown(e: React.KeyboardEvent) {
        // new: Move to other pane
        if (e.key.toLowerCase() === "m" && e.ctrlKey && e.shiftKey) { e.preventDefault(); moveToOther(); return; }
        // existing: Copy to other pane
        if (e.key.toLowerCase() === "c" && e.ctrlKey && e.shiftKey) { e.preventDefault(); copyToOther(); return; }

        if (e.key.toLowerCase() === "c" && e.ctrlKey && !e.shiftKey) { e.preventDefault(); copyToClipboard(); return; }
        if (e.key.toLowerCase() === "x" && e.ctrlKey) { e.preventDefault(); cutToClipboard(); return; }
        if (e.key.toLowerCase() === "v" && e.ctrlKey) { e.preventDefault(); pasteHere(); return; }
        if (e.key === "Delete") { e.preventDefault(); removeSelected(); return; }

        if (e.key === "Enter") { e.preventDefault(); openEntry(sel.cursor); return; }
        if (e.key === "ArrowUp" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); goUp(); return; }

        sel.key(e);
    }

    function register(getPath: () => string, reload: () => void) {
        registerPane({ id, getPath, reload });
    }

    return {
        sel,
        onKeyDown,
        register,
        // expose DnD hooks:
        onDragStartRow,
        onDragOverPane,
        onDropPane,
        onDragEndRow,

        // expose ops if you also show them in menu:
        copyToOther,
        moveToOther,
        copyToClipboard,
        cutToClipboard,
        pasteHere,
        removeSelected,
    };
}
