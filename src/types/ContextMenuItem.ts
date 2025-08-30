export type ContextMenuItem = {
    label: string;
    shortcut?: string;
    onClick: () => void;
    disabled?: boolean;
};
