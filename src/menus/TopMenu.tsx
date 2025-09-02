import { useEffect, useState, useCallback } from "react";
import usePaneView from "../hooks/usePaneView";
import { useCommander } from "../store/CommanderContext";
import Menu from "../components/menu/Menu";
import { invoke } from "@tauri-apps/api/core";
import type { PaneActions } from "../store/CommanderContext";
import { fire } from "../components/modal/utils/fire";

export default function TopMenu() {
    const [act, setAct] = useState<PaneActions | undefined>(undefined);
    const { activePane, getPeerPath, getActiveActions } = useCommander();
    const { view, toggleHidden, setSort, setDirsFirst } = usePaneView(activePane);

    const hasOther = !!getPeerPath(activePane);
    const hasActions = !!act;

    const call = useCallback(
        (fn?: () => void) => () => { if (fn) fn(); },
        []
    );

    useEffect(() => {
        setAct(getActiveActions());
    }, [activePane, getActiveActions]);

    return (
        <div className="h-[4vh] bg-blue-900 text-white flex items-center gap-4 px-3 text-sm select-none">
            <Menu label="Main">
                <Menu.Item label="Settings" />
                <Menu.Item label="About" onClick={async () => {
                    await fire({
                        title: "About",
                        text: "CopyCut File Manager v0.1.0/\n\nmade by Yehonatan Moravia",
                        icon: "info",
                    })
                }} />
                <Menu.Sep />
                <Menu.Item
                    label="Exit"
                    onClick={async () => { await invoke("exit"); }}
                />
            </Menu>

            <Menu label="Selection">
                <Menu.Item label="Select all" disabled={!hasActions} />
                <Menu.Item label="Deselect all" disabled={!hasActions} />
            </Menu>

            <Menu label="Operations">
                <Menu.Item label="Open File" onClick={call(act?.open)} disabled={!act?.open} />
                <Menu.Item label="Delete Selection" onClick={call(act?.remove)} disabled={!act?.remove} />
                <Menu.Sep />
                <Menu.Item label="Copy Selection" onClick={call(act?.copy)} disabled={!act?.copy} shortcut="Ctrl+C" />
                <Menu.Item label="Cut Selection" onClick={call(act?.cut)} disabled={!act?.cut} shortcut="Ctrl+X" />
                <Menu.Item label="Paste Selection" onClick={call(act?.paste)} disabled={!act?.paste} shortcut="Ctrl+V" />
                <Menu.Sep />
                <Menu.Item
                    label="Copy Selection to other pane"
                    onClick={call(act?.copyToOther)}
                    disabled={!hasOther || !act?.copyToOther}
                    shortcut="Ctrl+Shift+C"
                />
                <Menu.Item
                    label="Move Selection to other pane"
                    onClick={call(act?.moveToOther)}
                    disabled={!hasOther || !act?.moveToOther}
                    shortcut="Ctrl+Shift+M"
                />
            </Menu>

            <Menu label="Navigate">
                <Menu.Item label="Refresh" onClick={call(act?.refresh)} disabled={!act?.refresh} shortcut="Ctrl+R" />
                <Menu.Item label="Up one level" onClick={call(act?.goUp)} disabled={!act?.goUp} shortcut="Ctrl+↑" />
                <Menu.Item label="Back to root" onClick={call(act?.refresh)} disabled={!act?.refresh} shortcut="Ctrl+R" />
            </Menu>

            <Menu label="View">
                <Menu.Item
                    label={`Show hidden files ${view.showHidden ? "✓" : ""}`}
                    onClick={toggleHidden}
                />
                <Menu.Sep />
                <Menu.Item
                    label={`Sort by Name ${view.sortKey === "name" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`}
                    onClick={() => setSort("name")}
                />
                <Menu.Item
                    label={`Sort by Size ${view.sortKey === "size" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`}
                    onClick={() => setSort("size")}
                />
                <Menu.Item
                    label={`Sort by Date ${view.sortKey === "date" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`}
                    onClick={() => setSort("date")}
                />
                <Menu.Item
                    label={`Sort by Type ${view.sortKey === "type" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`}
                    onClick={() => setSort("type")}
                />
                <Menu.Sep />
                <Menu.Item
                    label={`Folders first ${view.dirsFirst ? "✓" : ""}`}
                    onClick={() => setDirsFirst(!view.dirsFirst)}
                />
            </Menu>
        </div>
    );
}
