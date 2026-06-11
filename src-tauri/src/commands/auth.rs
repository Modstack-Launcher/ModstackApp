use tauri::command;
use serde_json::{json, Value};
use super::instance::offline_uuid;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use reqwest::Client;
use minecraft_msa_auth::MinecraftAuthorizationFlow;
use urlencoding::decode;

const CLIENT_ID: &str = "28345b95-0610-4565-b77d-03a20a541560";
const REDIRECT_URI: &str = "http://localhost:7878/callback";

#[command]
pub async fn login_microsoft() -> Result<Value, String> {
    let listener = TcpListener::bind("127.0.0.1:7878")
        .await
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize\
        ?client_id={}\
        &response_type=code\
        &redirect_uri={}\
        &scope=XboxLive.signin%20offline_access\
        &prompt=select_account",
        CLIENT_ID,
        urlencoding::encode(REDIRECT_URI)
    );

    open::that(url).map_err(|e| e.to_string())?;

    let code = loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let first_line = request.lines().next().unwrap_or("");

        if !first_line.contains("/callback") {
            let resp = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(resp.as_bytes()).await;
            continue;
        }

        if first_line.contains("error=") {
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(resp.as_bytes()).await;
            return Err("Microsoft returned an error in the OAuth callback".to_string());
        }

        let path = first_line.split_whitespace().nth(1).unwrap_or("");
        let query = path.split('?').nth(1).unwrap_or("");

        let code = query
            .split('&')
            .find_map(|pair| {
                let mut kv = pair.splitn(2, '=');
                let key = kv.next()?;
                let val = kv.next()?;
                if key == "code" {
                    decode(val).ok().map(|s| s.into_owned())
                } else {
                    None
                }
            });

        let body = include_str!("../commands/auth_success.html");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;

        match code {
            Some(c) if !c.is_empty() => break c,
            _ => return Err("Empty or missing OAuth code".to_string()),
        }
    };

    drop(listener);

    let (ms_access_token, ms_refresh_token) = exchange_code(&code).await
        .map_err(|e| format!("Error exchanging code: {}", e))?;

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let mc_token = mc_flow
        .exchange_microsoft_token(&ms_access_token)
        .await
        .map_err(|e| format!("Error getting Minecraft token: {}", e))?;

    let profile = get_minecraft_profile(mc_token.access_token().as_ref()).await
        .map_err(|e| format!("Error getting profile: {}", e))?;

    Ok(json!({
        "type": "microsoft",
        "minecraft": {
            "name": profile["name"],
            "uuid": profile["id"],
            "access_token": mc_token.access_token().as_ref(),
            "refresh_token": ms_refresh_token,
            "ms_access_token": ms_access_token
        }
    }))
}

#[command]
pub async fn refresh_microsoft_token(refresh_token: String) -> Result<Value, String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
        ("scope", "XboxLive.signin offline_access"),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!("Error refresh: {}", err));
    }

    let new_ms_access = json["access_token"]
        .as_str()
        .ok_or("No access_token")?
        .to_string();
    let new_ms_refresh = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token")?
        .to_string();

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let mc_token = mc_flow
        .exchange_microsoft_token(&new_ms_access)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "access_token": mc_token.access_token().as_ref(),
        "refresh_token": new_ms_refresh,
        "ms_access_token": new_ms_access
    }))
}

async fn exchange_code(code: &str) -> Result<(String, String), String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", REDIRECT_URI),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!(
            "MS token error: {} — {}",
            err,
            json.get("error_description").unwrap_or(&Value::Null)
        ));
    }

    let access_token = json["access_token"]
        .as_str()
        .ok_or("No access_token en respuesta")?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token en respuesta")?
        .to_string();

    Ok((access_token, refresh_token))
}

async fn get_minecraft_profile(access_token: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Error perfil: {}", response.status()));
    }

    let profile: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(profile)
}

#[command]
pub async fn login_offline(username: String) -> Result<Value, String> {
    let uuid = offline_uuid(&username);
    Ok(json!({
        "type": "offline",
        "minecraft": {
            "name": username,
            "uuid": uuid
        }
    }))
}

#[command]
pub fn logout() {
    println!("Sesion cerrada");
}