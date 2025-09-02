use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc},
    time::SystemTime,
};

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Clone)]
pub struct CacheEntry {
    pub bytes: u64,
    pub items: u64,
    pub completed: bool,
    pub _updated_at: SystemTime,
}

#[derive(Serialize, Clone)]
pub struct ChildEvent {
    pub job_id: String,
    pub scan_key: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct SummaryEvent {
    pub job_id: String,
    pub scan_key: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct ProgressEvent {
    pub job_id: String,
    pub scan_key: String,
    pub bytes: u64,
    pub name: String,
}

#[derive(Hash, Eq, PartialEq, Clone)]
pub struct CacheKey {
    pub path: PathBuf,
    pub show_hidden: bool,
    pub ignores_sig: String,
}

pub struct Job {
    pub _key: CacheKey,
    pub cancel: Arc<AtomicBool>,
}
