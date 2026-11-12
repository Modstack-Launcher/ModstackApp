//! Instance wallpapers, launcher news images and the one-time app icon cleanup.
//!
//! * `fetch_version_wallpaper` looks up the commemorative artwork Mojang publishes
//!   for a game version and only accepts images that are exactly 1920 × 1080.
//!   When the version has none, the default Java Edition artwork (the newest
//!   release artwork that is 1080p) is used instead. If neither exists the
//!   command returns `None` and the launcher keeps its bundled fallback image.
//! * `fetch_remote_image` downloads news thumbnails from Rust so they are not
//!   blocked by hot-link / referrer / CORS rules of the image host.
//! * `restore_default_shortcut_icons` undoes the removed "custom app icon"
//!   option on Windows shortcuts that point to the launcher.

use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{command, AppHandle, Manager};

const PATCH_NOTES_URL: &str = "https://launchercontent.mojang.com/v2/javaPatchNotes.json";
const LAUNCHER_CONTENT_BASE: &str = "https://launchercontent.mojang.com";
const WALLPAPER_WIDTH: u32 = 1920;
const WALLPAPER_HEIGHT: u32 = 1080;

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("ModstackApp (wallpapers)")
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

fn absolute_url(path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!("{}{}", LAUNCHER_CONTENT_BASE, path)
    }
}

/// Reads the pixel size from a PNG, JPEG or WebP header without decoding it.
fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    // PNG: signature + IHDR chunk.
    if bytes.len() >= 24 && bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        return Some((w, h));
    }
    // JPEG: walk the markers until a start-of-frame segment.
    if bytes.len() > 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
        let mut i = 2usize;
        while i + 9 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = bytes[i + 1];
            if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
                i += 2;
                continue;
            }
            let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            let is_sof = matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF);
            if is_sof {
                let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                return Some((w, h));
            }
            i += 2 + len;
        }
        return None;
    }
    // WebP (VP8 / VP8L / VP8X).
    if bytes.len() >= 30 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        match &bytes[12..16] {
            b"VP8 " => {
                let w = (u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3FFF) as u32;
                let h = (u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3FFF) as u32;
                return Some((w, h));
            }
            b"VP8L" => {
                let b = &bytes[21..25];
                let w = 1 + (((b[1] as u32 & 0x3F) << 8) | b[0] as u32);
                let h = 1 + (((b[3] as u32 & 0x0F) << 10) | ((b[2] as u32) << 2) | ((b[1] as u32 & 0xC0) >> 6));
                return Some((w, h));
            }
            b"VP8X" => {
                let w = 1 + (bytes[24] as u32 | (bytes[25] as u32) << 8 | (bytes[26] as u32) << 16);
                let h = 1 + (bytes[27] as u32 | (bytes[28] as u32) << 8 | (bytes[29] as u32) << 16);
                return Some((w, h));
            }
            _ => {}
        }
    }
    None
}

fn extension_for(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        "jpg"
    }
}

/// Every image referenced by a patch note entry, plus the ones embedded in its body.
async fn patch_note_images(entry: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = entry.pointer("/image/url").and_then(Value::as_str) {
        urls.push(absolute_url(url));
    }
    if let Some(path) = entry.get("contentPath").and_then(Value::as_str) {
        let detail_url = format!("{}/v2/{}", LAUNCHER_CONTENT_BASE, path);
        if let Ok(response) = client().get(&detail_url).send().await {
            if let Ok(detail) = response.json::<Value>().await {
                if let Some(body) = detail.get("body").and_then(Value::as_str) {
                    for chunk in body.split("src=").skip(1) {
                        let raw = chunk.trim_start_matches(['"', '\'']);
                        let end = raw
                            .find(|c: char| c == '"' || c == '\'' || c == '>' || c.is_whitespace())
                            .unwrap_or(raw.len());
                        let url = &raw[..end];
                        if !url.is_empty() {
                            urls.push(absolute_url(url));
                        }
                    }
                }
            }
        }
    }
    urls.dedup();
    urls
}

