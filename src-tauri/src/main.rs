#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
 
mod commands;
mod core;
mod utils;
mod state;
mod java_runtime;
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
            anyserver_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}