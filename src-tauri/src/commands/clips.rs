use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::{io::AsRawHandle, process::CommandExt};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
    UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN},
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const BUFFER_SEGMENTS: usize = 10;
#[cfg(target_os = "windows")]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;

#[cfg(target_os = "windows")]
struct JobHandle(HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for JobHandle {}

#[cfg(target_os = "windows")]
impl Drop for JobHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub struct ClipsState {
    recorder: Mutex<Option<Child>>,
    #[cfg(target_os = "windows")]
    recorder_job: Mutex<Option<JobHandle>>,
    loopback: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>>,
}

impl ClipsState {
    pub fn new() -> Self {
        Self {
            recorder: Mutex::new(None),
            #[cfg(target_os = "windows")]
            recorder_job: Mutex::new(None),
            loopback: Mutex::new(None),
        }
    }
}

impl Drop for ClipsState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.recorder.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        #[cfg(target_os = "windows")]
        if let Ok(mut guard) = self.recorder_job.lock() {
            let _ = guard.take();
        }
        if let Ok(mut guard) = self.loopback.lock() {
            if let Some((stop, _handle)) = guard.take() {
                stop.store(true, Ordering::Relaxed);
            }
        }
        let _ = fs::remove_dir_all(buffer_dir());
    }
}

#[cfg(target_os = "windows")]
fn primary_screen_size() -> Option<(i32, i32)> {
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if width > 0 && height > 0 {
        Some((width, height))
    } else {
        None
    }
}

fn stop_recording(state: &ClipsState, remove_buffer: bool) -> Result<(), String> {
    let mut guard = state.recorder.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"q\n");
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    drop(guard);

    #[cfg(target_os = "windows")]
    if let Ok(mut job) = state.recorder_job.lock() {
        let _ = job.take();
    }

    let mut loopback = state.loopback.lock().map_err(|e| e.to_string())?;
    if let Some((stop, _handle)) = loopback.take() {
        stop.store(true, Ordering::Relaxed);
    }

    if remove_buffer {
        let _ = fs::remove_dir_all(buffer_dir());
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSettings {
    pub duration_seconds: u32,
    pub fps: u32,
    pub quality: String,
    pub ffmpeg_path: Option<String>,
    pub system_audio_device: Option<String>,
    pub capture_system_audio: Option<bool>,
    pub microphone_device: Option<String>,
    pub capture_width: Option<u32>,
    pub capture_height: Option<u32>,
}

fn segment_seconds_for(duration_seconds: u32) -> u32 {
    ((duration_seconds.clamp(5, 300) + BUFFER_SEGMENTS as u32 - 1) / BUFFER_SEGMENTS as u32).max(1)
}

#[cfg(target_os = "windows")]
fn start_loopback_capture(dir: PathBuf, segment_seconds: u32) -> (Arc<AtomicBool>, JoinHandle<()>) {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let handle = std::thread::spawn(move || {
        use std::collections::VecDeque;
        use wasapi::{
            initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
        };
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            initialize_mta().ok()?;
            let device = DeviceEnumerator::new()?.get_default_device(&Direction::Render)?;
            let mut client = device.get_iaudioclient()?;
            let format = WaveFormat::new(32, 32, &SampleType::Float, 44_100, 2, None);
            let (_, min_time) = client.get_device_period()?;
            client.initialize_client(
                &format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: min_time,
                },
            )?;
            let event = client.set_get_eventhandle()?;
            let capture = client.get_audiocaptureclient()?;
            let mut queue = VecDeque::<u8>::new();
            let segment_bytes = 44_100usize * 2 * 4 * segment_seconds as usize;
            let mut index = 0u32;
            let mut written = 0usize;
            let mut file = fs::File::create(dir.join(format!("system_audio_{index:06}.f32")))?;
            client.start_stream()?;
            while !thread_stop.load(Ordering::Relaxed) {
                capture.read_from_device_to_deque(&mut queue)?;
                while !queue.is_empty() {
                    let take = (segment_bytes - written).min(queue.len());
                    let bytes: Vec<u8> = queue.drain(..take).collect();
                    file.write_all(&bytes)?;
                    written += take;
                    if written >= segment_bytes {
                        index = (index + 1) % BUFFER_SEGMENTS as u32;
                        written = 0;
                        file = fs::File::create(dir.join(format!("system_audio_{index:06}.f32")))?;
                    }
                }
                let _ = event.wait_for_event(100);
            }
            client.stop_stream()?;
            Ok(())
        })();
        if let Err(error) = result {
            log::warn!("WASAPI loopback capture stopped: {error}");
        }
    });
    (stop, handle)
}

