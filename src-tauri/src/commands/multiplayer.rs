use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerStats {
    pub online_players: u32,
    pub max_players: u32,
    pub tps: f32,
    pub uptime_secs: u64,
}

impl Default for ServerStats {
    fn default() -> Self {
        Self { online_players: 0, max_players: 20, tps: 20.0, uptime_secs: 0 }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlayerInfo {
    pub name: String,
    pub uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServerSoftware {
    Vanilla,
    Fabric,
    Forge,
    Paper,
    Quilt,
}

impl std::fmt::Display for ServerSoftware {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Vanilla => write!(f, "vanilla"),
            Self::Fabric => write!(f, "fabric"),
            Self::Forge => write!(f, "forge"),
            Self::Paper => write!(f, "paper"),
            Self::Quilt => write!(f, "quilt"),
        }
    }
}

pub struct MultiplayerState {
    pub process: Arc<Mutex<Option<Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    pub status: Arc<Mutex<ServerStatus>>,
    pub stats: Arc<Mutex<ServerStats>>,
    pub players: Arc<Mutex<Vec<PlayerInfo>>>,
    pub start_time: Arc<Mutex<Option<std::time::Instant>>>,
}

impl MultiplayerState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(ServerStatus::Stopped)),
            stats: Arc::new(Mutex::new(ServerStats::default())),
            players: Arc::new(Mutex::new(Vec::new())),
            start_time: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn server_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Modstack")
        .join("multiplayer-server")
}

fn software_dir(software: &ServerSoftware) -> PathBuf {
    server_dir().join(software.to_string())
}

async fn download_vanilla_jar(version: &str, dest: &PathBuf, app: &AppHandle) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 10, "msg": "Buscando version..."}));

    let manifest: serde_json::Value = client
        .get("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json")
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let version_url = manifest["versions"].as_array()
        .ok_or("no versions")?
        .iter()
        .find(|v| v["id"].as_str() == Some(version))
        .and_then(|v| v["url"].as_str())
        .ok_or(format!("version {} no encontrada", version))?
        .to_string();

    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 30, "msg": "Obteniendo metadata..."}));

    let meta: serde_json::Value = client.get(&version_url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let server_url = meta["downloads"]["server"]["url"]
        .as_str().ok_or("URL de server no encontrada")?.to_string();

    let sha1_expected = meta["downloads"]["server"]["sha1"]
        .as_str().unwrap_or("").to_string();

    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 50, "msg": "Descargando server.jar..."}));

    let bytes = client.get(&server_url)
        .send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;

    if !sha1_expected.is_empty() {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());
        if hash != sha1_expected {
            return Err(format!("SHA1 mismatch: esperado {} got {}", sha1_expected, hash));
        }
    }

    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;

    Ok(())
}

async fn download_paper_jar(version: &str, dest: &PathBuf, app: &AppHandle) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 20, "msg": "Buscando build de Paper..."}));

    let builds_url = format!("https://api.papermc.io/v2/projects/paper/versions/{}/builds", version);
    let builds: serde_json::Value = client.get(&builds_url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let build_number = builds["builds"].as_array()
        .and_then(|arr| arr.last())
        .and_then(|b| b["build"].as_u64())
        .ok_or("no se encontro build de paper")?;

    let jar_name = format!("paper-{}-{}.jar", version, build_number);
    let jar_url = format!(
        "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}",
        version, build_number, jar_name
    );

    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 50, "msg": "Descargando Paper..."}));

    let bytes = client.get(&jar_url)
        .send().await.map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;

    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;

    Ok(())
}

fn write_server_properties(
    dir: &PathBuf,
    port: u16,
    max_players: u16,
    name: &str,
    difficulty: &str,
    gamemode: &str,
    view: u8,
    sim: u8,
    online_mode: bool,
    pvp: bool,
    spawn_monsters: bool,
    allow_flight: bool,
    nether: bool,
) -> Result<(), String> {
    let props = format!(
        "#Minecraft server properties\nonline-mode={online_mode}\nserver-port={port}\nmax-players={max_players}\nmotd={name}\ndifficulty={difficulty}\ngamemode={gamemode}\nview-distance={view}\nsimulation-distance={sim}\nspawn-protection=0\nwhite-list=false\nenable-command-block=true\npvp={pvp}\nspawn-monsters={spawn_monsters}\nallow-flight={allow_flight}\nallow-nether={nether}\n"
    );
    std::fs::write(dir.join("server.properties"), props).map_err(|e| e.to_string())
}

