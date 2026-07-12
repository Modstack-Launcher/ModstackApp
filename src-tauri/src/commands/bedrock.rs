#![allow(dead_code)]

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::Command};
use tauri::{command, AppHandle, Emitter};

const BEDROCK_CONTENT_ID: &str = "7792d9ce-355a-493c-afbd-768f4a77c3b0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub install_path: Option<String>,
    pub platform: String,
    pub store_installed: bool,
}

#[derive(Debug, Serialize)]
pub struct LatestVersion {
    pub version: String,
    pub download_url: String,
}

#[derive(Debug, Deserialize)]
struct XboxAuthResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct XvcMetaFile {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "RelativeUrl")]
    relative_url: String,
}

#[derive(Debug, Deserialize)]
struct XvcPackageMetadata {
    #[serde(rename = "CdnRootPaths", default)]
    cdn_root_paths: Vec<String>,
    #[serde(rename = "BackgroundCdnRootPaths", default)]
    background_cdn_root_paths: Vec<String>,
    #[serde(rename = "Files")]
    files: Vec<XvcMetaFile>,
}

#[derive(Debug, Deserialize)]
struct XvcResponse {
    #[serde(rename = "PackageFound")]
    package_found: bool,
    #[serde(rename = "Version")]
    version: Option<String>,
    #[serde(rename = "PackageMetadata")]
    package_metadata: Option<XvcPackageMetadata>,
}

fn bedrock_data_dir(_app: &AppHandle) -> PathBuf {
    crate::commands::config::get_install_dir_path().join("bedrock")
}

async fn get_xsts_token(
    ms_access_token: &str,
    relying_party: &str,
) -> Result<(String, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let xbl_resp: XboxAuthResponse = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName":   "user.auth.xboxlive.com",
                "RpsTicket":  format!("d={}", ms_access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType":    "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("XBL auth error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse XBL response: {}", e))?;

    let uhs = xbl_resp.display_claims["xui"][0]["uhs"]
        .as_str()
        .ok_or("uhs field not found in XBL response")?
        .to_string();

    let xsts_resp: XboxAuthResponse = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId":  "RETAIL",
                "UserTokens": [xbl_resp.token]
            },
            "RelyingParty": relying_party,
            "TokenType":    "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("XSTS auth error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse XSTS response: {}", e))?;

    Ok((uhs, xsts_resp.token))
}

#[command]
pub async fn bedrock_get_status(app: AppHandle) -> BedrockStatus {
    #[cfg(target_os = "windows")]
    return windows_get_status(&app).await;

    #[cfg(target_os = "linux")]
    return linux_get_status(&app).await;

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    BedrockStatus {
        installed: false,
        version: None,
        install_path: None,
        platform: "unsupported".into(),
        store_installed: false,
    }
}

#[cfg(target_os = "windows")]
async fn windows_get_status(app: &AppHandle) -> BedrockStatus {
    let output = Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            "Get-AppxPackage -Name 'Microsoft.MinecraftUWP' | Select-Object -ExpandProperty Version"
        ])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = output {
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !version.is_empty() {
            let path_out = Command::new("powershell")
                .args([
                    "-NoProfile", "-NonInteractive", "-Command",
                    "Get-AppxPackage -Name 'Microsoft.MinecraftUWP' | Select-Object -ExpandProperty InstallLocation"
                ])
                .creation_flags(0x08000000)
                .output()
                .ok();

            let install_path = path_out
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            return BedrockStatus {
                installed: true,
                version: Some(version),
                install_path,
                platform: "windows".into(),
                store_installed: true,
            };
        }
    }

    let manual_dir = bedrock_data_dir(app).join("install");
    let version_file = manual_dir.join("version.txt");
    if version_file.exists() {
        let version = fs::read_to_string(&version_file)
            .unwrap_or_default()
            .trim()
            .to_string();
        return BedrockStatus {
            installed: true,
            version: Some(version),
            install_path: Some(manual_dir.to_string_lossy().to_string()),
            platform: "windows".into(),
            store_installed: false,
        };
    }

    BedrockStatus {
        installed: false,
        version: None,
        install_path: None,
        platform: "windows".into(),
        store_installed: false,
    }
}

