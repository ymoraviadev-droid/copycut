use once_cell::sync::Lazy;
use std::{collections::HashMap, sync::Mutex};

use crate::api::types::Job;

pub static JOBS: Lazy<Mutex<HashMap<String, Job>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn insert_if_absent(scan_key: String, job: Job) -> bool {
    if let Ok(mut j) = JOBS.lock() {
        if j.contains_key(&scan_key) {
            return false;
        }
        j.insert(scan_key, job);
        return true;
    }
    false
}

pub fn remove(scan_key: &str) {
    let _ = JOBS.lock().map(|mut j| j.remove(scan_key));
}
