import { fmtBytes } from "../../utils/fileDataParse";

type Props = {
    currentPath: string;
    rootPath: string;
    rowsCount: number;
    totalBytes: number;
    loadPath: (p: string) => void;
    isHighlight: boolean
};

function normalize(p: string) {
    let s = (p || "/").replace(/\\/g, "/").replace(/\/+$/, "");
    return s || "/";
}

export default function StatusBar({ currentPath, rootPath, rowsCount, totalBytes, loadPath, isHighlight }: Props) {
    const root = normalize(rootPath || "/");
    const rootLabel = root === "/" ? "/" : root.split("/").pop() || "/";

    const rel = (() => {
        const p = normalize(currentPath || root);
        if (!p.startsWith(root)) return "";
        return p.slice(root.length).replace(/^\/+/, "");
    })();
    const segs = rel ? rel.split("/") : [];

    const bg = !isHighlight ? "bg-transparent" : "bg-blue-600";

    return (
        <div className={`mt-2 h-10 border-2 border-white flex items-center justify-between px-4 text-white ${bg}`}>
            <div className="flex items-center gap-1 text-sm">
                <span className="select-none">/</span>
                {root !== "/" && (
                    <button
                        className="underline decoration-dotted hover:no-underline"
                        onClick={() => loadPath(root)}
                        title={root}
                    >
                        {rootLabel}
                    </button>
                )}
                {segs.map((seg, idx) => {
                    const target = normalize(root + "/" + segs.slice(0, idx + 1).join("/"));
                    return (
                        <div key={`seg-${idx}`} className="flex items-center">
                            <span className="px-1 select-none">/</span>
                            <button
                                className="underline decoration-dotted hover:no-underline"
                                onClick={() => loadPath(target)}
                                title={target}
                            >
                                {seg}
                            </button>
                        </div>
                    );
                })}
            </div>

            <p>{rowsCount} items • {fmtBytes(totalBytes)}</p>
            <p>CopyCut v1.0</p>
        </div>
    );
}
