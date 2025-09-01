export type PathSizerSummaryEvent = {
    path: string;   // root folder being sized
    bytes: number;  // total for root (files + all child dirs)
    items?: number; // optional: total immediate children
    job_id: string;
};