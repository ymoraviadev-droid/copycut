export type PaneId = "left" | "right";
export type SortKey = "name" | "size" | "date" | "type";
export type SortDir = "asc" | "desc";

export type PaneView = {
    showHidden: boolean;
    sortKey: SortKey;
    sortDir: SortDir;
    dirsFirst: boolean;
};

export type PaneApi = { id: PaneId; getPath: () => string; reload: () => void };