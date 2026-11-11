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
        version_id: Option<String>,
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

    let dest_dir = content_dir(instance_id, project_type);
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| format!("Error creating directory: {}", e))?;

    // A project can be required by several selected mods. Its dependency
    // versions may have different filenames, so filename-only checks create
    // duplicate jars. Reuse the existing project entry, upgrading it only
    // when the resolved dependency version is newer.
    let index_dir = index_dir(&dest_dir);
    let mut previous: Option<(String, ModIndex)> = None;
    if let Ok(entries) = fs::read_dir(&index_dir) {
        for entry in entries.flatten() {
            let Ok(raw) = fs::read_to_string(entry.path()) else { continue };
            let Ok(index) = serde_json::from_str::<ModIndex>(&raw) else { continue };
            if index.project_id == project.id || index.slug.eq_ignore_ascii_case(slug) {
                previous = Some((entry.file_name().to_string_lossy().trim_end_matches(".json").to_string(), index));
                break;
            }
        }
    }
    let version_parts = |value: &str| -> Vec<u64> {
        value.split(|ch: char| !ch.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    if let Some((old_filename, old_index)) = &previous {
        let is_newer = version_parts(&version.version_number) > version_parts(&old_index.version);
        if !is_newer || old_index.version == version.version_number {
            return Ok(InstalledMod {
                id: slug.to_string(), name: old_index.name.clone(), author: String::new(),
                version: old_index.version.clone(), filename: old_filename.clone(),
                icon_url: old_index.icon_url.clone(), enabled: true, has_update: false, has_download: true, installed_at: 0,
                download_url: Some(old_index.download_url.clone()),
            });
        }
    }

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

    if let Some((old_filename, _)) = previous {
        if old_filename != file.filename {
            let _ = fs::remove_file(dest_dir.join(&old_filename));
            delete_mod_index(&dest_dir, &old_filename);
        }
    }

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
        installed_at: 0,
        download_url: Some(file.url.clone()),
    };

    if let Some(deps) = version.dependencies {
        for dep in deps {
            if dep.dependency_type == "required" {
                if let Some(dep_project_id) = dep.project_id {
                    // A dependency shared by sibling mods is not a cycle. Track
                    // visited projects per branch and skip real back-edges.
                    if visited.contains(&dep_project_id) {
                        continue;
                    }
                    let mut dependency_path = visited.clone();
                    Box::pin(install_modrinth_mod(
                        client,
                        instance_id,
                        &dep_project_id,
                        project_type,
                        game_version,
                        loader,
                        dep.version_id.as_deref(),
                        &mut dependency_path,
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
    #[serde(default)]
    pub installed_at: u64,
    #[serde(default)]
    pub download_url: Option<String>,
}

/// Lightweight alternative to get_installed_mods — reads only the .index/ directory
/// (small JSONs, no jar files) to return which slugs are installed.
/// Used by the mod browser to show "Installed" badges without freezing.
#[command(async)]
pub fn get_installed_mod_slugs(instance_id: String, project_type: String) -> Vec<String> {
    let dir = content_dir(&instance_id, &project_type);
    let mut slugs = std::collections::HashSet::new();
    let mut installed_files = std::collections::HashSet::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten().filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false)) {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            if filename.ends_with(".jar") || filename.ends_with(".jar.disabled") || filename.ends_with(".zip") || filename.ends_with(".zip.disabled") {
                installed_files.insert(filename.trim_end_matches(".disabled").to_string());
            }
        }
    }

    if let Ok(data) = fs::read_to_string(dir.join("_slugs.json")) {
        if let Ok(legacy) = serde_json::from_str::<std::collections::HashMap<String, String>>(&data) {
            slugs.extend(legacy.into_iter()
                .filter(|(filename, _)| installed_files.contains(&filename.to_lowercase()))
                .map(|(_, slug)| slug.trim().to_lowercase())
                .filter(|slug| !slug.is_empty()));
        }
    }

    let idx = index_dir(&dir);
    if let Ok(entries) = fs::read_dir(&idx) {
        for entry in entries.flatten().filter(|entry| entry.file_name().to_string_lossy().ends_with(".json")) {
            let index_filename = entry.path().file_stem().and_then(|name| name.to_str()).unwrap_or("").to_lowercase();
            if !installed_files.contains(&index_filename) {
                continue;
            }
            let Some(index) = fs::read_to_string(entry.path())
                .ok()
                .and_then(|data| serde_json::from_str::<ModIndex>(&data).ok())
            else {
                continue;
            };
            let slug = index.slug.trim().to_lowercase();
            if !slug.is_empty() {
                slugs.insert(slug);
            }
            let project_id = index.project_id.trim().to_lowercase();
            if !project_id.is_empty() {
                slugs.insert(project_id);
            }
        }
    }

    // Include filenames as a fallback for older manually copied mods that predate
    // the launcher index. The lookup remains local to this instance and avoids jar reads.
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten().filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false)) {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            let clean = filename
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .trim_end_matches(".zip");
            if clean != filename && !clean.is_empty() {
                slugs.insert(clean.to_string());
            }
        }
    }

    slugs.into_iter().collect()
}

