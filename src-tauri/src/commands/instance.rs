#![allow(dead_code)]

use tauri::Manager;

use std::io::Write;

use futures::stream::{self, StreamExt};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::{fs, path::PathBuf};
use tauri::Emitter;
use tauri::{command, AppHandle, State};
use walkdir::WalkDir;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::instance_manager::Instance;
use crate::discord;
use crate::ilog;
use crate::ilog_err;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use minecraft_java_rs_core::{
    launcher::{
        events::LaunchEvent,
        options::{JavaOptions, LaunchOptions, LoaderConfig, MemoryConfig, ScreenConfig},
        Launcher,
    },
    models::{loader::LoaderType, minecraft::Authenticator},
};
use tokio::sync::mpsc;

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .unwrap_or_default()
}

fn build_client_with_timeout(secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .timeout(std::time::Duration::from_secs(secs))
        .build()
        .unwrap_or_default()
}

fn recommended_java_version(minecraft_version: &str) -> u32 {
    let mut parts = minecraft_version
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok());

    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);

    if major >= 25 {
        return 25;
    }

    if major == 1 {
        if minor > 20 || (minor == 20 && patch >= 5) {
            return 21;
        }

        if minor >= 17 {
            return 17;
        }
    }

    8
}

fn java_runtime_executable(runtime_path: PathBuf) -> PathBuf {
    runtime_path
        .join("bin")
        .join(if cfg!(windows) { "javaw.exe" } else { "java" })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceRuntimeSettings {
    memory_mode: Option<String>,
    min_ram_mb: Option<u32>,
    max_ram_mb: Option<u32>,
    java_mode: Option<String>,
    java_path: Option<String>,
    resolution_mode: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fullscreen: Option<bool>,
    extra_jvm_args: Option<String>,
}

#[command]
pub async fn get_instances(launcher_id: String) -> Result<Vec<Value>, String> {
    let api_url = "https://fitzxel-cl-api.vercel.app/v2";
    let url = format!("{}/{}/instances", api_url, launcher_id);
    let client = build_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Vec<Value>>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp)
}

#[command]
pub async fn get_instance(
    launcher_id: String,
    id: Option<String>,
    slug: Option<String>,
    code: Option<String>,
) -> Result<Value, String> {
    let api_url = "https://fitzxel-cl-api.vercel.app/v2";
    let query = if let Some(i) = id {
        format!("id={}", i)
    } else if let Some(s) = slug {
        format!("slug={}", s)
    } else if let Some(c) = code {
        format!("code={}", urlencoding::encode(&c))
    } else {
        return Err("No instance specified".into());
    };
    let url = format!("{}/{}/instance?{}", api_url, launcher_id, query);
    let client = build_client();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if response.status() == 404 {
        return Err("404: Instance not found".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Error {}: failed to get instance",
            response.status()
        ));
    }
    let data = response.json::<Value>().await.map_err(|e| e.to_string())?;
    Ok(data)
}

#[command]
pub fn discord_set_idle() {
    discord::set_idle();
}

#[command]
pub fn discord_set_playing(name: String) {
    discord::set_playing(&name);
}

#[command]
pub fn uninstall_instance(instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let instance_path = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .map(|i| i.path.clone())
    };
    if let Some(path) = instance_path {
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Error removing instance folder: {}", e))?;
        }
    }
    {
        let mut manager = state.instances.lock().unwrap();
        manager.instances.retain(|i| i.id != instance_id);
    }
    Ok(())
}

#[command]
pub async fn install_instance_files(
    app: AppHandle,
    instance_id: String,
    instance_code: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let instance = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or_else(|| format!("Instance '{}' not found", instance_id))?
    };
    let log_id = format!("{}-{}", instance.id, instance.slug.as_deref().unwrap_or(""));
    let mods_dir = instance.path.join("mods");
    let mods_exist = mods_dir.exists()
        && fs::read_dir(&mods_dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
    if instance.files_installed == Some(true) && mods_exist {
        ilog!(
            &app,
            &log_id,
            "Files already installed for '{}', skipping download",
            instance_id
        );
        app.emit("instance-done", &instance_id).ok();
        return Ok(());
    }
    if instance.files_installed == Some(true) && !mods_exist {
        let mut manager = state.instances.lock().unwrap();
        manager.mark_files_installed(&instance_id);
        drop(manager);
    }
    let instance_dir = instance.path.clone();
    fs::create_dir_all(&instance_dir).ok();
    let api_url = "https://fitzxel-cl-api.vercel.app/v2".to_string();
    let url = if let Some(code) = &instance_code {
        format!("{}/instance/{}/files?code={}", api_url, instance_id, code)
    } else {
        format!("{}/instance/{}/files", api_url, instance_id)
    };
    let client = build_client_with_timeout(300);
    let files: Vec<Value> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Error fetching files: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Error parsing files JSON: {}", e))?;
    ilog!(&app, &log_id, "Total remote files: {}", files.len());
    let sorted_files = files.clone();
    let overrides = sorted_files
        .iter()
        .find(|f| f["path"].as_str() == Some("overrides.zip"))
        .cloned();
    let regular_files: Vec<Value> = sorted_files
        .iter()
        .filter(|f| f["path"].as_str() != Some("overrides.zip"))
        .cloned()
        .collect();
    let total = sorted_files.len();
    let count = AtomicUsize::new(0);
    stream::iter(regular_files)
        .for_each_concurrent(256, |file| {
            let client = client.clone();
            let instance_dir = instance_dir.clone();
            let app = app.clone();
            let log_id = log_id.clone();
            let iid = instance_id.clone();
            let count = &count;
            async move {
                let file_path = file["path"].as_str().unwrap_or("").to_string();
                let downloads = file["downloads"]
                    .as_array()
                    .and_then(|d| d.first().cloned());
                if file_path.is_empty() {
                    count.fetch_add(1, Ordering::Relaxed);
                    return;
                }
                let local_path = instance_dir.join(&file_path);
                if let Some(parent) = local_path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if local_path.exists() {
                    let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                    app.emit(
                        "instance-progress",
                        serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                    )
                    .ok();
                    return;
                }
                if let Some(dl_url) = downloads.and_then(|u| u.as_str().map(|s| s.to_string())) {
                    match client.get(&dl_url).send().await {
                        Ok(resp) => match resp.bytes().await {
                            Ok(bytes) => {
                                fs::write(&local_path, &bytes).ok();
                            }
                            Err(e) => {
                                ilog_err!(&app, &log_id, "Error reading bytes {}: {}", file_path, e)
                            }
                        },
                        Err(e) => {
                            ilog_err!(&app, &log_id, "Error downloading {}: {}", file_path, e)
                        }
                    }
                }
                let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                app.emit(
                    "instance-progress",
                    serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                )
                .ok();
            }
        })
        .await;
    if let Some(file) = overrides {
        let file_path = "overrides.zip";
        let local_path = instance_dir.join(file_path);
        let downloads = file["downloads"].as_array();
        if let Some(dl_list) = downloads {
            if let Some(dl_url) = dl_list.first().and_then(|u| u.as_str()) {
                match client.get(dl_url).send().await {
                    Ok(resp) => match resp.bytes().await {
                        Ok(bytes) => {
                            fs::write(&local_path, &bytes).ok();
                        }
                        Err(e) => {
                            ilog_err!(&app, &log_id, "Error reading bytes overrides.zip: {}", e)
                        }
                    },
                    Err(e) => ilog_err!(&app, &log_id, "Error downloading overrides.zip: {}", e),
                }
            }
        }
        let c = count.fetch_add(1, Ordering::Relaxed) + 1;
        app.emit(
            "instance-progress",
            serde_json::json!({ "instanceId": &instance_id, "current": c, "total": total }),
        )
        .ok();
        if local_path.exists() {
            ilog!(&app, &log_id, "Extracting overrides.zip...");
            app.emit("instance-status", serde_json::json!({ "instanceId": &instance_id, "status": "Extracting overrides..." })).ok();
            match fs::read(&local_path) {
                Ok(zip_bytes) => {
                    let cursor = std::io::Cursor::new(zip_bytes);
                    match zip::ZipArchive::new(cursor) {
                        Ok(mut archive) => {
                            for i in 0..archive.len() {
                                if let Ok(mut zip_file) = archive.by_index(i) {
                                    let out_path = instance_dir.join(zip_file.name());
                                    if zip_file.name().ends_with('/') {
                                        fs::create_dir_all(&out_path).ok();
                                    } else {
                                        if let Some(parent) = out_path.parent() {
                                            fs::create_dir_all(parent).ok();
                                        }
                                        if let Ok(mut out_file) = fs::File::create(&out_path) {
                                            std::io::copy(&mut zip_file, &mut out_file).ok();
                                        }
                                    }
                                }
                            }
                            ilog!(&app, &log_id, "overrides.zip extracted successfully");
                            fs::remove_file(&local_path).ok();
                        }
                        Err(e) => ilog_err!(&app, &log_id, "Error opening overrides.zip: {}", e),
                    }
                }
                Err(e) => ilog_err!(&app, &log_id, "Error reading overrides.zip: {}", e),
            }
        }
    }
    {
        let mut manager = state.instances.lock().unwrap();
        manager.mark_files_installed(&instance_id);
    }
    ilog!(
        &app,
        &log_id,
        "Installation complete: {}/{} files",
        total,
        total
    );
    app.emit("instance-done", instance_id).ok();
    Ok(())
}

