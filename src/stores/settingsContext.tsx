import { createContext, useContext, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  animations: boolean;
  setAnimations: (animations: boolean) => void;
  animatedBackground: boolean;
  setAnimatedBackground: (animatedBackground: boolean) => void;
  hideLauncher: boolean;
  setHideLauncher: (hideLauncher: boolean) => void;
  discordRPC: boolean;
  setDiscordRPC: (discordRPC: boolean) => void;
  windowWidth: number;
  setWindowWidth: (windowWidth: number) => void;
  windowHeight: number;
  setWindowHeight: (windowHeight: number) => void;
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
  minRAM: number;
  setMinRAM: (minRAM: number) => void;
  maxRAM: number;
  setMaxRAM: (maxRAM: number) => void;
  hardwareAcceleration: boolean;
  setHardwareAcceleration: (hardwareAcceleration: boolean) => void;
  downloadConcurrency: number;
  setDownloadConcurrency: (downloadConcurrency: number) => void;
  forceIpv4: boolean;
  setForceIpv4: (forceIpv4: boolean) => void;
}

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [loaded, setLoaded] = useState(false);

  const [animations, setAnimations] = useState<boolean>(true);
  const [animatedBackground, setAnimatedBackground] = useState<boolean>(true);
  const [hideLauncher, setHideLauncher] = useState<boolean>(false);
  const [discordRPC, setDiscordRPC] = useState<boolean>(true);

  const [windowWidth, setWindowWidth] = useState<number>(1280);
  const [windowHeight, setWindowHeight] = useState<number>(720);
  const [fullscreen, setFullscreen] = useState<boolean>(false);

  const [minRAM, setMinRAM] = useState<number>(512);
  const [maxRAM, setMaxRAM] = useState<number>(4096);
  const [hardwareAcceleration, setHardwareAcceleration] =
    useState<boolean>(false);

  const [downloadConcurrency, setDownloadConcurrency] = useState<number>(10);
  const [forceIpv4, setForceIpv4] = useState<boolean>(true);

  const parseRAM = (ram: any) => {
    if (!ram) return 4096;

    if (typeof ram === "string") {
      const parsed = parseInt(ram.replace("M", ""));
      return Number.isNaN(parsed) ? 4096 : parsed;
    }

    return Number(ram) || 4096;
  };

  const getConfig = async () => {
    try {
      const config: any = await invoke("get_config");

      if (!config) return;

      setAnimations(config?.app?.animations ?? true);
      setAnimatedBackground(config?.app?.["animated-background"] ?? true);
      setHideLauncher(config?.app?.["hide-on-launch"] ?? false);
      setDiscordRPC(config?.app?.["discord-rpc"] ?? true);

      setWindowWidth(Number(config?.game?.width ?? 1280));
      setWindowHeight(Number(config?.game?.height ?? 720));
      setFullscreen(Boolean(config?.game?.fullScreen ?? false));

      setMinRAM(parseRAM(config?.game?.minRAM));
      setMaxRAM(parseRAM(config?.game?.maxRAM));

      setHardwareAcceleration(
        config?.params?.["hardware-acceleration"] ?? false,
      );

      setDownloadConcurrency(Number(config?.resources?.["download-concurrency"] ?? 10));
      setForceIpv4(config?.resources?.["force-ipv4"] ?? true);

      setLoaded(true);
    } catch (err) {
      console.error("Error loading config:", err);
      setLoaded(true);
    }
  };

  useEffect(() => {
    getConfig();
  }, []);

  if (!loaded) {
    return null as any;
  }

  return (
    <SettingsContext.Provider
      value={{
        animations,
        setAnimations,
        animatedBackground,
        setAnimatedBackground,
        hideLauncher,
        setHideLauncher,
        discordRPC,
        setDiscordRPC,
        windowWidth,
        setWindowWidth,
        windowHeight,
        setWindowHeight,
        fullscreen,
        setFullscreen,
        minRAM,
        setMinRAM,
        maxRAM,
        setMaxRAM,
        hardwareAcceleration,
        setHardwareAcceleration,
        downloadConcurrency,
        setDownloadConcurrency,
        forceIpv4,
        setForceIpv4,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
