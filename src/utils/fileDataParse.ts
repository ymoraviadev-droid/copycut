const fmtSize = (b: number, d: boolean) =>
    d ? "<DIR>" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
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

export { fmtSize, getDate, getTime, parentPath, fmtBytes };