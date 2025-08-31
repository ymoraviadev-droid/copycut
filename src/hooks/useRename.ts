import { useCallback, useEffect, useRef, useState } from "react";
import type { RowType } from "../types/RowType";

export default function useRename(rows: RowType[]) {
    const [index, setIndex] = useState<number | null>(null);
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (index != null) {
            // autofocus + select all
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 0);
        }
    }, [index]);

    const start = useCallback((i: number) => {
        const r = rows[i];
        if (!r || (r as any).specialUp) return; // never rename "../"
        setIndex(i);
        setValue(r.displayName || r.realName || "");
    }, [rows]);

    const cancel = useCallback(() => {
        setIndex(null);
        setValue("");
    }, []);

    return {
        renamingIndex: index,
        renameValue: value,
        setRenameValue: setValue,
        nameInputRef: inputRef,
        startRename: start,
        cancelRename: cancel,
    };
}