pub fn offline_uuid(username: &str) -> String {
    let name = format!("OfflinePlayer:{}", username);
    let digest = md5::compute(name.as_bytes());
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[command]
pub fn create_instance(
    name: String,
    id: String,
    base_path: String,
    loader: String,
    version: String,
    slug: Option<String>,
    state: State<'_, AppState>,
) -> String {
    let mut manager = state.instances.lock().unwrap();
    let instance = manager.create_instance(
        name,
        id,
        PathBuf::from(base_path),
        loader,
        version,
        slug,
        None,
        None,
        None,
    );
    instance.name
}

#[command]
pub fn list_instances(state: State<'_, AppState>) -> Vec<Instance> {
    let manager = state.instances.lock().unwrap();
    manager.instances.clone()
}

#[command]
pub fn get_instance_by_code(code: String, state: State<'_, AppState>) -> Result<Instance, String> {
    let manager = state.instances.lock().unwrap();
    manager
        .instances
        .iter()
        .find(|i| i.id == code || i.name == code)
        .cloned()
        .ok_or("Instance not found".into())
}

#[command]
pub async fn launch_instance_cmd(
    app: AppHandle,
    instance_id: String,
    username: String,
    uuid: String,
    token: String,
    ram: u64,
    width: i32,
    height: i32,
    fullscreen: bool,
    download_concurrency: Option<u32>,
    force_ipv4: Option<bool>,
    dns: Option<bool>,
    skin_data_url: Option<String>,
    arm_style: Option<String>,
    skin_server_url: Option<String>,
    runtime_settings: Option<InstanceRuntimeSettings>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let instance = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Instance '{}' not found. Available: [{}]",
                    instance_id,
                    manager
                        .instances
                        .iter()
                        .map(|i| format!("'{}'", i.id))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?
    };

    let log_id = format!("{}-{}", instance.id, instance.slug.as_deref().unwrap_or(""));
    let version = instance.minecraft_version.clone();
    let loader = instance.loader.to_lowercase();

    ilog!(
        &app,
        &log_id,
        "Launching '{}' | version={} | loader={}",
        instance.name,
        version,
        loader
    );

    let is_offline = token == "none" || token.is_empty();
    let effective_uuid = if is_offline {
        offline_uuid(&username)
    } else {
        uuid.clone()
    };
    let effective_token = if is_offline {
        "0".to_string()
    } else {
        token.clone()
    };

    let engine_dir = crate::commands::config::get_install_dir_path().join("engine_data");
    fs::create_dir_all(&engine_dir).ok();
    if let Err(error) =
        crate::java_runtime::repair_mojang_runtime_cache(&engine_dir.join("runtime"))
    {
        ilog!(
            &app,
            &log_id,
            "Java runtime cache repair skipped: {}",
            error
        );
    }

    let mut skin_cancel_tx_to_store = None;
    let skin_agent_arg = if is_offline {
        let global_skin_server = skin_server_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty());
        if let Some(server_url) = global_skin_server {
            prepare_global_skin_server(server_url, &engine_dir, &app, &log_id).await
        } else {
            let (skin_cancel_tx, skin_cancel_rx) = tokio::sync::oneshot::channel::<()>();
            let arg = prepare_offline_skin(
                skin_data_url.as_deref().unwrap_or(""),
                arm_style.as_deref().unwrap_or("wide"),
                &effective_uuid,
                &username,
                &engine_dir,
                &app,
                &log_id,
                skin_cancel_rx,
            )
            .await;
            if arg.is_some() {
                skin_cancel_tx_to_store = Some(skin_cancel_tx);
            }
            arg
        }
    } else {
        None
    };
    if let Some(skin_cancel_tx) = skin_cancel_tx_to_store {
        state
            .skin_servers
            .lock()
            .unwrap()
            .insert(instance_id.clone(), skin_cancel_tx);
    }

    let loader_type = match loader.as_str() {
        "fabric" => Some(LoaderType::Fabric),
        "forge" => Some(LoaderType::Forge),
        "neoforge" => Some(LoaderType::NeoForge),
        "quilt" => Some(LoaderType::Quilt),
        "legacyfabric" | "legacy_fabric" => Some(LoaderType::LegacyFabric),
        _ => None,
    };

    let custom_memory = runtime_settings
        .as_ref()
        .and_then(|settings| settings.memory_mode.as_deref())
        .is_some_and(|mode| mode == "custom");
    let min_ram = if custom_memory {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.min_ram_mb)
            .map(u64::from)
            .unwrap_or_else(|| (ram / 4).max(512))
    } else {
        (ram / 4).max(512)
    };
    let max_ram = if custom_memory {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.max_ram_mb)
            .map(u64::from)
            .unwrap_or(ram)
            .max(min_ram)
    } else {
        ram
    };

    let custom_resolution = runtime_settings
        .as_ref()
        .and_then(|settings| settings.resolution_mode.as_deref())
        .is_some_and(|mode| mode == "custom");
    let launch_width = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.width)
            .unwrap_or(width.max(320) as u32)
    } else {
        width.max(320) as u32
    };
    let launch_height = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.height)
            .unwrap_or(height.max(240) as u32)
    } else {
        height.max(240) as u32
    };
    let launch_fullscreen = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.fullscreen)
            .unwrap_or(fullscreen)
    } else {
        fullscreen
    };

    let custom_java_path = runtime_settings
        .as_ref()
        .filter(|settings| settings.java_mode.as_deref() == Some("custom"))
        .and_then(|settings| settings.java_path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty());

    let java_options = if let Some(path) = custom_java_path {
        JavaOptions {
            path: Some(PathBuf::from(path)),
            ..Default::default()
        }
    } else {
        let java_version = recommended_java_version(&version);
        ilog!(
            &app,
            &log_id,
            "Preparing Java {} for Minecraft {}",
            java_version,
            version
        );

        let runtime_path = crate::java_runtime::ensure_java(
            &engine_dir.join("runtime"),
            java_version,
            &app,
            &log_id,
        )
        .await
        .map_err(|error| {
            format!(
                "No se pudo instalar Java {} automáticamente: {}",
                java_version, error
            )
        })?;

        JavaOptions {
            path: Some(java_runtime_executable(runtime_path)),
            version: Some(java_version.to_string()),
            ..Default::default()
        }
    };

    let mut jvm_args: Vec<String> = skin_agent_arg.into_iter().collect();
    if let Some(extra_args) = runtime_settings
        .as_ref()
        .and_then(|settings| settings.extra_jvm_args.as_deref())
        .map(str::trim)
        .filter(|args| !args.is_empty())
    {
        jvm_args.extend(extra_args.split_whitespace().map(ToString::to_string));
    }

    let options = LaunchOptions {
        path: engine_dir.clone(),
        instance: Some(instance.path.to_string_lossy().into_owned()),
        version: version.clone(),
        authenticator: Authenticator {
            access_token: effective_token,
            name: username.clone(),
            uuid: effective_uuid,
            xbox_account: None,
            user_properties: None,
            client_id: None,
            client_token: None,
        },
        loader: LoaderConfig {
            enable: loader_type.is_some(),
            loader_type,
            build: "latest".to_string(),
            ..Default::default()
        },
        memory: MemoryConfig {
            min: format!("{}M", min_ram),
            max: format!("{}M", max_ram),
        },
        screen: ScreenConfig {
            width: Some(launch_width),
            height: Some(launch_height),
            fullscreen: launch_fullscreen,
        },
        jvm_args,
        download_concurrency: download_concurrency.unwrap_or(10),
        force_ipv4: force_ipv4.unwrap_or(true),
        // Cloudflare DNS-over-HTTPS resolver; bypasses ISP DNS hijacking/port-53 blocking.
        dns: dns
            .unwrap_or(false)
            .then(|| IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))),
        timeout_secs: 30,
        bypass_offline: is_offline,
        java: java_options,
        game_args: vec![],
        verify: false,
        verify_concurrency: 4,
        skip_bundle_check: true,
        url: None,
        mcp: None,
        intel_enabled_mac: false,
    };

    let (tx, mut rx) = mpsc::channel::<LaunchEvent>(512);

    let collected_logs: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let logs_for_event = collected_logs.clone();
    let logs_for_monitor = collected_logs;

    let app_ev = app.clone();
    let iid = instance_id.clone();
    let log_id_ev = log_id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                LaunchEvent::Progress {
                    downloaded,
                    total,
                    ref kind,
                } => match kind.as_str() {
                    "libraries" | "assets" => {
                        app_ev
                            .emit("minecraft-progress", serde_json::json!({ "instanceId": &iid, "current": downloaded, "total": total }))
                            .ok();
                    }
                    "java" => {
                        let pct = if total > 0 {
                            downloaded * 100 / total
                        } else {
                            0
                        };
                        app_ev
                            .emit(
                                "java-download-progress",
                                serde_json::json!({ "instanceId": &iid, "percent": pct, "status": "Downloading..." }),
                            )
                            .ok();
                    }
                    _ => {}
                },
                LaunchEvent::GameDownloadFinished => {
                    app_ev
                        .emit(
                            "java-download-done",
                            serde_json::json!({ "instanceId": &iid }),
                        )
                        .ok();
                    app_ev.emit("minecraft-done", &iid).ok();
                }
                LaunchEvent::Check {
                    current,
                    total,
                    ref kind,
                } => {
                    app_ev
                        .emit("minecraft-progress", serde_json::json!({ "instanceId": &iid, "current": current, "total": total }))
                        .ok();
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Verifying {}...", kind) }))
                        .ok();
                }
                LaunchEvent::Extract(ref name) => {
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Extracting {}...", name) }))
                        .ok();
                }
                LaunchEvent::Patch(ref name) => {
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Patching {}...", name), "indeterminate": true }))
                        .ok();
                }
                LaunchEvent::Data(ref line) => {
                    let mut logs = logs_for_event.lock().unwrap();
                    if logs.len() < 2000 {
                        logs.push(line.clone());
                    }
                    drop(logs);
                    ilog!(&app_ev, &log_id_ev, "{}", line);
                }
                LaunchEvent::Error(ref msg) => {
                    ilog_err!(&app_ev, &log_id_ev, "{}", msg);
                }
                _ => {}
            }
        }
    });

    // Acquire download slot: wait if another instance is already downloading
    // the same MC version to avoid concurrent writes to shared library/asset files.
    loop {
        {
            let mut dl = state.downloading.lock().unwrap();
            if !dl.values().any(|v| v == &version) {
                dl.insert(instance_id.clone(), version.clone());
                break;
            }
        }
        ilog!(
            &app,
            &log_id,
            "Waiting for another download of {} to finish...",
            version
        );
        state.download_notify.notified().await;
    }

    ilog!(&app, &log_id, "Downloading game files...");
    let mut launcher = Launcher::new(options);
    let download_result = launcher.download_game(tx.clone()).await;

    // Release download slot regardless of success or failure.
    state.downloading.lock().unwrap().remove(&instance_id);
    state.download_notify.notify_waiters();

    download_result.map_err(|e| e.to_string())?;

    ilog!(&app, &log_id, "Launching Minecraft...");
    let mut child = launcher.launch(tx).await.map_err(|e| e.to_string())?;

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .running
        .lock()
        .unwrap()
        .insert(instance_id.clone(), kill_tx);
    state
        .playtime
        .lock()
        .unwrap()
        .insert(instance_id.clone(), std::time::Instant::now());

    let running_ev = state.running.clone();
    let playtime_ev = state.playtime.clone();
    let skin_servers_ev = state.skin_servers.clone();
    let app_ev2 = app.clone();
    let id_ev2 = instance_id.clone();

    tokio::spawn(async move {
        let exit_code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()).unwrap_or(-1),
            _ = kill_rx => {
                let _ = child.kill().await;
                child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1)
            }
        };

        running_ev.lock().unwrap().remove(&id_ev2);
        if let Some(cancel_tx) = skin_servers_ev.lock().unwrap().remove(&id_ev2) {
            let _ = cancel_tx.send(());
        }

        let logs_snapshot = logs_for_monitor.lock().unwrap().clone();
        if Launcher::is_corrupt_crash(exit_code, &logs_snapshot) {
            app_ev2.emit("minecraft-corrupt-crash", &id_ev2).ok();
        }

        let elapsed = playtime_ev
            .lock()
            .unwrap()
            .remove(&id_ev2)
            .map(|start| start.elapsed().as_secs())
            .unwrap_or(0);
        if elapsed > 0 {
            save_playtime(&app_ev2, &id_ev2, elapsed);
        }

        app_ev2.emit("minecraft-closed", &id_ev2).ok();
    });

    Ok(())
}

