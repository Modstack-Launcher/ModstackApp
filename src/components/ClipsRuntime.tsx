import { uiText, useUiLanguage } from "../utils/uiTranslation";
import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { toast } from "@heroui/react";
import {
  ClipSettings,
  DEFAULT_SAVE_SHORTCUT,
  DEFAULT_TOGGLE_SHORTCUT,
  formatShortcut,
  readClipSettings,
  saveClipSettings,
} from "../utils/clipsSettings";
import { useLauncherTranslation } from "../utils/languageContext";

interface ClipInfo {
  name: string;
  path: string;
  thumbnailPath?: string | null;
  size: number;
  createdAt: number;
}

const launcherBlue = "var(--color-accent)";

function withScreen(settings: ClipSettings) {
  return {
    ...settings,
    microphoneDevice: settings.microphoneDevice || undefined,
    captureWidth: window.screen.width,
    captureHeight: window.screen.height,
  };
}

function useListen(event: string, handler: () => void) {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen(event, () => handler()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event, handler]);
}

export default function ClipsRuntime() {
  useUiLanguage();
  const t = useLauncherTranslation();
  const settingsRef = useRef<ClipSettings>(readClipSettings());
  const busyRef = useRef(false);
  const installingRef = useRef(false);
  const appliedShortcutsRef = useRef("");

  const showStatus = useCallback((title: string, subtitle: string) => {
    invoke("clips_show_status_overlay", { title, subtitle, accent: launcherBlue })
      .catch((error) => console.warn("Clip status overlay failed", error));
  }, []);

  const saveHint = useCallback(
    () => uiText("clips.saveShortcutHint", { 0: formatShortcut(settingsRef.current.saveShortcut || DEFAULT_SAVE_SHORTCUT) }),
    [],
  );

  const applyShortcuts = useCallback(async (settings: ClipSettings) => {
    const save = settings.saveShortcut || DEFAULT_SAVE_SHORTCUT;
    const toggle = settings.toggleShortcut || DEFAULT_TOGGLE_SHORTCUT;
    const key = `${save}|${toggle}`;
    if (appliedShortcutsRef.current === key) return;
    try {
      await invoke("clips_set_shortcuts", { save, toggle });
      appliedShortcutsRef.current = key;
    } catch (error) {
      toast.danger("Clips", { description: String(error) });
    }
  }, []);

  /** Starts the replay buffer if it is enabled. Returns whether it is running. */
  const startBuffer = useCallback(async () => {
    const settings = settingsRef.current;
    if (settings.enabled === false) {
      await invoke("clips_stop").catch(() => undefined);
      return false;
    }

    let ready = await invoke<boolean>("clips_ffmpeg_available", { path: settings.ffmpegPath || null });
    if (!ready && !installingRef.current) {
      installingRef.current = true;
      try {
        const ffmpegPath = await invoke<string>("clips_install_ffmpeg");
        settingsRef.current = { ...settingsRef.current, ffmpegPath };
        ready = true;
      } finally {
        installingRef.current = false;
      }
    }
    if (!ready) return false;

    // No-op when the recorder already runs with these settings; restarts it otherwise.
    const skippedDevices = await invoke<string[]>("clips_start", { settings: withScreen(settingsRef.current) });
    for (const device of skippedDevices ?? []) {
      toast.warning("Clips", { description: uiText("clips.audioDeviceMissing", { 0: device }) });
    }
    await emit("clips-replay-status", true);
    return true;
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    // Persisting dispatches "modstack-clips-settings-changed", which (re)starts or stops the buffer.
    saveClipSettings({ ...readClipSettings(), enabled });
  }, []);

  const saveMoment = useCallback(async () => {
    if (busyRef.current) return;
    // Shortcut pressed while replay is off: turn it on. There is nothing to save yet.
    const running = await invoke<boolean>("clips_status").catch(() => false);
    if (!running) {
      setEnabled(true);
      showStatus(t("clips.started"), saveHint());
      return;
    }
    busyRef.current = true;
    try {
      const clip = await invoke<ClipInfo>("clips_save", { settings: settingsRef.current });
      await emit("clips-saved", clip);
      invoke("clips_show_overlay", {
        clip,
        title: t("clips.savedOverlayTitle"),
        accent: launcherBlue,
      }).catch((error) => console.warn("Clip overlay failed", error));
    } catch (error) {
      toast.danger(t("clips.saveFailed"), { description: String(error) });
    } finally {
      busyRef.current = false;
    }
  }, [saveHint, setEnabled, showStatus, t]);

  const toggleReplay = useCallback(async () => {
    const running = await invoke<boolean>("clips_status").catch(() => false);
    if (running) {
      setEnabled(false);
      showStatus(t("clips.stoppedOverlay"), uiText("clips.toggleShortcutHint", {
        0: formatShortcut(settingsRef.current.toggleShortcut || DEFAULT_TOGGLE_SHORTCUT),
      }));
    } else {
      setEnabled(true);
      showStatus(t("clips.started"), saveHint());
    }
  }, [saveHint, setEnabled, showStatus, t]);

  // Launch: register the user's shortcuts and auto-start the replay.
  useEffect(() => {
    const initial = readClipSettings();
    void applyShortcuts(initial);
    if (initial.autoStart !== false && initial.enabled === false) {
      // Mark as already on so the settings listener doesn't show the
      // "replay on" toast every time the launcher opens.
      settingsRef.current = { ...initial, enabled: true };
      setEnabled(true);
      return;
    }
    settingsRef.current = initial;
    startBuffer().catch(console.error);
  }, [applyShortcuts, setEnabled, startBuffer]);

  // Keep the buffer alive (FFmpeg can exit on display mode changes).
  useEffect(() => {
    const timer = window.setInterval(() => startBuffer().catch(console.error), 15000);
    return () => clearInterval(timer);
  }, [startBuffer]);

  useEffect(() => {
    const onSettingsChanged = () => {
      const previous = settingsRef.current;
      const next = readClipSettings();
      settingsRef.current = next;
      void applyShortcuts(next);
      startBuffer()
        .then(async (active) => {
          if (!active) await emit("clips-replay-status", false);
          if (active && previous.enabled === false) showStatus(t("clips.started"), saveHint());
        })
        .catch(console.error);
    };
    window.addEventListener("modstack-clips-settings-changed", onSettingsChanged);
    return () => window.removeEventListener("modstack-clips-settings-changed", onSettingsChanged);
  }, [applyShortcuts, saveHint, showStatus, startBuffer, t]);

  // NVIDIA-style "recording is on" toast when a game starts.
  const announceOnLaunch = useCallback(() => {
    if (settingsRef.current.enabled === false) return;
    startBuffer()
      .then((active) => { if (active) showStatus(t("clips.started"), saveHint()); })
      .catch(console.error);
  }, [saveHint, showStatus, startBuffer, t]);

  const onSaveShortcut = useCallback(() => void saveMoment(), [saveMoment]);
  const onToggleShortcut = useCallback(() => void toggleReplay(), [toggleReplay]);
  useListen("clips-shortcut", onSaveShortcut);
  useListen("clips-toggle-shortcut", onToggleShortcut);
  useListen("minecraft-started", announceOnLaunch);

  return null;
}
