use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::command;
use tokio::process::Command;

#[derive(Deserialize)]
struct InvidiousThumbnail {
    url: Option<String>,
    quality: Option<String>,
}

#[derive(Deserialize)]
struct InvidiousVideo {
    #[serde(rename = "videoId")]
    video_id: Option<String>,
    title: Option<String>,
    author: Option<String>,
    #[serde(rename = "videoThumbnails")]
    video_thumbnails: Option<Vec<InvidiousThumbnail>>,
}

#[derive(Serialize)]
pub struct NativeYoutubeTrack {
    id: String,
    title: String,
    artist: String,
    thumbnail: String,
    external_url: String,
    playback_url: String,
    video_id: String,
}

fn normalize_youtube_thumbnail(url: Option<String>, video_id: &str) -> String {
    let Some(trimmed) = url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return format!("https://img.youtube.com/vi/{video_id}/hqdefault.jpg");
    };
    if let Some(path) = trimmed.strip_prefix("//") {
        return format!("https://{path}");
    }
    if trimmed.starts_with("/vi/") {
        return format!("https://i.ytimg.com{trimmed}");
    }
    trimmed
}

fn best_invidious_thumbnail(video: &InvidiousVideo, video_id: &str) -> String {
    let thumbnails = video.video_thumbnails.as_deref().unwrap_or(&[]);
    let preferred = thumbnails
        .iter()
        .find(|thumb| thumb.quality.as_deref() == Some("medium"))
        .or_else(|| {
            thumbnails
                .iter()
                .find(|thumb| thumb.quality.as_deref() == Some("high"))
        })
        .or_else(|| {
            thumbnails
                .iter()
                .find(|thumb| thumb.quality.as_deref() == Some("maxres"))
        })
        .or_else(|| thumbnails.first());
    normalize_youtube_thumbnail(preferred.and_then(|thumb| thumb.url.clone()), video_id)
}

fn extract_yt_initial_data(html: &str) -> Option<&str> {
    for marker in ["var ytInitialData = ", "ytInitialData = "] {
        let Some(marker_start) = html.find(marker) else {
            continue;
        };
        let start = marker_start + marker.len();
        let Some(relative_json_start) = html[start..].find('{') else {
            continue;
        };
        let json_start = relative_json_start + start;
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;

        for (offset, ch) in html[json_start..].char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
                continue;
            }
            match ch {
                '"' => in_string = true,
                '{' => depth += 1,
                '}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        return Some(&html[json_start..json_start + offset + ch.len_utf8()]);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

fn yt_text(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.get("simpleText").and_then(|item| item.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let text = value
        .get("runs")?
        .as_array()?
        .iter()
        .filter_map(|run| run.get("text").and_then(|item| item.as_str()))
        .collect::<Vec<_>>()
        .join("");
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn yt_thumbnail(renderer: &serde_json::Value, video_id: &str) -> String {
    let selected = renderer
        .get("thumbnail")
        .and_then(|thumb| thumb.get("thumbnails"))
        .and_then(|thumbs| thumbs.as_array())
        .and_then(|thumbs| {
            thumbs
                .iter()
                .rev()
                .find_map(|thumb| thumb.get("url").and_then(|url| url.as_str()))
        })
        .map(str::to_string);
    normalize_youtube_thumbnail(selected, video_id)
}

fn collect_youtube_renderers(value: &serde_json::Value, tracks: &mut Vec<NativeYoutubeTrack>) {
    if tracks.len() >= 18 {
        return;
    }
    if let Some(renderer) = value.get("videoRenderer") {
        if let (Some(video_id), Some(title)) = (
            renderer.get("videoId").and_then(|item| item.as_str()),
            yt_text(renderer.get("title")),
        ) {
            if video_id.len() == 11 && !tracks.iter().any(|track| track.video_id == video_id) {
                let artist = yt_text(renderer.get("ownerText"))
                    .or_else(|| yt_text(renderer.get("longBylineText")))
                    .or_else(|| yt_text(renderer.get("shortBylineText")))
                    .unwrap_or_else(|| "YouTube Music".to_string());
                tracks.push(NativeYoutubeTrack {
                    id: video_id.to_string(),
                    title,
                    artist,
                    thumbnail: yt_thumbnail(renderer, video_id),
                    external_url: format!("https://www.youtube.com/watch?v={video_id}"),
                    playback_url: format!(
                        "https://www.youtube.com/embed/{video_id}?autoplay=1&rel=0"
                    ),
                    video_id: video_id.to_string(),
                });
            }
        }
    }
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_youtube_renderers(item, tracks);
                if tracks.len() >= 18 {
                    break;
                }
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                collect_youtube_renderers(item, tracks);
                if tracks.len() >= 18 {
                    break;
                }
            }
        }
        _ => {}
    }
}

async fn search_youtube_web(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<NativeYoutubeTrack>, String> {
    let response = client
        .get("https://www.youtube.com/results")
        .query(&[("search_query", query)])
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("YouTube search failed: {}", response.status()));
    }
    let html = response.text().await.map_err(|err| err.to_string())?;
    let json_text = extract_yt_initial_data(&html).ok_or("YouTube search data not found")?;
    let data =
        serde_json::from_str::<serde_json::Value>(json_text).map_err(|err| err.to_string())?;
    let mut tracks = Vec::new();
    collect_youtube_renderers(&data, &mut tracks);
    Ok(tracks)
}

#[command]
pub async fn search_youtube_music_native(query: String) -> Result<Vec<NativeYoutubeTrack>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(7))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Modstack/1.0 Chrome/126.0 Safari/537.36")
        .build()
        .map_err(|err| err.to_string())?;
    for instance in [
        "https://inv.thepixora.com",
        "https://inv.nadeko.net",
        "https://yt.chocolatemoo53.com",
        "https://invidious.tiekoetter.com",
        "https://invidious.f5.si",
    ] {
        let Ok(response) = client
            .get(format!("{instance}/api/v1/search"))
            .query(&[("q", query), ("type", "video")])
            .send()
            .await
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(videos) = response.json::<Vec<InvidiousVideo>>().await else {
            continue;
        };
        let tracks = videos
            .into_iter()
            .filter_map(|video| {
                let video_id = video.video_id.clone()?;
                let title = video.title.clone()?;
                Some(NativeYoutubeTrack {
                    id: video_id.clone(),
                    title,
                    artist: video
                        .author
                        .clone()
                        .unwrap_or_else(|| "YouTube Music".to_string()),
                    thumbnail: best_invidious_thumbnail(&video, &video_id),
                    external_url: format!("https://www.youtube.com/watch?v={video_id}"),
                    playback_url: format!(
                        "https://www.youtube.com/embed/{video_id}?autoplay=1&rel=0"
                    ),
                    video_id,
                })
            })
            .take(18)
            .collect::<Vec<_>>();
        if !tracks.is_empty() {
            return Ok(tracks);
        }
    }
    if let Ok(tracks) = search_youtube_web(&client, query).await {
        if !tracks.is_empty() {
            return Ok(tracks);
        }
    }
    Err("All music search providers failed".into())
}

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