async fn download_authlib_injector(
    path: &PathBuf,
    app: &AppHandle,
    log_id: &str,
) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    ilog!(app, log_id, "Descargando authlib-injector...");
    let client = reqwest::Client::builder()
        .user_agent("modstack-launcher/1.0")
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .map_err(|e| e.to_string())?;
    let release: serde_json::Value = client
        .get("https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest")
        .send()
        .await
        .map_err(|e| format!("authlib-injector info: {}", e))?
        .json()
        .await
        .map_err(|e| format!("authlib-injector parse: {}", e))?;
    let url = release["assets"]
        .as_array()
        .and_then(|a| {
            a.iter().find(|a| {
                a["name"]
                    .as_str()
                    .map(|n| n.ends_with(".jar"))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("No se encontró URL de descarga de authlib-injector")?
        .to_string();
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("authlib-injector download: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("authlib-injector bytes: {}", e))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(path, &bytes).map_err(|e| format!("authlib-injector write: {}", e))?;
    ilog!(
        app,
        log_id,
        "authlib-injector guardado en {}",
        path.display()
    );
    Ok(())
}

async fn prepare_offline_skin(
    data_url: &str,
    arm_style: &str,
    uuid: &str,
    username: &str,
    engine: &PathBuf,
    app: &AppHandle,
    log_id: &str,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Option<String> {
    if data_url.is_empty() {
        return None;
    }
    let base64_part = data_url.split(',').nth(1)?;
    let skin_bytes = B64.decode(base64_part).ok()?;
    if skin_bytes.is_empty() {
        return None;
    }
    let port =
        crate::skin_server::start_skin_server(skin_bytes, uuid, username, arm_style, cancel_rx)
            .await
            .map_err(|e| ilog!(app, log_id, "Skin server error: {}", e))
            .ok()?;
    let authlib_jar = engine.join("authlib-injector.jar");
    if let Err(e) = download_authlib_injector(&authlib_jar, app, log_id).await {
        ilog!(app, log_id, "authlib-injector no disponible: {}", e);
        return None;
    }
    Some(format!(
        "-javaagent:{}=http://127.0.0.1:{}",
        authlib_jar.display(),
        port
    ))
}

async fn prepare_global_skin_server(
    server_url: &str,
    engine: &PathBuf,
    app: &AppHandle,
    log_id: &str,
) -> Option<String> {
    let authlib_jar = engine.join("authlib-injector.jar");
    if let Err(e) = download_authlib_injector(&authlib_jar, app, log_id).await {
        ilog!(app, log_id, "authlib-injector no disponible: {}", e);
        return None;
    }
    let clean_url = server_url.trim().trim_end_matches('/');
    ilog!(
        app,
        log_id,
        "Usando servidor global de skins: {}",
        clean_url
    );
    Some(format!(
        "-javaagent:{}={}",
        authlib_jar.display(),
        clean_url
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalInstance {
    pub id: String,
    pub title: String,
    pub minecraft_version: String,
    pub loader: String,
    pub icon_path: Option<String>,
    pub background_path: Option<String>,
    pub created_at: i64,
}

fn instances_root(_app: &AppHandle) -> PathBuf {
    crate::commands::config::get_install_dir_path().join("instances")
}

fn instance_dir(app: &AppHandle, id: &str) -> PathBuf {
    instances_root(app).join(id)
}

fn instance_json_path(app: &AppHandle, id: &str) -> PathBuf {
    instance_dir(app, id).join("instance.json")
}

fn selected_id_path(app: &AppHandle) -> PathBuf {
    instances_root(app).join(".selected")
}

fn img_ext(src: &PathBuf) -> &'static str {
    match src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "jpg",
        _ => "png",
    }
}

fn copy_image(src: &str, dest_dir: &PathBuf, name: &str) -> Result<String, String> {
    let src_path = PathBuf::from(src);
    if !src_path.exists() {
        return Err(format!("File not found: {}", src));
    }
    let ext = img_ext(&src_path);
    let dest = dest_dir.join(format!("{}.{}", name, ext));
    fs::copy(&src_path, &dest).map_err(|e| format!("Error copying image: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

fn init_instance_dirs(dir: &PathBuf) -> Result<(), String> {
    for sub in &["mods", "config", "saves", "resourcepacks", "shaderpacks"] {
        fs::create_dir_all(dir.join(sub)).map_err(|e| format!("Error creating {}: {}", sub, e))?;
    }
    Ok(())
}

#[command]
pub fn load_local_instances(app: AppHandle) -> Vec<LocalInstance> {
    let root = instances_root(&app);
    if !root.exists() {
        return vec![];
    }
    let mut list: Vec<LocalInstance> = fs::read_dir(&root)
        .unwrap_or_else(|_| return std::fs::read_dir(".").unwrap())
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let json = e.path().join("instance.json");
            let raw = fs::read_to_string(&json).ok()?;
            serde_json::from_str::<LocalInstance>(&raw).ok()
        })
        .collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

#[command]
pub fn add_local_instance(
    app: AppHandle,
    mut instance: LocalInstance,
    icon_src: Option<String>,
    background_src: Option<String>,
) -> Result<LocalInstance, String> {
    let dir = instance_dir(&app, &instance.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dir)?;
    if let Some(src) = icon_src.filter(|s| !s.is_empty()) {
        match copy_image(&src, &dir, "icon") {
            Ok(dest) => instance.icon_path = Some(dest),
            Err(e) => eprintln!("Warn: could not copy icon: {}", e),
        }
    }
    if let Some(src) = background_src.filter(|s| !s.is_empty()) {
        match copy_image(&src, &dir, "background") {
            Ok(dest) => instance.background_path = Some(dest),
            Err(e) => eprintln!("Warn: could not copy background: {}", e),
        }
    }
    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(&app, &instance.id), json).map_err(|e| e.to_string())?;
    Ok(instance)
}

#[command]
pub fn remove_local_instance(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dir = instance_dir(&app, &id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    {
        let mut manager = state.instances.lock().unwrap();
        let before = manager.instances.len();
        manager.instances.retain(|i| i.id != id);
        if manager.instances.len() != before {
            manager.save();
        }
    }
    let sel = get_selected_local_instance_id(app.clone());
    if sel.as_deref() == Some(&id) {
        set_selected_local_instance_id(app, None).ok();
    }
    Ok(())
}

#[command]
pub fn update_local_instance(
    app: AppHandle,
    id: String,
    title: Option<String>,
    minecraft_version: Option<String>,
    loader: Option<String>,
    icon_src: Option<String>,
    background_src: Option<String>,
    clear_icon: bool,
    clear_background: bool,
) -> Result<LocalInstance, String> {
    let json_path = instance_json_path(&app, &id);
    let raw = fs::read_to_string(&json_path).map_err(|_| format!("Instance '{}' not found", id))?;
    let mut inst: LocalInstance = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let dir = instance_dir(&app, &id);
    if let Some(v) = title {
        inst.title = v;
    }
    if let Some(v) = minecraft_version {
        inst.minecraft_version = v;
    }
    if let Some(v) = loader {
        inst.loader = v;
    }
    if clear_icon {
        if let Some(ref p) = inst.icon_path {
            let _ = fs::remove_file(p);
        }
        inst.icon_path = None;
    } else if let Some(src) = icon_src.filter(|s| !s.is_empty()) {
        if let Some(ref old) = inst.icon_path {
            let _ = fs::remove_file(old);
        }
        match copy_image(&src, &dir, "icon") {
            Ok(dest) => inst.icon_path = Some(dest),
            Err(e) => eprintln!("Warn: icon: {}", e),
        }
    }
    if clear_background {
        if let Some(ref p) = inst.background_path {
            let _ = fs::remove_file(p);
        }
        inst.background_path = None;
    } else if let Some(src) = background_src.filter(|s| !s.is_empty()) {
        if let Some(ref old) = inst.background_path {
            let _ = fs::remove_file(old);
        }
        match copy_image(&src, &dir, "background") {
            Ok(dest) => inst.background_path = Some(dest),
            Err(e) => eprintln!("Warn: background: {}", e),
        }
    }
    let json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;
    Ok(inst)
}

#[command]
pub fn get_selected_local_instance_id(app: AppHandle) -> Option<String> {
    let path = selected_id_path(&app);
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[command]
pub fn set_selected_local_instance_id(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let path = selected_id_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match id {
        Some(val) => fs::write(&path, val).map_err(|e| e.to_string()),
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        }
    }
}

#[command]
pub fn open_local_instance_folder(app: AppHandle, id: String) -> Result<(), String> {
    let dir = instance_dir(&app, &id);
    if !dir.exists() {
        return Err(format!("Folder not found: {}", dir.display()));
    }
    open::that(&dir).map_err(|e| e.to_string())
}

#[command]
pub fn save_local_instances(_app: AppHandle, _instances: Vec<LocalInstance>) -> Result<(), String> {
    Ok(())
}

#[command]
pub async fn export_local_instance(
    app: AppHandle,
    id: String,
    options: HashMap<String, bool>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let dir = instance_dir(&app, &id);
    let json_path = instance_json_path(&app, &id);
    let raw = fs::read_to_string(&json_path).map_err(|_| format!("Instance '{}' not found", id))?;
    let inst: LocalInstance = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let dest_folder = app
        .dialog()
        .file()
        .set_title("Export instance")
        .blocking_pick_folder()
        .ok_or("User cancelled export")?;

    let dest_path = PathBuf::from(dest_folder.to_string());
    let export_name = format!("{}.mrstack", slugify_export(&inst.title));
    let export_path = dest_path.join(&export_name);

    let file = fs::File::create(&export_path).map_err(|e| format!("Error creating file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let zip_options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("instance.json", zip_options)
        .map_err(|e| e.to_string())?;
    zip.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;

    let logo_candidates: &[&str] = &["icons/icon.png", "icons/32x32.png", "icons/128x128.png"];
    let search_roots: Vec<PathBuf> = {
        let mut roots = vec![];
        if let Ok(res) = app.path().resource_dir() {
            roots.push(res);
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                roots.push(parent.to_path_buf());
                roots.push(parent.join("..").join("Resources"));
                roots.push(parent.join("..").join("..").join(".."));
            }
        }
        roots
    };

    'logo: for root in &search_roots {
        for candidate in logo_candidates {
            let logo_path = root.join(candidate);
            if logo_path.exists() {
                let fname = logo_path.file_name().unwrap().to_string_lossy();
                zip.start_file(format!("assets/launcher/{}", fname), zip_options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(&fs::read(&logo_path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                break 'logo;
            }
        }
    }

    let zip_subdir = |zip: &mut zip::ZipWriter<fs::File>, subdir: &str| -> Result<(), String> {
        let sub_path = dir.join(subdir);
        if !sub_path.exists() {
            return Ok(());
        }
        for entry in WalkDir::new(&sub_path).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() {
                let relative = path
                    .strip_prefix(&dir)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                zip.start_file(&relative, zip_options)
                    .map_err(|e| e.to_string())?;
                let bytes = fs::read(path).map_err(|e| e.to_string())?;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    };

    if options.get("mods").copied().unwrap_or(true) {
        zip_subdir(&mut zip, "mods")?;
    }
    if options.get("config").copied().unwrap_or(true) {
        zip_subdir(&mut zip, "config")?;
    }
    if options.get("resourcepacks").copied().unwrap_or(true) {
        zip_subdir(&mut zip, "resourcepacks")?;
    }
    if options.get("shaderpacks").copied().unwrap_or(false) {
        zip_subdir(&mut zip, "shaderpacks")?;
    }
    if options.get("datapack").copied().unwrap_or(false) {
        zip_subdir(&mut zip, "datapacks")?;
    }

    if options.get("include_images").copied().unwrap_or(true) {
        for img_path_str in [&inst.icon_path, &inst.background_path]
            .into_iter()
            .flatten()
        {
            let img_path = PathBuf::from(img_path_str);
            if img_path.exists() {
                if let Some(fname) = img_path.file_name() {
                    let zip_name = format!("assets/{}", fname.to_string_lossy());
                    zip.start_file(&zip_name, zip_options)
                        .map_err(|e| e.to_string())?;
                    zip.write_all(&fs::read(&img_path).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(export_path.to_string_lossy().to_string())
}

#[command(rename_all = "camelCase")]
pub async fn import_mrstack(app: AppHandle, mrstack_path: String) -> Result<LocalInstance, String> {
    let extension = std::path::Path::new(&mrstack_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "mrpack" => import_mrpack_file(&app, &mrstack_path).await,
        "zip" => import_curseforge_zip(&app, &mrstack_path).await,
        _ => import_mrstack_file(&app, &mrstack_path),
    }
}

fn import_mrstack_file(app: &AppHandle, path: &str) -> Result<LocalInstance, String> {
    use std::io::Read;

    let zip_bytes = fs::read(path).map_err(|e| format!("Could not read file: {}", e))?;
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Not a valid .mrstack: {}", e))?;

    let raw_json = {
        let mut f = archive
            .by_name("instance.json")
            .map_err(|_| "Missing instance.json in archive")?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        s
    };

    let mut inst: LocalInstance =
        serde_json::from_str(&raw_json).map_err(|e| format!("Invalid instance.json: {}", e))?;

    let existing = load_local_instances(app.clone());
    if existing.iter().any(|i| i.id == inst.id) {
        inst.id = format!("{}-{}", inst.id, chrono::Utc::now().timestamp());
    }
    inst.created_at = chrono::Utc::now().timestamp_millis();

    let dest_dir = instance_dir(app, &inst.id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dest_dir)?;
    inst.icon_path = None;
    inst.background_path = None;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name == "instance.json" {
            continue;
        }
        if name.starts_with("assets/launcher/") {
            continue;
        }
        if name.ends_with('/') {
            fs::create_dir_all(dest_dir.join(&name)).ok();
            continue;
        }
        if name.starts_with("assets/") {
            let fname = PathBuf::from(&name)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            if fname.is_empty() {
                continue;
            }
            let out_path = dest_dir.join(&fname);
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Error creating {}: {}", fname, e))?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
            if fname.starts_with("icon") {
                inst.icon_path = Some(out_path.to_string_lossy().to_string());
            } else if fname.starts_with("background") {
                inst.background_path = Some(out_path.to_string_lossy().to_string());
            }
            continue;
        }
        let out_path = dest_dir.join(&name);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        let mut out_file =
            fs::File::create(&out_path).map_err(|e| format!("Error creating {}: {}", name, e))?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }

    let updated_json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(app, &inst.id), updated_json).map_err(|e| e.to_string())?;
    Ok(inst)
}

async fn import_mrpack_file(app: &AppHandle, path: &str) -> Result<LocalInstance, String> {
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    let zip_bytes = fs::read(path).map_err(|e| format!("Could not read .mrpack: {}", e))?;
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Not a valid .mrpack: {}", e))?;

    let index: serde_json::Value = {
        let mut f = archive
            .by_name("modrinth.index.json")
            .map_err(|_| "Missing modrinth.index.json")?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| e.to_string())?
    };

    let pack_name = index["name"]
        .as_str()
        .unwrap_or("Imported Pack")
        .to_string();
    let mc_version = index["dependencies"]["minecraft"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let loader = if index["dependencies"]["fabric-loader"].is_string() {
        "fabric"
    } else if index["dependencies"]["forge"].is_string() {
        "forge"
    } else if index["dependencies"]["neoforge"].is_string() {
        "neoforge"
    } else if index["dependencies"]["quilt-loader"].is_string() {
        "quilt"
    } else {
        "vanilla"
    }
    .to_string();

    let id = format!(
        "mrpack-{}-{}",
        slugify_export(&pack_name),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let dest_dir = instance_dir(app, &id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dest_dir)?;

    let files = index["files"].as_array().cloned().unwrap_or_default();
    let total = files.len();
    let client = build_client_with_timeout(300);

    // Collect Modrinth mod metadata before the download loop consumes `files`
    struct MrpackModInfo {
        filename: String,
        project_id: String,
        download_url: String,
    }
    let mod_infos: Vec<MrpackModInfo> = files
        .iter()
        .filter_map(|file| {
            let path = file["path"].as_str()?;
            if !path.starts_with("mods/") {
                return None;
            }
            let filename = std::path::Path::new(path)
                .file_name()?
                .to_str()?
                .to_string();
            let first_url = file["downloads"]
                .as_array()
                .and_then(|d| d.first())
                .and_then(|u| u.as_str())?
                .to_string();
            let project_id = first_url
                .split("/data/")
                .nth(1)
                .and_then(|s| s.split('/').next())?
                .to_string();
            Some(MrpackModInfo {
                filename,
                project_id,
                download_url: first_url,
            })
        })
        .collect();

    app.emit("instance-status", serde_json::json!({ "instanceId": &id, "status": format!("Downloading {} files...", total) })).ok();

    let count = std::sync::atomic::AtomicUsize::new(0);
    stream::iter(files)
        .for_each_concurrent(32, |file| {
            let client = client.clone();
            let dest_dir = dest_dir.clone();
            let app = app.clone();
            let iid = id.clone();
            let count = &count;
            async move {
                let file_path = file["path"].as_str().unwrap_or("").to_string();
                if file_path.is_empty() {
                    count.fetch_add(1, Ordering::Relaxed);
                    return;
                }
                let dest = dest_dir.join(&file_path);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if dest.exists() {
                    let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                    app.emit(
                        "instance-progress",
                        serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                    )
                    .ok();
                    return;
                }
                let downloads = file["downloads"].as_array().cloned().unwrap_or_default();
                for dl in &downloads {
                    if let Some(url) = dl.as_str() {
                        if let Ok(resp) = client.get(url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                fs::write(&dest, &bytes).ok();
                                break;
                            }
                        }
                    }
                }
                let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                app.emit(
                    "instance-progress",
                    serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                )
                .ok();
            }
        })
        .await;

    // Index mods: batch-query Modrinth for slug/name/icon per project_id
    if !mod_infos.is_empty() {
        let mods_dir = dest_dir.join("mods");
        let unique_ids: Vec<&str> = {
            let mut seen = std::collections::HashSet::new();
            mod_infos
                .iter()
                .filter(|m| seen.insert(m.project_id.as_str()))
                .map(|m| m.project_id.as_str())
                .collect()
        };
        let ids_json = serde_json::to_string(&unique_ids).unwrap_or_default();
        if let Ok(resp) = client
            .get(format!(
                "https://api.modrinth.com/v2/projects?ids={}",
                ids_json
            ))
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
        {
            if let Ok(projects) = resp.json::<Vec<serde_json::Value>>().await {
                let project_map: std::collections::HashMap<String, serde_json::Value> = projects
                    .into_iter()
                    .filter_map(|p| {
                        let id = p["id"].as_str()?.to_string();
                        Some((id, p))
                    })
                    .collect();
                for info in &mod_infos {
                    if let Some(project) = project_map.get(&info.project_id) {
                        let slug = project["slug"]
                            .as_str()
                            .unwrap_or(&info.project_id)
                            .to_string();
                        let name = project["title"].as_str().unwrap_or(&slug).to_string();
                        let icon = project["icon_url"].as_str().map(|s| s.to_string());
                        crate::commands::modrinth::write_mod_index(
                            &mods_dir,
                            &info.filename,
                            &crate::commands::modrinth::ModIndex {
                                slug,
                                project_id: info.project_id.clone(),
                                name,
                                version: String::new(),
                                source: "modrinth".to_string(),
                                download_url: info.download_url.clone(),
                                icon_url: icon,
                            },
                        );
                    }
                }
            }
        }
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Extracting overrides..." }),
    )
    .ok();
    let cursor2 = std::io::Cursor::new(&zip_bytes);
    let mut archive2 = zip::ZipArchive::new(cursor2).map_err(|e| e.to_string())?;
    for i in 0..archive2.len() {
        let mut entry = archive2.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !name.starts_with("overrides/") {
            continue;
        }
        let rel = name.trim_start_matches("overrides/");
        if rel.is_empty() {
            continue;
        }
        let out_path = dest_dir.join(rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            if let Ok(mut out_file) = fs::File::create(&out_path) {
                std::io::copy(&mut entry, &mut out_file).ok();
            }
        }
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "" }),
    )
    .ok();
    app.emit("instance-done", &id).ok();

    let inst = LocalInstance {
        id: id.clone(),
        title: pack_name,
        minecraft_version: mc_version,
        loader,
        icon_path: None,
        background_path: None,
        created_at,
    };
    let json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(app, &id), json).map_err(|e| e.to_string())?;
    Ok(inst)
}

async fn import_curseforge_zip(app: &AppHandle, path: &str) -> Result<LocalInstance, String> {
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    let zip_bytes = fs::read(path).map_err(|e| format!("Could not read zip: {}", e))?;
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Not a valid zip: {}", e))?;

    let manifest: serde_json::Value = {
        let mut f = archive
            .by_name("manifest.json")
            .map_err(|_| "Missing manifest.json — is this a CurseForge modpack?")?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| e.to_string())?
    };

    let pack_name = manifest["name"]
        .as_str()
        .unwrap_or("Imported Pack")
        .to_string();
    let mc_version = manifest["minecraft"]["version"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let loader = manifest["minecraft"]["modLoaders"]
        .as_array()
        .and_then(|l| l.iter().find(|m| m["primary"].as_bool().unwrap_or(false)))
        .and_then(|m| m["id"].as_str())
        .and_then(|id| id.split('-').next())
        .unwrap_or("forge")
        .to_string();

    let id = format!(
        "cf-{}-{}",
        slugify_export(&pack_name),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let dest_dir = instance_dir(app, &id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dest_dir)?;

    let files = manifest["files"].as_array().cloned().unwrap_or_default();
    let total = files.len();
    let client = build_client_with_timeout(300);
    let cf_api_key = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";
    let mods_dir = dest_dir.join("mods");
    fs::create_dir_all(&mods_dir).ok();

    app.emit("instance-status", serde_json::json!({ "instanceId": &id, "status": format!("Downloading {} mods...", total) })).ok();

    for (i, file) in files.iter().enumerate() {
        let project_id = file["projectID"].as_u64().unwrap_or(0);
        let file_id = file["fileID"].as_u64().unwrap_or(0);
        if project_id == 0 || file_id == 0 {
            continue;
        }

        let api_url = format!(
            "https://api.curseforge.com/v1/mods/{}/files/{}/download-url",
            project_id, file_id
        );
        if let Ok(resp) = client
            .get(&api_url)
            .header("x-api-key", cf_api_key)
            .send()
            .await
        {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(url) = data["data"].as_str() {
                    let filename = url.split('/').last().unwrap_or("mod.jar").to_string();
                    let dest = mods_dir.join(&filename);
                    if !dest.exists() {
                        if let Ok(r) = client.get(url).send().await {
                            if let Ok(bytes) = r.bytes().await {
                                fs::write(&dest, &bytes).ok();
                            }
                        }
                    }
                }
            }
        }
        app.emit(
            "instance-progress",
            serde_json::json!({ "instanceId": &id, "current": i + 1, "total": total }),
        )
        .ok();
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Extracting overrides..." }),
    )
    .ok();
    let cursor2 = std::io::Cursor::new(&zip_bytes);
    let mut archive2 = zip::ZipArchive::new(cursor2).map_err(|e| e.to_string())?;
    for i in 0..archive2.len() {
        let mut entry = archive2.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !name.starts_with("overrides/") {
            continue;
        }
        let rel = name.trim_start_matches("overrides/");
        if rel.is_empty() {
            continue;
        }
        let out_path = dest_dir.join(rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            if let Ok(mut out_file) = fs::File::create(&out_path) {
                std::io::copy(&mut entry, &mut out_file).ok();
            }
        }
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "" }),
    )
    .ok();
    app.emit("instance-done", &id).ok();

    let inst = LocalInstance {
        id: id.clone(),
        title: pack_name,
        minecraft_version: mc_version,
        loader,
        icon_path: None,
        background_path: None,
        created_at,
    };
    let json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(app, &id), json).map_err(|e| e.to_string())?;
    Ok(inst)
}

fn slugify_export(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c.to_lowercase().next().unwrap()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[command]
pub async fn install_modrinth_modpack(
    app: AppHandle,
    slug: String,
    title: String,
    icon_url: Option<String>,
    version_id: Option<String>,
) -> Result<LocalInstance, String> {
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    let id = format!("{}-{}", slug, version_id.as_deref().unwrap_or("latest"));
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let dir = instance_dir(&app, &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dir)?;

    let icon_path = if let Some(url) = icon_url.filter(|s| !s.is_empty()) {
        let icon_dest = dir.join("icon.png");
        match build_client().get(&url).send().await {
            Ok(resp) => match resp.bytes().await {
                Ok(bytes) => {
                    fs::write(&icon_dest, &bytes).ok();
                    Some(icon_dest.to_string_lossy().to_string())
                }
                Err(_) => None,
            },
            Err(_) => None,
        }
    } else {
        None
    };

    let client = build_client_with_timeout(300);

    let project: serde_json::Value = client
        .get(format!("https://api.modrinth.com/v2/project/{}", slug))
        .header("User-Agent", "Launcher/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let background_path = {
        let gallery = project["gallery"].as_array();
        let gallery_url = gallery
            .and_then(|g| {
                g.iter()
                    .find(|img| img["featured"].as_bool().unwrap_or(false))
                    .or_else(|| g.first())
            })
            .and_then(|img| img["raw_url"].as_str().or_else(|| img["url"].as_str()))
            .map(|s| s.to_string());
        if let Some(url) = gallery_url {
            let bg_dest = dir.join("background.png");
            match client
                .get(&url)
                .header("User-Agent", "Launcher/1.0")
                .send()
                .await
            {
                Ok(resp) => match resp.bytes().await {
                    Ok(bytes) => {
                        fs::write(&bg_dest, &bytes).ok();
                        Some(bg_dest.to_string_lossy().to_string())
                    }
                    Err(_) => None,
                },
                Err(_) => None,
            }
        } else {
            None
        }
    };

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Fetching modpack version..." }),
    )
    .ok();

    let versions: serde_json::Value = client
        .get(format!(
            "https://api.modrinth.com/v2/project/{}/version",
            slug
        ))
        .header("User-Agent", "Launcher/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let target_version = if let Some(vid) = &version_id {
        versions
            .as_array()
            .and_then(|v| v.iter().find(|ver| ver["id"].as_str() == Some(vid)))
            .ok_or("Specified version not found")?
    } else {
        versions
            .as_array()
            .and_then(|v| v.first())
            .ok_or("No modpack versions found")?
    };

    let mc_version = target_version["game_versions"]
        .as_array()
        .and_then(|v| v.last())
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            project["game_versions"]
                .as_array()
                .and_then(|v| v.last())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
        })
        .to_string();

    let loader = target_version["loaders"]
        .as_array()
        .and_then(|v| v.first())
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            project["loaders"]
                .as_array()
                .and_then(|v| v.first())
                .and_then(|v| v.as_str())
                .unwrap_or("fabric")
        })
        .to_string();

    let mrpack_url = target_version["files"]
        .as_array()
        .and_then(|files| {
            files.iter().find(|f| {
                f["filename"]
                    .as_str()
                    .map(|n| n.ends_with(".mrpack"))
                    .unwrap_or(false)
            })
        })
        .and_then(|f| f["url"].as_str())
        .ok_or("No .mrpack file found")?
        .to_string();

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Downloading modpack..." }),
    )
    .ok();

    let mrpack_bytes = client
        .get(&mrpack_url)
        .header("User-Agent", "Launcher/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let cursor = std::io::Cursor::new(&mrpack_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Error opening .mrpack: {}", e))?;

    let index: serde_json::Value = {
        let mut f = archive
            .by_name("modrinth.index.json")
            .map_err(|_| "Missing modrinth.index.json in .mrpack")?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| e.to_string())?
    };

    let files = index["files"].as_array().cloned().unwrap_or_default();
    let total = files.len();

    // Collect Modrinth metadata for each mod file before the download loop consumes `files`
    struct ModInstallInfo {
        filename: String,
        project_id: String,
        download_url: String,
    }
    let mod_infos: Vec<ModInstallInfo> = files
        .iter()
        .filter_map(|file| {
            let path = file["path"].as_str()?;
            if !path.starts_with("mods/") {
                return None;
            }
            let filename = std::path::Path::new(path)
                .file_name()?
                .to_str()?
                .to_string();
            let first_url = file["downloads"]
                .as_array()
                .and_then(|d| d.first())
                .and_then(|u| u.as_str())?
                .to_string();
            // Extract project_id from Modrinth CDN URL: /data/{project_id}/versions/...
            let project_id = first_url
                .split("/data/")
                .nth(1)
                .and_then(|s| s.split('/').next())?
                .to_string();
            Some(ModInstallInfo {
                filename,
                project_id,
                download_url: first_url,
            })
        })
        .collect();

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Downloading mods..." }),
    )
    .ok();
    app.emit(
        "instance-progress",
        serde_json::json!({ "instanceId": &id, "current": 0u64, "total": total }),
    )
    .ok();

    let count = std::sync::atomic::AtomicUsize::new(0);

    stream::iter(files)
        .for_each_concurrent(32, |file| {
            let client = client.clone();
            let dir = dir.clone();
            let app = app.clone();
            let count = &count;
            let iid = id.clone();
            async move {
                let path_str = file["path"].as_str().unwrap_or("").to_string();
                if path_str.is_empty() {
                    count.fetch_add(1, Ordering::Relaxed);
                    return;
                }
                let dest = dir.join(&path_str);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).ok();
                }
                if dest.exists() {
                    let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                    app.emit(
                        "instance-progress",
                        serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                    )
                    .ok();
                    return;
                }
                let downloads = file["downloads"].as_array().cloned().unwrap_or_default();
                for dl_url in downloads {
                    if let Some(url) = dl_url.as_str() {
                        if let Ok(resp) = client.get(url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                fs::write(&dest, &bytes).ok();
                                break;
                            }
                        }
                    }
                }
                let c = count.fetch_add(1, Ordering::Relaxed) + 1;
                app.emit(
                    "instance-progress",
                    serde_json::json!({ "instanceId": &iid, "current": c, "total": total }),
                )
                .ok();
            }
        })
        .await;

    // Index installed mods: batch-query Modrinth for slug/name/icon per project_id
    if !mod_infos.is_empty() {
        let mods_dir = dir.join("mods");
        let unique_project_ids: Vec<&str> = {
            let mut seen = std::collections::HashSet::new();
            mod_infos
                .iter()
                .filter(|m| seen.insert(m.project_id.as_str()))
                .map(|m| m.project_id.as_str())
                .collect()
        };
        let ids_json = serde_json::to_string(&unique_project_ids).unwrap_or_default();
        if let Ok(resp) = client
            .get(format!(
                "https://api.modrinth.com/v2/projects?ids={}",
                ids_json
            ))
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
        {
            if let Ok(projects) = resp.json::<Vec<serde_json::Value>>().await {
                let project_map: std::collections::HashMap<String, serde_json::Value> = projects
                    .into_iter()
                    .filter_map(|p| {
                        let id = p["id"].as_str()?.to_string();
                        Some((id, p))
                    })
                    .collect();
                for info in &mod_infos {
                    if let Some(project) = project_map.get(&info.project_id) {
                        let slug = project["slug"]
                            .as_str()
                            .unwrap_or(&info.project_id)
                            .to_string();
                        let name = project["title"].as_str().unwrap_or(&slug).to_string();
                        let icon = project["icon_url"].as_str().map(|s| s.to_string());
                        crate::commands::modrinth::write_mod_index(
                            &mods_dir,
                            &info.filename,
                            &crate::commands::modrinth::ModIndex {
                                slug,
                                project_id: info.project_id.clone(),
                                name,
                                version: String::new(),
                                source: "modrinth".to_string(),
                                download_url: info.download_url.clone(),
                                icon_url: icon,
                            },
                        );
                    }
                }
            }
        }
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "Extracting overrides..." }),
    )
    .ok();

    let cursor = std::io::Cursor::new(&mrpack_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Error reopening .mrpack: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !name.starts_with("overrides/") {
            continue;
        }
        let rel = name.trim_start_matches("overrides/");
        if rel.is_empty() {
            continue;
        }
        let out_path = dir.join(rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            if let Ok(mut out_file) = fs::File::create(&out_path) {
                std::io::copy(&mut entry, &mut out_file).ok();
            }
        }
    }

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &id, "status": "" }),
    )
    .ok();
    app.emit("instance-done", &id).ok();

    let inst = LocalInstance {
        id: id.clone(),
        title,
        minecraft_version: mc_version,
        loader,
        icon_path,
        background_path,
        created_at,
    };

    let json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(&app, &id), json).map_err(|e| e.to_string())?;
    Ok(inst)
}

