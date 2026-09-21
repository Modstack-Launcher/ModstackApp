use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::{
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static LAST_ACTIVITY: Mutex<u64> = Mutex::new(0);
static IS_PLAYING: Mutex<bool> = Mutex::new(false);
static ENABLED: Mutex<bool> = Mutex::new(true);
static CURRENT_DETAILS: Mutex<String> = Mutex::new(String::new());
static CURRENT_MUSIC: Mutex<Option<String>> = Mutex::new(None);

const CLIENT_ID: &str = "1500619451622625371";
const AFK_TIMEOUT_SECS: u64 = 15 * 60;
const DISCORD_TEXT_LIMIT: usize = 128;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn truncate_discord_text(value: &str) -> String {
    value
        .trim()
        .chars()
        .take(DISCORD_TEXT_LIMIT)
        .collect::<String>()
}

fn update_last_activity() {
    *LAST_ACTIVITY.lock().unwrap() = now_secs();
}

fn connect() -> bool {
    if CLIENT.lock().unwrap().is_some() {
        return true;
    }

    let mut client = DiscordIpcClient::new(CLIENT_ID);

    match client.connect() {
        Ok(_) => {
            println!("[Discord] Connected");
            *CLIENT.lock().unwrap() = Some(client);
            true
        }
        Err(e) => {
            println!("[Discord] Connection error: {:?}", e);
            false
        }
    }
}

fn apply_activity() {
    if !*ENABLED.lock().unwrap() || !connect() {
        return;
    }

    let details = truncate_discord_text(&CURRENT_DETAILS.lock().unwrap());
    let music = CURRENT_MUSIC.lock().unwrap().clone();
    let state = music
        .as_ref()
        .map(|track| truncate_discord_text(&format!("Listening: {}", track)));
    let started_at = now_millis();

    let build = || {
        let mut a = activity::Activity::new()
            .details(&details)
            .timestamps(activity::Timestamps::new().start(started_at))
            .activity_type(activity::ActivityType::Playing)
            .status_display_type(activity::StatusDisplayType::Details);

        if let Some(s) = state.as_deref() {
            a = a.state(s);
        }

        a
    };

    let mut lock = CLIENT.lock().unwrap();
    let Some(client) = lock.as_mut() else {
        return;
    };

    if let Err(e) = client.set_activity(build()) {
        println!("[Discord] Activity error: {:?}", e);

        match client.reconnect() {
            Ok(_) => {
                println!("[Discord] Reconnected");

                if let Err(e) = client.set_activity(build()) {
                    println!("[Discord] Retry error: {:?}", e);
                    *lock = None;
                }
            }
            Err(e) => {
                println!("[Discord] Reconnect error: {:?}", e);
                *lock = None;
            }
        }
    } else {
        println!("[Discord] {}", details);
    }
}

fn clear_activity() {
    let mut lock = CLIENT.lock().unwrap();

    if let Some(client) = lock.as_mut() {
        if let Err(e) = client.clear_activity() {
            println!("[Discord] Clear error: {:?}", e);
            *lock = None;
        }
    }
}

pub fn init() {
    println!("[Discord] Initializing RPC...");

    *CURRENT_DETAILS.lock().unwrap() = "Browsing...".into();
    update_last_activity();

    connect();
    apply_activity();

    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(60));

        if !*ENABLED.lock().unwrap() {
            continue;
        }

        if CLIENT.lock().unwrap().is_none() {
            if connect() {
                apply_activity();
            }
            continue;
        }

        if *IS_PLAYING.lock().unwrap() {
            continue;
        }

        let elapsed = now_secs()
            .saturating_sub(*LAST_ACTIVITY.lock().unwrap());

        if elapsed >= AFK_TIMEOUT_SECS {
            let mut details = CURRENT_DETAILS.lock().unwrap();

            if details.as_str() != "AFK..." {
                *details = "AFK...".into();
                drop(details);
                apply_activity();
            }
        }
    });
}

pub fn set_enabled(enabled: bool) {
    *ENABLED.lock().unwrap() = enabled;

    if enabled {
        connect();
        apply_activity();
    } else {
        clear_activity();
        println!("[Discord] RPC disabled");
    }
}

pub fn set_idle() {
    if !*ENABLED.lock().unwrap() {
        return;
    }

    update_last_activity();
    *IS_PLAYING.lock().unwrap() = false;
    *CURRENT_DETAILS.lock().unwrap() = "Browsing...".into();
    apply_activity();
}

pub fn set_playing(instance_name: &str) {
    if !*ENABLED.lock().unwrap() {
        return;
    }

    update_last_activity();
    *IS_PLAYING.lock().unwrap() = true;
    *CURRENT_DETAILS.lock().unwrap() = format!("Playing {}", instance_name);
    apply_activity();
}

pub fn set_music(track: Option<&str>, _thumbnail: Option<&str>) {
    if !*ENABLED.lock().unwrap() {
        return;
    }

    *CURRENT_MUSIC.lock().unwrap() = track.map(str::to_string);
    apply_activity();
}
