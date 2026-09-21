import { uiText, useUiLanguage } from "../utils/uiTranslation";
import { useEffect, useState } from "react";
import { getActiveId, loadSkinDataUrl } from "../utils/skinsStore";

export default function PlayerHead({ username }: { username?: string }) {
  useUiLanguage();
  const [skin, setSkin] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let generation = 0;
    let disposed = false;
    const refresh = async () => {
      const request = ++generation;
      setFailed(false); setSkin(null);
      const id = getActiveId();
      const data = id ? await loadSkinDataUrl(id) : null;
      if (!disposed && generation === request) setSkin(data);
    };
    void refresh();
    window.addEventListener("modstack:active-skin-changed", refresh);
    return () => { disposed = true; window.removeEventListener("modstack:active-skin-changed", refresh); };
  }, [username]);
  return <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-accent/25 bg-accent/10 shadow-lg" role="img" aria-label={uiText("ui.cabezaDe", { 0: username || "Steve" })}>
    {skin ? <>
      <div className="absolute inset-0" style={{ backgroundImage: `url(${JSON.stringify(skin)})`, backgroundSize: "800% 800%", backgroundPosition: "14.2857% 14.2857%", imageRendering: "pixelated" }} />
      <div className="absolute inset-0" style={{ backgroundImage: `url(${JSON.stringify(skin)})`, backgroundSize: "800% 800%", backgroundPosition: "71.4286% 14.2857%", imageRendering: "pixelated" }} />
    </> : <img className="size-full object-contain" style={{ imageRendering: "pixelated" }} src={!failed && username ? `https://mineskin.eu/helm/${encodeURIComponent(username)}/64.png` : "./steve-helm.png"} alt="" onError={() => setFailed(true)} />}
  </div>;
}
