use tauri::command;
use serde_json::Value;

#[command]
pub async fn anyserver_get(path: String, query: Vec<(String, String)>) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let mut req = client.get(format!("https://anyserver.pro/api{}", path));
    if !query.is_empty() {
        req = req.query(&query);
    }
    
    let resp = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp)
}
