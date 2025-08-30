export type FileEntry = {
    name: string;
    is_dir: boolean;
    size: number;
    modified?: string | null; // "YYYY-MM-DD HH:MM"
};