#[command]
pub fn register_local_instance_for_launch(
    app: AppHandle,
    id: String,
    title: String,
    loader: String,
    version: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = instance_dir(&app, &id);
    let mut manager = state.instances.lock().unwrap();
    manager.instances.retain(|i| i.id != id);
    manager.create_instance(
        title,
        id.clone(),
        path,
        loader,
        version,
        None,
        None,
        None,
        None,
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    pub name: String,
    pub folder_name: String,
    pub last_played: i64,
    pub icon_path: Option<String>,
}

#[command]
pub fn get_instance_worlds(app: AppHandle, instance_id: String) -> Vec<WorldInfo> {
    let saves_dir = instance_dir(&app, &instance_id).join("saves");
    println!("Looking for worlds in: {}", saves_dir.display());
    if !saves_dir.exists() {
        return vec![];
    }
    let mut worlds: Vec<WorldInfo> = fs::read_dir(&saves_dir)
        .unwrap_or_else(|_| fs::read_dir(".").unwrap())
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let folder_name = e.file_name().to_string_lossy().to_string();
            let path = e.path();
            let icon_path = path.join("icon.png");
            let last_played = e
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64
                })
                .unwrap_or(0);
            WorldInfo {
                name: folder_name.clone(),
                folder_name,
                last_played,
                icon_path: if icon_path.exists() {
                    Some(icon_path.to_string_lossy().to_string())
                } else {
                    None
                },
            }
        })
        .collect();
    worlds.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    worlds
}

