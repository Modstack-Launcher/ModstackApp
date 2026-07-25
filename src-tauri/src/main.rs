#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod discord;
mod logger;
mod java_runtime;
mod skin_server;
mod state;
mod utils;

#[cfg(target_os = "linux")]
mod linux_appimage;

use commands::anyserver::*;
use commands::auth::*;
use commands::bedrock::*;
use commands::clips::*;
use commands::config::*;
use commands::instance::*;
use commands::java::*;
use commands::modrinth::*;
use commands::news::*;
use commands::skin::*;
use utils::*;
use commands::multiplayer::*;

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[allow(dead_code)]
struct PendingMrstack(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn discord_set_music(track: Option<String>, thumbnail: Option<String>) {
    discord::set_music(track.as_deref(), thumbnail.as_deref());
}

#[derive(Deserialize)]
struct SpotifyTokenResponse {
    access_token: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyImage {
    url: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyArtist {
    name: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyAlbum {
    name: Option<String>,
    images: Option<Vec<SpotifyImage>>,
}

#[derive(Deserialize)]
struct SpotifyExternalIds {
    isrc: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyExternalUrls {
    spotify: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyTrack {
    id: Option<String>,
    name: Option<String>,
    external_urls: Option<SpotifyExternalUrls>,
    external_ids: Option<SpotifyExternalIds>,
    preview_url: Option<String>,
    artists: Option<Vec<SpotifyArtist>>,
    album: Option<SpotifyAlbum>,
}

#[derive(Deserialize)]
struct SpotifyPlaylistItem {
    track: Option<SpotifyTrack>,
}

#[derive(Deserialize)]
struct SpotifyPlaylistResponse {
    items: Vec<SpotifyPlaylistItem>,
    next: Option<String>,
}

#[derive(Serialize)]
struct ImportedSpotifyTrack {
    id: String,
    title: String,
    artist: String,
    thumbnail: String,
    external_url: String,
    playback_url: String,
    album: String,
    isrc: String,
}

fn spotify_playlist_id(url: &str) -> Option<String> {
    if let Some(id) = url.strip_prefix("spotify:playlist:") {
        let id = id.trim().to_string();
        return if id.is_empty() { None } else { Some(id) };
    }
    let marker = "/playlist/";
    let start = url.find(marker)? + marker.len();
    let rest = &url[start..];
    let id = rest
        .split(['?', '/', '#'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() { None } else { Some(id) }
}

fn html_decode(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_html_tags(value: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    html_decode(out.trim())
}

fn extract_heading_text(row: &str, heading: &str) -> Option<String> {
    let start = row.find(&format!("<{heading}"))?;
    let after_start = &row[start..];
    let content_start = after_start.find('>')? + 1;
    let after_content_start = &after_start[content_start..];
    let end = after_content_start.find(&format!("</{heading}>"))?;
    let text = strip_html_tags(&after_content_start[..end]);
    if text.is_empty() { None } else { Some(text) }
}

#[tauri::command]
async fn import_spotify_playlist_public_native(url: String) -> Result<Vec<ImportedSpotifyTrack>, String> {
    let playlist_id = spotify_playlist_id(&url).ok_or("Invalid Spotify playlist URL")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 Modstack/1.0 spotify public importer")
        .build()
        .map_err(|err| err.to_string())?;

    let embed_url = format!("https://open.spotify.com/embed/playlist/{playlist_id}");
    let response = client
        .get(embed_url)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Spotify public playlist failed: {}", response.status()));
    }

    let html = response.text().await.map_err(|err| err.to_string())?;
    let mut tracks = Vec::new();

    for (index, row) in html.split("data-testid=\"tracklist-row-\"").skip(1).enumerate() {
        let title = extract_heading_text(row, "h3");
        let artist = extract_heading_text(row, "h4");
        let (Some(title), Some(artist)) = (title, artist) else { continue };

        tracks.push(ImportedSpotifyTrack {
            id: format!("public:{playlist_id}:{index}"),
            title,
            artist,
            thumbnail: String::new(),
            external_url: url.clone(),
            playback_url: String::new(),
            album: String::new(),
            isrc: String::new(),
        });

        if tracks.len() >= 300 {
            break;
        }
    }

    if tracks.is_empty() {
        return Err("No public tracks found in Spotify embed".into());
    }

    Ok(tracks)
}

#[tauri::command]
async fn import_spotify_playlist_native(
    url: String,
    client_id: String,
    client_secret: String,
) -> Result<Vec<ImportedSpotifyTrack>, String> {
    let playlist_id = spotify_playlist_id(&url).ok_or("Invalid Spotify playlist URL")?;
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Missing Spotify credentials".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Modstack/1.0 spotify importer")
        .build()
        .map_err(|err| err.to_string())?;

    let credentials = general_purpose::STANDARD.encode(format!("{client_id}:{client_secret}"));
    let token_response = client
        .post("https://accounts.spotify.com/api/token")
        .header(reqwest::header::AUTHORIZATION, format!("Basic {credentials}"))
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !token_response.status().is_success() {
        return Err(format!("Spotify auth failed: {}", token_response.status()));
    }

    let token = token_response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|err| err.to_string())?
        .access_token
        .ok_or("Spotify did not return an access token")?;

    let mut tracks = Vec::new();
    let mut next_url = Some(format!(
        "https://api.spotify.com/v1/playlists/{}/tracks?fields=items(track(id,name,external_urls,external_ids(isrc),preview_url,artists(name),album(name,images))),next&limit=50",
        playlist_id
    ));

    while let Some(page_url) = next_url.take() {
        let response = client
            .get(&page_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|err| err.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Spotify playlist import failed: {}", response.status()));
        }

        let page = response
            .json::<SpotifyPlaylistResponse>()
            .await
            .map_err(|err| err.to_string())?;

        for item in page.items {
            let Some(track) = item.track else { continue };
            let Some(id) = track.id else { continue };
            let Some(title) = track.name else { continue };
            let artists = track.artists.unwrap_or_default();
            let artist = artists
                .into_iter()
                .filter_map(|artist| artist.name)
                .collect::<Vec<_>>()
                .join(", ");
            let album = track.album;
            let album_name = album.as_ref().and_then(|album| album.name.clone()).unwrap_or_default();
            let images = album.and_then(|album| album.images).unwrap_or_default();
            let thumbnail = images
                .get(1)
                .or_else(|| images.first())
                .or_else(|| images.get(2))
                .and_then(|image| image.url.clone())
                .unwrap_or_default();
            let external_url = track
                .external_urls
                .and_then(|urls| urls.spotify)
                .unwrap_or_else(|| format!("https://open.spotify.com/track/{id}"));

            tracks.push(ImportedSpotifyTrack {
                id,
                title,
                artist: if artist.is_empty() { "Spotify".into() } else { artist },
                thumbnail,
                external_url,
                playback_url: track.preview_url.unwrap_or_default(),
                album: album_name,
                isrc: track.external_ids.and_then(|ids| ids.isrc).unwrap_or_default(),
            });
        }

        next_url = page.next;
        if tracks.len() >= 300 {
            break;
        }
    }

    tracks.truncate(300);
    Ok(tracks)
}

#[cfg(target_os = "windows")]
fn disable_tracking_prevention(webview: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile, ICoreWebView2Profile3, ICoreWebView2_13,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
    };
    use windows_core::Interface;

    let _ = webview.with_webview(|webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("No se pudo obtener CoreWebView2: {e:?}");
                return;
            }
        };

        let core13: ICoreWebView2_13 = match core.cast() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("ICoreWebView2_13 no soportado: {e:?}");
                return;
            }
        };

        let profile: ICoreWebView2Profile = match core13.Profile() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("No se pudo obtener el Profile: {e:?}");
                return;
            }
        };

        let profile3: ICoreWebView2Profile3 = match profile.cast() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("ICoreWebView2Profile3 no soportado: {e:?}");
                return;
            }
        };

        if let Err(e) = profile3
            .SetPreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE)
        {
            eprintln!("No se pudo desactivar Tracking Prevention: {e:?}");
        }
    });
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        linux_appimage::ensure_system_wayland_preload();
        linux_appimage::reject_system_color_fonts();
    }

    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--js-flags=\"--max-old-space-size=256\" --disable-gpu-program-cache --disable-gpu-shader-disk-cache",
        );
    }

    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|v| v == "wayland")
                .unwrap_or(false);

        if !is_wayland {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        std::env::set_var("WEBKIT_FORCE_SANDBOX", "0");
    }

    std::thread::spawn(|| {
        let _ = std::panic::catch_unwind(|| {
            discord::init();
        });
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file_path) = argv.get(1) {
                if file_path.ends_with(".mrstack") {
                    app.emit("open-mrstack", file_path).ok();
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
                window.unminimize().ok();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("clips-shortcut", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Err(error) = app.global_shortcut().register("Alt+F7") {
                log::warn!("Could not register Clips shortcut Alt+F7: {error}");
            }
            if let Some(window_config) = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
            {
                #[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
                let window =
                    tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                        .visible(false)
                        .build()?;

                #[cfg(target_os = "windows")]
                disable_tracking_prevention(&window);
            }
            {
                let handle = app.handle().clone();
                app.listen("frontend-ready", move |_| {
                    if !handle.global_shortcut().is_registered("Alt+F7") {
                        if let Err(error) = handle.global_shortcut().register("Alt+F7") {
                            log::warn!("Clips shortcut Alt+F7 is still unavailable: {error}");
                        }
                    }
                    if let Some(window) = handle.get_webview_window("main") {
                        window.show().ok();
                    }
                });
            }

            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.get(1) {
                if file_path.ends_with(".mrstack") {
                    let path = file_path.clone();
                    let handle = app.handle().clone();
                    app.manage(PendingMrstack(std::sync::Mutex::new(Some(path.clone()))));
                    app.listen("frontend-ready", move |_| {
                        handle.emit("open-mrstack", &path).ok();
                        if let Some(window) = handle.get_webview_window("main") {
                            window.set_focus().ok();
                            window.unminimize().ok();
                        }
                    });
                } else {
                    app.manage(PendingMrstack(std::sync::Mutex::new(None)));
                }
            } else {
                app.manage(PendingMrstack(std::sync::Mutex::new(None)));
            }
            Ok(())
        })
        .manage(state::AppState::new())
        .manage(ClipsState::new())
        .manage(commands::multiplayer::MultiplayerState::new())
        .invoke_handler(tauri::generate_handler![
            create_instance,
            list_instances,
            get_instance_by_code,
            launch_instance_cmd,
            install_instance_files,
            uninstall_instance,
            get_instances,
            get_instance,
            download_mod,
            modrinth_install,
            get_installed_mods,
            get_installed_mod_slugs,
            reindex_instance_mods,
            check_mod_updates,
            toggle_mod,
            delete_mod,
            set_config,
            get_config,
            get_system_ram,
            login_microsoft,
            login_offline,
            refresh_microsoft_token,
            logout,
            get_news,
            upload_skin_to_mojang,
            apply_skin_locally,
            inject_offline_skin,
            fetch_skin_as_base64,
            fetch_image_as_base64,
            get_minecraft_profile,
            get_player_capes,
            set_active_cape,
            discord_set_idle,
            discord_set_playing,
            discord_set_music,
            import_spotify_playlist_public_native,
            import_spotify_playlist_native,
            load_local_instances,
            save_local_instances,
            add_local_instance,
            remove_local_instance,
            get_selected_local_instance_id,
            set_selected_local_instance_id,
            update_local_instance,
            open_local_instance_folder,
            export_local_instance,
            import_mrstack,
            install_modrinth_modpack,
            bedrock_get_status,
            bedrock_get_latest_version,
            bedrock_install,
            bedrock_launch,
            bedrock_uninstall,
            get_install_dir,
            pick_install_dir,
            reset_install_dir,
            get_java_runtimes_status,
            detect_java_runtime,
            install_java_runtime,
            pick_java_runtime,
            curseforge_install,
            register_local_instance_for_launch,
            get_instance_worlds,
            anyserver_get,
            stop_instance,
            get_running_instances,
            get_downloading_instances,
            get_instance_files,
            read_instance_file,
            write_instance_file,
            delete_instance_file,
            rename_instance_file,
            get_instance_playtime,
            get_instance_screenshots,
            open_instance_screenshot,
            install_curseforge_modpack,
            clips_ffmpeg_available,
            clips_pick_ffmpeg,
            clips_start,
            clips_stop,
            clips_status,
            clips_save,
            clips_save_and_restart,
            clips_save_webm,
            clips_list,
            clips_delete,
            clips_trim,
            clips_open_folder,
            clips_install_ffmpeg,
            clips_audio_devices,
            clips_show_overlay,
            clips_hide_overlay,
            multiplayer_setup_server,
            multiplayer_get_status,
            multiplayer_get_stats,
            multiplayer_start_server,
            multiplayer_stop_server,
            multiplayer_restart_server,
            multiplayer_send_command,
            multiplayer_get_local_ip,
            multiplayer_get_server_dir,
            multiplayer_open_folder,
            multiplayer_open_mods_folder,
            multiplayer_list_setups,
            multiplayer_delete_setup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}
