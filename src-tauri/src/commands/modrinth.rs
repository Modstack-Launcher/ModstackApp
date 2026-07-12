use futures::stream::{self, StreamExt};
use std::{fs, path::PathBuf};
use tauri::{command, AppHandle};

fn instances_root() -> PathBuf {
    crate::commands::config::get_install_dir_path().join("instances")
}

fn content_dir(instance_id: &str, project_type: &str) -> PathBuf {
    let subdir = match project_type {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    };
    instances_root().join(instance_id).join(subdir)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModIndex {
    pub slug: String,
    pub project_id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub download_url: String,
    pub icon_url: Option<String>,
}

pub fn index_dir(content_dir: &PathBuf) -> PathBuf {
    content_dir.join(".index")
}

pub fn read_mod_index(content_dir: &PathBuf, filename: &str) -> Option<ModIndex> {
    let path = index_dir(content_dir).join(format!("{}.json", filename));
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn write_mod_index(content_dir: &PathBuf, filename: &str, index: &ModIndex) {
    let dir = index_dir(content_dir);
    let _ = fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_string_pretty(index) {
        let _ = fs::write(dir.join(format!("{}.json", filename)), json);
    }
}

fn delete_mod_index(content_dir: &PathBuf, filename: &str) {
    let _ = fs::remove_file(index_dir(content_dir).join(format!("{}.json", filename)));
}

// One-time lazy migration: converts the old _slugs.json flat map to per-mod index files
fn migrate_slugs_to_index(dir: &PathBuf) {
    let slugs_path = dir.join("_slugs.json");
    if !slugs_path.exists() {
        return;
    }
    let map: std::collections::HashMap<String, String> = fs::read_to_string(&slugs_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for (filename, slug) in map {
        if read_mod_index(dir, &filename).is_none() {
            write_mod_index(
                dir,
                &filename,
                &ModIndex {
                    slug: slug.clone(),
                    project_id: String::new(),
                    name: slug.clone(),
                    version: String::new(),
                    source: "modrinth".to_string(),
                    download_url: String::new(),
                    icon_url: None,
                },
            );
        }
    }
    let _ = fs::remove_file(slugs_path);
}

#[command]
pub async fn download_mod(url: String, path: String) -> Result<String, String> {
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok("Downloaded".into())
}

#[command]
pub async fn modrinth_install(
    _app: AppHandle,
    instance_id: String,
    slug: String,
    project_type: String,
    game_version: String,
    loader: Option<String>,
    version_id: Option<String>,
) -> Result<InstalledMod, String> {
    let client = reqwest::Client::new();

    install_modrinth_mod(
        &client,
        &instance_id,
        &slug,
        &project_type,
        &game_version,
        &loader,
        version_id.as_deref(),
        &mut std::collections::HashSet::new(),
    )
    .await
}

async fn install_modrinth_mod(
    client: &reqwest::Client,
    instance_id: &str,
    slug: &str,
    project_type: &str,
    game_version: &str,
    loader: &Option<String>,
    version_id: Option<&str>,
    visited: &mut std::collections::HashSet<String>,
) -> Result<InstalledMod, String> {
    if visited.contains(slug) {
        return Err(format!("Circular dependency detected for '{}'", slug));
    }
    visited.insert(slug.to_string());

    let url = if let Some(vid) = version_id {
        format!("https://api.modrinth.com/v2/version/{}", vid)
    } else {
        let mut u = format!(
            "https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]",
            slug, game_version
        );
        if project_type == "mod" {
            if let Some(ref l) = loader {
                if !l.is_empty() {
                    u.push_str(&format!("&loaders=[\"{}\"]", l));
                }
            }
        }
        u
    };

    #[derive(serde::Deserialize)]
    struct MrDep {
        project_id: Option<String>,
        dependency_type: String,
    }
    #[derive(serde::Deserialize)]
    struct MrFile {
        url: String,
        filename: String,
        primary: bool,
    }
    #[derive(serde::Deserialize)]
    struct MrVersion {
        files: Vec<MrFile>,
        dependencies: Option<Vec<MrDep>>,
        version_number: String,
        #[allow(dead_code)]
        id: String,
    }

    let mut versions: Vec<MrVersion> = if version_id.is_some() {
        let single: MrVersion = client
            .get(&url)
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        vec![single]
    } else {
        client
            .get(&url)
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?
    };

    if versions.is_empty() && project_type == "mod" {
        let fallback = format!(
            "https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]",
            slug, game_version
        );
        versions = client
            .get(&fallback)
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
    }

    let version = versions
        .into_iter()
        .next()
        .ok_or_else(|| format!("No version of '{}' for MC {}", slug, game_version))?;

    let file = version
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| version.files.first())
        .ok_or("No files in this version")?;

    let dest_dir = content_dir(instance_id, project_type);
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| format!("Error creating directory: {}", e))?;

    let dest_path = dest_dir.join(&file.filename);
    if !dest_path.exists() {
        let bytes = client
            .get(&file.url)
            .header("User-Agent", "ModstackApp/1.0")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::write(&dest_path, &bytes)
            .await
            .map_err(|e| format!("Error saving file: {}", e))?;
    }

    #[derive(serde::Deserialize)]
    struct MrProject {
        id: String,
        title: String,
        icon_url: Option<String>,
    }
    let project: MrProject = client
        .get(format!("https://api.modrinth.com/v2/project/{}", slug))
        .header("User-Agent", "ModstackApp/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    write_mod_index(
        &dest_dir,
        &file.filename,
        &ModIndex {
            slug: slug.to_string(),
            project_id: project.id.clone(),
            name: project.title.clone(),
            version: version.version_number.clone(),
            source: "modrinth".to_string(),
            download_url: file.url.clone(),
            icon_url: project.icon_url.clone(),
        },
    );

    let installed = InstalledMod {
        id: slug.to_string(),
        name: project.title,
        author: String::new(),
        version: version.version_number,
        filename: file.filename.clone(),
        icon_url: project.icon_url,
        enabled: true,
        has_update: false,
        has_download: true,
    };

    if let Some(deps) = version.dependencies {
        for dep in deps {
            if dep.dependency_type == "required" {
                if let Some(dep_project_id) = dep.project_id {
                    Box::pin(install_modrinth_mod(
                        client,
                        instance_id,
                        &dep_project_id,
                        project_type,
                        game_version,
                        loader,
                        None,
                        visited,
                    ))
                    .await?;
                }
            }
        }
    }

    Ok(installed)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledMod {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub filename: String,
    pub icon_url: Option<String>,
    pub enabled: bool,
    pub has_update: bool,
    pub has_download: bool,
}

/// Lightweight alternative to get_installed_mods — reads only the .index/ directory
/// (small JSONs, no jar files) to return which slugs are installed.
/// Used by the mod browser to show "Installed" badges without freezing.
#[command]
pub fn get_installed_mod_slugs(instance_id: String, project_type: String) -> Vec<String> {
    let dir = content_dir(&instance_id, &project_type);
    let idx = index_dir(&dir);
    if !idx.exists() {
        return vec![];
    }
    fs::read_dir(&idx)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter_map(|e| {
            let s = fs::read_to_string(e.path()).ok()?;
            let idx: ModIndex = serde_json::from_str(&s).ok()?;
            if idx.slug.is_empty() {
                return None;
            }
            Some(idx.slug)
        })
        .collect()
}

#[command]
pub fn get_installed_mods(
    instance_id: String,
    project_type: String,
) -> Result<Vec<InstalledMod>, String> {
    let dir = content_dir(&instance_id, &project_type);
    if !dir.exists() {
        return Ok(vec![]);
    }

    migrate_slugs_to_index(&dir);

    let mut mods: Vec<InstalledMod> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".jar")
                || name.ends_with(".jar.disabled")
                || name.ends_with(".zip")
                || name.ends_with(".zip.disabled")
        })
        .map(|e| {
            let filename = e.file_name().to_string_lossy().to_string();
            let enabled = !filename.ends_with(".disabled");

            let clean = filename
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .trim_end_matches(".zip")
                .to_string();

            let meta = if filename.replace(".disabled", "").ends_with(".jar") {
                read_jar_meta(&e.path())
            } else {
                None
            };

            // Index files are stored by the base filename (without .disabled suffix)
            let index_key = filename.trim_end_matches(".disabled");
            let index = read_mod_index(&dir, index_key);

            let name = meta
                .as_ref()
                .and_then(|m| {
                    m.get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .or_else(|| {
                    index
                        .as_ref()
                        .filter(|i| !i.name.is_empty())
                        .map(|i| i.name.clone())
                })
                .unwrap_or_else(|| clean.split('-').next().unwrap_or(&clean).to_string());

            let version = meta
                .as_ref()
                .and_then(|m| {
                    m.get("version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .or_else(|| {
                    index
                        .as_ref()
                        .filter(|i| !i.version.is_empty())
                        .map(|i| i.version.clone())
                })
                .unwrap_or_default();

            let author = meta
                .as_ref()
                .and_then(|m| {
                    m.get("authors").and_then(|a| {
                        a.as_array()?.first().and_then(|v| {
                            v.as_str().map(|s| s.to_string()).or_else(|| {
                                v.get("name")
                                    .and_then(|n| n.as_str())
                                    .map(|s| s.to_string())
                            })
                        })
                    })
                })
                .unwrap_or_default();

            let id = index
                .as_ref()
                .map(|i| i.slug.clone())
                .unwrap_or_else(|| clean.clone());
            let has_download = index.is_some();
            let icon_url = index.as_ref().and_then(|i| i.icon_url.clone());

            InstalledMod {
                id,
                name,
                author,
                version,
                filename,
                icon_url,
                enabled,
                has_update: false,
                has_download,
            }
        })
        .collect();

    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(mods)
}

fn read_jar_meta(jar_path: &std::path::Path) -> Option<serde_json::Value> {
    use std::io::Read;
    // Open with a File so ZipArchive only reads the central directory (~50 KB),
    // not the entire jar (which can be 30-80 MB per mod).
    let file = std::fs::File::open(jar_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    for candidate in &["fabric.mod.json", "quilt.mod.json", "mcmod.info"] {
        if let Ok(mut entry) = archive.by_name(candidate) {
            let mut buf = String::new();
            if entry.read_to_string(&mut buf).is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
                    if let Some(arr) = v.as_array() {
                        return arr.first().cloned();
                    }
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Retroactively creates .index/ entries for mods that were installed before the index system.
/// Computes SHA512 of each unindexed jar, sends a batch lookup to Modrinth, and writes
/// the resulting index files. Safe to call repeatedly (skips already-indexed files).
#[command]
pub async fn reindex_instance_mods(
    instance_id: String,
    project_type: String,
) -> Result<(), String> {
    use sha2::{Digest, Sha512};

    let dir = content_dir(&instance_id, &project_type);
    if !dir.exists() {
        return Ok(());
    }

    // Collect files that don't yet have an index entry
    let unindexed: Vec<(String, std::path::PathBuf)> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let is_mod = name.ends_with(".jar")
                || name.ends_with(".jar.disabled")
                || name.ends_with(".zip")
                || name.ends_with(".zip.disabled");
            if !is_mod {
                return None;
            }
            let _clean = name
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .trim_end_matches(".zip")
                .to_string();
            // Use the actual filename (with extension, without .disabled) as the index key
            let key = name.trim_end_matches(".disabled").to_string();
            if read_mod_index(&dir, &key).is_some() {
                return None;
            }
            Some((key, e.path()))
        })
        .collect();

    if unindexed.is_empty() {
        return Ok(());
    }

    // Compute SHA512 for each unindexed file
    let mut hash_to_filename: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (filename, path) in &unindexed {
        if let Ok(bytes) = tokio::fs::read(path).await {
            let hash = hex::encode(Sha512::digest(&bytes));
            hash_to_filename.insert(hash, filename.clone());
        }
    }
    if hash_to_filename.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::new();

    // Batch hash lookup: POST /v2/version_files
    let hashes: Vec<&String> = hash_to_filename.keys().collect();
    let lookup_body = serde_json::json!({ "hashes": hashes, "algorithm": "sha512" });
    let version_map: serde_json::Value = match client
        .post("https://api.modrinth.com/v2/version_files")
        .header("User-Agent", "ModstackApp/1.0")
        .json(&lookup_body)
        .send()
        .await
    {
        Ok(r) => r
            .json()
            .await
            .unwrap_or(serde_json::Value::Object(Default::default())),
        Err(_) => return Ok(()), // silently skip if offline
    };

    // Collect unique project_ids from the version results
    let mut project_id_to_version: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    if let Some(map) = version_map.as_object() {
        for (_, ver) in map {
            if let Some(pid) = ver["project_id"].as_str() {
                project_id_to_version
                    .entry(pid.to_string())
                    .or_insert_with(|| ver.clone());
            }
        }
    }
    if project_id_to_version.is_empty() {
        return Ok(());
    }

    // Batch project lookup: GET /v2/projects?ids=[...]
    let ids_json = serde_json::to_string(&project_id_to_version.keys().collect::<Vec<_>>())
        .unwrap_or_default();
    let projects: Vec<serde_json::Value> = match client
        .get(format!(
            "https://api.modrinth.com/v2/projects?ids={}",
            ids_json
        ))
        .header("User-Agent", "ModstackApp/1.0")
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or_default(),
        Err(_) => return Ok(()),
    };

    let project_map: std::collections::HashMap<String, serde_json::Value> = projects
        .into_iter()
        .filter_map(|p| {
            let id = p["id"].as_str()?.to_string();
            Some((id, p))
        })
        .collect();

    // Write index entries
    if let Some(version_obj_map) = version_map.as_object() {
        for (hash, ver) in version_obj_map {
            let filename = match hash_to_filename.get(hash) {
                Some(f) => f,
                None => continue,
            };
            let project_id = match ver["project_id"].as_str() {
                Some(p) => p,
                None => continue,
            };
            let project = match project_map.get(project_id) {
                Some(p) => p,
                None => continue,
            };

            let slug = project["slug"].as_str().unwrap_or(project_id).to_string();
            let name = project["title"].as_str().unwrap_or(&slug).to_string();
            let icon_url = project["icon_url"].as_str().map(|s| s.to_string());
            let version = ver["version_number"].as_str().unwrap_or("").to_string();
            let dl_url = ver["files"]
                .as_array()
                .and_then(|f| {
                    f.iter()
                        .find(|f| f["primary"].as_bool().unwrap_or(false))
                        .or_else(|| f.first())
                })
                .and_then(|f| f["url"].as_str())
                .unwrap_or("")
                .to_string();

            write_mod_index(
                &dir,
                filename,
                &ModIndex {
                    slug,
                    project_id: project_id.to_string(),
                    name,
                    version,
                    source: "modrinth".to_string(),
                    download_url: dl_url,
                    icon_url,
                },
            );
        }
    }

    Ok(())
}

/// Checks which installed mods have a newer compatible version on Modrinth.
/// Returns a list of slugs that have updates available.
#[command]
pub async fn check_mod_updates(
    instance_id: String,
    project_type: String,
    game_version: String,
    loader: Option<String>,
) -> Result<Vec<String>, String> {
    let dir = content_dir(&instance_id, &project_type);
    if !dir.exists() {
        return Ok(vec![]);
    }

    // Collect all indexed mods that have a stored version to compare against
    let idx_dir = index_dir(&dir);
    if !idx_dir.exists() {
        return Ok(vec![]);
    }

    let entries: Vec<ModIndex> = fs::read_dir(&idx_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") {
                return None;
            }
            fs::read_to_string(e.path())
                .ok()
                .and_then(|s| serde_json::from_str::<ModIndex>(&s).ok())
        })
        .filter(|idx| !idx.slug.is_empty() && !idx.version.is_empty())
        .collect();

    if entries.is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::Client::new();

    let outdated: Vec<String> = stream::iter(entries)
        .map(|idx| {
            let client = client.clone();
            let game_version = game_version.clone();
            let loader = loader.clone();
            async move {
                let mut params = format!("game_versions=[\"{}\"]&limit=1", game_version);
                if let Some(ref l) = loader {
                    params.push_str(&format!("&loaders=[\"{}\"]", l));
                }
                let url = format!(
                    "https://api.modrinth.com/v2/project/{}/version?{}",
                    idx.slug, params
                );
                let versions: Option<Vec<serde_json::Value>> = async {
                    let resp = client
                        .get(&url)
                        .header("User-Agent", "ModstackApp/1.0")
                        .send()
                        .await
                        .ok()?;
                    resp.json::<Vec<serde_json::Value>>().await.ok()
                }
                .await;

                let latest_ver = versions
                    .as_ref()
                    .and_then(|v| v.first())
                    .and_then(|v| v["version_number"].as_str())
                    .unwrap_or("")
                    .to_string();

                if !latest_ver.is_empty() && latest_ver != idx.version {
                    Some(idx.slug)
                } else {
                    None
                }
            }
        })
        .buffer_unordered(8)
        .filter_map(|opt| async move { opt })
        .collect()
        .await;

    Ok(outdated)
}

#[command]
pub fn toggle_mod(instance_id: String, filename: String, enabled: bool) -> Result<(), String> {
    for subdir in &["mods", "resourcepacks", "shaderpacks", "datapacks"] {
        let base = instances_root().join(&instance_id).join(subdir);
        if !base.exists() {
            continue;
        }

        let clean_filename = filename.trim_end_matches(".disabled").to_string();

        let on = base.join(&clean_filename);
        let off = base.join(format!("{}.disabled", clean_filename));

        if enabled && off.exists() {
            fs::rename(&off, &on).map_err(|e| e.to_string())?;
            return Ok(());
        }
        if enabled && on.exists() {
            return Ok(());
        }
        if !enabled && on.exists() {
            fs::rename(&on, &off).map_err(|e| e.to_string())?;
            return Ok(());
        }
        if !enabled && off.exists() {
            return Ok(());
        }
    }
    Err(format!("File '{}' not found", filename))
}

#[command]
pub fn delete_mod(instance_id: String, filename: String) -> Result<(), String> {
    for subdir in &["mods", "resourcepacks", "shaderpacks", "datapacks"] {
        let base = instances_root().join(&instance_id).join(subdir);
        let clean_filename = filename.trim_end_matches(".disabled").to_string();
        let on = base.join(&clean_filename);
        let off = base.join(format!("{}.disabled", clean_filename));
        if on.exists() {
            fs::remove_file(&on).map_err(|e| e.to_string())?;
            delete_mod_index(&base, &clean_filename);
            return Ok(());
        }
        if off.exists() {
            fs::remove_file(&off).map_err(|e| e.to_string())?;
            delete_mod_index(&base, &clean_filename);
            return Ok(());
        }
    }
    Err(format!("File '{}' not found", filename))
}

#[command]
pub async fn curseforge_install(
    instance_id: String,
    mod_id: String,
    project_type: String,
    game_version: String,
) -> Result<(), String> {
    const CF_API_KEY: &str = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";

    let client = reqwest::Client::new();

    let files_url = format!(
        "https://api.curseforge.com/v1/mods/{}/files?gameVersion={}&pageSize=10",
        mod_id, game_version
    );

    let resp: serde_json::Value = client
        .get(&files_url)
        .header("x-api-key", CF_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| format!("Error parsing files response: {}", e))?;

    let file = resp["data"]
        .as_array()
        .and_then(|arr| arr.first())
        .ok_or("No files found for this mod and game version")?;

    let file_id = file["id"].as_u64().ok_or("Invalid file ID")?;
    let filename = file["fileName"]
        .as_str()
        .ok_or("Invalid filename")?
        .to_string();

    let dl_url = if let Some(url) = file["downloadUrl"].as_str() {
        url.to_string()
    } else {
        let id_str = file_id.to_string();
        let (part1, part2) = id_str.split_at(id_str.len().saturating_sub(3));
        format!(
            "https://edge.forgecdn.net/files/{}/{}/{}",
            part1,
            part2.parse::<u32>().unwrap_or(0),
            filename
        )
    };

    let dest_dir: PathBuf = content_dir(&instance_id, &project_type);
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| e.to_string())?;

    let dest_path = dest_dir.join(&filename);
    if dest_path.exists() {
        return Ok(());
    }

    let bytes = client
        .get(&dl_url)
        .header("x-api-key", CF_API_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
