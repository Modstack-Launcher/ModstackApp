//! "Crash doctor": turns Minecraft launch failures and crashes into a specific,
//! actionable diagnosis (incompatible mods, outdated GPU driver, wrong Java,
//! corrupt files, blocked folder...) instead of a raw stack trace.
//!
//! Sources, newest first: the error returned by the launcher, the game's stdout,
//! the crash report and JVM `hs_err_pid` file written during this run, and the
//! tail of `logs/latest.log`.

use regex::Regex;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::SystemTime,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDiagnosis {
    pub instance_id: String,
    /// incompatible_mods | missing_dependency | duplicate_mod | mixin | mod_crash |
    /// wrong_loader | java_version | graphics_driver | out_of_memory | heap_reservation |
    /// corrupt_files | access_denied | disk_full | network | unknown
    pub kind: String,
    /// Mods involved, when we could tell.
    pub mods: Vec<String>,
    /// The few log lines that explain the problem.
    pub details: Vec<String>,
    /// Folder the user should look at (mods, libraries, the blocked path...).
    pub folder: Option<String>,
    /// Crash report / hs_err file written during this run.
    pub report: Option<String>,
    /// Kind-specific value: required Java version, GPU vendor...
    pub extra: Option<String>,
    pub exit_code: Option<i32>,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

fn newest_file_since(dir: &Path, since: SystemTime, accept: impl Fn(&str) -> bool) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| accept(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            (modified >= since).then_some((modified, entry.path()))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn read_tail(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(max_lines)..]
        .iter()
        .map(|line| line.to_string())
        .collect()
}

fn push_unique(list: &mut Vec<String>, value: impl Into<String>) {
    let value = value.into().trim().to_string();
    if !value.is_empty() && !list.contains(&value) && list.len() < 12 {
        list.push(value);
    }
}

fn clean_line(line: &str) -> String {
    // Drop "[12:00:00] [main/ERROR]: " style prefixes, keep the message.
    let trimmed = line.trim();
    let without_prefix = trimmed
        .rsplit_once("]: ")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let mut value = without_prefix.trim().to_string();
    if value.len() > 300 {
        value.truncate(300);
        value.push('…');
    }
    value
}

struct Context<'a> {
    lines: &'a [String],
    joined: String,
}

impl<'a> Context<'a> {
    fn has(&self, needle: &str) -> bool {
        self.joined.contains(needle)
    }

    fn has_any(&self, needles: &[&str]) -> bool {
        needles.iter().any(|needle| self.has(needle))
    }

