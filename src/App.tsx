import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Activity } from "react";
import { useNavigation } from "./hooks/useNavigation";
import { Toast, toast } from "@heroui/react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Multiplayer from "./views/Multiplayer";
import { MultiplayerProvider } from "./stores/multiplayerContext";

import Frame from "./components/Frame";
import NavBar from "./components/NavBar";
import { UpdateNotification } from "./components/UpdateNotification";

import Home from "./views/Home";
import Settings from "./views/Settings";
import Loading from "./views/Loading";
import Skins from "./views/Skins";
import Instances from "./views/Instances";
import Bedrock from "./views/Bedrock";
import ServerBrowser from "./views/ServerBrowser";
import Music from "./views/Music";
import MusicMiniPlayer from "./components/MusicMiniPlayer";
import ClipsRuntime from "./components/ClipsRuntime";
import Friends from "./views/Friends";
import Clips from "./views/Clips";

import { useAuth } from "./stores/authContext";
import { useSettings } from "./stores/settingsContext";
import { useLauncherTranslation } from "./utils/languageContext";
import { UpdateProvider, useUpdate } from "./stores/updateContext";


import {
  getMinecraftProfile,
  getSkinModelFromProfile,
  getSkinUrlFromProfile,
} from "./utils/mojang";

const views = {
  home: Home,
  settings: Settings,
  skins: Skins,
  instances: Instances,
  bedrock: Bedrock,
  server_browser: ServerBrowser,
  music: Music,
  clips: Clips,
  multiplayer: Multiplayer,
};