#[cfg(not(target_os = "windows"))]
fn start_loopback_capture(
    _dir: PathBuf,
    _segment_seconds: u32,
) -> (Arc<AtomicBool>, JoinHandle<()>) {
    let stop = Arc::new(AtomicBool::new(true));
    let handle = std::thread::spawn(|| {});
    (stop, handle)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    pub name: String,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub size: u64,
    pub created_at: u64,
}

fn buffer_dir() -> PathBuf {
    std::env::temp_dir()
        .join("ModstackApp")
        .join("replay-buffer")
}

fn legacy_buffer_dir() -> PathBuf {
    crate::commands::config::get_install_dir_path().join(".clips-buffer")
}

fn clips_dir() -> PathBuf {
    crate::commands::config::get_install_dir_path().join("clips")
}

fn managed_ffmpeg_path() -> PathBuf {
    crate::commands::config::get_install_dir_path()
        .join("tools")
        .join("ffmpeg.exe")
}

fn sort_paths_by_modified(paths: &mut Vec<PathBuf>) {
    paths.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(UNIX_EPOCH)
    });
}

fn find_ffmpeg(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = custom.filter(|v| !v.trim().is_empty()) {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err("La ruta seleccionada de FFmpeg no existe".into());
    }
    let managed = managed_ffmpeg_path();
    if managed.is_file() {
        return Ok(managed);
    }
    if Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
    {
        return Ok(PathBuf::from("ffmpeg"));
    }
    Err("FFmpeg no está instalado. Selecciona ffmpeg.exe en los ajustes de Clips".into())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<u8>,
}

#[tauri::command]
pub async fn clips_install_ffmpeg(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;

    if !cfg!(target_os = "windows") {
        return Err("La instalación automática está disponible por ahora en Windows".into());
    }
    let destination = managed_ffmpeg_path();
    if destination.is_file() {
        return Ok(destination.to_string_lossy().to_string());
    }
    let parent = destination
        .parent()
        .ok_or("Ruta de instalación no válida")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let archive_path = parent.join("ffmpeg-download.zip");
    let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "ModstackApp")
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar FFmpeg: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("GitHub respondió con {}", response.status()));
    }
    let total = response.content_length();
    let mut file = fs::File::create(&archive_path).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = total.map(|value| ((downloaded.saturating_mul(100) / value).min(100)) as u8);
        let _ = app.emit(
            "clips-ffmpeg-download-progress",
            DownloadProgress {
                downloaded,
                total,
                percent,
            },
        );
    }
    drop(file);

    let archive = archive_path.clone();
    let output = destination.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let file = fs::File::open(&archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let index = (0..zip.len())
            .find(|index| {
                zip.by_index(*index)
                    .ok()
                    .map(|item| item.name().replace('\\', "/").ends_with("/bin/ffmpeg.exe"))
                    .unwrap_or(false)
            })
            .ok_or("El paquete descargado no contiene ffmpeg.exe")?;
        let mut source = zip.by_index(index).map_err(|e| e.to_string())?;
        let mut target = fs::File::create(&output).map_err(|e| e.to_string())?;
        std::io::copy(&mut source, &mut target).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(archive_path);
    Ok(destination.to_string_lossy().to_string())
}

#[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    cmd
}

