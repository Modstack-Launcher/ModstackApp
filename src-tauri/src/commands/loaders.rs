//! Lists the loader builds (Fabric, Quilt, Forge, NeoForge) available for a Minecraft
//! version, so an instance can be pinned to a specific loader build instead of
//! always resolving "latest" at launch time.
//!
//! Fetched from Rust (not the webview) to avoid CORS issues with the loader mavens.

use serde::Serialize;
use std::cmp::Ordering;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderBuildInfo {
    /// Exactly what the launcher core expects as `LoaderConfig::build`.
    pub id: String,
    pub stable: bool,
    pub recommended: bool,
    pub latest: bool,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("ModstackApp (loader-versions)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

async fn get_text(url: &str) -> Result<String, String> {
    let response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} ({url})", response.status()));
    }
    response.text().await.map_err(|e| e.to_string())
}

fn maven_versions(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|chunk| chunk.split("</version>").next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

/// Compares dotted versions numerically ("47.10.0" > "47.9.3"); suffixes like
/// "-beta" sort below the plain release.
fn compare_versions(a: &str, b: &str) -> Ordering {
    let split = |value: &str| -> (Vec<u64>, bool) {
        let (numbers, suffix) = match value.split_once('-') {
            Some((numbers, suffix)) => (numbers, !suffix.is_empty()),
            None => (value, false),
        };
        (
            numbers
                .split('.')
                .map(|part| part.parse::<u64>().unwrap_or(0))
                .collect(),
            suffix,
        )
    };
    let (a_parts, a_suffix) = split(a);
    let (b_parts, b_suffix) = split(b);
    for index in 0..a_parts.len().max(b_parts.len()) {
        let left = a_parts.get(index).copied().unwrap_or(0);
        let right = b_parts.get(index).copied().unwrap_or(0);
        match left.cmp(&right) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    // "1.0.0" > "1.0.0-beta"
    b_suffix.cmp(&a_suffix)
}

fn is_unstable(version: &str) -> bool {
    let lower = version.to_lowercase();
    ["beta", "alpha", "snapshot", "-pre", "-rc"]
        .iter()
        .any(|tag| lower.contains(tag))
}

/// Mirrors the launcher core: "1.20.4" -> "20.4.", "1.21" -> "21.0.", "26.1.2" -> "26.1.".
fn neoforge_prefix(mc_version: &str) -> String {
    let parts: Vec<&str> = mc_version.splitn(3, '.').collect();
    let major = parts.first().copied().unwrap_or("1");
    let minor = parts.get(1).copied().unwrap_or("0");
    let patch = parts.get(2).copied().unwrap_or("0");
    if major == "1" {
        format!("{minor}.{patch}.")
    } else {
        format!("{major}.{minor}.")
    }
}

fn finalize(mut builds: Vec<LoaderBuildInfo>, sort_by_id_tail: Option<&str>) -> Vec<LoaderBuildInfo> {
    if let Some(prefix) = sort_by_id_tail {
        builds.sort_by(|a, b| {
            compare_versions(
                b.id.strip_prefix(prefix).unwrap_or(&b.id),
                a.id.strip_prefix(prefix).unwrap_or(&a.id),
            )
        });
    }
    let mut seen = std::collections::HashSet::new();
    builds.retain(|build| seen.insert(build.id.clone()));
    if let Some(first) = builds.first_mut() {
        first.latest = true;
    }
    if !builds.iter().any(|build| build.recommended) {
        if let Some(stable) = builds.iter_mut().find(|build| build.stable) {
            stable.recommended = true;
        } else if let Some(first) = builds.first_mut() {
            first.recommended = true;
        }
    }
    builds
}

async fn fabric_like(root: &str, mc_version: &str) -> Result<Vec<LoaderBuildInfo>, String> {
    let text = get_text(&format!(
        "{root}/versions/loader/{}",
        urlencoding::encode(mc_version)
    ))
    .await?;
    let items: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let builds = items
        .iter()
        .filter_map(|item| {
            let id = item["loader"]["version"].as_str()?.to_string();
            let stable = item["loader"]["stable"]
                .as_bool()
                .unwrap_or_else(|| !is_unstable(&id));
            Some(LoaderBuildInfo {
                id,
                stable,
                recommended: false,
                latest: false,
            })
        })
        .collect();
    // Fabric/Quilt meta already returns newest first.
    Ok(finalize(builds, None))
}

async fn forge(mc_version: &str) -> Result<Vec<LoaderBuildInfo>, String> {
    let xml = get_text("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml").await?;
    let prefix = format!("{mc_version}-");
    let promos: serde_json::Value = get_text(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
    )
    .await
    .ok()
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_default();
    let recommended = promos["promos"][format!("{mc_version}-recommended")]
        .as_str()
        .map(|build| format!("{mc_version}-{build}"));

    let builds = maven_versions(&xml)
        .into_iter()
        // Old versions carry a "-<mc>" suffix ("1.12.2-14.23.5.2860"); keep the id as
        // published, which is what the installer download expects.
        .filter(|id| id.starts_with(&prefix))
        .map(|id| LoaderBuildInfo {
            recommended: recommended
                .as_deref()
                .is_some_and(|rec| id == rec || id.starts_with(&format!("{rec}-"))),
            stable: true,
            latest: false,
            id,
        })
        .collect();
    Ok(finalize(builds, Some(&prefix)))
}

async fn neoforge(mc_version: &str) -> Result<Vec<LoaderBuildInfo>, String> {
    if mc_version == "1.20.1" {
        // 1.20.1 NeoForge was published under the old "forge" artifact.
        let xml = get_text("https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml").await?;
        let prefix = format!("{mc_version}-");
        let builds = maven_versions(&xml)
            .into_iter()
            .filter(|id| id.starts_with(&prefix))
            .map(|id| LoaderBuildInfo {
                stable: !is_unstable(&id),
                recommended: false,
                latest: false,
                id,
            })
            .collect();
        return Ok(finalize(builds, Some(&prefix)));
    }
    let xml = get_text("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml").await?;
    let prefix = neoforge_prefix(mc_version);
    let builds = maven_versions(&xml)
        .into_iter()
        .filter(|id| id.starts_with(&prefix))
        .map(|id| LoaderBuildInfo {
            stable: !is_unstable(&id),
            recommended: false,
            latest: false,
            id,
        })
        .collect();
    Ok(finalize(builds, Some("")))
}

#[tauri::command]
pub async fn get_loader_versions(
    loader: String,
    game_version: String,
) -> Result<Vec<LoaderBuildInfo>, String> {
    let game_version = game_version.trim();
    if game_version.is_empty() {
        return Ok(Vec::new());
    }
    match loader.to_lowercase().as_str() {
        "fabric" => fabric_like("https://meta.fabricmc.net/v2", game_version).await,
        "quilt" => fabric_like("https://meta.quiltmc.org/v3", game_version).await,
        "legacyfabric" | "legacy_fabric" => {
            fabric_like("https://meta.legacyfabric.net/v2", game_version).await
        }
        "forge" => forge(game_version).await,
        "neoforge" => neoforge(game_version).await,
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_version_order() {
        assert_eq!(compare_versions("47.10.0", "47.9.3"), Ordering::Greater);
        assert_eq!(compare_versions("21.1.0", "21.1.0-beta"), Ordering::Greater);
        assert_eq!(compare_versions("20.4.1", "20.4.1"), Ordering::Equal);
    }

    #[test]
    fn neoforge_prefixes() {
        assert_eq!(neoforge_prefix("1.21"), "21.0.");
        assert_eq!(neoforge_prefix("1.21.1"), "21.1.");
        assert_eq!(neoforge_prefix("26.1.2"), "26.1.");
    }

    #[test]
    fn maven_parsing() {
        let xml = "<versions><version>1.20.1-47.1.0</version><version>1.20.1-47.2.0</version></versions>";
        assert_eq!(maven_versions(xml), vec!["1.20.1-47.1.0", "1.20.1-47.2.0"]);
    }
}