    fn lines_with(&self, needles: &[&str], limit: usize) -> Vec<String> {
        let mut out = Vec::new();
        for line in self.lines {
            if needles.iter().any(|needle| line.contains(needle)) {
                push_unique(&mut out, clean_line(line));
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }

    /// Lines following a header line (e.g. Fabric's "A potential solution..."
    /// list or "Suspected Mods:"), until an empty line.
    fn block_after(&self, header: &str, limit: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut inside = false;
        for line in self.lines {
            if !inside {
                if line.contains(header) {
                    inside = true;
                }
                continue;
            }
            let value = line.trim();
            if value.is_empty() || value.starts_with("at ") {
                if !out.is_empty() {
                    break;
                }
                continue;
            }
            push_unique(&mut out, clean_line(line));
            if out.len() >= limit {
                break;
            }
        }
        out
    }
}

fn gpu_vendor(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    if ["atio6axx", "atioglxx", "atig6pxx", "amdxx", "amd radeon"].iter().any(|v| lower.contains(v)) {
        Some("AMD")
    } else if ["ig9icd", "ig8icd", "ig7icd", "ig75icd", "ig4icd", "igxelpicd", "intel(r)"].iter().any(|v| lower.contains(v)) {
        Some("Intel")
    } else if ["nvoglv", "nvidia"].iter().any(|v| lower.contains(v)) {
        Some("NVIDIA")
    } else {
        None
    }
}

pub struct DiagnoseInput<'a> {
    pub instance_id: &'a str,
    pub instance_dir: &'a Path,
    pub engine_dir: &'a Path,
    pub logs: &'a [String],
    pub error: Option<&'a str>,
    pub exit_code: Option<i32>,
    pub started_at: SystemTime,
}

pub fn diagnose(input: DiagnoseInput<'_>) -> LaunchDiagnosis {
    static MOD_QUOTED: OnceLock<Regex> = OnceLock::new();
    static FORGE_MOD_ID: OnceLock<Regex> = OnceLock::new();
    static CLASS_VERSION: OnceLock<Regex> = OnceLock::new();
    static MIXIN_CONFIG: OnceLock<Regex> = OnceLock::new();
    static FROM_MOD: OnceLock<Regex> = OnceLock::new();
    static ACCESS_PATH: OnceLock<Regex> = OnceLock::new();
    static SUSPECT: OnceLock<Regex> = OnceLock::new();

    let mut lines: Vec<String> = Vec::new();
    if let Some(error) = input.error {
        lines.extend(error.lines().map(ToString::to_string));
    }
    lines.extend(input.logs.iter().cloned());

    let crash_report = newest_file_since(&input.instance_dir.join("crash-reports"), input.started_at, |name| {
        name.starts_with("crash-") && name.ends_with(".txt")
    });
    let hs_err = newest_file_since(input.instance_dir, input.started_at, |name| {
        name.starts_with("hs_err_pid") && name.ends_with(".log")
    });
    if let Some(path) = crash_report.as_ref() {
        lines.extend(read_tail(path, 600));
    }
    if let Some(path) = hs_err.as_ref() {
        lines.extend(read_tail(path, 120));
    }
    let latest_log = input.instance_dir.join("logs").join("latest.log");
    if fs::metadata(&latest_log)
        .and_then(|meta| meta.modified())
        .is_ok_and(|modified| modified >= input.started_at)
    {
        lines.extend(read_tail(&latest_log, 400));
    }

    let ctx = Context {
        joined: lines.join("\n"),
        lines: &lines,
    };
    let mods_dir = input.instance_dir.join("mods").to_string_lossy().to_string();
    let report = crash_report
        .as_ref()
        .or(hs_err.as_ref())
        .map(|path| path.to_string_lossy().to_string());

    let mut diagnosis = LaunchDiagnosis {
        instance_id: input.instance_id.to_string(),
        kind: "unknown".into(),
        mods: Vec::new(),
        details: Vec::new(),
        folder: None,
        report,
        extra: None,
        exit_code: input.exit_code,
    };
    let collect_quoted_mods = |details: &[String], mods: &mut Vec<String>| {
        for line in details {
            for capture in re(&MOD_QUOTED, r"(?:Mod|mod) '([^']+)'").captures_iter(line) {
                push_unique(mods, capture[1].to_string());
            }
            for capture in re(&FORGE_MOD_ID, r"Mod ID: '([^']+)'").captures_iter(line) {
                push_unique(mods, capture[1].to_string());
            }
        }
    };

    // 1. Disk full.
    if ctx.has_any(&["No space left on device", "There is not enough space on the disk", "espacio suficiente en el disco"]) {
        diagnosis.kind = "disk_full".into();
        diagnosis.details = ctx.lines_with(&["space"], 3);
        diagnosis.folder = Some(input.engine_dir.to_string_lossy().to_string());
        return diagnosis;
    }

    // 2. A folder/file blocked by permissions or antivirus.
    if ctx.has_any(&["AccessDeniedException", "Access is denied", "Acceso denegado", "Permission denied"]) {
        diagnosis.kind = "access_denied".into();
        diagnosis.details = ctx.lines_with(&["AccessDeniedException", "Access is denied", "Acceso denegado", "Permission denied"], 4);
        if let Some(capture) = re(&ACCESS_PATH, r"AccessDeniedException: ([^\r\n]+)").captures(&ctx.joined) {
            let path = PathBuf::from(capture[1].trim());
            let folder = if path.is_dir() { Some(path) } else { path.parent().map(Path::to_path_buf) };
            diagnosis.folder = folder.map(|p| p.to_string_lossy().to_string());
        }
        if diagnosis.folder.is_none() {
            diagnosis.folder = Some(input.instance_dir.to_string_lossy().to_string());
        }
        return diagnosis;
    }

    // 3. Mod or game compiled for a newer Java.
    if ctx.has("UnsupportedClassVersionError") || ctx.has("compiled by a more recent version of the Java Runtime") {
        diagnosis.kind = "java_version".into();
        diagnosis.details = ctx.lines_with(&["UnsupportedClassVersionError", "class file version"], 3);
        if let Some(capture) = re(&CLASS_VERSION, r"class file version (\d+)").captures(&ctx.joined) {
            if let Ok(version) = capture[1].parse::<u32>() {
                diagnosis.extra = Some((version.saturating_sub(44)).to_string());
            }
        }
        return diagnosis;
    }

    // 4. Memory.
    if ctx.has_any(&["Could not reserve enough space for", "Invalid maximum heap size", "Invalid initial heap size", "Initial heap size set to a larger value than the maximum"]) {
        diagnosis.kind = "heap_reservation".into();
        diagnosis.details = ctx.lines_with(&["heap", "reserve enough space"], 3);
        return diagnosis;
    }
    if ctx.has("java.lang.OutOfMemoryError") || ctx.has("Native memory allocation (mmap) failed") || ctx.has("Native memory allocation (malloc) failed") {
        diagnosis.kind = "out_of_memory".into();
        diagnosis.details = ctx.lines_with(&["OutOfMemoryError", "Native memory allocation"], 3);
        return diagnosis;
    }

    // 5. Mod set problems reported by the loader before the game starts.
    if ctx.has_any(&["Incompatible mods found", "Incompatible mod set", "incompatible mod set", "Mod resolution failed"]) {
        let mut details = ctx.block_after("A potential solution has been determined", 10);
        details.extend(ctx.block_after("Incompatible mods found", 10));
        details.extend(ctx.block_after("Incompatible mod set", 10));
        details.extend(ctx.lines_with(&["requires", "is incompatible with", "breaks"], 10));
        let mut unique = Vec::new();
        for line in details {
            push_unique(&mut unique, line);
        }
        let missing = unique.iter().any(|line| line.contains("which is missing") || line.starts_with("- Install"));
        diagnosis.kind = if missing { "missing_dependency" } else { "incompatible_mods" }.into();
        collect_quoted_mods(&unique, &mut diagnosis.mods);
        diagnosis.details = unique;
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }
    if ctx.has_any(&["Missing or unsupported mandatory dependencies", "MissingModsException", "Mod ID: '", "requires mod"]) {
        diagnosis.kind = "missing_dependency".into();
        diagnosis.details = ctx.lines_with(&["Mod ID:", "requires", "Missing or unsupported", "Requested by"], 10);
        collect_quoted_mods(&diagnosis.details, &mut diagnosis.mods);
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }
    if ctx.has_any(&["DuplicateModsFoundException", "Found duplicate mods", "Duplicate mods found", "duplicate mod"]) {
        diagnosis.kind = "duplicate_mod".into();
        diagnosis.details = ctx.lines_with(&["uplicate"], 8);
        collect_quoted_mods(&diagnosis.details, &mut diagnosis.mods);
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }
    // A Fabric mod in a Forge instance (or vice versa) is silently ignored or
    // fails with a "not a valid mod file" / "fabric.mod.json" message.
    if ctx.has_any(&["is a Fabric mod and cannot be loaded", "This is a Fabric mod", "is not a valid mod file", "Found Forge mod", "requires Fabric", "Fabric Loader is required"]) {
        diagnosis.kind = "wrong_loader".into();
        diagnosis.details = ctx.lines_with(&["Fabric mod", "not a valid mod file", "Forge mod", "requires Fabric", "Fabric Loader is required"], 8);
        collect_quoted_mods(&diagnosis.details, &mut diagnosis.mods);
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }

    // 6. Mixin failures name the mod that broke.
    if ctx.has_any(&["Mixin apply failed", "MixinApplyError", "InvalidMixinException", "MixinTransformerError", "Mixin prepare failed"]) {
        diagnosis.kind = "mixin".into();
        diagnosis.details = ctx.lines_with(&["Mixin apply failed", "MixinApplyError", "InvalidMixinException", "MixinTransformerError", "Mixin prepare failed"], 5);
        for line in &diagnosis.details.clone() {
            if let Some(capture) = re(&FROM_MOD, r"from mod ([A-Za-z0-9_\-]+)").captures(line) {
                push_unique(&mut diagnosis.mods, capture[1].to_string());
            } else if let Some(capture) = re(&MIXIN_CONFIG, r"([A-Za-z0-9_\-]+)\.mixins?\.json").captures(line) {
                push_unique(&mut diagnosis.mods, capture[1].to_string());
            }
        }
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }

    // 7. Graphics driver / OpenGL.
    let graphics_markers = [
        "Pixel format not accelerated",
        "GLFW error 65542",
        "GLFW error 65543",
        "GLFW error 65545",
        "WGL: The driver does not appear to support OpenGL",
        "OpenGL 3.2 not supported",
        "Couldn't set pixel format",
        "No OpenGL context",
        "Failed to create OpenGL context",
        "GL_INVALID",
        "atio6axx.dll",
        "atioglxx.dll",
        "ig9icd64.dll",
        "ig8icd64.dll",
        "ig7icd64.dll",
        "ig75icd64.dll",
        "nvoglv64.dll",
    ];
    if ctx.has_any(&graphics_markers) {
        diagnosis.kind = "graphics_driver".into();
        diagnosis.details = ctx.lines_with(&graphics_markers, 4);
        diagnosis.extra = gpu_vendor(&ctx.joined).map(ToString::to_string);
        return diagnosis;
    }

    // 8. Network problems while downloading game files.
    if input.error.is_some_and(|error| {
        let lower = error.to_lowercase();
        ["dns error", "error sending request", "timed out", "connection refused", "tcp connect", "connection reset", "failed to lookup address", "certificate"]
            .iter()
            .any(|needle| lower.contains(needle))
    }) {
        diagnosis.kind = "network".into();
        diagnosis.details = input.error.map(|error| vec![clean_line(error)]).unwrap_or_default();
        return diagnosis;
    }

    // 9. Damaged game files.
    let corrupt_markers = [
        "ZipException",
        "Invalid or corrupt jarfile",
        "zip END header not found",
        "Could not find or load main class",
        "ClassNotFoundException: net.minecraft",
        "NoClassDefFoundError: net/minecraft",
        "NoClassDefFoundError: org/lwjgl",
        "UnsatisfiedLinkError",
        "checksum mismatch",
        "hash mismatch",
    ];
    if ctx.has_any(&corrupt_markers) {
        diagnosis.kind = "corrupt_files".into();
        diagnosis.details = ctx.lines_with(&corrupt_markers, 4);
        diagnosis.folder = Some(input.engine_dir.to_string_lossy().to_string());
        return diagnosis;
    }

    // 10. A mod crashed the game (crash report names it).
    let suspects = {
        let mut mods = Vec::new();
        for line in ctx.block_after("Suspected Mod", 6) {
            // Only "Name (modid)" lines; skip "Issue tracker URL: ..." and similar.
            if let Some(capture) = re(&SUSPECT, r"^([^(:]+?)\s*\(([A-Za-z0-9_\-]+)\)$").captures(line.trim()) {
                push_unique(&mut mods, capture[1].trim().to_string());
            }
        }
        mods
    };
    if !suspects.is_empty() || ctx.has("ModLoadingException") || ctx.has("-- MOD ") {
        diagnosis.kind = "mod_crash".into();
        diagnosis.mods = suspects;
        diagnosis.details = ctx.lines_with(&["Description:", "Exception", "Caused by"], 4);
        diagnosis.folder = Some(mods_dir);
        return diagnosis;
    }

    // Unknown: show the most telling exception lines.
    diagnosis.details = ctx.lines_with(&["Exception", "Error:", "Caused by", "FATAL"], 5);
    if diagnosis.details.is_empty() {
        if let Some(error) = input.error {
            diagnosis.details.push(clean_line(error));
        }
    }
    diagnosis.folder = Some(input.instance_dir.to_string_lossy().to_string());
    diagnosis
}

pub fn has_crash_report_since(instance_dir: &Path, since: SystemTime) -> bool {
    newest_file_since(&instance_dir.join("crash-reports"), since, |name| {
        name.starts_with("crash-") && name.ends_with(".txt")
    })
    .is_some()
}

/// Diagnoses an error returned by `launch_instance_cmd` (download/Java/start
/// failures that happen before the game window exists).
#[tauri::command(async)]
pub fn diagnose_launch_error(
    instance_id: String,
    error: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<LaunchDiagnosis, String> {
    let instance_dir = state
        .instances
        .lock()
        .map_err(|e| e.to_string())?
        .instances
        .iter()
        .find(|instance| instance.id == instance_id)
        .map(|instance| instance.path.clone())
        .unwrap_or_else(|| {
            crate::commands::config::get_install_dir_path()
                .join("instances")
                .join(&instance_id)
        });
    let engine_dir = crate::commands::config::get_install_dir_path().join("engine_data");
    // Look back a few minutes: a launch can take a while to download files.
    let since = SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(600))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    Ok(diagnose(DiagnoseInput {
        instance_id: &instance_id,
        instance_dir: &instance_dir,
        engine_dir: &engine_dir,
        logs: &[],
        error: Some(&error),
        exit_code: None,
        started_at: since,
    }))
}

/// Opens a folder or a crash report from the diagnosis modal. Only paths inside
/// the launcher's install directory are allowed (never executables).
#[tauri::command(async)]
pub fn open_diagnosis_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let root = crate::commands::config::get_install_dir_path();
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let canonical_root = root.canonicalize().unwrap_or(root);
    if !canonical.starts_with(&canonical_root) {
        return Err("Ruta no permitida".into());
    }
    if canonical.is_file() {
        let extension = canonical
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !matches!(extension.as_str(), "txt" | "log") {
            return Err("Ruta no permitida".into());
        }
    }
    open::that(canonical).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lines: &[&str], error: Option<&str>) -> LaunchDiagnosis {
        let logs: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
        let dir = std::env::temp_dir().join("modstack-crash-doctor-test");
        diagnose(DiagnoseInput {
            instance_id: "test",
            instance_dir: &dir,
            engine_dir: &dir,
            logs: &logs,
            error,
            exit_code: Some(1),
            started_at: SystemTime::now(),
        })
    }

    #[test]
    fn fabric_missing_dependency() {
        let d = run(&[
            "[main/ERROR]: Incompatible mods found!",
            "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!",
            "A potential solution has been determined, this may resolve your problem:",
            "\t - Install fabric-api, any version.",
            "More details:",
            "\t - Mod 'Sodium Extra' (sodium-extra) 0.5.1 requires any version of fabric-api, which is missing!",
        ], None);
        assert_eq!(d.kind, "missing_dependency");
        assert!(d.mods.contains(&"Sodium Extra".to_string()));
    }

    #[test]
    fn java_version() {
        let d = run(&["java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime (class file version 65.0)"], None);
        assert_eq!(d.kind, "java_version");
        assert_eq!(d.extra.as_deref(), Some("21"));
    }

    #[test]
    fn amd_driver() {
        let d = run(&["# Problematic frame:", "# C  [atio6axx.dll+0x1a2b3]"], None);
        assert_eq!(d.kind, "graphics_driver");
        assert_eq!(d.extra.as_deref(), Some("AMD"));
    }

    #[test]
    fn mixin_mod() {
        let d = run(&["Mixin apply failed iris.mixins.json:MixinLevelRenderer -> net.minecraft.class_761: from mod iris"], None);
        assert_eq!(d.kind, "mixin");
        assert_eq!(d.mods, vec!["iris".to_string()]);
    }

    #[test]
    fn network_error() {
        let d = run(&[], Some("error sending request for url (https://libraries.minecraft.net/...): dns error"));
        assert_eq!(d.kind, "network");
    }

    #[test]
    fn suspected_mods() {
        let d = run(&[
            "Description: Ticking entity",
            "Suspected Mods: ",
            "\tCreate (create)",
            "\t\tIssue tracker URL: https://github.com/Creators-of-Create/Create/issues",
            "",
        ], None);
        assert_eq!(d.kind, "mod_crash");
        assert_eq!(d.mods.first().map(String::as_str), Some("Create"));
    }
}
