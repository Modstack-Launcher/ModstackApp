export type InstanceRuntimeSettings = {
  memoryMode: "global" | "custom";
  minRamMb: number;
  maxRamMb: number;
  javaMode: "auto" | "custom";
  javaPath: string;
  resolutionMode: "global" | "custom";
  width: number;
  height: number;
  fullscreen: boolean;
  extraJvmArgs: string;
  environmentVariables: string;
  preLaunchCommand: string;
  wrapperCommand: string;
  postExitCommand: string;
};

const STORAGE_PREFIX = "modstack.instanceRuntime.";

export function defaultInstanceRuntimeSettings(globalMaxRam = 4096, width = 854, height = 480, fullscreen = false): InstanceRuntimeSettings {
  const maxRamMb = Math.max(1024, Number(globalMaxRam) || 4096);
  return {
    memoryMode: "global",
    minRamMb: Math.max(512, Math.floor(maxRamMb / 4)),
    maxRamMb,
    javaMode: "auto",
    javaPath: "",
    resolutionMode: "global",
    width: Math.max(320, Number(width) || 854),
    height: Math.max(240, Number(height) || 480),
    fullscreen: !!fullscreen,
    extraJvmArgs: "",
    environmentVariables: "",
    preLaunchCommand: "",
    wrapperCommand: "",
    postExitCommand: "",
  };
}

export function loadInstanceRuntimeSettings(
  instanceId: string,
  globalMaxRam = 4096,
  width = 854,
  height = 480,
  fullscreen = false,
): InstanceRuntimeSettings {
  const defaults = defaultInstanceRuntimeSettings(globalMaxRam, width, height, fullscreen);
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${instanceId}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<InstanceRuntimeSettings>;
    return {
      ...defaults,
      ...parsed,
      minRamMb: Math.max(512, Number(parsed.minRamMb ?? defaults.minRamMb)),
      maxRamMb: Math.max(1024, Number(parsed.maxRamMb ?? defaults.maxRamMb)),
      width: Math.max(320, Number(parsed.width ?? defaults.width)),
      height: Math.max(240, Number(parsed.height ?? defaults.height)),
      fullscreen: !!(parsed.fullscreen ?? defaults.fullscreen),
    };
  } catch {
    return defaults;
  }
}

export function saveInstanceRuntimeSettings(instanceId: string, settings: InstanceRuntimeSettings) {
  window.localStorage.setItem(`${STORAGE_PREFIX}${instanceId}`, JSON.stringify(settings));
}

export function runtimeSettingsForLaunch(instanceId: string): InstanceRuntimeSettings | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${instanceId}`);
    return raw ? (JSON.parse(raw) as InstanceRuntimeSettings) : null;
  } catch {
    return null;
  }
}
