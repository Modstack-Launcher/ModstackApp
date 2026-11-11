//! Instant replay ("Clips").
//!
//! Design notes (why it is built this way):
//! * Every Tauri command here runs off the main thread. Sync Tauri commands run on
//!   the UI thread, so spawning FFmpeg, sleeping or re-encoding there froze the
//!   whole launcher (and creating the overlay window from a sync command can
//!   deadlock on Windows).
//! * Video is captured with `ddagrab` (Desktop Duplication, GPU) and encoded with
//!   the first hardware encoder that actually works on this PC (NVENC, AMF, QSV),
//!   falling back to libx264 and finally to `gdigrab`.
//! * The ring buffer is made of MPEG-TS segments. TS can be read while it is still
//!   being written and segments can be byte-concatenated, so saving a clip never
//!   stops the recorder and never re-encodes the video (stream copy only).
//! * System audio is captured with WASAPI loopback into an in-memory ring that is
//!   padded with silence while nothing is playing, so it stays in sync.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
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

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const NORMAL_PRIORITY_CLASS: u32 = 0x00000020;
#[cfg(target_os = "windows")]
const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x00008000;

const AUDIO_SAMPLE_RATE: usize = 44_100;
const AUDIO_CHANNELS: usize = 2;
const AUDIO_BYTES_PER_SECOND: usize = AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 4;
const AUDIO_FRAME_BYTES: usize = AUDIO_CHANNELS * 4;

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

/// How the recorder captures and encodes video. Probed once per FFmpeg binary.
#[derive(Clone, Debug)]
struct CapturePlan {
    /// `true` = ddagrab (GPU desktop duplication), `false` = gdigrab.
    ddagrab: bool,
    encoder: String,
    /// Video filter applied after capture (None = feed GPU frames straight to the encoder).
    filter: Option<String>,
}

struct ClipsInner {
    recorder: Mutex<Option<Child>>,
    #[cfg(target_os = "windows")]
    recorder_job: Mutex<Option<JobHandle>>,
    loopback: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>>,
    audio_ring: Arc<Mutex<VecDeque<u8>>>,
    /// Settings the running recorder was started with.
    active: Mutex<Option<ClipSettings>>,
    plan_cache: Mutex<Option<(PathBuf, CapturePlan)>>,
    ffmpeg_cache: Mutex<Option<(Option<String>, PathBuf)>>,
    saving: AtomicBool,
    overlay_counter: AtomicU64,
    /// True when the running recorder captured a DirectShow device (mic) into the segments.
    device_audio: AtomicBool,
}

pub struct ClipsState {
    inner: Arc<ClipsInner>,
}

impl ClipsState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ClipsInner {
                recorder: Mutex::new(None),
                #[cfg(target_os = "windows")]
                recorder_job: Mutex::new(None),
                loopback: Mutex::new(None),
                audio_ring: Arc::new(Mutex::new(VecDeque::new())),
                active: Mutex::new(None),
                plan_cache: Mutex::new(None),
                ffmpeg_cache: Mutex::new(None),
                saving: AtomicBool::new(false),
                overlay_counter: AtomicU64::new(0),
                device_audio: AtomicBool::new(false),
            }),
        }
    }
}

