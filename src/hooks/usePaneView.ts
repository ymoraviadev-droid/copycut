// hooks/usePaneView.ts
import { useCommander } from "../store/CommanderContext";
import { PaneId, SortKey } from "../types/PaneTypes";

export default function usePaneView(id: PaneId) {
    const { getView, updateView, focusPane, activePane } = useCommander();
    const v = getView(id);

    function toggleHidden() { updateView(id, { showHidden: !v.showHidden }); }
    function setSort(key: SortKey) {
        if (v.sortKey === key) {
            updateView(id, { sortDir: v.sortDir === "asc" ? "desc" : "asc" });
        } else {
            updateView(id, { sortKey: key });
        }
    }
    function setDirsFirst(on: boolean) { updateView(id, { dirsFirst: on }); }

    return {
        view: v,
        toggleHidden,
        setSort,
        setDirsFirst,
        focusPane,
        isActive: activePane === id,
    };
}
