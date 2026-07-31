use std::path::PathBuf;
use std::time::Duration;
use tauri::command;
use tokio::process::Command;

fn yt_dlp_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn yt_dlp_download_url() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    }
}

async fn ensure_yt_dlp() -> Result<PathBuf, String> {
    let tools_dir = crate::commands::config::get_install_dir_path().join("tools");
    std::fs::create_dir_all(&tools_dir).map_err(|e| e.to_string())?;

    let bin_path = tools_dir.join(yt_dlp_name());
    if bin_path.exists() {
        return Ok(bin_path);
    }

    let bytes = reqwest::get(yt_dlp_download_url())
        .await
        .map_err(|e| format!("yt-dlp download: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("yt-dlp bytes: {}", e))?;

    std::fs::write(&bin_path, &bytes).map_err(|e| format!("yt-dlp write: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&bin_path)
            .map_err(|e| e.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&bin_path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(bin_path)
}

#[command]
pub async fn resolve_youtube_audio_url(video_id: String) -> Result<String, String> {
    if !video_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        || video_id.len() != 11
    {
        return Err("Invalid YouTube video id".to_string());
    }

    let yt_dlp = ensure_yt_dlp().await?;
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        Command::new(yt_dlp)
            .args([
                "--no-playlist",
                "--no-warnings",
                "--force-ipv4",
                "-f",
                "bestaudio/best",
                "-g",
                &url,
            ])
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp timeout".to_string())?
    .map_err(|e| format!("yt-dlp run: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(ToString::to_string)
        .ok_or_else(|| "yt-dlp did not return an audio URL".to_string())
}
