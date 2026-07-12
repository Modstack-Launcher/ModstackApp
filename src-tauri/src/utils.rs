use sysinfo::System;

#[tauri::command]
pub fn get_system_ram() -> u64 {
    let sys = System::new_all();
    sys.total_memory()
}
