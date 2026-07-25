use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Stopped, Starting, Running, Stopping, Error,
}

pub struct MultiplayerState {
    pub process: Arc<Mutex<Option<Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    pub status: Arc<Mutex<ServerStatus>>,
}

impl MultiplayerState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(ServerStatus::Stopped)),
        }
    }
}

pub fn server_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Modstack")
        .join("multiplayer-server")
}

async fn download_server_jar(version: &str, dest: &PathBuf, app: &AppHandle) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = app.emit("multiplayer-setup-progress", (10u8, "Buscando version..."));
    let manifest: serde_json::Value = client
        .get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let version_url = manifest["versions"].as_array()
        .ok_or("no versions")?
        .iter()
        .find(|v| v["id"].as_str() == Some(version))
        .and_then(|v| v["url"].as_str())
        .ok_or(format!("version {} not found", version))?
        .to_string();

    let _ = app.emit("multiplayer-setup-progress", (30u8, "Obteniendo info de version..."));

    let meta: serde_json::Value = client.get(&version_url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let server_url = meta["downloads"]["server"]["url"]
        .as_str().ok_or("no server url")?.to_string();

    let _ = app.emit("multiplayer-setup-progress", (50u8, "Descargando server.jar..."));

    let bytes = client.get(&server_url)
        .send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;

    std::fs::write(dest, &bytes).map_err(|e| e.to_string())
}

fn write_server_properties(
    port: u16, max_players: u16, name: &str,
    difficulty: &str, gamemode: &str, view: u8, sim: u8,
) -> Result<(), String> {
    let props = format!(
        "#Minecraft server properties\nonline-mode=false\nserver-port={port}\nmax-players={max_players}\nmotd={name}\ndifficulty={difficulty}\ngamemode={gamemode}\nview-distance={view}\nsimulation-distance={sim}\nspawn-protection=0\nwhite-list=false\nenable-command-block=true\n"
    );
    std::fs::write(server_dir().join("server.properties"), props).map_err(|e| e.to_string())
}

fn build_java_command(java: &str, min_ram: u16, max_ram: u16) -> Command {
    let mut cmd = Command::new(java);
    cmd.args([
        &format!("-Xms{}M", min_ram),
        &format!("-Xmx{}M", max_ram),
        "-jar", "server.jar", "nogui",
    ])
    .current_dir(server_dir())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn spawn_server_threads(
    app: AppHandle,
    child: &mut Child,
    status: Arc<Mutex<ServerStatus>>,
    stdin_arc: Arc<Mutex<Option<std::process::ChildStdin>>>,
) {
    let stdin = child.stdin.take();
    *stdin_arc.lock().unwrap() = stdin;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app2 = app.clone();
    let status2 = Arc::clone(&status);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = app2.emit("multiplayer-log", line.clone());
            if line.contains("Done (") {
                *status2.lock().unwrap() = ServerStatus::Running;
                let _ = app2.emit("multiplayer-status", ServerStatus::Running);
            }
        }
        *status2.lock().unwrap() = ServerStatus::Stopped;
        let _ = app2.emit("multiplayer-status", ServerStatus::Stopped);
    });

    let app3 = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let _ = app3.emit("multiplayer-log", format!("[ERR] {line}"));
        }
    });
}

#[tauri::command]
pub async fn multiplayer_setup_server(
    app: AppHandle,
    version: String,
    max_players: u16,
    port: u16,
    server_name: String,
    difficulty: String,
    gamemode: String,
    view_distance: u8,
    simulation_distance: u8,
) -> Result<(), String> {
    let dir = server_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = app.emit("multiplayer-setup-progress", (10u8, "Preparando directorio..."));

    let jar = dir.join("server.jar");
    if !jar.exists() {
        download_server_jar(&version, &jar, &app).await?;
    } else {
        let _ = app.emit("multiplayer-setup-progress", (50u8, "server.jar ya existe"));
    }

    let _ = app.emit("multiplayer-setup-progress", (80u8, "Escribiendo configuracion..."));

    let eula = dir.join("eula.txt");
    if !eula.exists() {
        std::fs::write(&eula, "eula=true\n").map_err(|e| e.to_string())?;
    }

    write_server_properties(port, max_players, &server_name, &difficulty, &gamemode, view_distance, simulation_distance)?;
    let _ = app.emit("multiplayer-setup-progress", (100u8, "Listo"));
    Ok(())
}

