export type PathSizerChildEvent = {
    path: string;   // root folder being sized
    name: string;   // immediate child dir name
    bytes: number;  // recursive size of that child
    items?: number; // optional: immediate children count (if backend sends it)
    job_id: string;
};
