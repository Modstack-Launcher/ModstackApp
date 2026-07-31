use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static LAST_ACTIVITY: Mutex<u64> = Mutex::new(0);
static IS_PLAYING: Mutex<bool> = Mutex::new(false);
static ENABLED: Mutex<bool> = Mutex::new(true);
static CURRENT_DETAILS: Mutex<String> = Mutex::new(String::new());
static CURRENT_MUSIC: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_THUMBNAIL: Mutex<Option<String>> = Mutex::new(None);

const CLIENT_ID: &str = "1500619451622625371";
const AFK_TIMEOUT_SECS: u64 = 15 * 60;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn update_last_activity() {
    *LAST_ACTIVITY.lock().unwrap() = now_secs();
}

fn apply_activity() {
    if !*ENABLED.lock().unwrap() {
        clear_activity();
        return;
    }

    let details = CURRENT_DETAILS.lock().unwrap().clone();
    let music = CURRENT_MUSIC.lock().unwrap().clone();
    let thumbnail = CURRENT_THUMBNAIL.lock().unwrap().clone();
    let state_str = music.as_ref().map(|track| format!("Listening: {}", track));
    let large_text = format!("Modstack App v{}", env!("CARGO_PKG_VERSION"));

    let mut lock = CLIENT.lock().unwrap();
    if let Some(client) = lock.as_mut() {
        let payload = match &state_str {
            Some(state) => {
                let assets = if let Some(thumb) = &thumbnail {
                    activity::Assets::new()
                        .large_image("modstack")
                        .large_text(&large_text)
                        .small_image(thumb)
                        .small_text(state)
                } else {
                    activity::Assets::new()
                        .large_image("modstack")
                        .large_text(&large_text)
                };

                activity::Activity::new()
                    .details(&details)
                    .state(state)
                    .assets(assets)
            }
            None => activity::Activity::new().details(&details),
        };

        match client.set_activity(payload) {
            Ok(_) => println!("[Discord] {}", details),
            Err(e) => println!("[Discord] Error: {:?}", e),
        }
    }
}

fn clear_activity() {
    let mut lock = CLIENT.lock().unwrap();
    if let Some(client) = lock.as_mut() {
        if let Err(e) = client.clear_activity() {
            println!("[Discord] Clear error: {:?}", e);
        }
    }
}

pub fn init() {
    println!("[Discord] Initializing RPC...");

    let mut client = match DiscordIpcClient::new(CLIENT_ID) {
        Ok(c) => c,
        Err(e) => {
            println!("[Discord] Error creating client: {:?}", e);
            return;
        }
    };

    match client.connect() {
        Ok(_) => println!("[Discord] Connected successfully"),
        Err(e) => {
            println!("[Discord] Could not connect: {:?}", e);
            return;
        }
    }

    *CLIENT.lock().unwrap() = Some(client);
    *CURRENT_DETAILS.lock().unwrap() = "Browsing...".to_string();
    apply_activity();
    update_last_activity();

    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(60));

        if *IS_PLAYING.lock().unwrap() {
            continue;
        }

        let elapsed = now_secs().saturating_sub(*LAST_ACTIVITY.lock().unwrap());
        if elapsed >= AFK_TIMEOUT_SECS {
            *CURRENT_DETAILS.lock().unwrap() = "AFK...".to_string();
            apply_activity();
            println!("[Discord] Activity: AFK");
        }
    });
}

pub fn set_enabled(enabled: bool) {
    *ENABLED.lock().unwrap() = enabled;
    if enabled {
        apply_activity();
    } else {
        clear_activity();
        println!("[Discord] RPC disabled");
    }
}

pub fn set_idle() {
    if !*ENABLED.lock().unwrap() {
        clear_activity();
        return;
    }
    update_last_activity();
    *IS_PLAYING.lock().unwrap() = false;
    *CURRENT_DETAILS.lock().unwrap() = "Browsing...".to_string();
    apply_activity();
}

pub fn set_playing(instance_name: &str) {
    if !*ENABLED.lock().unwrap() {
        clear_activity();
        return;
    }
    update_last_activity();
    *IS_PLAYING.lock().unwrap() = true;
    *CURRENT_DETAILS.lock().unwrap() = format!("Playing {}", instance_name);
    apply_activity();
}

pub fn set_music(track_title: Option<&str>, thumbnail: Option<&str>) {
    if !*ENABLED.lock().unwrap() {
        clear_activity();
        return;
    }
    *CURRENT_MUSIC.lock().unwrap() = track_title.map(|s| s.to_string());
    *CURRENT_THUMBNAIL.lock().unwrap() = thumbnail.map(|s| s.to_string());
    apply_activity();
    println!("[Discord] Listening: {:?}", track_title);
}
