// store/CommanderContext.ts
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { PaneApi, PaneId, PaneView } from "../types/PaneTypes";

export type PaneActions = {
    open?: () => void;
    copyToOther?: () => void;
    moveToOther?: () => void;
    copy?: () => void;
    cut?: () => void;
    paste?: () => void;
    remove?: () => void;
    refresh?: () => void;
    goUp?: () => void;
};

type ClipboardState = { op: "copy" | "cut"; paths: string[] } | null;

type Ctx = {
    // panes
    registerPane: (api: PaneApi) => void;
    getPeerPath: (id: PaneId) => string | null;
    reloadPane: (id: PaneId) => void;

    // active pane focus
    activePane: PaneId;
    focusPane: (id: PaneId) => void;

    // per-pane view
    getView: (id: PaneId) => PaneView;
    updateView: (id: PaneId, patch: Partial<PaneView>) => void;

    // actions registry
    registerActions: (id: PaneId, actions: PaneActions) => void;
    getActions: (id: PaneId) => PaneActions | undefined;
    getActiveActions: () => PaneActions | undefined;

    // app clipboard
    clipboard: ClipboardState;
    setClipboard: (s: ClipboardState) => void;

    // DnD payload (optional; you already use it)
    dragPaths: string[] | null;
    setDragPaths: (paths: string[] | null) => void;
};

const CommanderCtx = createContext<Ctx | null>(null);
export function useCommander() {
    const ctx = useContext(CommanderCtx);
    if (!ctx) throw new Error("CommanderProvider missing");
    return ctx;
}

const DEFAULT_VIEW: PaneView = {
    showHidden: false,
    sortKey: "name",
    sortDir: "asc",
    dirsFirst: true,
};

export function CommanderProvider({ children }: { children: React.ReactNode }) {
    const panes = useRef<{ left?: PaneApi; right?: PaneApi }>({});
    const actions = useRef<{ left?: PaneActions; right?: PaneActions }>({});

    const [activePane, setActivePane] = useState<PaneId>("left");
    const [clipboard, setClipboard] = useState<ClipboardState>(null);
    const [dragPaths, setDragPaths] = useState<string[] | null>(null);
    const [view, setView] = useState<Record<PaneId, PaneView>>({
        left: DEFAULT_VIEW,
        right: DEFAULT_VIEW,
    });

    const value = useMemo<Ctx>(() => ({
        registerPane(api) { panes.current[api.id] = api; },
        getPeerPath(id) {
            const peer: PaneId = id === "left" ? "right" : "left";
            return panes.current[peer]?.getPath() ?? null;
        },
        reloadPane(id) { panes.current[id]?.reload(); },

        activePane,
        focusPane(id) { setActivePane(id); },

        getView(id) { return view[id]; },
        updateView(id, patch) {
            setView(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
        },

        registerActions(id, a) { actions.current[id] = a; },
        getActions(id) { return actions.current[id]; },
        getActiveActions() {
            console.log(activePane);
            console.log(actions.current);
            console.log(actions.current.left);
            console.log(actions.current[activePane]);


            return actions.current[activePane];
        },

        clipboard, setClipboard,
        dragPaths, setDragPaths,
    }), [activePane, clipboard, dragPaths, view]);

    return <CommanderCtx.Provider value={value}>{children}</CommanderCtx.Provider>;
}
