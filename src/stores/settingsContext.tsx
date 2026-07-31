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
  dnsOverHttps: boolean;
  setDnsOverHttps: (dnsOverHttps: boolean) => void;
  hideMusic: boolean;
  setHideMusic: (hideMusic: boolean) => void;
  hideFriends: boolean;
  setHideFriends: (hideFriends: boolean) => void;
  accentColor: string;
  setAccentColor: (accentColor: string) => void;
  sidebarLayout: "right" | "left" | "bottom" | "compact";
  setSidebarLayout: (sidebarLayout: "right" | "left" | "bottom" | "compact") => void;
  dashboardMode: "new" | "classic";
  setDashboardMode: (dashboardMode: "new" | "classic") => void;
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
  const [hardwareAcceleration, setHardwareAcceleration] = useState<boolean>(false);

  const [downloadConcurrency, setDownloadConcurrency] = useState<number>(10);
  const [forceIpv4, setForceIpv4] = useState<boolean>(true);
  const [dnsOverHttps, setDnsOverHttps] = useState<boolean>(false);

  const [hideMusic, setHideMusic] = useState<boolean>(false);
  const [hideFriends, setHideFriends] = useState<boolean>(false);
  const [accentColor, setAccentColor] = useState<string>("blue");
  const [sidebarLayout, setSidebarLayout] = useState<"right" | "left" | "bottom" | "compact">("right");
  const [dashboardMode, setDashboardMode] = useState<"new" | "classic">("new");

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
      const discordRpcEnabled = config?.app?.["discord-rpc"] ?? true;
      setDiscordRPC(discordRpcEnabled);
      invoke("discord_set_enabled", { enabled: discordRpcEnabled }).catch(() => {});
      setHideMusic(config?.app?.["hide-music"] ?? false);
      setHideFriends(config?.app?.["hide-friends"] ?? false);
      setAccentColor(config?.app?.["accent-color"] ?? "blue");
      setSidebarLayout(config?.app?.["sidebar-layout"] ?? "right");
      setDashboardMode(config?.app?.["dashboard-mode"] ?? "new");

      setWindowWidth(Number(config?.game?.width ?? 1280));
      setWindowHeight(Number(config?.game?.height ?? 720));
      setFullscreen(Boolean(config?.game?.fullScreen ?? false));

      setMinRAM(parseRAM(config?.game?.minRAM));
      setMaxRAM(parseRAM(config?.game?.maxRAM));

      setHardwareAcceleration(config?.params?.["hardware-acceleration"] ?? false);

      setDownloadConcurrency(Number(config?.resources?.["download-concurrency"] ?? 10));
      setForceIpv4(config?.resources?.["force-ipv4"] ?? true);
      setDnsOverHttps(config?.resources?.["dns-over-https"] ?? false);

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
        animations, setAnimations,
        animatedBackground, setAnimatedBackground,
        hideLauncher, setHideLauncher,
        discordRPC, setDiscordRPC,
        windowWidth, setWindowWidth,
        windowHeight, setWindowHeight,
        fullscreen, setFullscreen,
        minRAM, setMinRAM,
        maxRAM, setMaxRAM,
        hardwareAcceleration, setHardwareAcceleration,
        downloadConcurrency, setDownloadConcurrency,
        forceIpv4, setForceIpv4,
        dnsOverHttps, setDnsOverHttps,
        hideMusic, setHideMusic,
        hideFriends, setHideFriends,
        accentColor, setAccentColor,
        sidebarLayout, setSidebarLayout,
        dashboardMode, setDashboardMode,
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