#[cfg(target_os = "linux")]
async fn linux_get_status(app: &AppHandle) -> BedrockStatus {
    let candidates = [
        "/usr/bin/mcpelauncher-client",
        "/usr/local/bin/mcpelauncher-client",
    ];

    let launcher_installed =
        candidates.iter().any(|p| PathBuf::from(p).exists()) || which_exists("mcpelauncher-client");

    if !launcher_installed {
        return BedrockStatus {
            installed: false,
            version: None,
            install_path: None,
            platform: "linux".into(),
            store_installed: false,
        };
    }

    let home = dirs::home_dir().unwrap_or_default();
    let game_dir = home.join(".local/share/mcpelauncher/versions");

    if game_dir.exists() {
        let version = fs::read_dir(&game_dir).ok().and_then(|mut d| {
            d.next()
                .and_then(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
        });

        return BedrockStatus {
            installed: true,
            version,
            install_path: Some(game_dir.to_string_lossy().to_string()),
            platform: "linux".into(),
            store_installed: false,
        };
    }

    BedrockStatus {
        installed: false,
        version: None,
        install_path: None,
        platform: "linux".into(),
        store_installed: false,
    }
}

#[cfg(target_os = "linux")]
fn which_exists(bin: &str) -> bool {
    Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[command]
pub async fn bedrock_get_latest_version(
    _app: AppHandle,
    ms_access_token: Option<String>,
) -> Result<LatestVersion, String> {
    #[cfg(target_os = "windows")]
    {
        let token =
            ms_access_token.ok_or("A Microsoft token is required to fetch the Bedrock version")?;
        return windows_get_latest(&token).await;
    }

    #[cfg(target_os = "linux")]
    return linux_get_latest().await;

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    Err("Unsupported platform".into())
}

#[cfg(target_os = "windows")]
async fn windows_get_latest(ms_access_token: &str) -> Result<LatestVersion, String> {
    let (uhs, xsts_token) = get_xsts_token(ms_access_token, "http://update.xboxlive.com").await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp_bytes = client
        .get(format!(
            "https://packagespc.xboxlive.com/GetBasePackage/{}",
            BEDROCK_CONTENT_ID
        ))
        .header("Authorization", format!("XBL3.0 x={};{}", uhs, xsts_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Error contacting packagespc: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Error reading response body: {}", e))?;

    let resp: XvcResponse = serde_json::from_slice(&resp_bytes).map_err(|e| {
        format!(
            "Failed to parse response: {} | body: {}",
            e,
            String::from_utf8_lossy(&resp_bytes)
        )
    })?;

    if !resp.package_found {
        return Err(
            "Package not found. Do you own Minecraft Bedrock on your Microsoft account?".into(),
        );
    }

    let version = resp.version.unwrap_or_else(|| "unknown".to_string());

    let metadata = resp.package_metadata.ok_or("Package metadata not found")?;

    let msixvc = metadata
        .files
        .iter()
        .find(|f| f.name.ends_with(".msixvc"))
        .ok_or("No .msixvc file found in package")?;

    let cdn_root = metadata
        .cdn_root_paths
        .first()
        .or_else(|| metadata.background_cdn_root_paths.first())
        .ok_or("No CDN available")?;

    let download_url = format!("{}{}", cdn_root, msixvc.relative_url);

    Ok(LatestVersion {
        version,
        download_url,
    })
}

#[cfg(target_os = "linux")]
async fn linux_get_latest() -> Result<LatestVersion, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let versions: serde_json::Value = client
        .get("https://raw.githubusercontent.com/minecraft-linux/mcpelauncher-manifest/master/versions.json")
        .send()
        .await
        .map_err(|e| format!("Error fetching versions: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse versions: {}", e))?;

    let latest = versions
        .as_array()
        .and_then(|arr| arr.first())
        .ok_or("No versions found")?;

    let version = latest["version"].as_str().unwrap_or("unknown").to_string();

    let download_url = latest["download_url"]
        .as_str()
        .or_else(|| latest["apk_url"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(LatestVersion {
        version,
        download_url,
    })
}

#[command]
pub async fn bedrock_install(
    app: AppHandle,
    force: Option<bool>,
    ms_access_token: Option<String>,
) -> Result<(), String> {
    let force = force.unwrap_or(false);

    #[cfg(target_os = "windows")]
    {
        let status = windows_get_status(&app).await;
        if status.installed && !force {
            app.emit("bedrock-already-installed", status).ok();
            return Ok(());
        }
        let token = ms_access_token.ok_or("A Microsoft token is required to install Bedrock")?;
        return windows_install(&app, &token).await;
    }

    #[cfg(target_os = "linux")]
    return linux_install(&app).await;

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    Err("Unsupported platform".into())
}

#[cfg(target_os = "windows")]
async fn windows_install(app: &AppHandle, ms_access_token: &str) -> Result<(), String> {
    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Authenticating with Xbox..." }),
    )
    .ok();

    let latest = windows_get_latest(ms_access_token).await?;

    let install_dir = bedrock_data_dir(app).join("packages");
    fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;

    let filename = latest
        .download_url
        .split('/')
        .last()
        .unwrap_or("minecraft.msixvc");
    let dest = install_dir.join(filename);

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Downloading Minecraft Bedrock" }),
    )
    .ok();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(&latest.download_url)
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_pct: u32 = 0;
    let mut file = fs::File::create(&dest).map_err(|e| e.to_string())?;

    use std::io::Write;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded * 100 / total) as u32;
            if pct != last_pct {
                last_pct = pct;
                app.emit("instance-progress", serde_json::json!({ "instanceId": "bedrock", "current": downloaded, "total": total })).ok();
            }
        }
    }
    drop(file);

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Installing package..." }),
    )
    .ok();

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("Add-AppxPackage -Path '{}'", dest.display()),
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("PowerShell execution error: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Installation error: {}", err));
    }

    let version_file = bedrock_data_dir(app).join("install").join("version.txt");
    if let Some(parent) = version_file.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&version_file, &latest.version).ok();
    fs::remove_file(&dest).ok();

    app.emit("instance-status", serde_json::json!({ "instanceId": "bedrock", "status": format!("Bedrock {} installed successfully!", latest.version) })).ok();
    app.emit("instance-done", "bedrock").ok();
    app.emit("bedrock-installed", &latest.version).ok();

    Ok(())
}

