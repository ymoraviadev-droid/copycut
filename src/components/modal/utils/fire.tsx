import { Root, createRoot } from "react-dom/client";
import ModalBox, { ModalOptions } from "../ModalBox";

/** Singleton portal root */
let portalRoot: Root | null = null;

function ensureRoot(): Root {
    if (portalRoot) return portalRoot;
    const host = document.getElementById("overlay");
    if (!host) throw new Error('#overlay portal div not found');
    portalRoot = createRoot(host);
    return portalRoot;
}

export function fire(opts: ModalOptions): Promise<boolean> {
    const root = ensureRoot();

    return new Promise<boolean>((resolve) => {
        const cleanup = () => {
            // unmount modal content but keep the root for next uses
            root.render(<></>);
        };

        root.render(<ModalBox {...opts} resolve={resolve} cleanup={cleanup} />);
    });
}