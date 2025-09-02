export type ModalIcon = "info" | "warn" | "question" | "success" | "error" | undefined;

export type ModalOptions = {
    title: string;
    text?: string;
    isQuestion?: boolean;
    icon?: ModalIcon;
    yesText?: string;
    noText?: string;
};

export type ModalInternalProps = ModalOptions & {
    resolve: (v: boolean) => void;
    cleanup: () => void;
};