#[tauri::command]
pub async fn multiplayer_start_server(
    app: AppHandle,
    state: State<'_, MultiplayerState>,
    min_ram: Option<u16>,
    max_ram: Option<u16>,
) -> Result<(), String> {
    {
        let s = state.status.lock().unwrap();
        if *s == ServerStatus::Running || *s == ServerStatus::Starting {
            return Err("ya esta corriendo".into());
        }
    }

    let jar = server_dir().join("server.jar");
    if !jar.exists() {
        return Err("server.jar no encontrado. Ejecuta setup primero.".into());
    }

    let java = crate::java_runtime::find_java().unwrap_or_else(|| "java".to_string());
    let min = min_ram.unwrap_or(512);
    let max = max_ram.unwrap_or(1024);

    *state.status.lock().unwrap() = ServerStatus::Starting;
    let _ = app.emit("multiplayer-status", ServerStatus::Starting);

    let mut child = build_java_command(&java, min, max)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar java: {e}"))?;

    spawn_server_threads(app, &mut child, Arc::clone(&state.status), Arc::clone(&state.stdin));

    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub async fn multiplayer_stop_server(
    app: AppHandle,
    state: State<'_, MultiplayerState>,
) -> Result<(), String> {
    *state.status.lock().unwrap() = ServerStatus::Stopping;
    let _ = app.emit("multiplayer-status", ServerStatus::Stopping);

    if let Some(ref mut stdin) = *state.stdin.lock().unwrap() {
        let _ = writeln!(stdin, "stop");
    } else if let Some(mut child) = state.process.lock().unwrap().take() {
        let _ = child.kill();
    }

    Ok(())
}

#[tauri::command]
pub async fn multiplayer_send_command(
    command: String,
    state: State<'_, MultiplayerState>,
) -> Result<(), String> {
    if let Some(ref mut stdin) = *state.stdin.lock().unwrap() {
        writeln!(stdin, "{command}").map_err(|e| e.to_string())?;
    } else {
        return Err("servidor no esta corriendo".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn multiplayer_restart_server(
    app: AppHandle,
    state: State<'_, MultiplayerState>,
    min_ram: Option<u16>,
    max_ram: Option<u16>,
) -> Result<(), String> {
    {
        let s = state.status.lock().unwrap();
        if *s == ServerStatus::Running || *s == ServerStatus::Stopping {
            drop(s);
            if let Some(ref mut stdin) = *state.stdin.lock().unwrap() {
                let _ = writeln!(stdin, "stop");
            } else if let Some(mut child) = state.process.lock().unwrap().take() {
                let _ = child.kill();
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    }

    let jar = server_dir().join("server.jar");
    if !jar.exists() {
        return Err("server.jar no encontrado.".into());
    }

    let java = crate::java_runtime::find_java().unwrap_or_else(|| "java".to_string());
    let min = min_ram.unwrap_or(512);
    let max = max_ram.unwrap_or(1024);

    *state.status.lock().unwrap() = ServerStatus::Starting;
    let _ = app.emit("multiplayer-status", ServerStatus::Starting);
    let _ = app.emit("multiplayer-log", "[INFO] Reiniciando servidor...");

    let mut child = build_java_command(&java, min, max)
        .spawn()
        .map_err(|e| format!("No se pudo reiniciar java: {e}"))?;

    spawn_server_threads(app, &mut child, Arc::clone(&state.status), Arc::clone(&state.stdin));
    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub fn multiplayer_get_status(state: State<'_, MultiplayerState>) -> ServerStatus {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn multiplayer_open_folder() -> Result<(), String> {
    let dir = server_dir();
    std::fs::create_dir_all(&dir).ok();
    #[cfg(target_os = "windows")]
    { Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn multiplayer_open_mods_folder() -> Result<(), String> {
    let dir = server_dir().join("mods");
    std::fs::create_dir_all(&dir).ok();
    #[cfg(target_os = "windows")]
    { Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn multiplayer_get_local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}
