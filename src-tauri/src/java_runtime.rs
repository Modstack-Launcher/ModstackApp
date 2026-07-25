use futures_util::StreamExt;
use std::fs::{self, File};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

macro_rules! jlog {
    ($app:expr, $log_id:expr, $version:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $app.emit("java-log", serde_json::json!({
            "version": $version,
            "message": msg
        })).ok();
    }};
}

pub fn get_installed_java_version(runtime_path: &Path) -> u32 {
    let java_exe = runtime_path
        .join("bin")
        .join(if cfg!(windows) { "java.exe" } else { "java" });

    if !is_complete_java_runtime(runtime_path) {
        return 0;
    }

    if !java_exe.exists() {
        return 0;
    }

    let mut cmd = Command::new(&java_exe);
    cmd.arg("-version");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return 0,
    };

    let text = String::from_utf8_lossy(&output.stderr).to_string()
        + &String::from_utf8_lossy(&output.stdout);

    for line in text.lines() {
        if line.contains("version") {
            if let Some(start) = line.find('"') {
                let rest = &line[start + 1..];
                if let Some(end) = rest.find('"') {
                    let ver_str = &rest[..end];
                    let first = ver_str.split('.').next().unwrap_or("0");
                    if first == "1" {
                        let second = ver_str.split('.').nth(1).unwrap_or("0");
                        return second.parse().unwrap_or(0);
                    }
                    return first.parse().unwrap_or(0);
                }
            }
        }
    }
    0
}

fn java_platform_dir() -> &'static str {
    if cfg!(windows) {
        "windows-x64"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "unknown"
    }
}

pub fn default_java_runtime_path(runtime_base: &Path, java_version: u32) -> PathBuf {
    runtime_base
        .join(format!("jre-{}", java_version))
        .join(java_platform_dir())
}

pub fn is_complete_java_runtime(runtime_path: &Path) -> bool {
    let java_bin = runtime_path.join("bin");
    let java_exe = java_bin.join(if cfg!(windows) { "java.exe" } else { "java" });
    if !java_exe.exists() {
        return false;
    }

    #[cfg(windows)]
    {
        java_bin.join("server").join("jvm.dll").exists()
    }

    #[cfg(not(windows))]
    {
        true
    }
}

pub fn repair_mojang_runtime_cache(runtime_base: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !runtime_base.exists() {
        return Ok(());
    }

    for component in fs::read_dir(runtime_base)? {
        let component = component?;
        let component_path = component.path();
        if !component_path.is_dir() {
            continue;
        }
        let Some(name) = component_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("jre-") && !name.starts_with("java-runtime-") {
            continue;
        }

        for platform in fs::read_dir(&component_path)? {
            let platform = platform?;
            let runtime_path = platform.path();
            if !runtime_path.is_dir() {
                continue;
            }

            #[cfg(windows)]
            {
                let server_dir = runtime_path.join("bin").join("server");
                let jvm = server_dir.join("jvm.dll");
                let tmp = server_dir.join("jvm.dll.tmp");
                if !jvm.exists() && tmp.exists() {
                    fs::rename(&tmp, &jvm).or_else(|_| {
                        fs::copy(&tmp, &jvm)?;
                        fs::remove_file(&tmp)
                    })?;
                }
            }

            if !is_complete_java_runtime(&runtime_path) {
                fs::remove_dir_all(&runtime_path)?;
            }
        }
    }

    Ok(())
}

