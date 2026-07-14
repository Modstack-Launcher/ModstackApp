import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { toast } from "@heroui/react";
import { ClipSettings, readClipSettings } from "../utils/clipsSettings";
import { useLauncherTranslation } from "../utils/languageContext";

interface ClipInfo {
  name: string;
  path: string;
  thumbnailPath?: string | null;
  size: number;
  createdAt: number;
}

const launcherBlue = "var(--color-accent)";

function readRuntimeSettings(): ClipSettings {
  return { ...readClipSettings(), enabled: true };
}

function withScreen(settings: ClipSettings) {
  return {
    ...settings,
    microphoneDevice: settings.microphoneDevice || undefined,
    captureWidth: window.screen.width,
    captureHeight: window.screen.height,
  };
}

export default function ClipsRuntime() {
  const t = useLauncherTranslation();
  const settingsRef = useRef(readRuntimeSettings());
  const busyRef = useRef(false);
  const disabledForSessionRef = useRef(false);
  const installingRef = useRef(false);
  const restartPromiseRef = useRef<Promise<boolean> | null>(null);

  const startBuffer = useCallback(async (forceRestart = false) => {
    if (!forceRestart && restartPromiseRef.current) {
      return restartPromiseRef.current;
    }
    if (disabledForSessionRef.current) return false;
    const settings = settingsRef.current;

    let ready = await invoke<boolean>("clips_ffmpeg_available", { path: settings.ffmpegPath || null });
    if (!ready && !installingRef.current) {
      installingRef.current = true;
      try {
        const ffmpegPath = await invoke<string>("clips_install_ffmpeg");
        settingsRef.current = { ...settingsRef.current, ffmpegPath, enabled: true };
        ready = true;
      } finally {
        installingRef.current = false;
      }
    }
    if (!ready) return false;

    const active = await invoke<boolean>("clips_status");
    if (active && !forceRestart) return true;
    if (active && forceRestart) await invoke("clips_stop");

    await invoke("clips_start", { settings: withScreen({ ...settingsRef.current, enabled: true }) });
    return true;
  }, []);

  const saveMoment = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    let saved = false;
    try {
      const active = await startBuffer(false);
      if (!active) {
        toast.danger(t("clips.replayOff"), {
          description: "Replay is still starting. Try again in a couple seconds.",
        });
        return;
      }

      const clip = await invoke<ClipInfo>("clips_save_and_restart", { settings: settingsRef.current });
      saved = true;
      await emit("clips-saved", clip);
      invoke("clips_show_overlay", {
        clip,
        title: t("clips.savedOverlayTitle"),
        accent: launcherBlue,
      }).catch((error) => {
        console.warn("Clip overlay failed", error);
      });
    } catch (error) {
      toast.danger(t("clips.saveFailed"), { description: String(error) });
    } finally {
      if (saved) {
        await emit("clips-replay-status", true);
      }
      busyRef.current = false;
    }
  }, [startBuffer, t]);

  useEffect(() => {
    settingsRef.current = readRuntimeSettings();
    startBuffer(false).catch(console.error);
    const timer = window.setInterval(() => startBuffer(false).catch(console.error), 15000);
    return () => clearInterval(timer);
  }, [startBuffer]);

  useEffect(() => {
    const onSettingsChanged = () => {
      const next = readClipSettings();
      disabledForSessionRef.current = next.enabled === false;
      settingsRef.current = { ...next, enabled: !disabledForSessionRef.current };
      startBuffer(true).catch(console.error);
    };
    window.addEventListener("modstack-clips-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("modstack-clips-settings-changed", onSettingsChanged);
  }, [startBuffer]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen("clips-shortcut", () => saveMoment()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [saveMoment]);

  return null;
}
