use std::fs::{self, File};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use futures_util::StreamExt;
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
    let java_exe = runtime_path.join("bin").join(if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    });

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

pub async fn ensure_java(
    runtime_base: &Path,
    java_version: u32,
    app: &AppHandle,
    _log_id: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let runtime_path = runtime_base.join(format!("java{}", java_version));

    let installed = get_installed_java_version(&runtime_path);
    if installed >= java_version {
        jlog!(app, log_id, java_version, "Java {} already installed (detected: {})", java_version, installed);
        return Ok(runtime_path);
    }

    jlog!(app, log_id, java_version, "Java {} not found (detected: {}), downloading...", java_version, installed);

    if runtime_path.exists() {
        fs::remove_dir_all(&runtime_path)?;
    }
    fs::create_dir_all(&runtime_path)?;

    app.emit("java-download-start", serde_json::json!({ "version": java_version })).ok();

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

    jlog!(app, log_id, java_version, "Downloading Java {} from: {}", java_version, url);

    let response = reqwest::get(&url).await?;

    if !response.status().is_success() {
        return Err(format!(
            "Error downloading Java {}: HTTP {}",
            java_version,
            response.status()
        ).into());
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
                jlog!(app, log_id, java_version, "Downloading Java {}: {}%", java_version, step);
                app.emit("java-download-progress", serde_json::json!({
                    "version": java_version,
                    "percent": step,
                    "status": format!("Downloading...")
                })).ok();
            }
        }
    }

    jlog!(app, log_id, java_version, "Download complete ({} bytes), extracting...", bytes.len());
    app.emit("java-download-progress", serde_json::json!({
        "version": java_version,
        "percent": 100,
        "status": "Extracting..."
    })).ok();

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
        ).into());
    }

    jlog!(app, log_id, java_version, "Java {} installed OK (detected version: {})", java_version, final_version);
    app.emit("java-download-done", serde_json::json!({ "version": java_version })).ok();

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