#[cfg(target_os = "windows")]
fn create_kill_on_close_job() -> Result<JobHandle, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("No se pudo crear el grupo de captura de Clips".into());
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return Err("No se pudo preparar la limpieza automática de Clips".into());
        }

        Ok(JobHandle(job))
    }
}

#[cfg(target_os = "windows")]
fn attach_to_job(child: &Child, job: &JobHandle) -> Result<(), String> {
    let process = child.as_raw_handle() as HANDLE;
    let ok = unsafe { AssignProcessToJobObject(job.0, process) };
    if ok == 0 {
        return Err("No se pudo proteger la grabación de Clips contra procesos huérfanos".into());
    }
    Ok(())
}

#[tauri::command]
pub fn clips_ffmpeg_available(path: Option<String>) -> bool {
    find_ffmpeg(path.as_deref()).is_ok()
}

#[tauri::command]
pub fn clips_audio_devices(path: Option<String>) -> Result<Vec<String>, String> {
    let ffmpeg = find_ffmpeg(path.as_deref())?;
    let output = command(&ffmpeg)
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stderr);
    let mut devices = Vec::new();
    for line in text.lines().filter(|line| line.contains("(audio)")) {
        if let Some(start) = line.find('"') {
            if let Some(end) = line[start + 1..].find('"') {
                let name = line[start + 1..start + 1 + end].to_string();
                if !devices.contains(&name) {
                    devices.push(name);
                }
            }
        }
    }
    Ok(devices)
}

