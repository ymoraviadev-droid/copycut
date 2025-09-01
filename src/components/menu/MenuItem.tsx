export default function MenuItem({ label, onClick, disabled, shortcut }: { label: string; onClick?: () => void; disabled?: boolean; shortcut?: string }) {
    return (
        <button className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-blue-700 disabled:opacity-40"
            onClick={onClick} disabled={disabled}>
            <span>{label}</span>
            {shortcut && <span className="text-xs opacity-80">{shortcut}</span>}
        </button>
    );
};
