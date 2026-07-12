use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CapeEntry {
    pub id: String,
    pub alias: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct ProfileResponse {
    capes: Option<Vec<RawCape>>,
}

#[derive(Debug, Deserialize)]
struct RawCape {
    id: String,
    alias: String,
    url: String,
}

#[command]
pub async fn get_player_capes(access_token: String) -> Result<Vec<CapeEntry>, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }

    let profile: ProfileResponse = res.json().await.map_err(|e| e.to_string())?;
    let capes = profile
        .capes
        .unwrap_or_default()
        .into_iter()
        .map(|c| CapeEntry {
            id: c.id,
            alias: c.alias,
            url: c.url,
        })
        .collect();

    Ok(capes)
}

#[command]
pub async fn set_active_cape(cape_id: String, access_token: String) -> Result<(), String> {
    let client = reqwest::Client::new();

    if cape_id.is_empty() {
        let res = client
            .delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        return if res.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "{}: {}",
                res.status(),
                res.text().await.unwrap_or_default()
            ))
        };
    }

    let res = client
        .put("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .bearer_auth(&access_token)
        .json(&serde_json::json!({ "capeId": cape_id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "{}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ))
    }
}

#[command]
pub async fn upload_skin_to_mojang(
    data_url: String,
    arm_style: String,
    access_token: String,
) -> Result<(), String> {
    let base64_data = data_url.split(",").nth(1).ok_or("dataUrl inválido")?;

    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;

    let variant = if arm_style == "slim" {
        "slim"
    } else {
        "classic"
    };

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("variant", variant.to_string())
        .part("file", part);

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(&access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status().to_string();
        let body = res.text().await.unwrap_or_default();
        Err(format!("{}: {}", status, body))
    }
}

#[command]
pub async fn apply_skin_locally(data_url: String, player_uuid: String) -> Result<(), String> {
    let base64_data = data_url.split(",").nth(1).ok_or("dataUrl inválido")?;

    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;

    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let skins_dir = std::path::PathBuf::from(&appdata)
        .join(".minecraft")
        .join("assets")
        .join("skins");

    std::fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;

    let uuid_clean = player_uuid.replace("-", "");
    let skin_path = skins_dir.join(&uuid_clean);

    std::fs::write(&skin_path, &bytes).map_err(|e| e.to_string())?;

    Ok(())
}

fn enable_resource_pack_in_options(
    options_path: &std::path::PathBuf,
    pack_name: &str,
) -> Result<(), String> {
    let existing = if options_path.exists() {
        std::fs::read_to_string(options_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let mut lines: Vec<String> = existing.lines().map(|l| l.to_string()).collect();
    let rp_idx = lines.iter().position(|l| l.starts_with("resourcePacks:"));

    match rp_idx {
        Some(idx) => {
            let json_part = lines[idx]
                .trim_start_matches("resourcePacks:")
                .trim()
                .to_string();
            let mut packs: Vec<String> =
                serde_json::from_str::<Vec<String>>(&json_part).unwrap_or_default();
            if !packs.iter().any(|p| p == pack_name) {
                packs.push(pack_name.to_string());
            }
            let new_json = serde_json::to_string(&packs).map_err(|e| e.to_string())?;
            lines[idx] = format!("resourcePacks:{}", new_json);
        }
        None => {
            lines.push(format!("resourcePacks:[\"{}\"]", pack_name));
        }
    }

    let new_content = lines.join("\n");
    std::fs::write(options_path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn inject_offline_skin(
    instance_id: String,
    data_url: String,
    arm_style: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let instance_dir = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .map(|i| i.path.clone())
            .ok_or_else(|| format!("Instancia '{}' no encontrada", instance_id))?
    };

    let base64_data = data_url.split(",").nth(1).ok_or("dataUrl inválido")?;

    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;

    let pack_root = instance_dir
        .join("resourcepacks")
        .join("modstack_active_skin");

    let textures_dir = pack_root
        .join("assets")
        .join("minecraft")
        .join("textures")
        .join("entity");

    std::fs::create_dir_all(&textures_dir).map_err(|e| e.to_string())?;

    std::fs::write(
        pack_root.join("pack.mcmeta"),
        r#"{"pack":{"pack_format":1,"description":"Modstack skin"}}"#,
    )
    .map_err(|e| e.to_string())?;

    std::fs::write(textures_dir.join("steve.png"), &bytes).map_err(|e| e.to_string())?;
    std::fs::write(textures_dir.join("alex.png"), &bytes).map_err(|e| e.to_string())?;

    let _ = arm_style;

    enable_resource_pack_in_options(&instance_dir.join("options.txt"), "modstack_active_skin")?;

    Ok(())
}

#[command]
pub async fn fetch_skin_as_base64(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }

    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("image") {
        return Err(format!("No es imagen: {}", content_type));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[command]
pub async fn get_minecraft_profile(username: String) -> Result<String, String> {
    let client: reqwest::Client = reqwest::Client::new();

    let uuid_res = client
        .get(format!(
            "https://api.mojang.com/users/profiles/minecraft/{}",
            username
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !uuid_res.status().is_success() {
        return Err(format!("HTTP {}", uuid_res.status()));
    }

    let uuid_data: serde_json::Value = uuid_res.json().await.map_err(|e| e.to_string())?;
    let uuid = uuid_data["id"].as_str().ok_or("No UUID")?;

    let profile_res = client
        .get(format!(
            "https://sessionserver.mojang.com/session/minecraft/profile/{}",
            uuid
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = profile_res.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}
