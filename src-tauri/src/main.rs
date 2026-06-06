#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod utils;
mod state;
mod logger;
mod discord;
mod skin_server;

use commands::bedrock::*; 
use commands::news::*; 
use commands::skin::*;
use commands::instance::*;
use commands::modrinth::*;
use commands::config::*;
use commands::auth::*;
use commands::anyserver::*;
use utils::*;

use tauri::Listener;
use tauri::Emitter;
use tauri::Manager;

#[allow(dead_code)]
struct PendingMrstack(std::sync::Mutex<Option<String>>);
 
fn main() {
#[cfg(target_os = "windows")]
    {
        // Reduce WebView2 GPU disk cache to lower RAM/disk footprint.
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

        // Disable DMABuf renderer — in AppImage environments the GPU buffer
        // access is restricted, causing WebKit to render a blank page instead
        // of falling back gracefully.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
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
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Warn).build())
        .plugin(tauri_plugin_shell::init())           
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}