impl Drop for ClipsState {
    fn drop(&mut self) {
        let _ = stop_recording(&self.inner, true);
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

fn stop_recording(inner: &ClipsInner, remove_buffer: bool) -> Result<(), String> {
    let child = inner.recorder.lock().map_err(|e| e.to_string())?.take();
    if let Some(mut child) = child {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }

    #[cfg(target_os = "windows")]
    if let Ok(mut job) = inner.recorder_job.lock() {
        let _ = job.take();
    }

    if let Ok(mut loopback) = inner.loopback.lock() {
        if let Some((stop, _handle)) = loopback.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut ring) = inner.audio_ring.lock() {
        ring.clear();
        ring.shrink_to_fit();
    }
    if let Ok(mut active) = inner.active.lock() {
        *active = None;
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

impl ClipSettings {
    fn duration(&self) -> u32 {
        self.duration_seconds.clamp(5, 300)
    }

    fn fps(&self) -> u32 {
        self.fps.clamp(15, 60)
    }

    /// Short segments keep the saved clip close to the requested length
    /// (the clip is cut on a segment keyframe).
    fn segment_seconds(&self) -> u32 {
        (self.duration() + 14) / 15
    }

    fn segment_count(&self) -> usize {
        let segment = self.segment_seconds();
        ((self.duration() + segment - 1) / segment) as usize + 2
    }

    fn same_recorder_config(&self, other: &ClipSettings) -> bool {
        self.duration_seconds == other.duration_seconds
            && self.fps == other.fps
            && self.quality == other.quality
            && self.ffmpeg_path == other.ffmpeg_path
            && self.system_audio_device == other.system_audio_device
            && self.capture_system_audio == other.capture_system_audio
            && self.microphone_device == other.microphone_device
    }
}

#[cfg(target_os = "windows")]
fn start_loopback_capture(
    ring: Arc<Mutex<VecDeque<u8>>>,
    max_bytes: usize,
) -> (Arc<AtomicBool>, JoinHandle<()>) {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let handle = std::thread::spawn(move || {
        use wasapi::{
            initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
        };
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            initialize_mta().ok()?;
            let device = DeviceEnumerator::new()?.get_default_device(&Direction::Render)?;
            let mut client = device.get_iaudioclient()?;
            let format = WaveFormat::new(
                32,
                32,
                &SampleType::Float,
                AUDIO_SAMPLE_RATE,
                AUDIO_CHANNELS,
                None,
            );
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
            let started = Instant::now();
            let mut total_bytes: u64 = 0;
            client.start_stream()?;
            while !thread_stop.load(Ordering::Relaxed) {
                capture.read_from_device_to_deque(&mut queue)?;
                // WASAPI loopback delivers nothing while no sound is playing. Pad
                // with silence so the audio timeline keeps pace with the video.
                let expected = (started.elapsed().as_secs_f64() * AUDIO_BYTES_PER_SECOND as f64)
                    as u64;
                let incoming = queue.len() as u64;
                let deficit = expected.saturating_sub(total_bytes + incoming);
                let silence = if deficit > (AUDIO_BYTES_PER_SECOND / 5) as u64 {
                    (deficit as usize / AUDIO_FRAME_BYTES) * AUDIO_FRAME_BYTES
                } else {
                    0
                };
                if silence > 0 || !queue.is_empty() {
                    let mut ring = ring.lock().map_err(|e| e.to_string())?;
                    ring.extend(std::iter::repeat(0u8).take(silence));
                    ring.extend(queue.drain(..));
                    if ring.len() > max_bytes {
                        let excess = ring.len() - max_bytes;
                        let excess = excess - excess % AUDIO_FRAME_BYTES;
                        ring.drain(..excess);
                    }
                    total_bytes += silence as u64 + incoming;
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
    _ring: Arc<Mutex<VecDeque<u8>>>,
    _max_bytes: usize,
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

/// Kept outside the replay buffer so it survives stopping the replay.
fn clips_log_path() -> PathBuf {
    crate::commands::config::get_install_dir_path()
        .join("logs")
        .join("clips-ffmpeg.log")
}

/// Clip covers live in a cache folder, not next to the videos.
fn thumbnails_dir() -> PathBuf {
    crate::commands::config::get_install_dir_path()
        .join("cache")
        .join("clip-thumbnails")
}

fn thumbnail_for(video: &Path) -> PathBuf {
    let stem = video.file_stem().unwrap_or_default().to_string_lossy();
    thumbnails_dir().join(format!("{stem}.jpg"))
}

fn managed_ffmpeg_path() -> PathBuf {
    crate::commands::config::get_install_dir_path()
        .join("tools")
        .join("ffmpeg.exe")
}

fn modified_time(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(UNIX_EPOCH)
}

#[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
fn command(path: &Path) -> Command {
    let mut cmd = Command::new(path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
fn recorder_command(path: &Path, hardware: bool) -> Command {
    let mut cmd = Command::new(path);
    // Below-normal priority made the capture drop frames as soon as the game
    // used the CPU. With a GPU encoder FFmpeg barely uses CPU, so give it
    // priority over the game; with libx264 stay at normal to protect game FPS.
    #[cfg(target_os = "windows")]
    cmd.creation_flags(
        CREATE_NO_WINDOW
            | if hardware {
                ABOVE_NORMAL_PRIORITY_CLASS
            } else {
                NORMAL_PRIORITY_CLASS
            },
    );
    #[cfg(not(target_os = "windows"))]
    let _ = hardware;
    cmd
}

fn find_ffmpeg_uncached(custom: Option<&str>) -> Result<PathBuf, String> {
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
    // CREATE_NO_WINDOW matters here: this probe used to flash a console window
    // (and steal focus from the game) every time the launcher polled Clips.
    if command(Path::new("ffmpeg"))
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("ffmpeg"));
    }
    Err("FFmpeg no está instalado. Selecciona ffmpeg.exe en los ajustes de Clips".into())
}

fn find_ffmpeg(inner: &ClipsInner, custom: Option<&str>) -> Result<PathBuf, String> {
    let key = custom
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if let Ok(cache) = inner.ffmpeg_cache.lock() {
        if let Some((cached_key, path)) = cache.as_ref() {
            if *cached_key == key && (path == Path::new("ffmpeg") || path.is_file()) {
                return Ok(path.clone());
            }
        }
    }
    let path = find_ffmpeg_uncached(key.as_deref())?;
    if let Ok(mut cache) = inner.ffmpeg_cache.lock() {
        *cache = Some((key, path.clone()));
    }
    Ok(path)
}

/// Runs a short FFmpeg probe with a hard timeout. Returns true on success.
fn run_probe(ffmpeg: &Path, args: &[&str], timeout: Duration) -> bool {
    let Ok(mut child) = command(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn ffmpeg_list(ffmpeg: &Path, flag: &str) -> String {
    command(ffmpeg)
        .args(["-hide_banner", flag])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
}

const SOFTWARE_SCALE: &str = "scale=-2:'min(1080,ih)':flags=fast_bilinear";

fn probe_capture_plan(ffmpeg: &Path) -> CapturePlan {
    let filters = ffmpeg_list(ffmpeg, "-filters");
    let encoders = ffmpeg_list(ffmpeg, "-encoders");
    let has_encoder = |name: &str| encoders.contains(&format!(" {name} "));

    if filters.contains(" ddagrab ") {
        let source = "ddagrab=output_idx=0:framerate=10:draw_mouse=0";
        let mut candidates: Vec<(&str, Option<String>)> = Vec::new();
        for encoder in ["h264_nvenc", "h264_amf"] {
            if has_encoder(encoder) {
                // GPU frames go straight from the duplication API to the encoder.
                candidates.push((encoder, None));
                candidates.push((encoder, Some("hwdownload,format=bgra".into())));
            }
        }
        if has_encoder("h264_qsv") {
            candidates.push(("h264_qsv", Some("hwdownload,format=bgra,format=nv12".into())));
        }
        candidates.push((
            "libx264",
            Some(format!("hwdownload,format=bgra,{SOFTWARE_SCALE},format=yuv420p")),
        ));

        for (encoder, filter) in candidates {
            let mut args = vec!["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source];
            if let Some(filter) = filter.as_deref() {
                args.extend(["-vf", filter]);
            }
            args.extend(["-frames:v", "5", "-c:v", encoder, "-f", "null", "-"]);
            if run_probe(ffmpeg, &args, Duration::from_secs(8)) {
                log::info!("Clips capture: ddagrab + {encoder} (filter: {filter:?})");
                return CapturePlan {
                    ddagrab: true,
                    encoder: encoder.into(),
                    filter,
                };
            }
        }
    }

    log::info!("Clips capture: gdigrab + libx264 fallback");
    CapturePlan {
        ddagrab: false,
        encoder: "libx264".into(),
        filter: Some(format!("{SOFTWARE_SCALE},format=yuv420p")),
    }
}

fn capture_plan(inner: &ClipsInner, ffmpeg: &Path) -> CapturePlan {
    if let Ok(cache) = inner.plan_cache.lock() {
        if let Some((path, plan)) = cache.as_ref() {
            if path == ffmpeg {
                return plan.clone();
            }
        }
    }
    let plan = probe_capture_plan(ffmpeg);
    if let Ok(mut cache) = inner.plan_cache.lock() {
        *cache = Some((ffmpeg.to_path_buf(), plan.clone()));
    }
    plan
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
    let mut last_percent = None;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = total.map(|value| ((downloaded.saturating_mul(100) / value).min(100)) as u8);
        // Emit once per percent instead of once per network chunk.
        if percent != last_percent || percent.is_none() && downloaded % (4 << 20) < chunk.len() as u64 {
            last_percent = percent;
            let _ = app.emit(
                "clips-ffmpeg-download-progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percent,
                },
            );
        }
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
        let partial = output.with_extension("exe.part");
        let mut target = fs::File::create(&partial).map_err(|e| e.to_string())?;
        std::io::copy(&mut source, &mut target).map_err(|e| e.to_string())?;
        drop(target);
        fs::rename(&partial, &output).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(archive_path);
    Ok(destination.to_string_lossy().to_string())
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

/// Gives the capture process GPU scheduling priority over the game, like OBS.
/// Without it a game that keeps the GPU at 100% (uncapped FPS) starves Desktop
/// Duplication and the clip ends up with ~20 real frames per second.
/// REALTIME needs admin rights; HIGH works for normal users. Returns the class set.
#[cfg(target_os = "windows")]
fn raise_gpu_priority(child: &Child) -> Option<&'static str> {
    #[link(name = "gdi32")]
    extern "system" {
        fn D3DKMTSetProcessSchedulingPriorityClass(process: HANDLE, priority: i32) -> i32;
    }
    const D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH: i32 = 4;
    const D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME: i32 = 5;
    let process = child.as_raw_handle() as HANDLE;
    for (class, name) in [
        (D3DKMT_SCHEDULINGPRIORITYCLASS_REALTIME, "realtime"),
        (D3DKMT_SCHEDULINGPRIORITYCLASS_HIGH, "high"),
    ] {
        // NTSTATUS: 0 (STATUS_SUCCESS) on success.
        if unsafe { D3DKMTSetProcessSchedulingPriorityClass(process, class) } == 0 {
            return Some(name);
        }
    }
    None
}

#[tauri::command(async)]
pub fn clips_ffmpeg_available(state: tauri::State<'_, ClipsState>, path: Option<String>) -> bool {
    find_ffmpeg(&state.inner, path.as_deref()).is_ok()
}

#[tauri::command(async)]
pub fn clips_audio_devices(
    state: tauri::State<'_, ClipsState>,
    path: Option<String>,
) -> Result<Vec<String>, String> {
    let ffmpeg = find_ffmpeg(&state.inner, path.as_deref())?;
    list_dshow_audio(&ffmpeg)
}

/// Audio capture devices DirectShow can open right now.
fn list_dshow_audio(ffmpeg: &Path) -> Result<Vec<String>, String> {
    let output = command(ffmpeg)
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .stdin(Stdio::null())
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
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("FFmpeg", &["exe"])
        .pick_file(move |selected| {
            let _ = tx.send(selected);
        });
    let selected = rx.await.map_err(|e| e.to_string())?;
    selected
        .map(|f| {
            f.into_path()
                .map(|p| p.to_string_lossy().to_string())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

fn video_bitrate(quality: &str) -> (u32, &'static str) {
    match quality {
        "high" => (20_000, "18"),
        "low" => (6_000, "28"),
        _ => (12_000, "23"),
    }
}

fn recorder_alive(inner: &ClipsInner) -> Result<bool, String> {
    let mut guard = inner.recorder.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(true);
        }
        *guard = None;
        drop(guard);
        #[cfg(target_os = "windows")]
        if let Ok(mut job) = inner.recorder_job.lock() {
            let _ = job.take();
        }
    }
    Ok(false)
}

fn build_recorder_command(
    ffmpeg: &Path,
    plan: &CapturePlan,
    settings: &ClipSettings,
    audio_devices: &[String],
    dir: &Path,
) -> Command {
    let fps = if plan.ddagrab { settings.fps() } else { settings.fps().min(30) };
    let segment_seconds = settings.segment_seconds();
    let (bitrate_k, crf) = video_bitrate(&settings.quality);
    let gop = (fps * segment_seconds).to_string();

    let mut cmd = recorder_command(ffmpeg, plan.encoder != "libx264");
    cmd.args(["-hide_banner", "-loglevel", "warning", "-nostats"]);
    if plan.ddagrab {
        cmd.args([
            "-f",
            "lavfi",
            "-i",
            &format!("ddagrab=output_idx=0:framerate={fps}:draw_mouse=0"),
        ]);
    } else {
        cmd.args(["-f", "gdigrab", "-draw_mouse", "0", "-framerate"])
            .arg(fps.to_string());
        #[cfg(target_os = "windows")]
        if let Some((width, height)) = primary_screen_size() {
            let video_size = format!("{width}x{height}");
            cmd.args(["-video_size", &video_size, "-offset_x", "0", "-offset_y", "0"]);
        }
        cmd.args(["-i", "desktop"]);
    }

    for device in audio_devices {
        cmd.args([
            "-f",
            "dshow",
            "-thread_queue_size",
            "1024",
            "-audio_buffer_size",
            "50",
            "-i",
            &format!("audio={device}"),
        ]);
    }

    cmd.args(["-map", "0:v:0"]);
    if let Some(filter) = plan.filter.as_deref() {
        cmd.args(["-vf", filter]);
    }
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

    cmd.args(["-c:v", &plan.encoder]);
    let bitrate = format!("{bitrate_k}k");
    let maxrate = format!("{}k", bitrate_k * 3 / 2);
    let bufsize = format!("{}k", bitrate_k * 2);
    match plan.encoder.as_str() {
        "h264_nvenc" => {
            cmd.args(["-preset", "p2", "-tune", "ll", "-rc", "vbr", "-forced-idr", "1"]);
        }
        "h264_amf" => {
            cmd.args(["-usage", "lowlatency", "-quality", "speed", "-rc", "vbr_peak"]);
        }
        "h264_qsv" => {
            cmd.args(["-preset", "veryfast"]);
        }
        _ => {}
    }
    if plan.encoder == "libx264" {
        cmd.args(["-preset", "ultrafast", "-tune", "zerolatency", "-crf", crf]);
    } else {
        cmd.args(["-b:v", &bitrate, "-maxrate", &maxrate, "-bufsize", &bufsize]);
    }

    let segment_time = segment_seconds.to_string();
    let segment_wrap = settings.segment_count().to_string();
    let rate = fps.to_string();
    cmd.args(["-fps_mode", "cfr", "-r", &rate]);
    cmd.args([
        "-g",
        &gop,
        "-force_key_frames",
        &format!("expr:gte(t,n_forced*{segment_seconds})"),
        "-f",
        "segment",
        "-segment_format",
        "mpegts",
        "-segment_time",
        &segment_time,
        "-segment_wrap",
        &segment_wrap,
    ])
    .arg(dir.join("segment_%03d.ts"));
    cmd
}

/// Spawns FFmpeg and waits briefly to see whether it survives start-up.
/// Returns the FFmpeg log on early exit.
fn spawn_recorder(
    inner: &ClipsInner,
    mut cmd: Command,
    dir: &Path,
    plan: &CapturePlan,
) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let job = create_kill_on_close_job()?;
    let _ = dir;
    let log_path = clips_log_path();
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut log_file = fs::File::create(&log_path)
        .map_err(|e| format!("No se pudo crear el log de FFmpeg: {e}"))?;
    let _ = writeln!(
        log_file,
        "[modstack] capture={} encoder={} filter={:?}",
        if plan.ddagrab { "ddagrab" } else { "gdigrab" },
        plan.encoder,
        plan.filter
    );
    let _ = log_file.flush();
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log_file)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar FFmpeg: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        attach_to_job(&child, &job)?;
        *inner.recorder_job.lock().map_err(|e| e.to_string())? = Some(job);
        if plan.ddagrab {
            let priority = raise_gpu_priority(&child);
            log::info!("Clips GPU priority: {priority:?}");
            if let Ok(mut log) = fs::OpenOptions::new().append(true).open(&log_path) {
                let _ = writeln!(log, "[modstack] gpu_priority={}", priority.unwrap_or("unchanged"));
            }
        }
    }

    std::thread::sleep(Duration::from_millis(600));
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        #[cfg(target_os = "windows")]
        if let Ok(mut job) = inner.recorder_job.lock() {
            let _ = job.take();
        }
        let log = fs::read_to_string(&log_path).unwrap_or_default();
        return Err(format!(
            "FFmpeg se cerró al iniciar video ({status}). {}",
            log.trim()
        ));
    }
    Ok(child)
}

/// Starts the replay buffer. Returns the audio devices that had to be skipped
/// (unplugged headset, renamed mic...) so the UI can warn without failing.
fn start_recorder(inner: &ClipsInner, settings: ClipSettings) -> Result<Vec<String>, String> {
    if !cfg!(target_os = "windows") {
        return Err("La captura de Clips está disponible por ahora en Windows".into());
    }
    if recorder_alive(inner)? {
        let same = inner
            .active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|a| a.same_recorder_config(&settings)))
            .unwrap_or(false);
        if same {
            return Ok(Vec::new());
        }
        stop_recording(inner, true)?;
    }

    let ffmpeg = find_ffmpeg(inner, settings.ffmpeg_path.as_deref())?;
    let plan = capture_plan(inner, &ffmpeg);
    let dir = buffer_dir();
    let _ = fs::remove_dir_all(legacy_buffer_dir());
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut requested: Vec<String> = [
        settings.system_audio_device.as_ref(),
        settings.microphone_device.as_ref(),
    ]
    .into_iter()
    .flatten()
    .map(|name| name.trim().to_string())
    .filter(|name| !name.is_empty())
    .collect();
    requested.dedup();

    // A saved mic that is not plugged in used to abort the whole capture
    // ("Could not find audio only device"). Record without it instead.
    let mut skipped = Vec::new();
    let mut audio_devices = requested.clone();
    if !requested.is_empty() {
        if let Ok(available) = list_dshow_audio(&ffmpeg) {
            audio_devices.retain(|device| available.contains(device));
            skipped.extend(
                requested
                    .iter()
                    .filter(|device| !audio_devices.contains(device))
                    .cloned(),
            );
        }
    }

    let child = match spawn_recorder(
        inner,
        build_recorder_command(&ffmpeg, &plan, &settings, &audio_devices, &dir),
        &dir,
        &plan,
    ) {
        Ok(child) => child,
        Err(error) if !audio_devices.is_empty() => {
            // The device exists but could not be opened (in use, exclusive mode,
            // driver glitch): keep the video and drop the device audio.
            log::warn!("Clips: audio device failed, retrying video only: {error}");
            skipped.extend(audio_devices.drain(..));
            spawn_recorder(
                inner,
                build_recorder_command(&ffmpeg, &plan, &settings, &[], &dir),
                &dir,
                &plan,
            )
            .map_err(|error| {
                if let Ok(mut cache) = inner.plan_cache.lock() {
                    *cache = None;
                }
                error
            })?
        }
        Err(error) => {
            // The cached plan may be stale (driver update, GPU switch): probe again next time.
            if let Ok(mut cache) = inner.plan_cache.lock() {
                *cache = None;
            }
            return Err(error);
        }
    };
    inner
        .device_audio
        .store(!audio_devices.is_empty(), Ordering::Relaxed);

    if settings.capture_system_audio.unwrap_or(false) {
        let max_bytes = (settings.duration() as usize + 10) * AUDIO_BYTES_PER_SECOND;
        if let Ok(mut ring) = inner.audio_ring.lock() {
            ring.clear();
        }
        let mut loopback = inner.loopback.lock().map_err(|e| e.to_string())?;
        if let Some((stop, _handle)) = loopback.take() {
            stop.store(true, Ordering::Relaxed);
        }
        *loopback = Some(start_loopback_capture(inner.audio_ring.clone(), max_bytes));
    }

    *inner.recorder.lock().map_err(|e| e.to_string())? = Some(child);
    *inner.active.lock().map_err(|e| e.to_string())? = Some(settings);
    Ok(skipped)
}

/// What the recorder uses on this PC, e.g. "GPU · NVENC" (shown in settings).
#[tauri::command(async)]
pub fn clips_capture_info(
    state: tauri::State<'_, ClipsState>,
    path: Option<String>,
) -> Result<String, String> {
    let ffmpeg = find_ffmpeg(&state.inner, path.as_deref())?;
    let plan = capture_plan(&state.inner, &ffmpeg);
    let encoder = match plan.encoder.as_str() {
        "h264_nvenc" => "NVIDIA NVENC",
        "h264_amf" => "AMD AMF",
        "h264_qsv" => "Intel Quick Sync",
        _ => "CPU (x264)",
    };
    let source = if plan.ddagrab { "Desktop Duplication" } else { "GDI" };
    Ok(format!("{encoder} · {source}"))
}

/// Global shortcuts for Clips. The handler in main.rs uses this to tell
/// "save clip" from "toggle replay".
pub struct ClipsShortcuts {
    pub save: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    pub toggle: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
}

impl ClipsShortcuts {
    pub fn new() -> Self {
        Self {
            save: Mutex::new(None),
            toggle: Mutex::new(None),
        }
    }

    pub fn is_toggle(&self, shortcut: &tauri_plugin_global_shortcut::Shortcut) -> bool {
        self.toggle
            .lock()
            .ok()
            .and_then(|current| current.as_ref().map(|value| value.id() == shortcut.id()))
            .unwrap_or(false)
    }
}

pub const DEFAULT_SAVE_SHORTCUT: &str = "Alt+F7";
pub const DEFAULT_TOGGLE_SHORTCUT: &str = "Alt+F8";

fn parse_shortcut(value: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, String> {
    value
        .trim()
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| format!("Atajo no válido \"{value}\": {e}"))
}

/// Registers the save/toggle shortcuts, replacing the previous ones.
pub fn apply_clips_shortcuts(
    app: &tauri::AppHandle,
    save: &str,
    toggle: Option<&str>,
) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let save = parse_shortcut(save)?;
    let toggle = toggle
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_shortcut)
        .transpose()?;
    if toggle.as_ref().is_some_and(|toggle| toggle.id() == save.id()) {
        return Err("Los dos atajos no pueden ser iguales".into());
    }

    let state = app.state::<ClipsShortcuts>();
    let previous_save = state.save.lock().map_err(|e| e.to_string())?.take();
    let previous_toggle = state.toggle.lock().map_err(|e| e.to_string())?.take();
    let shortcuts = app.global_shortcut();
    for old in previous_save.iter().chain(previous_toggle.iter()) {
        let _ = shortcuts.unregister(*old);
    }

    let mut registered = Vec::new();
    let mut failure = None;
    for shortcut in std::iter::once(save).chain(toggle) {
        match shortcuts.register(shortcut) {
            Ok(()) => registered.push(shortcut),
            Err(error) => {
                failure = Some(format!(
                    "No se pudo usar {shortcut}: otro programa ya lo usa ({error})"
                ));
                break;
            }
        }
    }
    if let Some(error) = failure {
        // Roll back to what worked before.
        for shortcut in registered {
            let _ = shortcuts.unregister(shortcut);
        }
        for old in previous_save.iter().chain(previous_toggle.iter()) {
            let _ = shortcuts.register(*old);
        }
        *state.save.lock().map_err(|e| e.to_string())? = previous_save;
        *state.toggle.lock().map_err(|e| e.to_string())? = previous_toggle;
        return Err(error);
    }
    *state.save.lock().map_err(|e| e.to_string())? = Some(save);
    *state.toggle.lock().map_err(|e| e.to_string())? = toggle;
    Ok(())
}

#[tauri::command]
pub async fn clips_set_shortcuts(
    app: tauri::AppHandle,
    save: String,
    toggle: Option<String>,
) -> Result<(), String> {
    apply_clips_shortcuts(&app, &save, toggle.as_deref())
}

#[tauri::command(async)]
pub fn clips_start(
    state: tauri::State<'_, ClipsState>,
    settings: ClipSettings,
) -> Result<Vec<String>, String> {
    start_recorder(&state.inner, settings)
}

#[tauri::command(async)]
pub fn clips_stop(state: tauri::State<'_, ClipsState>) -> Result<(), String> {
    stop_recording(&state.inner, true)
}

#[tauri::command(async)]
pub fn clips_status(state: tauri::State<'_, ClipsState>) -> Result<bool, String> {
    recorder_alive(&state.inner)
}

/// Parses "Duration: 00:00:29.97" from FFmpeg's input banner.
fn media_duration(ffmpeg: &Path, file: &Path) -> Option<f64> {
    let output = command(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let value = text.split("Duration: ").nth(1)?.split(',').next()?.trim();
    let mut parts = value.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn make_thumbnail(ffmpeg: &Path, video: &Path) {
    let _ = fs::create_dir_all(thumbnails_dir());
    let _ = command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss", "1", "-i"])
        .arg(video)
        .args(["-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", "-y"])
        .arg(thumbnail_for(video))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn run_ffmpeg(cmd: &mut Command, what: &str) -> Result<(), String> {
    let result = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!(
            "{what}: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

/// Saves the last N seconds without stopping the recorder and without re-encoding video.
fn save_clip(inner: &ClipsInner, settings: &ClipSettings) -> Result<ClipInfo, String> {
    let ffmpeg = find_ffmpeg(inner, settings.ffmpeg_path.as_deref())?;
    let recording = inner
        .active
        .lock()
        .ok()
        .and_then(|active| active.clone())
        .unwrap_or_else(|| settings.clone());
    let duration = settings.duration();

    // Snapshot system audio first so its end lines up with the newest video frame.
    let system_audio: Option<Vec<u8>> = if recording.capture_system_audio.unwrap_or(false) {
        inner
            .audio_ring
            .lock()
            .ok()
            .map(|ring| ring.iter().copied().collect::<Vec<u8>>())
            .filter(|bytes| !bytes.is_empty())
    } else {
        None
    };

    let mut segments: Vec<PathBuf> = fs::read_dir(buffer_dir())
        .map_err(|_| "Todavía no hay suficiente vídeo en el búfer".to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|x| x.to_str()) == Some("ts"))
        .filter(|path| fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false))
        .collect();
    segments.sort_by_key(|path| modified_time(path));
    let segment_seconds = recording.segment_seconds();
    // +1: the newest segment is still being written and is only partially filled.
    let needed = ((duration + segment_seconds - 1) / segment_seconds) as usize + 1;
    if segments.len() > needed {
        segments = segments.split_off(segments.len() - needed);
    }
    if segments.is_empty() {
        return Err("Todavía no hay suficiente vídeo en el búfer".into());
    }

    let work = buffer_dir().join(format!("save-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = (|| -> Result<ClipInfo, String> {
        // MPEG-TS is a byte stream: segments can simply be appended. Copying them
        // first also protects us from the recorder overwriting the oldest one.
        let joined = work.join("joined.ts");
        {
            let mut out = fs::File::create(&joined).map_err(|e| e.to_string())?;
            for segment in &segments {
                let bytes = fs::read(segment).map_err(|e| e.to_string())?;
                // Drop a trailing partial TS packet from the segment being written.
                let usable = bytes.len() - bytes.len() % 188;
                out.write_all(&bytes[..usable]).map_err(|e| e.to_string())?;
            }
        }

        let dir = clips_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let now = chrono::Local::now();
        let mut output = dir.join(format!(
            "Modstack Clip {}.mp4",
            now.format("%Y-%m-%d %H-%M-%S")
        ));
        let mut suffix = 2;
        while output.exists() {
            output = dir.join(format!(
                "Modstack Clip {} ({suffix}).mp4",
                now.format("%Y-%m-%d %H-%M-%S")
            ));
            suffix += 1;
        }

        let video_target = if system_audio.is_some() {
            work.join("video.mp4")
        } else {
            output.clone()
        };
        run_ffmpeg(
            command(&ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-fflags", "+genpts+discardcorrupt"])
                .args(["-sseof", &format!("-{duration}"), "-i"])
                .arg(&joined)
                .args([
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    "-movflags",
                    "+faststart",
                    "-y",
                ])
                .arg(&video_target),
            "No se pudo crear el clip",
        )?;

        if let Some(audio) = system_audio.as_ref() {
            let video_seconds = media_duration(&ffmpeg, &video_target).unwrap_or(duration as f64);
            let wanted = (video_seconds * AUDIO_BYTES_PER_SECOND as f64) as usize;
            let wanted = wanted - wanted % AUDIO_FRAME_BYTES;
            let raw_path = work.join("system.f32");
            {
                let mut raw = fs::File::create(&raw_path).map_err(|e| e.to_string())?;
                if audio.len() < wanted {
                    raw.write_all(&vec![0u8; wanted - audio.len()])
                        .map_err(|e| e.to_string())?;
                    raw.write_all(audio).map_err(|e| e.to_string())?;
                } else {
                    raw.write_all(&audio[audio.len() - wanted..])
                        .map_err(|e| e.to_string())?;
                }
            }
            // Not the settings: a missing mic is skipped at start, so ask what was recorded.
            let has_mic = inner.device_audio.load(Ordering::Relaxed);
            let mut mux = command(&ffmpeg);
            mux.args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&video_target)
                .args(["-f", "f32le", "-ar", "44100", "-ac", "2", "-i"])
                .arg(&raw_path);
            if has_mic {
                mux.args([
                    "-filter_complex",
                    "[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
                    "-map",
                    "0:v:0",
                    "-map",
                    "[a]",
                ]);
            } else {
                mux.args(["-map", "0:v:0", "-map", "1:a:0"]);
            }
            mux.args([
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags",
                "+faststart", "-y",
            ])
            .arg(&output);
            run_ffmpeg(&mut mux, "No se pudo mezclar el audio del clip")?;
        }

        make_thumbnail(&ffmpeg, &output);
        info_for(output)
    })();
    let _ = fs::remove_dir_all(&work);
    result
}

async fn save_clip_async(state: &ClipsState, settings: ClipSettings) -> Result<ClipInfo, String> {
    let inner = state.inner.clone();
    if inner.saving.swap(true, Ordering::AcqRel) {
        return Err("Ya se está guardando un clip".into());
    }
    let result = tauri::async_runtime::spawn_blocking({
        let inner = inner.clone();
        move || {
            // If FFmpeg died (e.g. display mode change) there is nothing to save from.
            if !recorder_alive(&inner)? {
                let _ = start_recorder(&inner, settings)?;
                return Err("La captura se estaba reiniciando. Inténtalo de nuevo en unos segundos".into());
            }
            save_clip(&inner, &settings)
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    inner.saving.store(false, Ordering::Release);
    result
}

#[tauri::command]
pub async fn clips_save(
    state: tauri::State<'_, ClipsState>,
    settings: ClipSettings,
) -> Result<ClipInfo, String> {
    save_clip_async(&state, settings).await
}

/// Kept for compatibility with older frontends: the recorder no longer needs a
/// restart after saving because it is never stopped.
#[tauri::command]
pub async fn clips_save_and_restart(
    state: tauri::State<'_, ClipsState>,
    settings: ClipSettings,
) -> Result<ClipInfo, String> {
    save_clip_async(&state, settings).await
}

#[tauri::command(async)]
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
    // Older versions wrote the cover next to the clip: move it to the cache.
    let legacy = path.with_extension("jpg");
    let thumbnail = thumbnail_for(&path);
    if legacy.is_file() {
        let _ = fs::create_dir_all(thumbnails_dir());
        if thumbnail.is_file() || fs::rename(&legacy, &thumbnail).is_err() {
            let _ = fs::remove_file(&legacy);
        }
    }
    Ok(ClipInfo {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        thumbnail_path: thumbnail
            .is_file()
            .then(|| thumbnail.to_string_lossy().to_string()),
        size: meta.len(),
        created_at,
    })
}

#[tauri::command(async)]
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

fn ensure_inside_clips_dir(path: &Path) -> Result<(), String> {
    let clips_dir = clips_dir();
    let canonical_parent = path.parent().and_then(|parent| parent.canonicalize().ok());
    let canonical_clips_dir = clips_dir.canonicalize().unwrap_or(clips_dir);
    if canonical_parent.as_deref() != Some(canonical_clips_dir.as_path()) {
        return Err("Ruta de clip no válida".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn clips_delete(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    ensure_inside_clips_dir(&path)?;
    let _ = fs::remove_file(path.with_extension("jpg"));
    let _ = fs::remove_file(thumbnail_for(&path));
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn clips_trim(
    state: tauri::State<'_, ClipsState>,
    path: String,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<ClipInfo, String> {
    let input = PathBuf::from(path);
    ensure_inside_clips_dir(&input)?;
    if !input.is_file() {
        return Err("El clip no existe".into());
    }
    let start = start_seconds.max(0.0);
    let end = end_seconds.max(0.0);
    if end <= start + 0.2 {
        return Err("El recorte necesita una duración mayor".into());
    }

    let ffmpeg = find_ffmpeg(&state.inner, None)?;
    let stem = input
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut output = clips_dir().join(format!("{stem} - Trimmed.mp4"));
    let mut suffix = 2;
    while output.exists() {
        output = clips_dir().join(format!("{stem} - Trimmed ({suffix}).mp4"));
        suffix += 1;
    }
    run_ffmpeg(
        command(&ffmpeg)
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
            .arg(&output),
        "No se pudo recortar el clip",
    )?;

    make_thumbnail(&ffmpeg, &output);
    info_for(output)
}

#[tauri::command(async)]
pub fn clips_open_folder() -> Result<(), String> {
    fs::create_dir_all(clips_dir()).map_err(|e| e.to_string())?;
    open::that(clips_dir()).map_err(|e| e.to_string())
}

const OVERLAY_WIDTH: f64 = 340.0;
const OVERLAY_HEIGHT: f64 = 96.0;

/// Shows a small always-on-top toast (top-right, like the NVIDIA overlay) that never
/// takes focus away from the game.
async fn show_overlay(app: &tauri::AppHandle, inner: &ClipsInner, query: String) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition, WebviewUrl};

    let id = inner.overlay_counter.fetch_add(1, Ordering::Relaxed);
    let label = format!("clip_overlay_{id}");
    // Only one toast at a time.
    for (existing, window) in app.webview_windows() {
        if existing.starts_with("clip_overlay_") {
            let _ = window.close();
        }
    }

    let url = format!("/clip-overlay.html?{query}");
    let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()));
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let window = builder
        .title("Modstack Clips")
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = (OVERLAY_WIDTH * scale) as i32;
        let x = area.position.x + area.size.width as i32 - width - (20.0 * scale) as i32;
        let y = area.position.y + (20.0 * scale) as i32;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    window.show().map_err(|e| e.to_string())?;

    let app_for_hide = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(4600)).await;
        if let Some(window) = app_for_hide.get_webview_window(&label) {
            let _ = window.close();
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn clips_show_overlay(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClipsState>,
    clip: ClipInfo,
    title: Option<String>,
    accent: Option<String>,
) -> Result<(), String> {
    let query = format!(
        "mode=saved&path={}&thumb={}&name={}&size={}&createdAt={}&title={}&accent={}",
        urlencoding::encode(&clip.path),
        urlencoding::encode(clip.thumbnail_path.as_deref().unwrap_or("")),
        urlencoding::encode(&clip.name),
        clip.size,
        clip.created_at,
        urlencoding::encode(title.as_deref().unwrap_or("Clip guardado con éxito")),
        urlencoding::encode(accent.as_deref().unwrap_or("#a3ff12"))
    );
    show_overlay(&app, &state.inner, query).await
}

/// "Recording started" toast, shown when the replay buffer turns on or a game starts.
#[tauri::command]
pub async fn clips_show_status_overlay(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClipsState>,
    title: String,
    subtitle: Option<String>,
    accent: Option<String>,
) -> Result<(), String> {
    let query = format!(
        "mode=recording&title={}&subtitle={}&accent={}",
        urlencoding::encode(&title),
        urlencoding::encode(subtitle.as_deref().unwrap_or("")),
        urlencoding::encode(accent.as_deref().unwrap_or("#a3ff12"))
    );
    show_overlay(&app, &state.inner, query).await
}

#[tauri::command]
pub async fn clips_hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    for (label, window) in app.webview_windows() {
        if label.starts_with("clip_overlay") {
            let _ = window.close();
        }
    }
    Ok(())
}
