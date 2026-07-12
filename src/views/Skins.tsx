import { useEffect, useRef, useState, useCallback } from "react";
// @ts-ignore
import { SkinViewerGLTF } from "../../src-tauri/src/skin";
import {
  type ArmStyle, type SavedSkin, loadAllSkins, addSkin, updateSkin,
  deleteSkin, getActiveId, setActiveId, uploadSkinToMojang, applySkinLocally,
} from "../utils/skinsStore";
import { useAuth } from "../stores/authContext";
import { toast } from "@heroui/react";
import { ChangeCapeModal, CapeViewer } from "../components/Capes";
import { IconCheck, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useLauncherTranslation } from "../utils/languageContext";
import HomeSidebar from "../components/HomeSidebar";

const STEVE_SKIN_URL = "./steve.png";

function normalizeSkinUrl(url: string): string {
  if (!url) return STEVE_SKIN_URL;
  if (url.includes("mineskin.eu/skin/") && !url.includes("/texture")) {
    return url + "/texture";
  }
  return url;
}

async function resolveSkinUrl(url: string): Promise<string> {
  try {
    const normalized = normalizeSkinUrl(url);
    return await invoke<string>("fetch_skin_as_base64", { url: normalized });
  } catch {
    try {
      return await invoke<string>("fetch_skin_as_base64", {
        url: "https://crafatar.com/skins/8667ba71b85a4004af54457a9734eed7"
      });
    } catch {
      return "./steve.png";
    }
  }
}

function detectSlimFromImage(url: string): Promise<ArmStyle> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve("wide");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(54, 20, 1, 12).data;
        let transparent = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] === 0) transparent++;
        }
        resolve(transparent > 6 ? "slim" : "wide");
      } catch { resolve("wide"); }
    };
    img.onerror = () => resolve("wide");
    img.src = url;
  });
}

type Props = {
  skinUrl: string;
  username: string;
  isPremium?: boolean;
  playerUuid?: string;
};

function SkinHead({ skinUrl, size = 64 }: { skinUrl: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!skinUrl) return;
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = size; canvas.height = size;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
    };
    img.src = skinUrl;
    return () => { active = false; };
  }, [skinUrl, size]);
  return (
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />
  );
}

function MiniViewer({ skinUrl, armStyle }: { skinUrl: string; armStyle: ArmStyle }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !skinUrl) return;
    viewerRef.current?.dispose?.();
    viewerRef.current = null;
    el.innerHTML = "";
    const canvas = document.createElement("canvas");
    el.appendChild(canvas);
    let active = true;
    (async () => {
      try {
        const viewer = new SkinViewerGLTF({ canvas, autoRotate: false, autoRotateSpeed: 0.5 });
        await viewer.loadSkin(skinUrl, armStyle);
        if (!active) { viewer.dispose?.(); return; }
        viewerRef.current = viewer;
      } catch {}
    })();
    return () => {
      active = false;
      viewerRef.current?.dispose?.();
      viewerRef.current = null;
    };
  }, [skinUrl, armStyle]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />;
}

type ModalData =
  | { mode: "add"; dataUrl: string; name: string }
  | { mode: "edit"; skin: SavedSkin };

