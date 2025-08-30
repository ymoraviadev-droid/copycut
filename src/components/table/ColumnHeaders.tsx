type Props = {
    gridTemplate: string;
};

export default function ColumnHeaders({ gridTemplate }: Props) {
    return (
        <div className="grid border-b-0" style={{ gridTemplateColumns: gridTemplate }
        }>
            <div className="px-4 py-2 text-yellow-400 text-2xl border-r-2 border-white">Name</div>
            <div className="px-4 py-2 text-yellow-400 text-2xl border-r-2 border-white">Size</div>
            <div className="px-4 py-2 text-yellow-400 text-2xl border-r-2 border-white">Date</div>
            <div className="px-4 py-2 text-yellow-400 text-2xl">Time</div>
        </div >
    );
}