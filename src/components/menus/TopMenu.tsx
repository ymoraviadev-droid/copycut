import usePaneView from "../../hooks/usePaneView";
import { useCommander } from "../../store/CommanderContext";
import Menu from "./Menu";

export default function TopMenu() {
    const { activePane, getPeerPath, getActiveActions } = useCommander();
    const { view, toggleHidden, setSort, setDirsFirst } = usePaneView(activePane);
    const act = getActiveActions();

    const hasOther = !!getPeerPath(activePane);

    return (
        <div className="h-[4vh] bg-blue-900 text-white border-b-2 border-white flex items-center gap-4 px-3 text-sm select-none">
            <Menu label="File">
                <Item label="Open" onClick={act?.open} disabled={!act?.open} />
                <Sep />
                <Item label="Delete…" onClick={act?.remove} disabled={!act?.remove} />
                <Sep />
                <Item label="Settings" />
                <Item label="About" />
            </Menu>

            <Menu label="Selection">
                {/* wire your selection ops here if you add them to actions */}
                <Item label="Select all" />
                <Item label="Deselect all" />
            </Menu>

            <Menu label="Edit">
                <Item label="Copy" onClick={act?.copy} disabled={!act?.copy} shortcut="Ctrl+C" />
                <Item label="Cut" onClick={act?.cut} disabled={!act?.cut} shortcut="Ctrl+X" />
                <Item label="Paste" onClick={act?.paste} disabled={!act?.paste} shortcut="Ctrl+V" />
            </Menu>

            <Menu label="Operations">
                <Item label="Copy to other pane" onClick={act?.copyToOther} disabled={!hasOther || !act?.copyToOther} shortcut="Ctrl+Shift+C" />
                <Item label="Move to other pane" onClick={act?.moveToOther} disabled={!hasOther || !act?.moveToOther} shortcut="Ctrl+Shift+M" />
            </Menu>

            <Menu label="Navigate">
                <Item label="Up one level" onClick={act?.goUp} shortcut="Ctrl+↑" />
                <Item label="Refresh" onClick={act?.refresh} shortcut="Ctrl+R" />
            </Menu>

            <Menu label="View">
                <Item label={`Show hidden files ${view.showHidden ? "✓" : ""}`} onClick={toggleHidden} />
                <Sep />
                <Item label={`Sort by Name ${view.sortKey === "name" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("name")} />
                <Item label={`Sort by Size ${view.sortKey === "size" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("size")} />
                <Item label={`Sort by Date ${view.sortKey === "date" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("date")} />
                <Item label={`Sort by Type ${view.sortKey === "type" ? (view.sortDir === "asc" ? "↑" : "↓") : ""}`} onClick={() => setSort("type")} />
                <Sep />
                <Item label={`Folders first ${view.dirsFirst ? "✓" : ""}`} onClick={() => setDirsFirst(!view.dirsFirst)} />
            </Menu>
        </div>
    );
}


function Item({ label, onClick, disabled, shortcut }: { label: string; onClick?: () => void; disabled?: boolean; shortcut?: string }) {
    return (
        <button className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-blue-700 disabled:opacity-40"
            onClick={onClick} disabled={disabled}>
            <span>{label}</span>
            {shortcut && <span className="text-xs opacity-80">{shortcut}</span>}
        </button>
    );
}
function Sep() { return <div className="h-px bg-white/40 my-1 mx-2" />; }
