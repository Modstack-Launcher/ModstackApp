use serde_json::Value;
use tauri::command;

#[command]
pub async fn get_news() -> Result<Vec<Value>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://fitzxel-cl-api.vercel.app/v2/modstack/news")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Vec<Value>>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp)
}