/// Returns indexed project slugs from every local instance. The store uses this
/// lightweight index scan to mark content installed without opening each archive.
#[command(async)]
pub fn get_all_installed_mod_slugs(project_type: String) -> Vec<String> {
    let root = instances_root();
    let mut slugs = std::collections::HashSet::new();
    let Ok(instances) = fs::read_dir(root) else {
        return Vec::new();
    };

    for instance in instances.flatten().filter(|entry| entry.path().is_dir()) {
        let instance_id = instance.file_name().to_string_lossy().into_owned();
        let dir = content_dir(&instance_id, &project_type);

        // Include the legacy flat index until the instance's next normal migration.
        if let Ok(data) = fs::read_to_string(dir.join("_slugs.json")) {
            if let Ok(legacy) = serde_json::from_str::<std::collections::HashMap<String, String>>(&data) {
                slugs.extend(legacy.into_values().map(|slug| slug.trim().to_lowercase()).filter(|slug| !slug.is_empty()));
            }
        }

        let idx = index_dir(&dir);
        let Ok(entries) = fs::read_dir(idx) else {
            continue;
        };

        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().ends_with(".json") {
                continue;
            }
            let Some(slug) = fs::read_to_string(entry.path())
                .ok()
                .and_then(|data| serde_json::from_str::<ModIndex>(&data).ok())
                .map(|index| index.slug.trim().to_lowercase())
                .filter(|slug| !slug.is_empty())
            else {
                continue;
            };
            slugs.insert(slug);
        }
    }

    let mut result: Vec<_> = slugs.into_iter().collect();
    result.sort_unstable();
    result
}

