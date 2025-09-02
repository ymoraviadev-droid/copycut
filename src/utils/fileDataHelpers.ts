import { FileEntry } from "../types/FileEntry";
import { PaneView } from "../types/PaneTypes";

const fmtSize = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
        : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(1)} GB`;

const getDate = (m?: string | null) => (m && m.includes(" ")) ? m.split(" ")[0] : "";

const getTime = (m?: string | null) => (m && m.includes(" ")) ? m.split(" ")[1] : "";

const parentPath = (p: string) => {
    if (!p || p === "/") return "/";
    const norm = p.replace(/\/+$/, "");
    const i = norm.lastIndexOf("/");
    return i <= 0 ? "/" : norm.slice(0, i);
};

const fmtBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const extOf = (name: string) => {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const compare = (a: FileEntry, b: FileEntry, view?: PaneView) => {
    const v = view || { showHidden: false, sortKey: "name", sortDir: "asc", dirsFirst: true };
    if (v.dirsFirst) {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
    }
    let res = 0;
    switch (v.sortKey) {
        case "name": res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); break;
        case "size": res = (a.size || 0) - (b.size || 0); break;
        case "date": res = (a.modified || "").localeCompare(b.modified || ""); break;
        case "type":
            res = extOf(a.name).localeCompare(extOf(b.name));
            if (res === 0) res = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            break;
    }
    if (v.sortDir === "desc") res = -res;
    return res;
}

export { fmtSize, getDate, getTime, parentPath, fmtBytes, compare };