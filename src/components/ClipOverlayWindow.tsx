import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useLauncherTranslation } from "../utils/languageContext";

interface ClipInfo {
  name: string;
  path: string;
  size: number;
  createdAt: number;
}

export default function ClipOverlayWindow() {
  const t = useLauncherTranslation();
  const [clip, setClip] = useState<ClipInfo | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path");
    if (!path) return null;
    return {
      path,
      name: params.get("name") || "Modstack Clip.mp4",
      size: Number(params.get("size") || 0),
      createdAt: Number(params.get("createdAt") || Date.now() / 1000),
    };
  });

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const root = document.getElementById("root");
    if (root) root.style.background = "transparent";
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setClip(null), 4100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent p-0 font-sans text-white">
      {clip && <div className="flex h-[90px] w-[304px] overflow-hidden bg-black/95 shadow-2xl shadow-black/60">
        <div className="w-1.5 shrink-0 bg-accent" />
        <div className="flex min-w-0 flex-1 items-center gap-5 px-7">
          <div className="h-[40px] w-[72px] shrink-0 overflow-hidden bg-[#090d16]">
            <video
              src={convertFileSrc(clip.path)}
              muted
              preload="metadata"
              className="size-full object-cover"
            />
          </div>
          <p className="text-sm font-semibold tracking-[-0.01em] text-white">
            {t("clips.savedOverlayTitle")} 
          </p>
        </div>
      </div>}
    </div>
  );
}