#[cfg(target_os = "linux")]
async fn linux_install(app: &AppHandle) -> Result<(), String> {
    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Checking mcpelauncher..." }),
    )
    .ok();

    if !which_exists("mcpelauncher-client") {
        install_mcpelauncher(app).await?;
    }

    let latest = linux_get_latest().await?;

    if latest.download_url.is_empty() {
        return Err("No download URL found for Bedrock on Linux".into());
    }

    let data_dir = bedrock_data_dir(app);
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let apk_path = data_dir.join(format!("minecraft-{}.apk", latest.version));

    app.emit("instance-status", serde_json::json!({ "instanceId": "bedrock", "status": format!("Downloading Bedrock {}...", latest.version) })).ok();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(&latest.download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_pct: u32 = 0;
    let mut file = fs::File::create(&apk_path).map_err(|e| e.to_string())?;

    use std::io::Write;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded * 100 / total) as u32;
            if pct != last_pct {
                last_pct = pct;
                app.emit("instance-progress", serde_json::json!({ "instanceId": "bedrock", "current": downloaded, "total": total })).ok();
            }
        }
    }
    drop(file);

    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Extracting game files..." }),
    )
    .ok();

    let versions_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".local/share/mcpelauncher/versions")
        .join(&latest.version);

    fs::create_dir_all(&versions_dir).map_err(|e| e.to_string())?;

    let extract_bin = [
        "/usr/bin/mcpelauncher-extract",
        "/usr/local/bin/mcpelauncher-extract",
    ]
    .iter()
    .find(|p| PathBuf::from(p).exists())
    .copied()
    .unwrap_or("mcpelauncher-extract");

    let output = Command::new(extract_bin)
        .args([apk_path.to_str().unwrap(), versions_dir.to_str().unwrap()])
        .output()
        .map_err(|e| format!("Extraction error: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Extraction failed: {}", err));
    }

    fs::remove_file(&apk_path).ok();

    app.emit("instance-status", serde_json::json!({ "instanceId": "bedrock", "status": format!("Bedrock {} installed successfully!", latest.version) })).ok();
    app.emit("instance-done", "bedrock").ok();
    app.emit("bedrock-installed", &latest.version).ok();

    Ok(())
}

