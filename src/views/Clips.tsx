import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "@heroui/react";
import {
  IconBolt,
  IconCheck,
  IconClock,
  IconDeviceFloppy,
  IconDownload,
  IconFolderOpen,
  IconMicrophone,
  IconPlayerPlay,
  IconScissors,
  IconSettings,
  IconTrash,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { useLauncherTranslation } from "../utils/languageContext";
import { ClipSettings, readClipSettings, saveClipSettings } from "../utils/clipsSettings";

interface ClipInfo {
  name: string;
  path: string;
  thumbnailPath?: string | null;
  size: number;
  createdAt: number;
}

interface DownloadProgress {
  percent?: number;
}

const launcherBlue = "var(--color-accent)";
const durations = [15, 30, 60, 120, 180, 300];

function durationLabel(seconds: number) {
  return seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`;
}

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function Clips() {
  const t = useLauncherTranslation();
  const [settings, setSettingsState] = useState<ClipSettings>(() => readClipSettings());
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [replayOn, setReplayOn] = useState(false);
  const [engineReady, setEngineReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedClip, setSelectedClip] = useState<ClipInfo | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(15);
  const [trimming, setTrimming] = useState(false);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);

  const replayOnRef = useRef(false);
  const busyRef = useRef(false);

  const setSettings = useCallback((next: ClipSettings) => {
    setSettingsState(next);
    saveClipSettings(next);
  }, []);

  const refreshClips = useCallback(async () => {
    try {
      const items = await invoke<ClipInfo[]>("clips_list");
      setClips(items);
    } catch (error) {
      console.warn("Could not load clips", error);
      setClips([]);
    }
  }, []);

  useEffect(() => {
    refreshClips();
    const timer = window.setInterval(refreshClips, 10000);
    return () => window.clearInterval(timer);
  }, [refreshClips]);

  const checkEngine = useCallback(async () => {
    const available = await invoke<boolean>("clips_ffmpeg_available", {
      path: settings.ffmpegPath || null,
    });
    setEngineReady(available);
    return available;
  }, [settings.ffmpegPath]);

  useEffect(() => {
    checkEngine().catch(() => setEngineReady(false));
    const timer = window.setInterval(() => {
      checkEngine().catch(() => setEngineReady(false));
    }, 7000);
    return () => window.clearInterval(timer);
  }, [checkEngine]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<ClipInfo>("clips-saved", ({ payload }) => {
      setClips((current) => [payload, ...current.filter((clip) => clip.path !== payload.path)]);
      setReplayOn(true);
      replayOnRef.current = true;
      window.setTimeout(() => refreshClips(), 250);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshClips]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<boolean>("clips-replay-status", ({ payload }) => {
      replayOnRef.current = payload;
      setReplayOn(payload);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const refreshStatus = () => {
      invoke<boolean>("clips_status")
        .then((active) => {
          setReplayOn(active);
          replayOnRef.current = active;
        })
        .catch(() => undefined);
    };
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    invoke<string[]>("clips_audio_devices", { path: settings.ffmpegPath || null })
      .then(setAudioDevices)
      .catch(() => setAudioDevices([]));
  }, [settings.ffmpegPath, settingsOpen]);

  const installEngine = useCallback(async () => {
    setInstalling(true);
    setProgress(0);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<DownloadProgress>("clips-ffmpeg-download-progress", ({ payload }) => {
        setProgress(payload.percent ?? 0);
      });
      const path = await invoke<string>("clips_install_ffmpeg");
      const next = { ...settings, ffmpegPath: path };
      setSettings(next);
      setEngineReady(true);
      setProgress(100);
      toast.success(t("clips.installed"));
      return next;
    } catch (error) {
      setEngineReady(false);
      toast.danger(t("clips.installFailed"), { description: String(error) });
      return null;
    } finally {
      unlisten?.();
      setInstalling(false);
    }
  }, [setSettings, settings, t]);

  const stopReplay = useCallback(async () => {
    replayOnRef.current = false;
    setReplayOn(false);
    setSettings({ ...settings, enabled: false });
    await invoke("clips_stop").catch(() => undefined);
  }, [setSettings, settings]);

  const startReplay = useCallback(async () => {
    if (busyRef.current || replayOnRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let activeSettings = settings;
      const available = await invoke<boolean>("clips_ffmpeg_available", {
        path: settings.ffmpegPath || null,
      });
      setEngineReady(available);
      if (!available) {
        const installed = await installEngine();
        if (!installed) return;
        activeSettings = installed;
      }

      await invoke("clips_start", {
        settings: {
          ...activeSettings,
          microphoneDevice: activeSettings.microphoneDevice || undefined,
        },
      });

      replayOnRef.current = true;
      setReplayOn(true);
      setSettings({ ...activeSettings, enabled: true });
      toast.success("Instant Replay", { description: "Alt + F7 saves the recent clip." });
    } catch (error) {
      replayOnRef.current = false;
      setReplayOn(false);
      toast.danger("Clips", { description: String(error) });
      await invoke("clips_stop").catch(() => undefined);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [installEngine, setSettings, settings]);

  const saveClip = useCallback(async () => {
    if (busyRef.current || !replayOnRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const clip = await invoke<ClipInfo>("clips_save_and_restart", { settings });
      setClips((current) => [clip, ...current.filter((item) => item.path !== clip.path)]);
      await refreshClips();
      invoke("clips_show_overlay", {
        clip,
        title: t("clips.savedOverlayTitle"),
        accent: launcherBlue,
      }).catch(() => {
        toast.success(t("clips.saved"), { description: clip.name });
      });
      replayOnRef.current = true;
      setReplayOn(true);
    } catch (error) {
      replayOnRef.current = false;
      setReplayOn(false);
      toast.danger(t("clips.saveFailed"), { description: String(error) });
    } finally {
      refreshClips().catch(() => undefined);
      busyRef.current = false;
      setBusy(false);
    }
  }, [refreshClips, settings, t]);

  const deleteClip = async (clip: ClipInfo) => {
    try {
      if (selectedClip?.path === clip.path) {
        setSelectedClip(null);
      }
      await invoke("clips_delete", { path: clip.path });
      setClips((current) => current.filter((item) => item.path !== clip.path));
      await refreshClips();
      toast.success("Clip deleted", { description: clip.name });
    } catch (error) {
      toast.danger("Could not delete clip", { description: String(error) });
    }
  };

  const openClip = (clip: ClipInfo) => {
    setSelectedClip(clip);
    setTrimStart(0);
    setTrimEnd(settings.durationSeconds);
  };

  const trimClip = async () => {
    if (!selectedClip || trimming) return;
    setTrimming(true);
    try {
      const clip = await invoke<ClipInfo>("clips_trim", {
        path: selectedClip.path,
        startSeconds: trimStart,
        endSeconds: trimEnd,
      });
      setClips((current) => [clip, ...current.filter((item) => item.path !== clip.path)]);
      setSelectedClip(clip);
      await refreshClips();
      toast.success("Clip trimmed", { description: clip.name });
    } catch (error) {
      toast.danger("Could not trim", { description: String(error) });
    } finally {
      setTrimming(false);
    }
  };

  return (
    <main className="relative min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background: `radial-gradient(ellipse at top, color-mix(in srgb, ${launcherBlue} 18%, transparent), transparent 66%)`,
        }}
      />
      <div className="relative w-full px-7 py-7">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl text-white shadow-lg shadow-black/30" style={{ background: launcherBlue }}>
              <IconBolt size={22} fill="currentColor" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                Clips
                <span className="text-[var(--color-accent)] text-sm px-2 py-0.5 rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10">
                  BETA
                </span>
              </h1>
              <p className="text-xs text-white/40">Primary-screen replay, no screen picker.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => invoke("clips_open_folder").catch((error) => toast.danger("Could not open folder", { description: String(error) }))}
              className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/4 text-white/55 transition hover:bg-white/8 hover:text-white"
              title={t("clips.openFolder")}
            >
              <IconFolderOpen size={19} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/4 text-white/55 transition hover:bg-white/8 hover:text-white"
              title={t("clips.settings")}
            >
              <IconSettings size={19} />
            </button>
          </div>
        </header>

        {engineReady === false && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                  <IconDownload size={22} />
                </span>
                <div>
                  <p className="font-bold">Install FFmpeg</p>
                  <p className="mt-0.5 text-xs text-white/45">
                    Clips needs FFmpeg to record your primary screen without a picker.
                  </p>
                </div>
              </div>
              <button
                disabled={installing}
                onClick={installEngine}
                className="min-w-36 rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-black/30 transition hover:brightness-110 disabled:opacity-60"
              >
                {installing ? `${progress}%` : "Install FFmpeg"}
              </button>
            </div>
            {installing && (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            )}
          </section>
        )}

        <section className={`relative mb-8 overflow-hidden rounded-[24px] border p-7 transition-colors ${replayOn ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10" : "border-white/8 bg-white/[.035]"}`}>
          <div className="absolute -right-20 -top-24 size-72 rounded-full bg-[var(--color-accent)]/10 blur-3xl" />
          <div className="relative flex flex-col items-center gap-6 md:flex-row md:justify-between">
            <div className="flex items-center gap-5">
              <button
                onClick={replayOn ? saveClip : startReplay}
                disabled={busy || installing}
                className={`group relative grid size-20 shrink-0 place-items-center rounded-full border-[6px] transition duration-300 disabled:opacity-50 ${replayOn ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)] text-white shadow-[0_0_38px_color-mix(in_srgb,var(--color-accent)_32%,transparent)] hover:scale-105" : "border-white/8 bg-white text-[#11131a] hover:scale-105"}`}
              >
                {installing ? <IconDownload size={27} /> : <IconDeviceFloppy size={27} />}
                {replayOn && <span className="absolute inset-[-9px] animate-pulse rounded-full border border-[var(--color-accent)]/40" />}
              </button>
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={`size-2 rounded-full ${replayOn ? "bg-[var(--color-accent)] shadow-[0_0_9px_var(--color-accent)]" : "bg-white/20"}`} />
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-white/45">
                    {replayOn ? t("clips.capturing") : t("clips.waiting")}
                  </p>
                </div>
                <h2 className="text-2xl font-black">
                  {replayOn ? `${durationLabel(settings.durationSeconds)} ${t("clips.recentReady")}` : t("clips.replayOff")}
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  {replayOn
                    ? "Press Alt + F7 to save the last moments from your primary screen."
                    : "Enable replay when you want Modstack to keep recent gameplay."}
                </p>
                {installing && <p className="mt-2 text-xs text-[var(--color-accent)]">Installing FFmpeg… {progress}%</p>}
              </div>
            </div>
            <div className="flex w-full gap-3 md:w-auto">
              <div className="flex min-w-24 flex-1 flex-col justify-center rounded-xl border border-white/7 bg-black/20 px-4 py-3 md:flex-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{t("clips.duration")}</span>
                <span className="mt-0.5 text-sm font-bold">{durationLabel(settings.durationSeconds)}</span>
              </div>
              <div className="flex min-w-20 flex-1 flex-col justify-center rounded-xl border border-white/7 bg-black/20 px-4 py-3 md:flex-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">{t("clips.flow")}</span>
                <span className="mt-0.5 text-sm font-bold">{settings.fps} FPS</span>
              </div>
              <button
                onClick={replayOn ? stopReplay : startReplay}
                disabled={busy || installing}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:opacity-60 md:flex-none"
              >
                {replayOn ? t("clips.replayDisable") : t("clips.replayEnable")}
              </button>
            </div>
          </div>
        </section>

        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-black">{t("clips.moments")}</h2>
            <p className="mt-1 text-xs text-white/35">
              {clips.length} {clips.length === 1 ? t("clips.savedSingular") : t("clips.savedPlural")}
            </p>
          </div>
          <div className="rounded-lg border border-white/7 bg-white/4 px-3 py-1.5 text-[11px] font-bold text-white/40">
            <span className="text-white/70">ALT</span> + <span className="text-white/70">F7</span>
          </div>
        </div>

        {clips.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[.018] text-center">
            <div>
              <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/4 text-white/25">
                <IconVideo size={25} />
              </span>
              <p className="font-bold text-white/70">{t("clips.emptyTitle")}</p>
              <p className="mt-1 text-xs text-white/30">{t("clips.emptyDescription")}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {clips.map((clip) => (
              <article key={clip.path} className="group overflow-hidden rounded-2xl border border-white/8 bg-white/[.035] transition hover:-translate-y-0.5 hover:border-white/15">
                <button onClick={() => openClip(clip)} className="relative aspect-video w-full overflow-hidden bg-black text-left">
                  {clip.thumbnailPath ? (
                    <img src={convertFileSrc(clip.thumbnailPath)} alt="" loading="lazy" className="size-full object-cover opacity-90 transition group-hover:scale-[1.02]" />
                  ) : (
                    <div className="grid size-full place-items-center bg-gradient-to-br from-[var(--color-accent)]/22 via-[var(--color-background)] to-black text-white/40">
                      <IconPlayerPlay size={38} fill="currentColor" />
                    </div>
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/10 opacity-0 transition group-hover:opacity-100">
                    <span className="grid size-12 place-items-center rounded-full bg-white/90 text-black shadow-xl">
                      <IconPlayerPlay size={22} fill="currentColor" />
                    </span>
                  </span>
                </button>
                <div className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <button onClick={() => openClip(clip)} className="block max-w-full truncate text-left text-sm font-bold hover:text-[var(--color-accent)]">
                      {clip.name.replace("Modstack Clip ", "")}
                    </button>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-white/30">
                      <IconClock size={12} /> {new Date(clip.createdAt * 1000).toLocaleString()} · {bytes(clip.size)}
                    </p>
                  </div>
                  <button onClick={() => deleteClip(clip)} className="grid size-8 place-items-center rounded-lg text-white/25 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100">
                    <IconTrash size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {selectedClip && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-6 backdrop-blur-md" onClick={() => setSelectedClip(null)}>
          <div className="grid w-full max-w-6xl overflow-hidden rounded-[26px] border border-[var(--color-accent)]/25 bg-[var(--color-overlay)] shadow-[0_30px_90px_rgba(0,0,0,.65)] lg:grid-cols-[1fr_320px]" onClick={(event) => event.stopPropagation()}>
            <div className="min-w-0">
              <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{selectedClip.name.replace("Modstack Clip ", "")}</p>
                  <p className="mt-1 text-xs text-white/35">{new Date(selectedClip.createdAt * 1000).toLocaleString()} · {bytes(selectedClip.size)}</p>
                </div>
                <button onClick={() => setSelectedClip(null)} className="grid size-9 place-items-center rounded-xl bg-white/5 text-white/60 hover:bg-white/10">
                  <IconX size={18} />
                </button>
              </div>
              <video src={convertFileSrc(selectedClip.path)} controls autoPlay preload="metadata" className="max-h-[76vh] w-full bg-black object-contain" />
            </div>

            <aside className="border-t border-border bg-surface p-5 lg:border-l lg:border-t-0">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                  <IconScissors size={20} />
                </span>
                <div>
                  <h3 className="text-lg font-black">Trim clip</h3>
                  <p className="text-xs text-white/35">Create a shorter copy.</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/35">Start second</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={trimStart}
                    onChange={(event) => setTrimStart(Number(event.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/35">End second</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={trimEnd}
                    onChange={(event) => setTrimEnd(Number(event.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]/60"
                  />
                </label>

                <button
                  onClick={trimClip}
                  disabled={trimming || trimEnd <= trimStart}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  <IconScissors size={17} />
                  {trimming ? "Trimming..." : "Save trimmed copy"}
                </button>

                <button onClick={() => invoke("clips_open_folder")} className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/65 transition hover:bg-white/10">
                  Open clips folder
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed right-0 z-50 flex w-[340px] items-stretch transition-transform duration-300 ease-out" style={{ top: 40, height: "calc(100% - 40px)" }}>
          <aside className="h-full w-full overflow-y-auto border-l border-t border-border bg-surface p-5 text-white shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">{t("clips.settingsTitle")}</h2>
                <p className="mt-1 text-xs text-white/35">Primary screen, native replay, no picker.</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="grid size-9 place-items-center rounded-lg bg-white/5 text-white/50 hover:bg-white/10">
                <IconX size={18} />
              </button>
            </div>
            <div className="space-y-7">
              <section>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white/35">{t("clips.duration")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {durations.map((value) => (
                    <button key={value} onClick={() => setSettings({ ...settings, durationSeconds: value })} className={`rounded-xl border px-2 py-3 text-sm font-bold transition ${settings.durationSeconds === value ? "border-[var(--color-accent)]/55 bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-white/7 bg-white/3 text-white/45 hover:bg-white/7"}`}>
                      {durationLabel(value)}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white/35">{t("clips.quality")}</p>
                <div className="space-y-2">
                  {([
                    ["low", t("clips.light"), t("clips.lightDescription")],
                    ["medium", t("clips.balanced"), t("clips.balancedDescription")],
                    ["high", t("clips.high"), t("clips.highDescription")],
                  ] as const).map(([value, title, description]) => (
                    <button key={value} onClick={() => setSettings({ ...settings, quality: value })} className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-left transition ${settings.quality === value ? "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/10" : "border-white/7 bg-white/3 hover:bg-white/6"}`}>
                      <div>
                        <p className="text-sm font-bold">{title}</p>
                        <p className="mt-0.5 text-xs text-white/30">{description}</p>
                      </div>
                      {settings.quality === value && <IconCheck className="text-[var(--color-accent)]" size={18} />}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white/35">{t("clips.frames")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[30, 60].map((fps) => (
                    <button key={fps} onClick={() => setSettings({ ...settings, fps })} className={`rounded-xl border py-3 text-sm font-bold ${settings.fps === fps ? "border-[var(--color-accent)]/55 bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-white/7 bg-white/3 text-white/45"}`}>
                      {fps} FPS
                    </button>
                  ))}
                </div>
              </section>
              <section className="space-y-2">
                <button onClick={() => setSettings({ ...settings, captureSystemAudio: !settings.captureSystemAudio })} className="flex w-full items-center justify-between rounded-xl border border-white/7 bg-white/3 p-4 text-left">
                  <div>
                    <p className="text-sm font-bold">{t("clips.systemAudio")}</p>
                    <p className="mt-0.5 text-xs text-white/30">Captures full PC audio through Windows loopback.</p>
                  </div>
                  <span className={`relative h-6 w-11 rounded-full transition ${settings.captureSystemAudio ? "bg-[var(--color-accent)]" : "bg-white/12"}`}>
                    <span className={`absolute top-1 size-4 rounded-full bg-white transition-all ${settings.captureSystemAudio ? "left-6" : "left-1"}`} />
                  </span>
                </button>
              </section>
              <section className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-white/35">{t("clips.microphone")}</p>
                <select value={settings.microphoneDevice || ""} onChange={(event) => setSettings({ ...settings, microphoneDevice: event.target.value })} className="w-full rounded-xl border border-white/10 bg-[var(--color-surface)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--color-accent)]/60">
                  <option value="">{t("clips.noAudio")}</option>
                  {audioDevices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
                <p className="flex items-center gap-2 text-[11px] text-white/30">
                  <IconMicrophone size={13} /> Open settings after FFmpeg is installed to refresh devices.
                </p>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