#[command(async)]
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
            let installed_at = e.metadata().ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let filename = e.file_name().to_string_lossy().to_string();
            let enabled = !filename.ends_with(".disabled");

            let clean = filename
                .trim_end_matches(".disabled")
                .trim_end_matches(".jar")
                .trim_end_matches(".zip")
                .to_string();

            // Index files are stored by the base filename (without .disabled suffix)
            let index_key = filename.trim_end_matches(".disabled");
            let index = read_mod_index(&dir, index_key);

            // Keep this list operation to directory and small index reads. Opening
            // each unindexed archive to inspect its manifest made large modpacks wait
            // on hundreds of sequential ZIP opens. Reindexing fills richer data later.
            let name = index
                .as_ref()
                .filter(|i| !i.name.is_empty())
                .map(|i| i.name.clone())
                .unwrap_or_else(|| clean.split('-').next().unwrap_or(&clean).to_string());

            let version = index
                .as_ref()
                .filter(|i| !i.version.is_empty())
                .map(|i| i.version.clone())
                .unwrap_or_default();

            let author = String::new();

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
                installed_at,
                download_url: index.as_ref().map(|item| item.download_url.clone()).filter(|url| !url.is_empty()),
            }
        })
        .collect();

    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(mods)
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

    // Compute SHA512 for each unindexed file. Large modpacks have hundreds of
    // jars, so hash them on several blocking threads instead of one by one.
    let hash_to_filename: std::collections::HashMap<String, String> =
        tauri::async_runtime::spawn_blocking(move || {
            let threads = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .clamp(1, 8);
            let chunk_size = unindexed.len().div_ceil(threads).max(1);
            std::thread::scope(|scope| {
                let handles: Vec<_> = unindexed
                    .chunks(chunk_size)
                    .map(|chunk| {
                        scope.spawn(move || {
                            chunk
                                .iter()
                                .filter_map(|(filename, path)| {
                                    let bytes = fs::read(path).ok()?;
                                    Some((hex::encode(Sha512::digest(&bytes)), filename.clone()))
                                })
                                .collect::<Vec<_>>()
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .flat_map(|handle| handle.join().unwrap_or_default())
                    .collect()
            })
        })
        .await
        .map_err(|e| e.to_string())?;
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

#[command(async)]
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

#[command(async)]
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
    let client = reqwest::Client::new();
    install_curseforge_mod(
        &client,
        &instance_id,
        &mod_id,
        &project_type,
        &game_version,
        None,
        &mut std::collections::HashSet::new(),
    )
    .await
}

async fn install_curseforge_mod(
    client: &reqwest::Client,
    instance_id: &str,
    mod_id: &str,
    project_type: &str,
    game_version: &str,
    file_id: Option<u64>,
    visited: &mut std::collections::HashSet<String>,
) -> Result<(), String> {
    const CF_API_KEY: &str = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";

    if !visited.insert(mod_id.to_string()) {
        return Ok(());
    }

    let file: serde_json::Value = if let Some(file_id) = file_id {
        client
            .get(format!("https://api.curseforge.com/v1/mods/{}/files/{}", mod_id, file_id))
            .header("x-api-key", CF_API_KEY)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Error parsing dependency file: {}", e))?["data"]
            .clone()
    } else {
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
        resp["data"]
            .as_array()
            .and_then(|arr| arr.first())
            .cloned()
            .ok_or("No files found for this mod and game version")?
    };

    let installed_file_id = file["id"].as_u64().ok_or("Invalid file ID")?;
    let filename = file["fileName"]
        .as_str()
        .ok_or("Invalid filename")?
        .to_string();

    let dl_url = if let Some(url) = file["downloadUrl"].as_str() {
        url.to_string()
    } else {
        let id_str = installed_file_id.to_string();
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
    if !dest_path.exists() {
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
    }

    // Store CurseForge IDs in the same lightweight index so the store can mark
    // installed projects across instances without scanning their archive files.
    write_mod_index(
        &dest_dir,
        &filename,
        &ModIndex {
            slug: mod_id.to_string(),
            project_id: mod_id.to_string(),
            name: filename
                .trim_end_matches(".jar")
                .trim_end_matches(".zip")
                .to_string(),
            version: file["displayName"].as_str().unwrap_or_default().to_string(),
            source: "curseforge".to_string(),
            download_url: dl_url,
            icon_url: None,
        },
    );

    // CurseForge marks required dependencies as relation type 3 and may pin
    // them to a specific file. Install those first, branch-locally so shared
    // dependencies are not mistaken for circular references.
    if let Some(dependencies) = file["dependencies"].as_array() {
        for dependency in dependencies {
            if dependency["relationType"].as_u64() != Some(3) {
                continue;
            }
            let Some(dependency_mod_id) = dependency["modId"].as_u64() else {
                continue;
            };
            let dependency_mod_id = dependency_mod_id.to_string();
            if visited.contains(&dependency_mod_id) {
                continue;
            }
            let mut dependency_path = visited.clone();
            Box::pin(install_curseforge_mod(
                client,
                instance_id,
                &dependency_mod_id,
                project_type,
                game_version,
                dependency["fileId"].as_u64(),
                &mut dependency_path,
            ))
            .await?;
        }
    }

    Ok(())
}
