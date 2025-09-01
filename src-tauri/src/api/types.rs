// src/api/types.rs
use serde::Serialize;
use std::sync::{atomic::AtomicBool, Arc};

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
pub struct ChildSizeEvent {
    pub job_id: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Clone, Serialize, Debug)]
pub struct SummaryEvent {
    pub job_id: String,
    pub bytes: u64, // total for the whole directory (files at root + all children)
}

#[derive(Clone)]
pub struct Job {
    pub cancel: Arc<AtomicBool>,
}
