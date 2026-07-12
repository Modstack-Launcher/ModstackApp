import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import NewsCarousel from "../components/NewsCarousel";
import bedrockHero from "../assets/modstack-bedrock.png";
import bedrockDefault from "../assets/modstack-default.jpg";
import {
  bedrockGetStatus, bedrockInstall, bedrockLaunch, BedrockStatus,
} from "../utils/bedrock";
import { useAuth } from "../stores/authContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLauncherTranslation } from "../utils/languageContext";
import { IconChevronRight, IconX, IconPhoto } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import HomeSidebar from "../components/HomeSidebar";

type PlayState =
  | "checking" | "not_installed" | "installing"
  | "ready" | "launching" | "playing" | "error";

export default function Bedrock() {
  const t = useLauncherTranslation();
  const { refreshMicrosoftToken } = useAuth();

  const [status, setStatus] = useState<BedrockStatus | null>(null);
  const [playState, setPlayState] = useState<PlayState>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [showAlreadyInstalled, setShowAlreadyInstalled] = useState(false);
  const [customBg, setCustomBg] = useState<string | null>(() => localStorage.getItem("bedrock_bg"));
  const [newsOpen, setNewsOpen] = useState(false);

  const handlePickBg = async () => {
    try {
      const p = await open({
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (typeof p === "string") {
        const url = convertFileSrc(p);
        setCustomBg(url);
        localStorage.setItem("bedrock_bg", url);
      }
    } catch {}
  };

  const handleRemoveBg = () => {
    setCustomBg(null);
    localStorage.removeItem("bedrock_bg");
  };

  useEffect(() => {
    checkStatus();
    const unlisten: Array<() => void> = [];

    listen<BedrockStatus>("bedrock-already-installed", (e) => {
      setStatus(e.payload);
      setPlayState("ready");
      setShowAlreadyInstalled(true);
    }).then((u) => unlisten.push(u));

    listen("bedrock-installed", () => {
      setPlayState("ready");
      setShowAlreadyInstalled(false);
      checkStatus();
    }).then((u) => unlisten.push(u));

    listen("bedrock-launched", () => {
      setPlayState("playing");
      setShowAlreadyInstalled(false);
    }).then((u) => unlisten.push(u));

    listen("bedrock-closed", () => {
      setPlayState("ready");
    }).then((u) => unlisten.push(u));

    return () => unlisten.forEach((u) => u());
  }, []);

  async function checkStatus() {
    setPlayState("checking");
    try {
      const s = await bedrockGetStatus();
      setStatus(s);
      setPlayState(s.installed ? "ready" : "not_installed");
    } catch {
      setPlayState("error");
      setErrorMsg(t("bedrock.errorStatus"));
    }
  }

  async function getMsToken(): Promise<string> {
    const fresh = await refreshMicrosoftToken();
    if (!fresh) throw new Error("No active Microsoft session. Please sign in first.");
    return fresh;
  }

  async function handleInstall(force = false) {
    setPlayState("installing");
    setErrorMsg("");
    setShowAlreadyInstalled(false);
    try {
      const token = await getMsToken();
      await bedrockInstall(force, token);
    } catch (e: any) {
      setErrorMsg(e?.toString() ?? "Unknown error");
      setPlayState("error");
    }
  }

  async function handlePlay() {
    setPlayState("launching");
    setErrorMsg("");
    setShowAlreadyInstalled(false);
    try {
      await bedrockLaunch();
    } catch (e: any) {
      setErrorMsg(e?.toString() ?? "Error launching game");
      setPlayState("error");
      setTimeout(() => setPlayState("ready"), 4000);
    }
  }

  function buttonLabel(): string {
    switch (playState) {
      case "checking":      return t("bedrock.checking");
      case "not_installed": return t("bedrock.install");
      case "installing":    return t("bedrock.installing");
      case "ready":         return t("bedrock.play");
      case "launching":     return t("bedrock.launching");
      case "playing":       return t("bedrock.playing");
      case "error":         return t("bedrock.retry");
      default:              return t("bedrock.play");
    }
  }

  function isButtonDisabled(): boolean {
    return ["checking", "installing", "launching", "playing"].includes(playState);
  }

  function handleButtonPress() {
    if (isButtonDisabled()) return;
    if (playState === "not_installed" || playState === "error") handleInstall(false);
    else if (playState === "ready") handlePlay();
  }

  return (
    <div className="w-full h-full flex min-h-0">
    <div className="flex-1 h-full flex flex-col min-h-0 relative overflow-hidden">
      <img
        src={bedrockDefault}
        alt=""
        className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
      />
      {customBg && (
        <img src={customBg} alt="background" className="absolute inset-0 w-full h-full object-cover" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent pointer-events-none" />

      <img
        src={bedrockHero}
        alt="Modstack Bedrock"
        className="absolute top-4 right-4 h-10 object-contain opacity-90 pointer-events-none select-none z-10"
        style={{ filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.7))" }}
      />

      <div className="relative z-10 flex-1 flex flex-col justify-end min-h-0 pointer-events-none">
        <div className="flex items-end justify-between px-6 pb-6 pointer-events-auto">
          <div className="flex flex-col gap-2">
            <p className="text-white/60 text-xs font-medium uppercase tracking-widest">Minecraft</p>
            <h1 className="text-white text-2xl font-bold drop-shadow-lg">Bedrock Edition</h1>
            {status?.version && <span className="text-white/40 text-xs">v{status.version}</span>}
            {playState === "error" && errorMsg && (
              <p className="text-red-400 text-xs max-w-xs">{errorMsg}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2">
              {customBg ? (
                <button
                  onClick={handleRemoveBg}
                  className="w-9 h-9 flex items-center justify-center rounded-[10px] text-white/60 hover:text-white border border-white/15 hover:border-white/30 transition-all"
                  style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)" }}
                  title={t("bedrock.removeBackground")}
                >
                  <IconX size={15} />
                </button>
              ) : (
                <button
                  onClick={handlePickBg}
                  className="w-9 h-9 flex items-center justify-center rounded-[10px] text-white/60 hover:text-white border border-white/15 hover:border-white/30 transition-all"
                  style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)" }}
                  title={t("bedrock.changeBackground")}
                >
                  <IconPhoto size={15} />
                </button>
              )}

              <button
                onClick={() => setNewsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-[10px] text-sm text-white/80 hover:text-white border border-white/15 hover:border-white/30 transition-all"
                style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)" }}
              >
                <span className="w-2 h-2 rounded-full bg-[#4b77e7] animate-pulse" />
                {t("home.news") ?? "Noticias"}
                <IconChevronRight size={13} className="text-white/50" />
              </button>
            </div>

            <button
              onClick={handleButtonPress}
              disabled={isButtonDisabled()}
              className="relative flex items-center justify-center font-minecraft text-shadow-[0_3px_#0000005e] text-foreground bg-transparent hover:saturate-80 disabled:opacity-60 disabled:cursor-not-allowed transition-all whitespace-nowrap"
              style={{ width: '256px', height: '56px', fontSize: '30px' }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={496}
                height={108}
                viewBox="0 0 496 108"
                fill="none"
                className="absolute -z-10 w-full h-full"
                preserveAspectRatio="none"
              >
                <path d="M2 10v88h8v8h476v-8h8V10h-8V2H10v8H2z" fill="color-mix(in srgb, var(--color-accent) 50%, black 50%)" stroke="#000" strokeWidth={4} />
                <path d="M12 10v88h472V10H12z" fill="var(--color-accent)" />
                <path d="M12 11h472V4H12v6z" fill="color-mix(in srgb, var(--color-accent) 80%, white 20%)" />
              </svg>
              <span className="relative z-10 text-center leading-tight px-4">
                {buttonLabel()}
              </span>
            </button>
          </div>
        </div>
      </div>

      {showAlreadyInstalled && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAlreadyInstalled(false); }}
        >
          <div
            className="rounded-[16px] shadow-2xl border border-white/10 p-6 flex flex-col gap-4 w-[420px]"
            style={{ backgroundColor: "var(--color-overlay)" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                {status?.store_installed ? t("bedrock.alreadyInstalledStore") : t("bedrock.alreadyInstalled")}
              </h2>
              {status?.version && <span className="text-xs text-white/40">v{status.version}</span>}
            </div>
            <p className="text-sm text-white/60">{t("bedrock.whatToDo")}</p>
            <div className="flex gap-2 mt-1">
              <Button size="sm" className="bg-accent text-foreground font-minecraft" onPress={handlePlay}>
                {t("bedrock.launch")}
              </Button>
              <Button size="sm" className="border-foreground/20 text-foreground/60 font-minecraft" onPress={() => handleInstall(true)}>
                {t("bedrock.reinstall")}
              </Button>
              <Button size="sm" className="text-foreground/40 font-minecraft ml-auto" onPress={() => setShowAlreadyInstalled(false)}>
                {t("bedrock.dismiss")}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {newsOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setNewsOpen(false); }}
        >
          <div
            className="relative rounded-[16px] shadow-2xl border border-white/10 overflow-hidden flex flex-col"
            style={{ width: 720, maxHeight: "80vh", backgroundColor: "var(--color-overlay)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-sm font-bold text-white">{t("home.news") ?? "Noticias"}</span>
              <button
                onClick={() => setNewsOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconX size={15} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <NewsCarousel />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
    <HomeSidebar />
    </div>
  );
}