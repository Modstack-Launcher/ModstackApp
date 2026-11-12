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
const AUTOSTART_OFF_MIGRATION_KEY = "modstack-clips-autostart-off-migrated";
export const DEFAULT_SAVE_SHORTCUT = "Alt+F7";
export const DEFAULT_TOGGLE_SHORTCUT = "Alt+F8";

export const defaultClipSettings: ClipSettings = {
  enabled: false,
  autoStart: false,
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
    if (stored.autoStart === undefined) stored.autoStart = false;
    // Auto-start used to be on by default and was saved with the rest of the
    // settings. Turn it off once so it is opt-in for existing installs too.
    if (!localStorage.getItem(AUTOSTART_OFF_MIGRATION_KEY)) {
      localStorage.setItem(AUTOSTART_OFF_MIGRATION_KEY, "1");
      if (stored.autoStart) {
        stored.autoStart = false;
        localStorage.setItem(CLIPS_SETTINGS_KEY, JSON.stringify({ ...stored, autoStart: false }));
      }
    }
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