/// Downloads candidates whose name advertises 1080p and returns the first one
/// whose real size is exactly 1920 × 1080.
async fn first_1080p(urls: &[String]) -> Option<Vec<u8>> {
    for url in urls {
        let name = url.to_ascii_lowercase();
        if !(name.contains("1920x1080") || name.contains("1920_1080") || name.contains("1080p")) {
            continue;
        }
        let Ok(response) = client().get(url).send().await else { continue };
        if !response.status().is_success() {
            continue;
        }
        let Ok(bytes) = response.bytes().await else { continue };
        if image_size(&bytes) == Some((WALLPAPER_WIDTH, WALLPAPER_HEIGHT)) {
            return Some(bytes.to_vec());
        }
    }
    None
}

/// Resolves a 1080p wallpaper for `version` and stores it in the app cache.
/// Returns the local file path, or `None` when only the bundled fallback applies.
#[command]
pub async fn fetch_version_wallpaper(app: AppHandle, version: String) -> Result<Option<String>, String> {
    let manifest = client()
        .get(PATCH_NOTES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let entries = manifest
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    // 1. Commemorative artwork of the selected version.
    let mut found: Option<(String, Vec<u8>)> = None;
    if let Some(entry) = entries
        .iter()
        .find(|entry| entry.get("version").and_then(Value::as_str) == Some(version.as_str()))
    {
        if let Some(bytes) = first_1080p(&patch_note_images(entry).await).await {
            found = Some((version.clone(), bytes));
        }
    }

    // 2. Default Java Edition artwork: newest release that ships a 1080p image.
    if found.is_none() {
        let mut releases: Vec<&Value> = entries
            .iter()
            .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("release"))
            .collect();
        releases.sort_by(|a, b| {
            let date = |v: &Value| v.get("date").and_then(Value::as_str).unwrap_or("").to_string();
            date(b).cmp(&date(a))
        });
        for entry in releases.into_iter().take(5) {
            if let Some(bytes) = first_1080p(&patch_note_images(entry).await).await {
                found = Some(("java-default".to_string(), bytes));
                break;
            }
        }
    }

    let Some((name, bytes)) = found else { return Ok(None) };
    let dir: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("wallpapers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{}.{}", safe, extension_for(&bytes)));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Downloads an image and returns it as a data URL (used for news thumbnails).
#[command]
pub async fn fetch_remote_image(url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Unsupported URL".into());
    }
    let response = client().get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let header_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("Image too large".into());
    }
    let mime = match header_type {
        Some(t) if t.starts_with("image/") => t,
        _ => match extension_for(&bytes) {
            "png" => "image/png".to_string(),
            "webp" => "image/webp".to_string(),
            _ => "image/jpeg".to_string(),
        },
    };
    Ok(format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes)))
}

/// Restores the standard icon on Windows shortcuts (.lnk) that point to the launcher.
#[command]
pub async fn restore_default_shortcut_icons() -> Result<u32, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_string_lossy().replace('\'', "''");
        let script = format!(
            r#"$ErrorActionPreference = 'SilentlyContinue'
$exe = '{exe}'
$shell = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'), (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
$count = 0
foreach ($dir in $dirs) {{
  if (-not $dir -or -not (Test-Path $dir)) {{ continue }}
  Get-ChildItem -Path $dir -Filter *.lnk -Recurse | ForEach-Object {{
    $lnk = $shell.CreateShortcut($_.FullName)
    if ($lnk.TargetPath -and ($lnk.TargetPath -ieq $exe)) {{
      $lnk.IconLocation = "$exe,0"
      $lnk.Save()
      $count++
    }}
  }}
}}
Write-Output $count"#
        );
        let output = tokio::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let count = String::from_utf8_lossy(&output.stdout)
            .trim()
            .lines()
            .last()
            .and_then(|line| line.trim().parse::<u32>().ok())
            .unwrap_or(0);
        Ok(count)
    }
    #[cfg(not(windows))]
    {
        Ok(0)
    }
}

#[cfg(test)]
mod tests {
    use super::image_size;

    #[test]
    fn reads_png_size() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        png.extend_from_slice(&1920u32.to_be_bytes());
        png.extend_from_slice(&1080u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((1920, 1080)));
    }
}
