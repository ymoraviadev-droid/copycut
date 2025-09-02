export type PathSizerChildEvent = {
    path: string;   // root folder being sized
    name: string;   // immediate child dir name
    bytes: number;  // recursive size of that child
    items?: number; // optional: immediate children count (if backend sends it)
    job_id: string;
};

export type PathSizerSummaryEvent = {
    path: string;   // root folder being sized
    bytes: number;  // total for root (files + all child dirs)
    items?: number; // optional: total immediate children
    job_id: string;
};

export type PathSizerProgressEvent = {
    job_id: String,
    bytes: number,
    name: String,
};