pub async fn ensure_java(
    runtime_base: &Path,
    java_version: u32,
    app: &AppHandle,
    _log_id: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let runtime_path = default_java_runtime_path(runtime_base, java_version);

    let installed = get_installed_java_version(&runtime_path);
    if installed >= java_version {
        jlog!(
            app,
            log_id,
            java_version,
            "Java {} already installed (detected: {})",
            java_version,
            installed
        );
        return Ok(runtime_path);
    }

    jlog!(
        app,
        log_id,
        java_version,
        "Java {} not found (detected: {}), downloading...",
        java_version,
        installed
    );

    if runtime_path.exists() {
        fs::remove_dir_all(&runtime_path)?;
    }
    fs::create_dir_all(&runtime_path)?;

    app.emit(
        "java-download-start",
        serde_json::json!({ "version": java_version }),
    )
    .ok();

    let (url, is_zip) = if cfg!(windows) {
        (
            format!(
                "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse",
                java_version
            ),
            true,
        )
    } else if cfg!(target_os = "linux") {
        (
            format!(
                "https://api.adoptium.net/v3/binary/latest/{}/ga/linux/x64/jre/hotspot/normal/eclipse",
                java_version
            ),
            false,
        )
    } else if cfg!(target_os = "macos") {
        (
            format!(
                "https://api.adoptium.net/v3/binary/latest/{}/ga/mac/aarch64/jre/hotspot/normal/eclipse",
                java_version
            ),
            false,
        )
    } else {
        return Err("Unsupported OS".into());
    };

    jlog!(
        app,
        log_id,
        java_version,
        "Downloading Java {} from: {}",
        java_version,
        url
    );

    let response = reqwest::get(&url).await?;

    if !response.status().is_success() {
        return Err(format!(
            "Error downloading Java {}: HTTP {}",
            java_version,
            response.status()
        )
        .into());
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut bytes: Vec<u8> = Vec::new();
    let mut downloaded = 0u64;
    let mut last_reported = -1i32;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);

        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64) * 100.0;
            let step = (progress as i32 / 5) * 5;
            if step > last_reported {
                last_reported = step;
                jlog!(
                    app,
                    log_id,
                    java_version,
                    "Downloading Java {}: {}%",
                    java_version,
                    step
                );
                app.emit(
                    "java-download-progress",
                    serde_json::json!({
                        "version": java_version,
                        "percent": step,
                        "status": format!("Downloading...")
                    }),
                )
                .ok();
            }
        }
    }

    jlog!(
        app,
        log_id,
        java_version,
        "Download complete ({} bytes), extracting...",
        bytes.len()
    );
    app.emit(
        "java-download-progress",
        serde_json::json!({
            "version": java_version,
            "percent": 100,
            "status": "Extracting..."
        }),
    )
    .ok();

    if is_zip {
        extract_zip(&bytes, &runtime_path)?;
    } else {
        extract_tar_gz(&bytes, &runtime_path)?;
    }

    jlog!(app, log_id, java_version, "Adjusting folder structure...");
    fix_java_folder(&runtime_path)?;

    let final_version = get_installed_java_version(&runtime_path);
    if final_version == 0 {
        return Err(format!(
            "Java {} was extracted but cannot be executed. Check folder: {:?}",
            java_version, runtime_path
        )
        .into());
    }

    jlog!(
        app,
        log_id,
        java_version,
        "Java {} installed OK (detected version: {})",
        java_version,
        final_version
    );
    app.emit(
        "java-download-done",
        serde_json::json!({ "version": java_version }),
    )
    .ok();

    Ok(runtime_path)
}

fn extract_zip(data: &[u8], output: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use flate2::read::GzDecoder;
    if data.len() >= 2 && &data[0..2] == b"PK" {
        let reader = Cursor::new(data);
        let mut archive = zip::ZipArchive::new(reader)?;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let outpath = output.join(file.name());
            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    fs::create_dir_all(p)?;
                }
                let mut outfile = File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }
        }
        return Ok(());
    }

    if data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b {
        let cursor = Cursor::new(data);
        let decoder = GzDecoder::new(cursor);
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(output)?;
        return Ok(());
    }

    Err("Unknown file format: not zip or tar.gz".into())
}

fn extract_tar_gz(data: &[u8], output: &Path) -> Result<(), Box<dyn std::error::Error>> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let gz = GzDecoder::new(Cursor::new(data));
    let mut archive = Archive::new(gz);
    archive.set_preserve_permissions(true);
    archive.unpack(output)?;
    Ok(())
}

fn fix_java_folder(runtime_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let entries: Vec<_> = fs::read_dir(runtime_path)?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();

    if entries.len() == 1 {
        let inner = entries[0].path();
        let inner_bin = inner.join("bin");

        if inner_bin.exists() {
            for item in fs::read_dir(&inner)? {
                let item = item?;
                let from = item.path();
                let to = runtime_path.join(item.file_name());

                if to.exists() {
                    if to.is_dir() {
                        fs::remove_dir_all(&to)?;
                    } else {
                        fs::remove_file(&to)?;
                    }
                }
                fs::rename(&from, &to)?;
            }
            fs::remove_dir_all(&inner)?;
        }
    }

    Ok(())
}
