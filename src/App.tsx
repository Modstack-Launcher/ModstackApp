import { useEffect, useState } from "react";
import { Activity } from "react";
import { useNavigation } from "./hooks/useNavigation";
import { Toast, toast } from "@heroui/react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
};

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
    <div className="w-screen h-screen flex flex-col bg-background overflow-hidden rounded-xl">
      <Toast.Provider placement="top" className="top-11" />

      {!loadingDone && <Loading onDone={() => setLoadingDone(true)} />}

      <UpdateNotification />
      <Frame />

      <div className="flex-1 flex min-h-0">
        <NavBar />

        {Object.entries(views).map(([key]) => (
          <div
            key={key}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: currentPath === key ? "flex" : "none",
              flexDirection: "column",
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
      <AppInner />
    </UpdateProvider>
  );
}