function SkinModal({
  data: initialData, onSave, onDelete, onClose, onReplaceTexture,
}: {
  data: ModalData;
  onSave: (result: { name: string; dataUrl: string; armStyle: ArmStyle }) => void;
  onDelete?: () => void;
  onClose: () => void;
  onReplaceTexture: () => void;
}) {
  const t = useLauncherTranslation();
  const isEdit = initialData.mode === "edit";

  const [dataUrl, setDataUrl] = useState(isEdit ? initialData.skin.dataUrl : initialData.dataUrl);
  const [name, setName] = useState(isEdit ? initialData.skin.name : initialData.name);
  const [armStyle, setArmStyle] = useState<ArmStyle>(isEdit ? initialData.skin.armStyle : "wide");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit && dataUrl) {
      detectSlimFromImage(dataUrl).then(setArmStyle);
    }
  }, []);

  useEffect(() => {
    (window as any).__modalSetDataUrl = setDataUrl;
    (window as any).__modalSetName = setName;
    return () => {
      delete (window as any).__modalSetDataUrl;
      delete (window as any).__modalSetName;
    };
  }, []);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md" />
      <div className="fixed left-1/2 top-1/2 z-[101] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-border bg-surface text-foreground shadow-[0_32px_90px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between border-b border-border bg-surface-secondary/60 px-5 py-4">
          <div>
            <p className="text-base font-semibold">{isEdit ? t("skins.editSkin") : t("skins.addSkin")}</p>
            <p className="mt-0.5 text-xs text-muted">{t("skins.wardrobeProfile")}</p>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-[10px] border border-border bg-surface text-muted transition-colors hover:border-accent/40 hover:text-foreground"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="flex min-h-[390px]">
          <div
            className="relative flex w-[215px] shrink-0 flex-col items-center justify-end overflow-hidden border-r border-border bg-surface-secondary pb-9"
            style={{
              background: "radial-gradient(circle at 50% 18%, color-mix(in oklch, var(--accent) 18%, transparent), transparent 34%), linear-gradient(180deg, var(--color-surface-secondary), var(--color-background))",
            }}
          >
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="absolute -left-12 -right-2 -top-5 bottom-2">
              {dataUrl
                ? <MiniViewer skinUrl={dataUrl} armStyle={armStyle} />
                : <div className="flex h-full w-full items-center justify-center text-sm text-muted/50">{t("skins.noSkin")}</div>
              }
            </div>
            <span className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-muted/45">{t("skins.dragToRotate")}</span>
          </div>

          <div className="flex flex-1 flex-col gap-5 p-5">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase text-muted">{t("skins.name")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("skins.namePlaceholder")}
                className="h-10 w-full rounded-[10px] border border-border bg-background px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-accent/70"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase text-muted">{t("skins.texture")}</label>
              <button
                onClick={onReplaceTexture}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border bg-surface-secondary px-4 text-sm text-foreground transition-colors hover:border-accent/50 hover:bg-surface-tertiary"
              >
                <IconUpload size={16} className="text-accent" />
                {t("skins.replaceTexture")}
              </button>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase text-muted">{t("skins.armStyle")}</label>
              <div className="grid grid-cols-2 gap-2">
                {(["wide", "slim"] as ArmStyle[]).map((style) => {
                  const selected = armStyle === style;
                  return (
                    <button
                      key={style}
                      onClick={() => setArmStyle(style)}
                      className={[
                        "flex h-14 items-center gap-3 rounded-[10px] border px-3 text-left transition-colors",
                        selected
                          ? "border-accent/70 bg-accent/10 text-foreground"
                          : "border-border bg-background text-muted hover:border-accent/35 hover:text-foreground",
                      ].join(" ")}
                    >
                      <span className={["flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent" : "border-border"].join(" ")}>
                        {selected && <span className="size-2 rounded-full bg-accent" />}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">{style === "wide" ? t("skins.wide") : t("skins.slim")}</span>
                        <span className="text-[11px] text-muted">{style === "wide" ? t("skins.wideDesc") : t("skins.slimDesc")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isEdit && onDelete && (
              <div className="mt-auto border-t border-border pt-4">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/5 px-4 text-xs text-danger transition-colors hover:bg-danger/10"
                  >
                    <IconTrash size={14} />
                    {t("skins.deleteSkin")}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{t("skins.confirmDelete")}</span>
                    <button
                      onClick={onDelete}
                      className="h-8 rounded-[10px] bg-danger px-4 text-xs font-medium text-danger-foreground transition-opacity hover:opacity-90"
                    >{t("skins.delete")}</button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="h-8 rounded-[10px] border border-border bg-surface-secondary px-4 text-xs text-muted transition-colors hover:text-foreground"
                    >{t("skins.cancel")}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-surface-secondary/40 px-5 py-4">
          <button
            onClick={onClose}
            className="h-10 rounded-[10px] border border-border bg-transparent px-5 text-sm text-muted transition-colors hover:border-accent/35 hover:text-foreground"
          >
            {t("skins.cancel")}
          </button>
          <button
            onClick={async () => {
              if (!dataUrl || saving) return;
              setSaving(true);
              await onSave({ name: name.trim() || "Unnamed", dataUrl, armStyle });
              setSaving(false);
            }}
            disabled={!dataUrl || saving}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-accent px-5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!saving && <IconCheck size={16} />}
            {saving ? t("skins.saving") : isEdit ? t("skins.save") : t("skins.addSkin")}
          </button>
        </div>
      </div>
    </>
  );
}

function SkinCard({
  skin, isActive, onSelect, onEdit, uploading,
}: {
  skin: SavedSkin; isActive: boolean; onSelect: () => void; onEdit: () => void; uploading: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ width: 72, flexShrink: 0, position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        onClick={onSelect}
        style={{
          width: 72, height: 72, background: "#111", borderRadius: 10,
          border: isActive ? "2px solid #4b77e7" : "2px solid #2a2a2a",
          boxShadow: isActive ? "0 0 10px #4b77e744" : "none",
          overflow: "hidden", cursor: uploading ? "wait" : "pointer",
          transition: "border-color 0.2s, box-shadow 0.2s",
          boxSizing: "border-box",
          opacity: uploading && !isActive ? 0.5 : 1,
        }}
      >
        <SkinHead skinUrl={skin.dataUrl} size={72} />
      </div>

      {isActive && uploading && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.55)", borderRadius: 10,
        }}>
          <div style={{
            width: 18, height: 18,
            border: "2px solid #4b77e733",
            borderTop: "2px solid #4b77e7",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
          }} />
        </div>
      )}

      {hover && !uploading && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{
            position: "absolute", top: -7, right: -7,
            width: 22, height: 22, borderRadius: "50%",
            background: "#222", border: "1px solid #3a3a3a",
            color: "#aaa", cursor: "pointer", fontSize: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 10,
          }}
        >✎</button>
      )}

      <div style={{
        marginTop: 5, textAlign: "center", fontSize: 10,
        color: isActive ? "#4b77e7" : "#555",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: 72, transition: "color 0.2s",
      }}>
        {skin.name}
      </div>
    </div>
  );
}

