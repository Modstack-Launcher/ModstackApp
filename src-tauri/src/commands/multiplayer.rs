use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerConfig {
    pub server_name: String,
    pub max_players: u32,
    pub port: u16,
    pub game_mode: String,
    pub difficulty: String,
    pub online_mode: bool,
    pub view_distance: u32,
    pub java_path: String,
    pub max_ram_mb: u32,
    pub instance_id: Option<String>,
}

pub struct MultiplayerState {
    pub child: Option<Child>,
    pub stdin: Option<ChildStdin>,
    pub server_dir: Option<PathBuf>,
}

impl MultiplayerState {
    pub fn new() -> Self {
        Self { child: None, stdin: None, server_dir: None }
    }
}

pub type SharedMultiplayerState = Arc<Mutex<MultiplayerState>>;

fn get_state(app: &AppHandle) -> SharedMultiplayerState {
    app.state::<SharedMultiplayerState>().inner().clone()
}

fn server_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("multiplayer_server")
}

fn local_ip() -> String {
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = socket.connect("8.8.8.8:80");
        if let Ok(addr) = socket.local_addr() {
            return addr.ip().to_string();
        }
    }
    "127.0.0.1".to_string()
}

fn port_available(port: u16) -> bool {
    TcpListener::bind(("0.0.0.0", port)).is_ok()
}

async fn download_server_jar(dir: &PathBuf) -> Result<PathBuf, String> {
    let jar_path = dir.join("server.jar");
    if jar_path.exists() {
        return Ok(jar_path);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let url = "https://piston-data.mojang.com/v1/objects/59353fb40c36d304f2035d51e7d6e6baa98dc05c/server.jar";
    let bytes = client.get(url).send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&jar_path, &bytes).map_err(|e| e.to_string())?;
    Ok(jar_path)
}

fn write_eula(dir: &PathBuf) -> Result<(), String> {
    std::fs::write(dir.join("eula.txt"), "eula=true\n").map_err(|e| e.to_string())
}

fn write_server_properties(dir: &PathBuf, cfg: &ServerConfig) -> Result<(), String> {
    let online = if cfg.online_mode { "true" } else { "false" };
    let content = format!(
        "server-port={}\nmax-players={}\ngamemode={}\ndifficulty={}\nonline-mode={}\nview-distance={}\nmotd={}\n",
        cfg.port, cfg.max_players, cfg.game_mode, cfg.difficulty, online, cfg.view_distance, cfg.server_name
    );
    std::fs::write(dir.join("server.properties"), content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn multiplayer_start(
    app: AppHandle,
    config: ServerConfig,
) -> Result<String, String> {
    let state = get_state(&app);
    {
        let locked = state.lock().map_err(|e| e.to_string())?;
        if locked.child.is_some() {
            return Err("El servidor ya esta corriendo".into());
        }
    }

    if !port_available(config.port) {
        return Err(format!("El puerto {} ya esta en uso", config.port));
    }

    let dir = server_dir(&app);
    let jar = download_server_jar(&dir).await?;
    write_eula(&dir)?;
    write_server_properties(&dir, &config)?;

    let java_bin = if config.java_path.is_empty() {
        "java".to_string()
    } else {
        config.java_path.clone()
    };

    let mut child = Command::new(&java_bin)
        .args([
            format!("-Xmx{}M", config.max_ram_mb),
            format!("-Xms{}M", (config.max_ram_mb / 2).max(512)),
            "-jar".into(),
            jar.to_string_lossy().to_string(),
            "nogui".into(),
        ])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar Java: {e}"))?;

    let stdin = child.stdin.take().ok_or("stdin no disponible")?;
    let stdout = child.stdout.take().ok_or("stdout no disponible")?;
    let stderr = child.stderr.take().ok_or("stderr no disponible")?;

    {
        let mut locked = state.lock().map_err(|e| e.to_string())?;
        locked.stdin = Some(stdin);
        locked.server_dir = Some(dir.clone());
        locked.child = Some(child);
    }

    let app_stdout = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = parse_player_event(&app_stdout, &line);
            let _ = app_stdout.emit("multiplayer-log", &line);
        }
        let _ = app_stdout.emit("multiplayer-stopped", "stopped");
    });

    let app_stderr = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = app_stderr.emit("multiplayer-log", format!("[STDERR] {line}"));
        }
    });

    Ok(local_ip())
}

fn parse_player_event(app: &AppHandle, line: &str) -> Result<(), String> {
    let state = get_state(app);
    let locked = state.lock().map_err(|e| e.to_string())?;
    let _ = locked;
    if line.contains("joined the game") || line.contains("left the game") {
        let _ = app.emit("multiplayer-log", line);
    }
    Ok(())
}

#[tauri::command]
pub fn multiplayer_stop(app: AppHandle) -> Result<(), String> {
    let state = get_state(&app);
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut stdin) = locked.stdin {
        let _ = stdin.write_all(b"stop\n");
    }
    if let Some(ref mut child) = locked.child {
        let _ = child.wait();
    }
    locked.child = None;
    locked.stdin = None;
    Ok(())
}

#[tauri::command]
pub fn multiplayer_send_command(app: AppHandle, command: String) -> Result<(), String> {
    let state = get_state(&app);
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut stdin) = locked.stdin {
        let line = format!("{command}\n");
        stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    } else {
        return Err("El servidor no esta corriendo".into());
    }
    Ok(())
}

#[tauri::command]
pub fn multiplayer_get_status(app: AppHandle) -> String {
    let state = get_state(&app);
    let locked = match state.lock() {
        Ok(l) => l,
        Err(_) => return "error".into(),
    };
    if locked.child.is_some() { "running".into() } else { "stopped".into() }
}
