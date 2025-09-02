import { useRef, useEffect, JSX } from "react";
import { AiOutlineInfoCircle, AiOutlineWarning, AiOutlineQuestionCircle, AiOutlineCheckCircle, AiOutlineCloseCircle } from "react-icons/ai";

type ModalIcon = "info" | "warn" | "question" | "success" | "error" | undefined;

export type ModalOptions = {
    title: string;
    text?: string;
    isQuestion?: boolean;
    icon?: ModalIcon;
    yesText?: string;
    noText?: string;
};

type ModalInternalProps = ModalOptions & {
    resolve: (v: boolean) => void;
    cleanup: () => void;
};

const iconMap: Record<NonNullable<ModalIcon>, JSX.Element> = {
    info: <AiOutlineInfoCircle className="w-6 h-6" />,
    warn: <AiOutlineWarning className="w-6 h-6" />,
    question: <AiOutlineQuestionCircle className="w-6 h-6" />,
    success: <AiOutlineCheckCircle className="w-6 h-6" />,
    error: <AiOutlineCloseCircle className="w-6 h-6" />,
};

export default function ModalBox({ title, text, isQuestion, icon, yesText, noText, resolve, cleanup }: ModalInternalProps) {
    const yesRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        // focus primary on mount
        yesRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                resolve(false);
                cleanup();
            } else if (e.key === "Enter") {
                resolve(true);
                cleanup();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [cleanup, resolve]);

    const onYes = () => { resolve(true); cleanup(); };
    const onNo = () => { resolve(false); cleanup(); };

    // Norton Commander-ish: deep blue, double border, subtle glow
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* overlay */}
            <div className="absolute inset-0 bg-black/40" onClick={onNo} />

            {/* modal */}
            <div
                role="dialog"
                aria-modal="true"
                className="
          relative min-w-[360px] max-w-[520px]
          text-white
          shadow-2xl
          bg-[#0b2a6b]  /* nc blue */
          px-5 py-4
        "
                // double border trick: inner outline + outer after
                style={{ boxShadow: "0 12px 24px rgba(0,0,0,.45)" }}
            >
                <div className="absolute inset-0 pointer-events-none border-2 border-[#d6d6d6]" />
                <div className="absolute inset-[4px] pointer-events-none border border-[#5ea0ff]" />

                {/* header */}
                <div className="flex items-center gap-2 mb-2">
                    {icon ? (
                        <div className="text-[#ffd966] drop-shadow-sm">
                            {iconMap[icon] ?? null}
                        </div>
                    ) : null}
                    <h3 className="font-bold tracking-wide">{title}</h3>
                </div>

                {/* body */}
                {text ? (
                    <p className="text-sm leading-relaxed text-[#e6efff] mb-4 whitespace-pre-wrap">
                        {text}
                    </p>
                ) : null}

                {/* actions */}
                <div className="flex justify-end gap-3 mt-2">
                    {isQuestion ? (
                        <>
                            <button
                                ref={yesRef}
                                onClick={onYes}
                                className="
                  px-4 py-1.5
                  bg-[#1c56ff] hover:bg-[#2b66ff] active:bg-[#1748d6]
                  text-white font-medium
                  border border-white/50
                  shadow
                "
                            >
                                {yesText ?? "Yes"}
                            </button>
                            <button
                                onClick={onNo}
                                className="
                  px-4 py-1.5
                  bg-[#0d317a] hover:bg-[#0f3a8f] active:bg-[#0b2f72]
                  text-white/90
                  border border-white/30
                "
                            >
                                {noText ?? "No"}
                            </button>
                        </>
                    ) : (
                        <button
                            ref={yesRef}
                            onClick={onYes}
                            className="
                px-4 py-1.5
                bg-[#1c56ff] hover:bg-[#2b66ff] active:bg-[#1748d6]
                text-white font-medium
                border border-white/50
                shadow
              "
                        >
                            {yesText ?? "OK"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}