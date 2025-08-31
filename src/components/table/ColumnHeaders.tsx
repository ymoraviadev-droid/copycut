type Props = {
    gridTemplate: string;
    isHighlight: boolean;
};

export default function ColumnHeaders({ gridTemplate, isHighlight }: Props) {
    const bg = !isHighlight ? "bg-transparent" : "bg-blue-600";

    return (
        <div className="grid border-b-0" style={{ gridTemplateColumns: gridTemplate }
        }>
            <div className={`px-4 py-2 text-yellow-400 text-2xl border-r-2 border-b-2 border-white ${bg}`}>Name</div>
            <div className={`px-4 py-2 text-yellow-400 text-2xl border-r-2 border-b-2 border-white ${bg}`}>Size</div>
            <div className={`px-4 py-2 text-yellow-400 text-2xl border-r-2 border-b-2 border-white ${bg}`}>Date</div>
            <div className={`px-4 py-2 text-yellow-400 text-2xl border-b-2 border-white ${bg}`}>Time</div>
        </div >
    );
}