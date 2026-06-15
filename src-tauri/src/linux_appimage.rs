//! AppImage-only startup fixes for Linux.
//!
//! WebKitGTK renders a blank/white window when an AppImage runs on a Wayland
//! session, because the AppImage bundles its own `libwayland-client.so` whose
//! version conflicts with the host compositor. The fix is to re-exec the AppImage
//! once with the *system* `libwayland-client.so` forced ahead via `LD_PRELOAD`.
//!
//! This intentionally does NOT set `WEBKIT_DISABLE_DMABUF_RENDERER` — that env var
//! "fixes" the blank window too, but on WebKitGTK 2.52 + Wayland it forces a broken
//! AcceleratedBackingStore path that SIGSEGVs the whole app on any accelerated
//! compositing (second webview, toast, modal). See the note in `main.rs`.

use std::os::unix::process::CommandExt;
use std::path::Path;

/// Guard env var: set on the re-exec'd process so we attempt the preload at most once.
const PRELOAD_GUARD: &str = "MODSTACK_WAYLAND_PRELOAD";

/// Candidate locations for the host's libwayland-client, most specific first.
const SYSTEM_LIBWAYLAND: &[&str] = &[
    "/usr/lib64/libwayland-client.so.0",
    "/usr/lib64/libwayland-client.so",
    "/lib64/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so",
];

/// On a Wayland AppImage launch, re-exec the AppImage once with the system
/// libwayland-client.so preloaded, fixing the blank-window bug. No-op otherwise.
/// Any failure is non-fatal: we fall through and let the app start normally.
pub fn ensure_system_wayland_preload() {
    // Only inside an AppImage (APPIMAGE points at the .AppImage file).
    let Some(appimage) = std::env::var_os("APPIMAGE") else {
        return;
    };

    // Only on Wayland sessions.
    let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t.eq_ignore_ascii_case("wayland"));
    if !is_wayland {
        return;
    }

    // Already re-exec'd once → don't loop.
    if std::env::var_os(PRELOAD_GUARD).is_some() {
        return;
    }

    // Find the system libwayland-client; if missing, leave things as-is.
    let Some(lib) = SYSTEM_LIBWAYLAND.iter().find(|p| Path::new(p).exists()) else {
        return;
    };

    // Prepend our preload, preserving any existing LD_PRELOAD entries.
    let preload = match std::env::var("LD_PRELOAD") {
        Ok(existing) if !existing.trim().is_empty() => format!("{lib}:{existing}"),
        _ => lib.to_string(),
    };

    // Re-exec the AppImage itself (not the inner binary) so its AppRun environment
    // is preserved, with the system libwayland forced ahead of the bundled one.
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let err = std::process::Command::new(&appimage)
        .args(args)
        .env("LD_PRELOAD", preload)
        .env(PRELOAD_GUARD, "1")
        .exec();

    // exec() only returns on failure — log and continue with a normal startup.
    eprintln!("modstack: Wayland libwayland preload re-exec failed: {err}");
}

/// Inside an AppImage, hide color (COLR) fonts from this process via fontconfig.
///
/// The WebKitGTK bundled in the AppImage crashes in Skia's `colrv1_configure_skpaint`
/// when it rasterizes a COLRv1 color-emoji glyph from the host's emoji font (e.g.
/// Noto Color Emoji), freezing the renderer a second after the window appears.
/// Rejecting color fonts means WebKit's *system* font fallback can never reach a
/// COLR font, so the broken path is never taken. Bundled `@font-face` web fonts
/// (our Twemoji) are loaded by WebKit directly from their bytes, not through
/// fontconfig, so color emoji still render from those.
///
/// Must run before any GTK/Pango/WebKit font init (fontconfig reads the config on
/// first use). No-op outside an AppImage; any failure is non-fatal.
pub fn reject_system_color_fonts() {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }

    // Config to wrap: honour an existing FONTCONFIG_FILE, else the system one.
    // If neither exists, bail rather than risk leaving the process with no fonts.
    let base = std::env::var_os("FONTCONFIG_FILE")
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .or_else(|| {
            let sys = std::path::Path::new("/etc/fonts/fonts.conf");
            sys.exists().then(|| sys.to_path_buf())
        });
    let Some(base) = base else {
        return;
    };

    let conf = format!(
        r#"<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">{}</include>
  <selectfont>
    <rejectfont>
      <pattern><patelt name="color"><bool>true</bool></patelt></pattern>
    </rejectfont>
  </selectfont>
</fontconfig>
"#,
        base.display()
    );

    let path = std::env::temp_dir().join("modstack-nocolor-fonts.conf");
    if std::fs::write(&path, conf).is_ok() {
        std::env::set_var("FONTCONFIG_FILE", &path);
    }
}