#[command]
pub async fn stop_instance(instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let kill_tx = state
        .running
        .lock()
        .unwrap()
        .remove(&instance_id)
        .ok_or_else(|| format!("Instance '{}' is not running", instance_id))?;
    let _ = kill_tx.send(());
    Ok(())
}

#[command]
pub fn get_running_instances(state: State<'_, AppState>) -> Vec<String> {
    state.running.lock().unwrap().keys().cloned().collect()
}

#[command]
pub fn get_downloading_instances(state: State<'_, AppState>) -> HashMap<String, String> {
    state.downloading.lock().unwrap().clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub children: Option<Vec<FileEntry>>,
}

#[command]
pub fn get_instance_files(app: AppHandle, instance_id: String) -> Vec<FileEntry> {
    let dir = instance_dir(&app, &instance_id);
    read_dir_recursive(&dir, &dir, 0, 4)
}

fn read_dir_recursive(
    root: &PathBuf,
    path: &PathBuf,
    depth: u32,
    max_depth: u32,
) -> Vec<FileEntry> {
    if depth >= max_depth {
        return vec![];
    }
    let Ok(entries) = fs::read_dir(path) else {
        return vec![];
    };
    let mut result: Vec<FileEntry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let is_dir = meta.is_dir();
            let full_path = e.path();
            let relative = full_path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            Some(FileEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: relative,
                is_dir,
                size: if is_dir { None } else { Some(meta.len()) },
                children: if is_dir {
                    Some(read_dir_recursive(root, &full_path, depth + 1, max_depth))
                } else {
                    None
                },
            })
        })
        .collect();
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    result
}

