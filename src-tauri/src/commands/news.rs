use serde_json::Value;
use std::time::Duration;
use tauri::command;

/// News sources, tried in order. The first is the public Modstack website
/// (proxied to ModstackAPI); the second is the ModstackAPI deployment itself.
const NEWS_SOURCES: [&str; 2] = [
    "https://www.modstack.online/api/news",
    "https://modstack-api.vercel.app/api/news",
];

async fn fetch_news(client: &reqwest::Client, url: &str) -> Result<Vec<Value>, String> {
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} ({url})", response.status()));
    }
    response.json::<Vec<Value>>().await.map_err(|e| e.to_string())
}

#[command]
pub async fn get_news() -> Result<Vec<Value>, String> {
    let client = reqwest::Client::builder()
        .user_agent("ModstackApp (news)")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_error = String::from("No news source available");
    for url in NEWS_SOURCES {
        match fetch_news(&client, url).await {
            Ok(news) => return Ok(news),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}
