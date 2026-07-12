use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::command;

fn config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap();
    path.push("ModstackApp");
    fs::create_dir_all(&path).ok();
    path.push("config.json");
    path
}

fn default_config() -> Value {
    json!({
        "game": {
            "width": 1280,
            "height": 720,
            "fullScreen": false,
            "minRAM": "512M",
            "maxRAM": "2048M"
        },
        "app": {
            "animations": true,
            "animated-background": true,
            "hide-on-launch": false,
            "discord-rpc": true,
            "install-dir": ""
        }
    })
}

fn default_install_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ModstackApp")
}

pub fn get_install_dir_path() -> PathBuf {
    let config = get_config();

    if let Some(val) = config
        .get("app")
        .and_then(|a| a.get("install-dir"))
        .and_then(|v| v.as_str())
    {
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }

    default_install_dir()
}

#[command]
pub fn set_config(key: String, value: Value) {
    let path = config_path();

    let mut config: Value = if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or("{}".into());
        serde_json::from_str(&data).unwrap_or(default_config())
    } else {
        default_config()
    };

    let parts: Vec<&str> = key.split('.').collect();
    let mut current = &mut config;

    for i in 0..parts.len() {
        let k = parts[i];

        if i == parts.len() - 1 {
            current[k] = value.clone();
        } else {
            if current.get(k).is_none() {
                current[k] = json!({});
            }
            current = current.get_mut(k).unwrap();
        }
    }

    fs::write(path, serde_json::to_string_pretty(&config).unwrap()).expect("Error saving config");

    println!("OK: {} = {}", key, value);
}

#[command]
pub fn get_config() -> Value {
    let path = config_path();

    if path.exists() {
        let data = fs::read_to_string(path).unwrap_or("{}".into());
        serde_json::from_str(&data).unwrap_or(default_config())
    } else {
        default_config()
    }
}

#[command]
pub fn get_install_dir() -> String {
    get_install_dir_path().to_string_lossy().to_string()
}

#[command]
pub async fn pick_install_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog().file().pick_folder(move |folder| {
        tx.send(folder).ok();
    });

    let folder = rx.recv().map_err(|e| e.to_string())?;

    let path = folder
        .ok_or_else(|| "Cancelled".to_string())?
        .into_path()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    set_config("app.install-dir".to_string(), Value::String(path.clone()));

    Ok(path)
}

#[command]
pub fn reset_install_dir() -> String {
    set_config("app.install-dir".to_string(), Value::String("".to_string()));

    default_install_dir().to_string_lossy().to_string()
}