#[tauri::command]
pub async fn clips_pick_ffmpeg(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let selected = app
        .dialog()
        .file()
        .add_filter("FFmpeg", &["exe"])
        .blocking_pick_file();
    selected
        .map(|f| {
            f.into_path()
                .map(|p| p.to_string_lossy().to_string())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

#[tauri::command]
pub fn clips_start(state: tauri::State<ClipsState>, settings: ClipSettings) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("La captura de Clips está disponible por ahora en Windows".into());
    }
    let mut guard = state.recorder.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        *guard = None;
        #[cfg(target_os = "windows")]
        if let Ok(mut job) = state.recorder_job.lock() {
            let _ = job.take();
        }
    }
    let ffmpeg = find_ffmpeg(settings.ffmpeg_path.as_deref())?;
    let dir = buffer_dir();
    let _ = fs::remove_dir_all(legacy_buffer_dir());
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let crf = match settings.quality.as_str() {
        "high" => "18",
        "low" => "28",
        _ => "23",
    };
    let output = dir.join("segment_%06d.mp4");
    let mut cmd = command(&ffmpeg);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "gdigrab",
        "-draw_mouse",
        "1",
        "-framerate",
    ])
    .arg(settings.fps.clamp(15, 60).to_string());
    #[cfg(target_os = "windows")]
    if let Some((width, height)) = primary_screen_size() {
        let video_size = format!("{width}x{height}");
        cmd.args([
            "-video_size",
            &video_size,
            "-offset_x",
            "0",
            "-offset_y",
            "0",
        ]);
    }
    cmd.args(["-i", "desktop"]);
    let mut audio_devices: Vec<String> = [
        settings.system_audio_device.as_ref(),
        settings.microphone_device.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|name| !name.is_empty())
    .cloned()
    .collect();
    audio_devices.dedup();
    for device in &audio_devices {
        cmd.args([
            "-f",
            "dshow",
            "-thread_queue_size",
            "1024",
            "-i",
            &format!("audio={device}"),
        ]);
    }
    cmd.args(["-map", "0:v:0"]);
    if audio_devices.len() == 1 {
        cmd.args(["-map", "1:a:0", "-c:a", "aac", "-b:a", "160k"]);
    } else if audio_devices.len() >= 2 {
        cmd.args([
            "-filter_complex",
            "[1:a][2:a]amix=inputs=2:duration=longest:dropout_transition=2[a]",
            "-map",
            "[a]",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
        ]);
    } else {
        cmd.arg("-an");
    }
    let segment_wrap = BUFFER_SEGMENTS.to_string();
    let segment_seconds = segment_seconds_for(settings.duration_seconds).to_string();
    #[cfg(target_os = "windows")]
    let job = create_kill_on_close_job()?;
    let child = cmd
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            crf,
            "-pix_fmt",
            "yuv420p",
            "-force_key_frames",
            &format!("expr:gte(t,n_forced*{})", segment_seconds),
            "-f",
            "segment",
            "-segment_time",
            &segment_seconds,
            "-segment_wrap",
            &segment_wrap,
            "-reset_timestamps",
            "1",
        ])
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(
            fs::File::create(dir.join("ffmpeg-video.log"))
                .map_err(|e| format!("No se pudo crear el log de FFmpeg: {e}"))?,
        )
        .spawn()
        .map_err(|e| format!("No se pudo iniciar FFmpeg: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(700));
    let mut child = child;
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        let log = fs::read_to_string(dir.join("ffmpeg-video.log")).unwrap_or_default();
        return Err(format!(
            "FFmpeg se cerró al iniciar video ({status}). {}",
            log.trim()
        ));
    }
    #[cfg(target_os = "windows")]
    {
        attach_to_job(&child, &job)?;
        let mut job_guard = state.recorder_job.lock().map_err(|e| e.to_string())?;
        *job_guard = Some(job);
    }
    if settings.capture_system_audio.unwrap_or(false) {
        let mut loopback = state.loopback.lock().map_err(|e| e.to_string())?;
        if let Some((stop, _handle)) = loopback.take() {
            stop.store(true, Ordering::Relaxed);
        }
        *loopback = Some(start_loopback_capture(
            dir.clone(),
            segment_seconds_for(settings.duration_seconds),
        ));
    }
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn clips_stop(state: tauri::State<ClipsState>) -> Result<(), String> {
    stop_recording(&state, true)
}

#[tauri::command]
pub fn clips_status(state: tauri::State<ClipsState>) -> Result<bool, String> {
    if let Ok(entries) = fs::read_dir(buffer_dir()) {
        let mut paths: Vec<_> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("mp4"))
            .collect();
        sort_paths_by_modified(&mut paths);
        let remove_count = paths.len().saturating_sub(BUFFER_SEGMENTS);
        for path in paths.into_iter().take(remove_count) {
            let _ = fs::remove_file(path);
        }
    }
    if let Ok(entries) = fs::read_dir(buffer_dir()) {
        let mut paths: Vec<_> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| {
                        name.starts_with("system_audio_") && name != "system_audio_concat.f32"
                    })
                    .unwrap_or(false)
            })
            .collect();
        sort_paths_by_modified(&mut paths);
        let remove_count = paths.len().saturating_sub(BUFFER_SEGMENTS);
        for path in paths.into_iter().take(remove_count) {
            let _ = fs::remove_file(path);
        }
    }
    let mut guard = state.recorder.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(true);
        }
        *guard = None;
        #[cfg(target_os = "windows")]
        if let Ok(mut job) = state.recorder_job.lock() {
            let _ = job.take();
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn clips_save(
    state: tauri::State<ClipsState>,
    settings: ClipSettings,
) -> Result<ClipInfo, String> {
    stop_recording(&state, false)?;
    let ffmpeg = find_ffmpeg(settings.ffmpeg_path.as_deref())?;
    let crf = match settings.quality.as_str() {
        "high" => "18",
        "low" => "28",
        _ => "23",
    };
    let mut files: Vec<_> = fs::read_dir(buffer_dir())
        .map_err(|_| "Todavía no hay suficiente vídeo en el búfer".to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("mp4"))
        .filter(|p| fs::metadata(p).map(|m| m.len() > 1024).unwrap_or(false))
        .collect();
    sort_paths_by_modified(&mut files);
    let segment_seconds = segment_seconds_for(settings.duration_seconds);
    let needed = ((settings.duration_seconds.clamp(5, 300) + segment_seconds - 1) / segment_seconds)
        as usize;
    if files.len() > needed {
        files = files.split_off(files.len() - needed);
    }
    if files.is_empty() {
        return Err("Todavía no hay suficiente vídeo en el búfer".into());
    }
    let dir = clips_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now();
    let output = dir.join(format!(
        "Modstack Clip {}.mp4",
        now.format("%Y-%m-%d %H-%M-%S")
    ));
    let list_path = buffer_dir().join("concat.txt");
    let list = files
        .iter()
        .map(|p| {
            let path = p
                .to_string_lossy()
                .replace('\\', "/")
                .replace('\'', "'\\''");
            format!("file '{}'\n", path)
        })
        .collect::<String>();
    fs::write(&list_path, list).map_err(|e| e.to_string())?;
    let raw_audio_path = buffer_dir().join("system_audio_concat.f32");
    let mut audio_files: Vec<_> = fs::read_dir(buffer_dir())
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    name.starts_with("system_audio_")
                        && name.ends_with(".f32")
                        && name != "system_audio_concat.f32"
                })
                .unwrap_or(false)
        })
        .filter(|path| {
            fs::metadata(path)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false)
        })
        .collect();
    sort_paths_by_modified(&mut audio_files);
    audio_files.pop();
    if audio_files.len() > needed {
        audio_files = audio_files.split_off(audio_files.len() - needed);
    }
    let has_system_audio =
        settings.capture_system_audio.unwrap_or(false) && !audio_files.is_empty();
    if has_system_audio {
        let mut raw = fs::File::create(&raw_audio_path).map_err(|e| e.to_string())?;
        for path in &audio_files {
            let mut source = fs::File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut raw).map_err(|e| e.to_string())?;
        }
    }
    let mut mux = command(&ffmpeg);
    mux.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
    ])
    .arg(&list_path);
    if has_system_audio {
        mux.args(["-f", "f32le", "-ar", "44100", "-ac", "2", "-i"])
            .arg(&raw_audio_path);
        if settings
            .microphone_device
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        {
            mux.args([
                "-filter_complex",
                "[0:a:0][1:a:0]amix=inputs=2:duration=shortest:dropout_transition=2[a]",
                "-map",
                "0:v:0",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                crf,
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
            ]);
        } else {
            mux.args([
                "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf",
                crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            ]);
        }
    } else {
        mux.args([
            "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf",
            crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
        ]);
    }
    let result = mux
        .args(["-movflags", "+faststart", "-y"])
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(list_path);
    let _ = fs::remove_file(raw_audio_path);
    if !result.status.success() {
        return Err(format!(
            "No se pudo crear el clip: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    let thumbnail = output.with_extension("jpg");
    let _ = command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "00:00:01",
            "-i",
        ])
        .arg(&output)
        .args(["-frames:v", "1", "-q:v", "3", "-y"])
        .arg(&thumbnail)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let info = info_for(output)?;
    let _ = fs::remove_dir_all(buffer_dir());
    Ok(info)
}

