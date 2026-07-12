use crate::core::instance_manager::InstanceManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::{oneshot, Notify};

pub struct AppState {
    pub instances: Mutex<InstanceManager>,
    /// Maps instance_id → kill-signal sender for running Minecraft processes.
    pub running: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    /// Maps instance_id → launch start time for playtime tracking.
    pub playtime: Arc<Mutex<HashMap<String, Instant>>>,
    /// Maps instance_id → Minecraft version currently being downloaded.
    /// Semaphore: only one download per MC version runs at a time.
    pub downloading: Arc<Mutex<HashMap<String, String>>>,
    /// Notifies waiters when a download slot is released.
    pub download_notify: Arc<Notify>,
    /// Maps instance_id → cancel-signal sender for offline skin servers.
    pub skin_servers: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(InstanceManager { instances: vec![] }),
            running: Arc::new(Mutex::new(HashMap::new())),
            playtime: Arc::new(Mutex::new(HashMap::new())),
            downloading: Arc::new(Mutex::new(HashMap::new())),
            download_notify: Arc::new(Notify::new()),
            skin_servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