export default function Skins({ skinUrl, username, isPremium = true, playerUuid }: Props) {
  const t = useLauncherTranslation();
  const { user, refreshMicrosoftToken } = useAuth();

  const [capeModalOpen, setCapeModalOpen] = useState(false);
  const [activeCapeId, setActiveCapeId] = useState<string | null>(null);
  const [activeCapeUrl, setActiveCapeUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [savedSkins, setSavedSkins] = useState<SavedSkin[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [activeSkinUrl, setActiveSkinUrl] = useState<string>("");
  const [activeArmStyle, setActiveArmStyle] = useState<ArmStyle>("wide");
  const [modal, setModal] = useState<ModalData | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const savedCapeId = localStorage.getItem("activeCapeId");
      const savedCapeUrl = localStorage.getItem("activeCapeUrl");
      if (savedCapeId) setActiveCapeId(savedCapeId);
      if (savedCapeUrl) setActiveCapeUrl(savedCapeUrl);

      const skins = await loadAllSkins();
      setSavedSkins(skins);
      const savedId = getActiveId();

      if (!isPremium) {
        const active = skins.find((s) => s.id === savedId) ?? skins[0] ?? null;
        if (active) {
          setActiveIdState(active.id);
          setActiveSkinUrl(active.dataUrl);
          setActiveArmStyle(active.armStyle);
        } else {
          setActiveSkinUrl(STEVE_SKIN_URL);
          setActiveArmStyle("wide");
        }
      } else {
        const active = skins.find((s) => s.id === savedId);
        if (active) {
          setActiveIdState(active.id);
          setActiveSkinUrl(active.dataUrl);
          setActiveArmStyle(active.armStyle);
        } else {
          setActiveIdState(null);
          const resolved = await resolveSkinUrl(skinUrl || "/steve.png");
          setActiveSkinUrl(resolved);
          detectSlimFromImage(resolved).then(setActiveArmStyle);
        }
      }
    })();
  }, [isPremium, skinUrl]);

  const tryUploadToMojang = useCallback(async (dataUrl: string, armStyle: ArmStyle) => {
    if (!isPremium || !user?.minecraft?.access_token) return;
    let token = user.minecraft.access_token;
    const refreshed = await refreshMicrosoftToken();
    if (refreshed) {
      const stored = JSON.parse(localStorage.getItem("userAuth") || "null");
      token = stored?.minecraft?.access_token ?? token;
    }
    setUploading(true);
    const result = await uploadSkinToMojang(dataUrl, armStyle, token);
    setUploading(false);
    if (result.ok) {
      toast.success(t("skins.successTitle"), { description: t("skins.successDesc") });
    } else {
      console.error("Upload error:", result.error);
      toast.danger(t("capes.error"), { description: t("skins.uploadError") });
    }
  }, [isPremium, user, refreshMicrosoftToken]);

  const handleOpenCapeModal = useCallback(() => {
    setCapeModalOpen(true);
  }, []);

  const handleSelect = useCallback((skin: SavedSkin) => {
    setActiveIdState(skin.id);
    setActiveSkinUrl(skin.dataUrl);
    setActiveArmStyle(skin.armStyle);
    setActiveId(skin.id);
    if (isPremium) {
      tryUploadToMojang(skin.dataUrl, skin.armStyle);
    } else if (playerUuid) {
      applySkinLocally(skin.dataUrl, playerUuid).then((res) => {
        if (!res.ok) console.error("apply_skin_locally:", res.error);
      });
    }
  }, [isPremium, playerUuid, tryUploadToMojang]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteSkin(id);
    setSavedSkins((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      if (activeId === id) {
        if (isPremium && skinUrl) {
          setActiveIdState(null);
          setActiveId(null);
          resolveSkinUrl(skinUrl).then((resolved) => {
            setActiveSkinUrl(resolved);
            detectSlimFromImage(resolved).then(setActiveArmStyle);
          });
        } else {
          const next = updated[0] ?? null;
          setActiveIdState(next?.id ?? null);
          setActiveSkinUrl(next?.dataUrl ?? STEVE_SKIN_URL);
          setActiveArmStyle(next?.armStyle ?? "wide");
          setActiveId(next?.id ?? null);
        }
      }
      return updated;
    });
    setModal(null);
  }, [activeId, isPremium, skinUrl]);

  const handleModalSave = useCallback(async (result: { name: string; dataUrl: string; armStyle: ArmStyle }) => {
    if (modal?.mode === "edit") {
      const id = modal.skin.id;
      await updateSkin(id, result);
      setSavedSkins((prev) => prev.map((s) => s.id === id ? { ...s, ...result } : s));
      if (activeId === id) {
        setActiveSkinUrl(result.dataUrl);
        setActiveArmStyle(result.armStyle);
        tryUploadToMojang(result.dataUrl, result.armStyle);
      }
    } else {
      const newSkin = await addSkin(result);
      setSavedSkins((prev) => [...prev, newSkin]);
      setActiveIdState(newSkin.id);
      setActiveSkinUrl(newSkin.dataUrl);
      setActiveArmStyle(newSkin.armStyle);
      setActiveId(newSkin.id);
      if (isPremium) {
        tryUploadToMojang(newSkin.dataUrl, newSkin.armStyle);
      } else if (playerUuid) {
        applySkinLocally(newSkin.dataUrl, playerUuid).then((res) => {
          if (!res.ok) console.error("apply_skin_locally:", res.error);
        });
      }
    }
    setModal(null);
  }, [modal, activeId, isPremium, playerUuid, tryUploadToMojang]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const inputEl = e.target;
    if (!file.type.includes("png")) {
      alert("Only PNG files are accepted");
      inputEl.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        if (img.width < 64 || img.height < 64) {
          alert("Skin must be at least 64x64 pixels");
          inputEl.value = "";
          return;
        }
        const name = file.name.replace(/\.png$/i, "");
        if ((window as any).__modalSetDataUrl) {
          (window as any).__modalSetDataUrl(dataUrl);
          (window as any).__modalSetName?.(name);
        } else {
          setModal({ mode: "add", dataUrl, name });
        }
        inputEl.value = "";
      };
      img.onerror = () => { inputEl.value = ""; };
      img.src = dataUrl;
    };
    reader.onerror = () => { inputEl.value = ""; };
    reader.readAsDataURL(file);
  }, []);

  return (
    <div className="w-full h-full flex min-h-0">
    <div className="flex-1 h-full bg-[#020803] text-white relative overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,image/png"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {modal && (
        <SkinModal
          data={modal}
          onSave={handleModalSave}
          onDelete={modal.mode === "edit" ? () => handleDelete(modal.skin.id) : undefined}
          onClose={() => setModal(null)}
          onReplaceTexture={() => fileInputRef.current?.click()}
        />
      )}

      {capeModalOpen && user?.minecraft?.access_token && (
        <ChangeCapeModal
          skinUrl={activeSkinUrl}
          armStyle={activeArmStyle}
          activeCapeId={activeCapeId}
          accessToken={user.minecraft.access_token}
          onRefreshToken={refreshMicrosoftToken}       
          onClose={() => setCapeModalOpen(false)}
          onSelect={(id, url) => {
            setActiveCapeId(id);
            setActiveCapeUrl(url);
            if (id) localStorage.setItem("activeCapeId", id);
            else localStorage.removeItem("activeCapeId");
            if (url) localStorage.setItem("activeCapeUrl", url);
            else localStorage.removeItem("activeCapeUrl");
          }}
        />
      )}

      <div className="absolute top-3 left-4 text-2xl font-semibold flex items-center gap-3">
        {t("skins.title")}
        <span className="text-[#4b77e7] text-sm px-2 py-0.5 rounded border border-[#4b77e7]/30 bg-[#4b77e7]/10">
          BETA
        </span>
        {!isPremium && (
          <span className="text-yellow-400 text-xs px-2 py-0.5 rounded border border-yellow-400/30 bg-yellow-400/10">
            {t("skins.nonPremium")}
          </span>
        )}
      </div>

      <div className="absolute left-[80px] top-[70px] flex flex-col items-center">
        <div className="inline-flex items-center bg-[#0b0b0b] px-4 h-[30px] rounded-[10px] border border-[#3a3a3a]">
          <span className="relative top-[4px] font-minecraftia text-[16px] text-white tracking-[1px] leading-none block">
            {username || "Player"}
          </span>
        </div>

        <div className="w-[300px] h-[380px] relative">
          {activeSkinUrl ? (
            <CapeViewer
              key={`${activeSkinUrl}-${activeCapeUrl}-${activeArmStyle}`}
              skinUrl={activeSkinUrl}
              capeUrl={activeCapeUrl}
              armStyle={activeArmStyle}
              initialRotation={Math.PI * 2.12}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center px-8">
                <span className="text-3xl"></span>
                <span className="text-white/40 text-sm">
                  {isPremium ? t("skins.noSkin") : t("skins.uploadToStart")}
                </span>
              </div>
            </div>
          )}
        </div>

        <span className="text-white/40 text-sm mt-4">{t("skins.dragToRotate")}</span>

        {isPremium && user?.minecraft?.access_token && (
          <button
            onClick={handleOpenCapeModal}
            style={{
              marginTop: 8, padding: "5px 14px",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              borderRadius: 8, color: "#ccc", fontSize: 12,
              cursor: "pointer", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3a3a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
          >
            {t("skins.changeCape")}
          </button>
        )}
      </div>

      <div className="absolute left-[440px] top-[100px]">
        <div className="flex items-center gap-2 mb-5">
          <h2 className="text-white/60 text-sm">{t("skins.savedSkins")}</h2>
          {savedSkins.length > 0 && (
            <span className="text-white/30 text-xs bg-white/5 px-2 py-0.5 rounded-full">
              {savedSkins.length}
            </span>
          )}
          {uploading && (
            <span style={{ fontSize: 11, color: "#4b77e7aa", display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 10, height: 10,
                border: "1.5px solid #4b77e733",
                borderTop: "1.5px solid #4b77e7",
                borderRadius: "50%",
                animation: "spin 0.7s linear infinite",
                display: "inline-block",
              }} />
              {t("skins.applyingMicrosoft")}
            </span>
          )}
        </div>

        <div
          className="hide-scrollbar"
          style={{
            display: "flex", gap: 12, alignItems: "flex-start",
            overflowX: "auto", overflowY: "visible",
            paddingBottom: 20, paddingTop: 8,
            scrollbarWidth: "none",
          }}
        >
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 72, height: 72, flexShrink: 0,
              border: "2px dashed #4b77e766", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#4b77e7", fontSize: 28, fontWeight: 300,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(75,119,231,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title={t("skins.addSkin")}
          >+</div>

          {savedSkins.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              isActive={activeId === skin.id}
              uploading={uploading && activeId === skin.id}
              onSelect={() => { if (!uploading) handleSelect(skin); }}
              onEdit={() => setModal({ mode: "edit", skin })}
            />
          ))}
        </div>

        {isPremium && user?.minecraft?.access_token && (
          <p className="text-white/20 text-xs mt-2">
            {t("skins.connectedMicrosoft")}
          </p>
        )}

        {!isPremium && (
          <div style={{
            marginTop: 20, padding: "10px 14px",
            background: "#1a1500", border: "1px solid #fbbf2433",
            borderRadius: 10, maxWidth: 280,
          }}>
            <p style={{ color: "#fbbf24", fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
              {t("skins.nonPremiumTitle")}
            </p>
            <p style={{ color: "#fbbf2499", fontSize: 11, lineHeight: 1.5 }}>
              {t("skins.nonPremiumDesc")}
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
    <HomeSidebar />
    </div>
  );
}