const PRESET_ACCENTS = new Set(["blue", "green", "cyan", "amber", "red", "pink", "purple"]);

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string) {
  const raw = hex.slice(1);
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function hexToHue(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const rp = r / 255;
  const gp = g / 255;
  const bp = b / 255;
  const max = Math.max(rp, gp, bp);
  const min = Math.min(rp, gp, bp);
  const delta = max - min;
  if (delta === 0) return 265.25;
  let hue = 0;
  if (max === rp) hue = ((gp - bp) / delta) % 6;
  else if (max === gp) hue = (bp - rp) / delta + 2;
  else hue = (rp - gp) / delta + 4;
  return Math.round((hue * 60 + 360) % 360);
}

interface LocalInstance {
  id: string;
  title: string;
  minecraft_version: string;
  loader: string;
  icon_path: string | null;
  background_path: string | null;
  created_at: number;
}

function AppInner() {
  const currentPath = useNavigation((s) => s.currentPath);
  const push = useNavigation((s) => s.push);
  const t = useLauncherTranslation();
  const { accentColor, sidebarLayout } = useSettings();
  const isCustomAccent = isHexColor(accentColor);
  const themeColorKey = PRESET_ACCENTS.has(accentColor) ? accentColor : isCustomAccent ? "custom" : "blue";
  const themeStyle = useMemo(() => {
    if (!isCustomAccent) return undefined;
    const hue = hexToHue(accentColor);
    return {
      "--accent": accentColor,
      "--focus": accentColor,
      "--accent-foreground": "oklch(99.11% 0 0)",
      "--background": `color-mix(in srgb, ${accentColor} 18%, #050507)`,
      "--border": `color-mix(in srgb, ${accentColor} 38%, #27272f)`,
      "--default": `color-mix(in srgb, ${accentColor} 26%, #252733)`,
      "--field-background": `color-mix(in srgb, ${accentColor} 28%, #101119)`,
      "--field-foreground": "oklch(99.11% 0.02 0)",
      "--field-placeholder": `color-mix(in srgb, ${accentColor} 36%, #b9bdca)`,
      "--foreground": "oklch(99.11% 0.02 0)",
      "--muted": `color-mix(in srgb, ${accentColor} 42%, #b9bdca)`,
      "--overlay": `color-mix(in srgb, ${accentColor} 26%, #101119)`,
      "--overlay-foreground": "oklch(99.11% 0.02 0)",
      "--scrollbar": `color-mix(in srgb, ${accentColor} 48%, #aeb4c2)`,
      "--segment": `color-mix(in srgb, ${accentColor} 36%, #2c2d38)`,
      "--segment-foreground": "oklch(99.11% 0.02 0)",
      "--separator": `color-mix(in srgb, ${accentColor} 30%, #20212a)`,
      "--surface": `color-mix(in srgb, ${accentColor} 28%, #101119)`,
      "--surface-foreground": "oklch(99.11% 0.02 0)",
      "--surface-secondary": `color-mix(in srgb, ${accentColor} 34%, #171923)`,
      "--surface-secondary-foreground": "oklch(99.11% 0.02 0)",
      "--surface-tertiary": `color-mix(in srgb, ${accentColor} 40%, #20222d)`,
      "--surface-tertiary-foreground": "oklch(99.11% 0.02 0)",
      "--theme-hue": String(hue),
      "--theme-media-filter": `hue-rotate(${Math.round(hue - 222)}deg) saturate(1.55)`,
    } as CSSProperties;
  }, [accentColor, isCustomAccent]);
  const [loadingDone, setLoadingDone] = useState(false);
  useUpdate();

  const { user } = useAuth();

  const [skinData, setSkinData] = useState<{
    skinUrl: string;
    model: "slim" | "classic";
  } | null>(null);

  useEffect(() => {
    if (!user?.minecraft?.name) return;

    (async () => {
      try {
        console.log("[App] loading skin:", user.minecraft.name);

        const profile = await getMinecraftProfile(user.minecraft.name);
        const model = getSkinModelFromProfile(profile);
        const skinUrl = getSkinUrlFromProfile(profile);

        console.log("[App] skin:", skinUrl);
        console.log("[App] model:", model);
        console.log("[App] profile raw:", JSON.stringify(profile).substring(0, 200));
        
        setSkinData({ skinUrl, model });
      } catch (e) {
        console.error("[App] error loading profile:", e); 
        setSkinData({
          skinUrl: "/steve.png", 
          model: "classic",
        });
      }
    })();
  }, [user]);

  useEffect(() => {
    getCurrentWindow()
      .show()
      .catch((e) => console.error("[App] failed to show window:", e));
  }, []);

  useEffect(() => {
    emit("frontend-ready", {});

    const unlistenPromise = listen<string>("open-mrstack", async (event) => {
      const mrstackPath = event.payload;
      try {
        const inst = await invoke<LocalInstance>("import_mrstack", {
          mrstackPath,
        });
        toast(`Instance "${inst.title}" ${t("inst.importedSuccess")}`);
        push("instances");
      } catch (e) {
        toast.danger("Error importing .mrstack", { description: String(e) });
      }
    });

    return () => {
      unlistenPromise.then((f) => f());
    };
  }, [push]);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const renderView = (key: string) => {
    switch (key) {
      case "home":
        return <Home />;

      case "settings":
        return <Settings />;

      case "instances":
        return <Instances />;

      case "bedrock":
        return <Bedrock />;

      case "server_browser":
        return <ServerBrowser />;

      case "music":
        return <Music />;

      case "clips":
        return <Clips />;

      case "multiplayer":
        return <Multiplayer />;  

      case "skins":
        if (!skinData) {
          return (
            <div className="w-full h-full flex items-center justify-center text-white/60">
              {t("app.loginSkin")}
            </div>
          );
        }

        return (
          <Skins
            skinUrl={skinData.skinUrl}
            username={user?.minecraft?.name || "Player"}
          />
        );
    }
  };

  return (
    <div data-theme="dark" data-color={themeColorKey} style={themeStyle} className="w-screen h-screen flex flex-col bg-background overflow-hidden rounded-xl">
      <Toast.Provider placement="top" className="top-11" />

      {!loadingDone && <Loading onDone={() => setLoadingDone(true)} />}

      <UpdateNotification />
      <Frame />

      <div className="flex-1 flex min-h-0">
        <div style={{ order: sidebarLayout === "left" ? 2 : 0 }}>
          <NavBar />
        </div>

        {Object.entries(views).map(([key]) => (
          <div
            key={key}
            style={{
              position: "relative",
              order: sidebarLayout === "left" ? 1 : 0,
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: currentPath === key ? "flex" : "none",
              flexDirection: "column",
              paddingBottom: sidebarLayout === "bottom" ? 230 : 0,
              boxSizing: "border-box",
            }}
          >
            <Activity mode={currentPath === key ? "visible" : "hidden"}>
              {renderView(key)}
            </Activity>
          </div>
        ))}
      </div>

      <Friends />
      <ClipsRuntime />
      <MusicMiniPlayer />
    </div>
  );
}

export default function App() {
  return (
    <UpdateProvider>
      <MultiplayerProvider>
        <AppInner />
      </MultiplayerProvider>
    </UpdateProvider>
  );
}