fn build_java_command(java: &str, min_ram: u16, max_ram: u16, dir: &PathBuf) -> Command {
    let mut cmd = Command::new(java);
    cmd.args([
        &format!("-Xms{}M", min_ram),
        &format!("-Xmx{}M", max_ram),
        "-jar", "server.jar", "nogui",
    ])
    .current_dir(dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn parse_log_line(line: &str) -> serde_json::Value {
    let level = if line.contains("[WARN") || line.contains("WARN]") {
        "warn"
    } else if line.contains("[ERROR") || line.contains("ERROR]") || line.contains("[ERR]") {
        "error"
    } else if line.contains("[INFO") || line.contains("INFO]") {
        "info"
    } else {
        "info"
    };

    serde_json::json!({
        "raw": line,
        "level": level,
        "ts": chrono::Utc::now().timestamp_millis()
    })
}

fn parse_online_players(line: &str) -> Option<(u32, u32)> {
    if line.contains("There are") && line.contains("of a max of") {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, &w) in parts.iter().enumerate() {
            if w == "are" {
                if let (Some(online), Some(max)) = (parts.get(i + 1), parts.get(i + 5)) {
                    let online = online.parse::<u32>().ok()?;
                    let max = max.parse::<u32>().ok()?;
                    return Some((online, max));
                }
            }
        }
    }
    None
}

fn spawn_server_threads(
    app: AppHandle,
    child: &mut Child,
    status: Arc<Mutex<ServerStatus>>,
    stdin_arc: Arc<Mutex<Option<std::process::ChildStdin>>>,
    stats: Arc<Mutex<ServerStats>>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
) {
    let stdin = child.stdin.take();
    *stdin_arc.lock().unwrap() = stdin;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app2 = app.clone();
    let status2 = Arc::clone(&status);
    let stats2 = Arc::clone(&stats);
    let start2 = Arc::clone(&start_time);

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            let entry = parse_log_line(&line);
            let _ = app2.emit("multiplayer-log", &entry);

            if line.contains("Done (") {
                *status2.lock().unwrap() = ServerStatus::Running;
                *start2.lock().unwrap() = Some(std::time::Instant::now());
                let _ = app2.emit("multiplayer-status", ServerStatus::Running);
            }

            if let Some((online, max)) = parse_online_players(&line) {
                let mut s = stats2.lock().unwrap();
                s.online_players = online;
                s.max_players = max;
                let _ = app2.emit("multiplayer-stats", s.clone());
            }

            if line.contains(" joined the game") {
                let _ = app2.emit("multiplayer-player-joined", &line);
            } else if line.contains(" left the game") {
                let _ = app2.emit("multiplayer-player-left", &line);
            }
        }

        *status2.lock().unwrap() = ServerStatus::Stopped;
        let _ = app2.emit("multiplayer-status", ServerStatus::Stopped);
        let _ = app2.emit("multiplayer-log", serde_json::json!({
            "raw": "[Modstack] Servidor detenido",
            "level": "warn",
            "ts": chrono::Utc::now().timestamp_millis()
        }));
    });

    let app3 = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            let entry = serde_json::json!({
                "raw": line,
                "level": "error",
                "ts": chrono::Utc::now().timestamp_millis()
            });
            let _ = app3.emit("multiplayer-log", &entry);
        }
    });
}

#[tauri::command]
pub async fn multiplayer_setup_server(
    app: AppHandle,
    version: String,
    software: Option<String>,
    max_players: u16,
    port: u16,
    server_name: String,
    difficulty: String,
    gamemode: String,
    view_distance: u8,
    simulation_distance: u8,
    online_mode: Option<bool>,
    pvp: Option<bool>,
    spawn_monsters: Option<bool>,
    allow_flight: Option<bool>,
    allow_nether: Option<bool>,
) -> Result<(), String> {
    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };

    let dir = software_dir(&sw);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 5, "msg": "Preparando directorio..."}));

    let jar = dir.join("server.jar");
    if !jar.exists() {
        match sw {
            ServerSoftware::Paper => download_paper_jar(&version, &jar, &app).await?,
            _ => download_vanilla_jar(&version, &jar, &app).await?,
        }
    } else {
        let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 50, "msg": "server.jar ya existe, saltando..."}));
    }

    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 80, "msg": "Escribiendo configuracion..."}));

    let eula = dir.join("eula.txt");
    if !eula.exists() {
        std::fs::write(&eula, "eula=true\n").map_err(|e| e.to_string())?;
    }

    write_server_properties(
        &dir, port, max_players, &server_name, &difficulty, &gamemode,
        view_distance, simulation_distance,
        online_mode.unwrap_or(false),
        pvp.unwrap_or(true),
        spawn_monsters.unwrap_or(true),
        allow_flight.unwrap_or(false),
        allow_nether.unwrap_or(true),
    )?;

    let _ = app.emit("multiplayer-setup-progress", serde_json::json!({"pct": 100, "msg": "Configuracion lista"}));
    Ok(())
}

