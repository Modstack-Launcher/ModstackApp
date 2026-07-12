#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod discord;
mod logger;
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
use commands::modrinth::*;
use commands::news::*;
use commands::skin::*;
use utils::*;

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
            get_minecraft_profile,
            get_player_capes,
            set_active_cape,
            discord_set_idle,
            discord_set_playing,
            discord_set_music,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}