export interface ClipSettings {
  enabled?: boolean;
  durationSeconds: number;
  fps: number;
  quality: "low" | "medium" | "high";
  ffmpegPath?: string;
  captureSystemAudio?: boolean;
  microphoneDevice?: string;
}

export const CLIPS_SETTINGS_KEY = "modstack-clips-settings-v1";

export const defaultClipSettings: ClipSettings = {
  enabled: false,
  durationSeconds: 30,
  fps: 30,
  quality: "medium",
  captureSystemAudio: false,
};

export function readClipSettings(): ClipSettings {
  try {
    const stored = {
      ...defaultClipSettings,
      ...JSON.parse(localStorage.getItem(CLIPS_SETTINGS_KEY) || "{}"),
    };
    if (stored.enabled === undefined) stored.enabled = false;
    delete stored.ffmpegPath;
    return stored;
  } catch {
    return defaultClipSettings;
  }
}

export function saveClipSettings(settings: ClipSettings) {
  localStorage.setItem(CLIPS_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event("modstack-clips-settings-changed"));
}
