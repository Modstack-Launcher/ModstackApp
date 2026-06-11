import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import NewsCarousel from "../components/NewsCarousel";
import bedrockHero from "../assets/modstack-bedrock.png";
import {
  bedrockGetStatus, bedrockInstall, bedrockLaunch, BedrockStatus,
} from "../utils/bedrock";
import { useAuth } from "../stores/authContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLauncherTranslation } from "../utils/languageContext";

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
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">

        <div className="w-full h-[50vh] overflow-hidden flex-shrink-0 relative bg-black">
          {customBg && (
            <img src={customBg} alt="background" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-black/20" />
          <img
            src={bedrockHero}
            alt="Modstack Bedrock"
            className="absolute bottom-1 right-1 h-16 object-contain opacity-90 pointer-events-none select-none"
            style={{ filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.7))" }}
          />
        </div>

        <div className="h-14 grid grid-cols-3 bg-surface-secondary shadow flex-shrink-0 sticky top-0 z-10 overflow-visible">
          <div className="flex items-center px-4 text-sm text-foreground/50 select-none">
            {status?.version && <span>v{status.version}</span>}
          </div>

          <Button
            isDisabled={isButtonDisabled()}
            onPress={handleButtonPress}
            className="justify-self-center relative -top-5 min-w-64 w-auto h-14 font-minecraft text-3xl text-shadow-[0_3px_#0000005e] text-foreground bg-transparent hover:saturate-80 disabled:opacity-100 disabled:hover:saturate-30"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="none"
              viewBox="0 0 496 108"
              fill="none"
              className="absolute -z-10 w-full h-full"
            >
              <path
                d="M2 10v88h8v8h476v-8h8V10h-8V2H10v8H2z"
                fill="color-mix(in srgb, var(--color-accent) 50%, black 50%)"
                stroke="#000" strokeWidth={4}
              />
              <path d="M12 10v88h472V10H12z" fill="var(--color-accent)" />
              <path
                d="M12 11h472V4H12v6z"
                fill="color-mix(in srgb, var(--color-accent) 80%, white 20%)"
              />
            </svg>
            <span className="relative z-10 text-center leading-tight px-4">
              {buttonLabel()}
            </span>
          </Button>

          <div className="flex items-center justify-end px-4">
            {customBg ? (
              <button
                onClick={handleRemoveBg}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs text-foreground/60 hover:text-foreground bg-black/20 hover:bg-black/40 transition-colors border border-foreground/10"
              >
                <i className="ti ti-x" style={{ fontSize: 12 }} /> {t("bedrock.removeBackground")}
              </button>
            ) : (
              <button
                onClick={handlePickBg}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs text-foreground/60 hover:text-foreground bg-black/20 hover:bg-black/40 transition-colors border border-foreground/10"
              >
                <i className="ti ti-photo" style={{ fontSize: 13 }} /> {t("bedrock.changeBackground")}
              </button>
            )}
          </div>
        </div>

        {playState === "error" && errorMsg && (
          <div className="mx-4 mt-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {errorMsg}
          </div>
        )}

        {showAlreadyInstalled && (
          <div className="mx-4 mt-3 p-4 rounded-lg bg-surface-secondary border border-accent/30 flex flex-col gap-3">
            <p className="text-sm text-foreground/80">
              {status?.store_installed
                ? t("bedrock.alreadyInstalledStore")
                : t("bedrock.alreadyInstalled")}{" "}
              {status?.version && (
                <span className="text-foreground/50">(v{status.version})</span>
              )}
            </p>
            <p className="text-xs text-foreground/50">{t("bedrock.whatToDo")}</p>
            <div className="flex gap-2">
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
        )}

        <div className="p-4">
          <NewsCarousel />
        </div>
      </div>
    </div>
  );
}