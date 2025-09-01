type Props = {
    gridTemplate: string;
    isHighlight?: boolean;
};

export default function ColumnHeaders({ gridTemplate, isHighlight }: Props) {
    const headerBg = isHighlight ? "bg-blue-800" : "bg-blue-900";

    return (
        <div className="sticky top-0 z-30" style={{ ["--hdr-h" as any]: "4px" }}>
            <div className={`${headerBg} border-b-2 border-white`}>
                <div
                    className="grid gap-0 px-4 py-1"
                    style={{ gridTemplateColumns: gridTemplate }}
                >
                    <div className="text-yellow-400 text-2xl mb-0 select-none">Name</div>
                    <div className="px-4 text-yellow-400 text-2xl mb-0 select-none">Size</div>
                    <div className="px-4 text-yellow-400 text-2xl mb-0 select-none">Date</div>
                </div>
            </div>
        </div>
    );
}
