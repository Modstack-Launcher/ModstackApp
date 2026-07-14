use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{command, AppHandle};

const JAVA_VERSIONS: [u32; 4] = [25, 21, 17, 8];

#[derive(Serialize)]
pub struct JavaRuntimeStatus {
    version: u32,
    path: String,
    installed: bool,
    detected_version: u32,
    custom: bool,
}

fn java_config_key(version: u32) -> String {
    format!("java.version-{}-location", version)
}

fn java_runtime_base() -> PathBuf {
    crate::commands::config::get_install_dir_path()
        .join("engine_data")
        .join("runtime")
}

fn configured_java_path(version: u32) -> Option<PathBuf> {
    crate::commands::config::get_config()
        .get("java")
        .and_then(|java| java.get(format!("version-{}-location", version)))
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn default_java_path(version: u32) -> PathBuf {
    java_runtime_base().join(format!("java{}", version))
}

fn java_status(version: u32) -> JavaRuntimeStatus {
    let custom_path = configured_java_path(version);
    let path = custom_path.clone().unwrap_or_else(|| default_java_path(version));
    let detected_version = crate::java_runtime::get_installed_java_version(&path);

    JavaRuntimeStatus {
        version,
        path: path.to_string_lossy().to_string(),
        installed: detected_version >= version,
        detected_version,
        custom: custom_path.is_some(),
    }
}

#[command]
pub fn get_java_runtimes_status() -> Vec<JavaRuntimeStatus> {
    JAVA_VERSIONS.into_iter().map(java_status).collect()
}

#[command]
pub fn detect_java_runtime(version: u32) -> JavaRuntimeStatus {
    java_status(version)
}

#[command]
pub async fn install_java_runtime(app: AppHandle, version: u32) -> Result<JavaRuntimeStatus, String> {
    crate::java_runtime::ensure_java(&java_runtime_base(), version, &app, "settings")
        .await
        .map_err(|error| error.to_string())?;

    crate::commands::config::set_config(
        java_config_key(version),
        Value::String(default_java_path(version).to_string_lossy().to_string()),
    );

    Ok(java_status(version))
}

#[command]
pub async fn pick_java_runtime(app: AppHandle, version: u32) -> Result<JavaRuntimeStatus, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        tx.send(folder).ok();
    });

    let folder = rx.recv().map_err(|error| error.to_string())?;
    let path = folder
        .ok_or_else(|| "Cancelled".to_string())?
        .into_path()
        .map_err(|error| error.to_string())?;

    crate::commands::config::set_config(
        java_config_key(version),
        Value::String(path.to_string_lossy().to_string()),
    );

    Ok(java_status(version))
}
