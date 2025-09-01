import usePaneView from "../hooks/usePaneView";
import { useCommander } from "../store/CommanderContext";
import Menu from "../components/menu/Menu";

export default function TopMenu() {
    const { activePane, getPeerPath, getActiveActions } = useCommander();
    const { view, toggleHidden, setSort, setDirsFirst } = usePaneView(activePane);
    const act = getActiveActions();

    const hasOther = !!getPeerPath(activePane);

    return (
        <div className="h-[4vh] bg-blue-900 text-white flex items-center gap-4 px-3 text-sm select-none">
            <Menu label="Main">
                <Menu.Item label="Settings" />
                <Menu.Item label="About" />
                <Menu.Sep />
                <Menu.Item label="Exit" />
            </Menu>

            <Menu label="Selection">
                {/* wire your selection ops here if you add them to actions */}
                <Menu.Item label="Select all" />
                <Menu.Item label="Deselect all" />
            </Menu>

            <Menu label="Operations">
                <Menu.Item label="Open File" onClick={act?.open} disabled={!act?.open} />
                <Menu.Item label="Delete Selection" onClick={act?.remove} disabled={!act?.remove} />
                <Menu.Sep />
                <Menu.Item label="Copy Selection" onClick={act?.copy} disabled={!act?.copy} shortcut="Ctrl+C" />
                <Menu.Item label="Cut Selection" onClick={act?.cut} disabled={!act?.cut} shortcut="Ctrl+X" />
                <Menu.Item label="Paste Selection" onClick={act?.paste} disabled={!act?.paste} shortcut="Ctrl+V" />
                <Menu.Sep />
                <Menu.Item label="Copy Selection to other pane" onClick={act?.copyToOther} disabled={!hasOther || !act?.copyToOther} shortcut="Ctrl+Shift+C" />
                <Menu.Item label="Move Selection to other pane" onClick={act?.moveToOther} disabled={!hasOther || !act?.moveToOther} shortcut="Ctrl+Shift+M" />
            </Menu>

            <Menu label="Navigate">
                <Menu.Item label="Refresh" onClick={act?.refresh} shortcut="Ctrl+R" />
                <Menu.Item label="Up one level" onClick={act?.goUp} shortcut="Ctrl+↑" />
                <Menu.Item label="Back to root" onClick={act?.refresh} shortcut="Ctrl+R" />
            </Menu>

            <Menu label="View">
                <Menu.Item label={`Show hidden files ${view.showHidden ? "✓" : ""}`} onClick={toggleHidden} />
                <Menu.Sep />
                <Menu.Item label={`Sort by Name ${view.sortKey === "name" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("name")} />
                <Menu.Item label={`Sort by Size ${view.sortKey === "size" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("size")} />
                <Menu.Item label={`Sort by Date ${view.sortKey === "date" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("date")} />
                <Menu.Item label={`Sort by Type ${view.sortKey === "type" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("type")} />
                <Menu.Sep />
                <Menu.Item label={`Folders first ${view.dirsFirst ? "✓" : ""}`} onClick={() => setDirsFirst(!view.dirsFirst)} />
            </Menu>
        </div>
    );
}