#[tauri::command]
pub async fn multiplayer_start_server(
    app: AppHandle,
    state: State<'_, MultiplayerState>,
    software: Option<String>,
    min_ram: Option<u16>,
    max_ram: Option<u16>,
) -> Result<(), String> {
    {
        let s = state.status.lock().unwrap();
        if *s == ServerStatus::Running || *s == ServerStatus::Starting {
            return Err("ya esta corriendo".into());
        }
    }

    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };

    let dir = software_dir(&sw);
    let jar = dir.join("server.jar");
    if !jar.exists() {
        return Err("server.jar no encontrado. Ejecuta setup primero.".into());
    }

    let java = crate::java_runtime::find_java().unwrap_or_else(|| "java".to_string());
    let min = min_ram.unwrap_or(512);
    let max = max_ram.unwrap_or(1024);

    *state.status.lock().unwrap() = ServerStatus::Starting;
    *state.stats.lock().unwrap() = ServerStats::default();
    let _ = app.emit("multiplayer-status", ServerStatus::Starting);

    let mut child = build_java_command(&java, min, max, &dir)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar java: {e}"))?;

    spawn_server_threads(
        app,
        &mut child,
        Arc::clone(&state.status),
        Arc::clone(&state.stdin),
        Arc::clone(&state.stats),
        Arc::clone(&state.start_time),
    );

    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub async fn multiplayer_stop_server(
    app: AppHandle,
    state: State<'_, MultiplayerState>,
) -> Result<(), String> {
    *state.status.lock().unwrap() = ServerStatus::Stopping;
    *state.start_time.lock().unwrap() = None;
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
    software: Option<String>,
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
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    }

    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };

    let dir = software_dir(&sw);
    let jar = dir.join("server.jar");
    if !jar.exists() {
        return Err("server.jar no encontrado.".into());
    }

    let java = crate::java_runtime::find_java().unwrap_or_else(|| "java".to_string());
    let min = min_ram.unwrap_or(512);
    let max = max_ram.unwrap_or(1024);

    *state.status.lock().unwrap() = ServerStatus::Starting;
    *state.stats.lock().unwrap() = ServerStats::default();
    let _ = app.emit("multiplayer-status", ServerStatus::Starting);
    let _ = app.emit("multiplayer-log", serde_json::json!({
        "raw": "[Modstack] Reiniciando servidor...",
        "level": "warn",
        "ts": chrono::Utc::now().timestamp_millis()
    }));

    let mut child = build_java_command(&java, min, max, &dir)
        .spawn()
        .map_err(|e| format!("No se pudo reiniciar java: {e}"))?;

    spawn_server_threads(
        app,
        &mut child,
        Arc::clone(&state.status),
        Arc::clone(&state.stdin),
        Arc::clone(&state.stats),
        Arc::clone(&state.start_time),
    );
    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
pub fn multiplayer_get_status(state: State<'_, MultiplayerState>) -> ServerStatus {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn multiplayer_get_stats(state: State<'_, MultiplayerState>) -> ServerStats {
    let mut s = state.stats.lock().unwrap().clone();
    if let Some(t) = *state.start_time.lock().unwrap() {
        s.uptime_secs = t.elapsed().as_secs();
    }
    s
}

#[tauri::command]
pub fn multiplayer_get_local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| { s.connect("8.8.8.8:80")?; s.local_addr() })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

#[tauri::command]
pub fn multiplayer_get_server_dir(software: Option<String>) -> String {
    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };
    software_dir(&sw).to_string_lossy().to_string()
}

fn open_folder_cross(path: &PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(path).ok();
    #[cfg(target_os = "windows")]
    { Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(path).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn multiplayer_open_folder(software: Option<String>) -> Result<(), String> {
    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };
    open_folder_cross(&software_dir(&sw))
}

#[tauri::command]
pub fn multiplayer_open_mods_folder(software: Option<String>) -> Result<(), String> {
    let sw = match software.as_deref().unwrap_or("vanilla") {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };
    let mods = software_dir(&sw).join("mods");
    open_folder_cross(&mods)
}

#[tauri::command]
pub fn multiplayer_list_setups() -> Vec<serde_json::Value> {
    let base = server_dir();
    let softwares = ["vanilla", "fabric", "forge", "paper", "quilt"];
    softwares.iter().filter_map(|sw| {
        let dir = base.join(sw);
        let jar = dir.join("server.jar");
        if jar.exists() {
            let props_path = dir.join("server.properties");
            let name = if props_path.exists() {
                std::fs::read_to_string(&props_path)
                    .ok()
                    .and_then(|c| c.lines().find(|l| l.starts_with("motd=")).map(|l| l[5..].to_string()))
                    .unwrap_or_else(|| sw.to_string())
            } else {
                sw.to_string()
            };
            Some(serde_json::json!({
                "software": sw,
                "name": name,
                "path": dir.to_string_lossy()
            }))
        } else {
            None
        }
    }).collect()
}

#[tauri::command]
pub async fn multiplayer_delete_setup(software: String) -> Result<(), String> {
    let sw = match software.as_str() {
        "paper" => ServerSoftware::Paper,
        "fabric" => ServerSoftware::Fabric,
        "forge" => ServerSoftware::Forge,
        "quilt" => ServerSoftware::Quilt,
        _ => ServerSoftware::Vanilla,
    };
    let dir = software_dir(&sw);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