#[command]
pub fn read_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
) -> Result<String, String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    let content =
        fs::read_to_string(&full_path).map_err(|e| format!("Could not read file: {}", e))?;
    Ok(content)
}

#[command]
pub fn delete_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&full_path).map_err(|e| e.to_string())
    }
}

#[command]
pub fn rename_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
    new_name: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    let new_path = full_path.parent().ok_or("No parent dir")?.join(&new_name);
    fs::rename(&full_path, &new_path).map_err(|e| e.to_string())
}

#[command]
pub fn write_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    fs::write(&full_path, content.as_bytes()).map_err(|e| format!("Could not write file: {}", e))
}

fn save_playtime(app: &AppHandle, instance_id: &str, seconds: u64) {
    let path = instances_root(app).join(instance_id).join("playtime.json");
    let existing: u64 = fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    fs::write(&path, (existing + seconds).to_string()).ok();
}

#[command]
pub fn get_instance_playtime(app: AppHandle, instance_id: String) -> u64 {
    let path = instances_root(&app)
        .join(&instance_id)
        .join("playtime.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotInfo {
    pub name: String,
    pub path: String,
    pub created: i64,
}

#[command]
pub fn get_instance_screenshots(app: AppHandle, instance_id: String) -> Vec<ScreenshotInfo> {
    let dir = instance_dir(&app, &instance_id).join("screenshots");
    if !dir.exists() {
        return vec![];
    }
    let mut screenshots = vec![];
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let created = entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .map(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs() as i64
                            })
                            .unwrap_or(0);
                        screenshots.push(ScreenshotInfo {
                            name,
                            path: path.to_string_lossy().to_string(),
                            created,
                        });
                    }
                }
            }
        }
    }
    screenshots.sort_by(|a, b| b.created.cmp(&a.created));
    screenshots
}

