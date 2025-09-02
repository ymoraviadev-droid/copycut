use crate::api::types::Job;
use once_cell::sync::Lazy;
use std::{collections::HashMap, sync::Mutex};

/// Active jobs keyed by SCAN KEY
pub static JOBS: Lazy<Mutex<HashMap<String, Job>>> = Lazy::new(|| Mutex::new(HashMap::new()));