#[cfg(target_os = "linux")]
async fn install_mcpelauncher(app: &AppHandle) -> Result<(), String> {
    app.emit(
        "instance-status",
        serde_json::json!({ "instanceId": "bedrock", "status": "Installing mcpelauncher..." }),
    )
    .ok();

    let distro = detect_linux_distro();

    let output = match distro.as_str() {
        "ubuntu" | "debian" | "linuxmint" | "pop" => Command::new("bash")
            .arg("-c")
            .arg(
                "add-apt-repository ppa:minecraft-linux/ppa -y && \
                 apt-get update && \
                 apt-get install -y mcpelauncher-client mcpelauncher-extract",
            )
            .output()
            .map_err(|e| format!("Error installing mcpelauncher: {}", e))?,

        "arch" | "manjaro" | "endeavouros" => Command::new("bash")
            .arg("-c")
            .arg(
                "yay -S --noconfirm mcpelauncher-client || \
                 paru -S --noconfirm mcpelauncher-client",
            )
            .output()
            .map_err(|e| format!("Error installing mcpelauncher (AUR): {}", e))?,

        "fedora" | "rhel" | "centos" => Command::new("bash")
            .arg("-c")
            .arg(
                "dnf copr enable -y nicowillis/mcpelauncher && \
                 dnf install -y mcpelauncher-client",
            )
            .output()
            .map_err(|e| format!("Error installing mcpelauncher (dnf): {}", e))?,

        _ => {
            return Err(format!(
                "Distro '{}' not supported. Install mcpelauncher manually: \
                 https://github.com/minecraft-linux/mcpelauncher-manifest",
                distro
            ));
        }
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Error installing mcpelauncher: {}", err));
    }

    app.emit("instance-status", serde_json::json!({ "instanceId": "bedrock", "status": "mcpelauncher installed successfully!" })).ok();
    Ok(())
}

#[cfg(target_os = "linux")]
fn detect_linux_distro() -> String {
    if let Ok(content) = fs::read_to_string("/etc/os-release") {
        for line in content.lines() {
            if line.starts_with("ID=") {
                return line[3..].trim_matches('"').to_lowercase();
            }
        }
    }
    "unknown".to_string()
}

#[command]
pub async fn bedrock_launch(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows_launch(&app).await;

    #[cfg(target_os = "linux")]
    return linux_launch(&app).await;

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    Err("Unsupported platform".into())
}

#[cfg(target_os = "windows")]
async fn windows_launch(app: &AppHandle) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "minecraft:"])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Error launching Minecraft Bedrock: {}", e))?;

    let app_clone = app.clone();
    std::thread::spawn(move || {
        app_clone.emit("bedrock-launched", ()).ok();
    });

    Ok(())
}

#[cfg(target_os = "linux")]
async fn linux_launch(app: &AppHandle) -> Result<(), String> {
    let launcher_bin = [
        "/usr/bin/mcpelauncher-client",
        "/usr/local/bin/mcpelauncher-client",
        "mcpelauncher-client",
    ]
    .iter()
    .find(|p| PathBuf::from(p).exists() || which_exists(p))
    .copied()
    .ok_or("mcpelauncher-client not found. Install Bedrock first.")?;

    let home = dirs::home_dir().unwrap_or_default();
    let game_dir = home.join(".local/share/mcpelauncher");

    let mut child = Command::new(launcher_bin)
        .args(["-dg", game_dir.to_str().unwrap_or("")])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Error launching mcpelauncher: {}", e))?;

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        app_clone.emit("bedrock-closed", ()).ok();
    });

    app.emit("bedrock-launched", ()).ok();
    Ok(())
}

#[command]
pub async fn bedrock_uninstall(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-AppxPackage -Name 'Microsoft.MinecraftUWP' | Remove-AppxPackage",
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Uninstall error: {}", err));
        }

        let our_dir = bedrock_data_dir(&app);
        if our_dir.exists() {
            fs::remove_dir_all(&our_dir).ok();
        }
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().unwrap_or_default();
        let versions_dir = home.join(".local/share/mcpelauncher/versions");
        if versions_dir.exists() {
            fs::remove_dir_all(&versions_dir).ok();
        }
        let our_dir = bedrock_data_dir(&app);
        if our_dir.exists() {
            fs::remove_dir_all(&our_dir).ok();
        }
    }

    app.emit("bedrock-uninstalled", ()).ok();
    Ok(())
}
