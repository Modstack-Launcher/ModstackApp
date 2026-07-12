use std::os::unix::process::CommandExt;
use std::path::Path;

const PRELOAD_GUARD: &str = "MODSTACK_WAYLAND_PRELOAD";

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

pub fn ensure_system_wayland_preload() {
    let Some(appimage) = std::env::var_os("APPIMAGE") else {
        return;
    };

    let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t.eq_ignore_ascii_case("wayland"));
    if !is_wayland {
        return;
    }

    if std::env::var_os(PRELOAD_GUARD).is_some() {
        return;
    }

    let Some(lib) = SYSTEM_LIBWAYLAND.iter().find(|p| Path::new(p).exists()) else {
        return;
    };

    let preload = match std::env::var("LD_PRELOAD") {
        Ok(existing) if !existing.trim().is_empty() => format!("{lib}:{existing}"),
        _ => lib.to_string(),
    };
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let err = std::process::Command::new(&appimage)
        .args(args)
        .env("LD_PRELOAD", preload)
        .env(PRELOAD_GUARD, "1")
        .exec();

    eprintln!("modstack: Wayland libwayland preload re-exec failed: {err}");
}

pub fn reject_system_color_fonts() {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }
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