#[tauri::command]
pub fn clips_save_and_restart(
    state: tauri::State<ClipsState>,
    settings: ClipSettings,
) -> Result<ClipInfo, String> {
    let info = clips_save(state.clone(), settings.clone())?;
    clips_start(state, settings)?;
    Ok(info)
}

#[tauri::command]
pub fn clips_save_webm(data: Vec<u8>) -> Result<ClipInfo, String> {
    if data.is_empty() {
        return Err("No hay datos de clip para guardar".into());
    }
    let dir = clips_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now();
    let output = dir.join(format!(
        "Modstack Clip {}.webm",
        now.format("%Y-%m-%d %H-%M-%S")
    ));
    fs::write(&output, data).map_err(|e| e.to_string())?;
    info_for(output)
}

fn info_for(path: PathBuf) -> Result<ClipInfo, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let created_at = meta
        .modified()
        .unwrap_or(SystemTime::now())
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(ClipInfo {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        thumbnail_path: path
            .with_extension("jpg")
            .is_file()
            .then(|| path.with_extension("jpg").to_string_lossy().to_string()),
        size: meta.len(),
        created_at,
    })
}

#[tauri::command]
pub fn clips_list() -> Result<Vec<ClipInfo>, String> {
    let dir = clips_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut clips: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            matches!(
                p.extension().and_then(|x| x.to_str()),
                Some("mp4") | Some("webm")
            )
        })
        .filter_map(|p| info_for(p).ok())
        .collect();
    clips.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(clips)
}