#[command]
pub fn open_instance_screenshot(
    app: AppHandle,
    instance_id: String,
    file_name: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id)
        .join("screenshots")
        .join(&file_name);
    if !dir.exists() {
        return Err(format!("File not found: {}", dir.display()));
    }
    open::that(&dir).map_err(|e| e.to_string())
}

#[command]
pub fn open_instance_screenshots_folder(app: AppHandle, instance_id: String) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id).join("screenshots");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    open::that(&dir).map_err(|e| e.to_string())
}

#[command]
pub async fn install_curseforge_modpack(
    app: AppHandle,
    project_id: String,
    title: String,
    icon_url: Option<String>,
    game_version: Option<String>,
) -> Result<LocalInstance, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    const CF_API_KEY: &str = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";

    let client = build_client_with_timeout(300);

    let mut files_url = format!(
        "https://api.curseforge.com/v1/mods/{}/files?pageSize=20",
        project_id
    );
    if let Some(ref gv) = game_version {
        files_url.push_str(&format!("&gameVersion={}", gv));
    }

    let files_resp: serde_json::Value = client
        .get(&files_url)
        .header("x-api-key", CF_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error fetching CF files: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Error parsing CF files: {}", e))?;

    let file = files_resp["data"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|f| f["releaseType"].as_u64() == Some(1))
                .or_else(|| arr.first())
        })
        .ok_or("No files found for this CurseForge modpack")?;

    let dl_url: String = if let Some(url) = file["downloadUrl"].as_str().filter(|s| !s.is_empty()) {
        url.to_string()
    } else {
        let file_id = file["id"].as_u64().ok_or("Invalid file ID")?;
        let id_str = file_id.to_string();
        let part1 = &id_str[..id_str.len().saturating_sub(3)];
        let part2: u32 = id_str[id_str.len().saturating_sub(3)..]
            .parse()
            .unwrap_or(0);
        let filename = file["fileName"].as_str().unwrap_or("modpack.zip");
        format!(
            "https://edge.forgecdn.net/files/{}/{}/{}",
            part1, part2, filename
        )
    };

    let filename = file["fileName"]
        .as_str()
        .unwrap_or("modpack.zip")
        .to_string();

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let tmp_id = format!("cf-dl-{}-{}", project_id, ts);

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": &tmp_id, "status": "Downloading modpack..." }),
    )
    .ok();

    let zip_bytes = client
        .get(&dl_url)
        .header("x-api-key", CF_API_KEY)
        .send()
        .await
        .map_err(|e| format!("Error downloading CF modpack: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Error reading CF modpack bytes: {}", e))?;

    let tmp_dir = crate::commands::config::get_install_dir_path().join("_tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Error creating tmp dir: {}", e))?;
    let tmp_path = tmp_dir.join(&filename);
    fs::write(&tmp_path, &zip_bytes).map_err(|e| format!("Error writing tmp zip: {}", e))?;

    let mut inst = import_curseforge_zip(&app, &tmp_path.to_string_lossy()).await?;

    let _ = fs::remove_file(&tmp_path);
    let _ = fs::remove_dir(&tmp_dir);

    if !title.trim().is_empty() && inst.title != title {
        inst.title = title.clone();
        let json_path = instance_json_path(&app, &inst.id);
        if let Ok(json) = serde_json::to_string_pretty(&inst) {
            let _ = fs::write(&json_path, json);
        }
    }

    if let Some(url) = icon_url.filter(|s| !s.is_empty()) {
        let dir = instance_dir(&app, &inst.id);
        let icon_dest = dir.join("icon.png");
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(bytes) = resp.bytes().await {
                if fs::write(&icon_dest, &bytes).is_ok() {
                    inst.icon_path = Some(icon_dest.to_string_lossy().to_string());
                    let json_path = instance_json_path(&app, &inst.id);
                    if let Ok(json) = serde_json::to_string_pretty(&inst) {
                        let _ = fs::write(&json_path, json);
                    }
                }
            }
        }
    }

    Ok(inst)
}
