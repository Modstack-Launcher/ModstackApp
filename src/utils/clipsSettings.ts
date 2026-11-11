export interface ClipSettings {
  /** Replay buffer is on. Turned off by "stop replay" (button or shortcut). */
  enabled?: boolean;
  /** Turn the replay buffer on when the launcher starts. */
  autoStart?: boolean;
  durationSeconds: number;
  fps: number;
  quality: "low" | "medium" | "high";
  ffmpegPath?: string;
  captureSystemAudio?: boolean;
  microphoneDevice?: string;
  /** Global shortcut that saves a clip (also turns replay on if it is off). */
  saveShortcut?: string;
  /** Global shortcut that turns the replay buffer on/off. */
  toggleShortcut?: string;
}

export const CLIPS_SETTINGS_KEY = "modstack-clips-settings-v1";
export const DEFAULT_SAVE_SHORTCUT = "Alt+F7";
export const DEFAULT_TOGGLE_SHORTCUT = "Alt+F8";

export const defaultClipSettings: ClipSettings = {
  enabled: false,
  autoStart: true,
  durationSeconds: 30,
  fps: 60,
  quality: "medium",
  captureSystemAudio: false,
  saveShortcut: DEFAULT_SAVE_SHORTCUT,
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
};

export function readClipSettings(): ClipSettings {
  try {
    const stored = {
      ...defaultClipSettings,
      ...JSON.parse(localStorage.getItem(CLIPS_SETTINGS_KEY) || "{}"),
    };
    if (stored.enabled === undefined) stored.enabled = false;
    if (stored.autoStart === undefined) stored.autoStart = true;
    if (!stored.saveShortcut) stored.saveShortcut = DEFAULT_SAVE_SHORTCUT;
    if (!stored.toggleShortcut) stored.toggleShortcut = DEFAULT_TOGGLE_SHORTCUT;
    delete stored.ffmpegPath;
    return stored;
  } catch {
    return defaultClipSettings;
  }
}

export function saveClipSettings(settings: ClipSettings) {
  try {
    localStorage.setItem(CLIPS_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: keep running with in-memory settings */
  }
  window.dispatchEvent(new Event("modstack-clips-settings-changed"));
}

/** "Alt+F7" -> "Alt + F7" for display. */
export function formatShortcut(value?: string) {
  return (value || "").split("+").filter(Boolean).join(" + ");
}