#[tauri::command]
pub fn clips_delete(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let clips_dir = clips_dir();
    let canonical_parent = path.parent().and_then(|parent| parent.canonicalize().ok());
    let canonical_clips_dir = clips_dir.canonicalize().unwrap_or(clips_dir);
    if canonical_parent.as_deref() != Some(canonical_clips_dir.as_path()) {
        return Err("Ruta de clip no valida".into());
    }
    let _ = fs::remove_file(path.with_extension("jpg"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clips_trim(path: String, start_seconds: f64, end_seconds: f64) -> Result<ClipInfo, String> {
    let input = PathBuf::from(path);
    if input.parent() != Some(clips_dir().as_path()) {
        return Err("Ruta de clip no vÃ¡lida".into());
    }
    if !input.is_file() {
        return Err("El clip no existe".into());
    }
    let start = start_seconds.max(0.0);
    let end = end_seconds.max(0.0);
    if end <= start + 0.2 {
        return Err("El recorte necesita una duraciÃ³n mayor".into());
    }

    let ffmpeg = find_ffmpeg(None)?;
    let stem = input
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let output = clips_dir().join(format!("{stem} - Trimmed.mp4"));
    let result = command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{start:.3}"),
            "-to",
            &format!("{end:.3}"),
            "-i",
        ])
        .arg(&input)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            "-y",
        ])
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!(
            "No se pudo recortar el clip: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }

    let thumbnail = output.with_extension("jpg");
    let _ = command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "00:00:01",
            "-i",
        ])
        .arg(&output)
        .args(["-frames:v", "1", "-q:v", "3", "-y"])
        .arg(&thumbnail)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    info_for(output)
}

#[tauri::command]
pub fn clips_open_folder() -> Result<(), String> {
    fs::create_dir_all(clips_dir()).map_err(|e| e.to_string())?;
    open::that(clips_dir()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clips_show_overlay(
    app: tauri::AppHandle,
    clip: ClipInfo,
    title: Option<String>,
    accent: Option<String>,
) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition, WebviewUrl};

    let url = format!(
        "/clip-overlay.html?path={}&thumb={}&name={}&size={}&createdAt={}&title={}&accent={}",
        urlencoding::encode(&clip.path),
        urlencoding::encode(clip.thumbnail_path.as_deref().unwrap_or("")),
        urlencoding::encode(&clip.name),
        clip.size,
        clip.created_at,
        urlencoding::encode(title.as_deref().unwrap_or("Clip guardado con éxito")),
        urlencoding::encode(accent.as_deref().unwrap_or("#a3ff12"))
    );

    let label = format!("clip_overlay_{}", clip.created_at);
    let window = tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Modstack Clips")
        .inner_size(304.0, 90.0)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            let area = monitor.work_area();
            let x = area.position.x + area.size.width as i32 - 304 - 16;
            let y = area.position.y + 12;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
    } else if let Ok(Some(monitor)) = window.primary_monitor() {
        let area = monitor.work_area();
        let x = area.position.x + area.size.width as i32 - 304 - 16;
        let y = area.position.y + 12;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }

    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();

    let app_for_hide = app.clone();
    let label_for_hide = label.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(4300)).await;
        if let Some(window) = app_for_hide.get_webview_window(&label_for_hide) {
            let _ = window.close();
        }
    });

    Ok(())
}

#[tauri::command]
pub fn clips_hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("clip_overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
