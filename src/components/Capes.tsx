import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
// @ts-ignore
import { SkinViewerGLTF } from "../../src-tauri/src/skin";
import type { ArmStyle } from "../utils/skinsStore";
import { IconCheck, IconX } from "@tabler/icons-react";

type CapeEntry = {
  id: string;
  alias: string;
  url: string;
};

function CapeThumbnail({
  url,
  size = 56,
  selected,
}: {
  url: string;
  size?: number;
  selected: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!url) return;
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scaleX = img.width / 64;
      const scaleY = img.height / 32;
      canvas.width = size;
      canvas.height = Math.round(size * 1.6);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        img,
        1 * scaleX, 1 * scaleY,
        10 * scaleX, 16 * scaleY,
        0, 0,
        canvas.width, canvas.height,
      );
    };
    img.src = url;
    return () => { active = false; };
  }, [url, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        imageRendering: "pixelated",
        borderRadius: 8,
        outline: selected ? "2px solid #4b77e7" : "2px solid transparent",
        boxShadow: selected ? "0 0 8px #4b77e755" : "none",
        transition: "outline 0.15s, box-shadow 0.15s",
      }}
    />
  );
}

export function CapeViewer({
  skinUrl,
  capeUrl,
  armStyle,
  initialRotation = Math.PI * 1.18,
}: {
  skinUrl: string;
  capeUrl: string | null;
  armStyle: ArmStyle;
  initialRotation?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
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
        const viewer = new SkinViewerGLTF({
          canvas,
          autoRotate: false,
          initialRotation,
          cape: capeUrl ?? undefined,
        });
        await viewer.loadSkin(skinUrl, armStyle);
        if (capeUrl) await viewer.loadCape(capeUrl);
        if (!active) { viewer.dispose?.(); return; }
        viewerRef.current = viewer;
      } catch {}
    })();

    return () => {
      active = false;
      viewerRef.current?.dispose?.();
      viewerRef.current = null;
    };
  }, [skinUrl, capeUrl, armStyle, initialRotation]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />
  );
}

export function ChangeCapeModal({
  skinUrl,
  armStyle,
  activeCapeId,
  onClose,
  onSelect,
  accessToken,
}: {
  skinUrl: string;
  armStyle: ArmStyle;
  activeCapeId: string | null;
  onClose: () => void;
  onSelect: (capeId: string | null, capeUrl: string | null) => void;
  accessToken: string;
}) {
  const [capes, setCapes] = useState<CapeEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(activeCapeId);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const previewCape = capes.find((c) => c.id === selected)?.url ?? null;

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke<CapeEntry[]>("get_player_capes", { accessToken });
        setCapes(result);
      } catch {
        toast.danger("Error", { description: "Could not load capes." });
      } finally {
        setLoading(false);
      }
    })();
  }, [accessToken]);

  const handleConfirm = async () => {
    if (applying) return;
    setApplying(true);
    try {
      await invoke("set_active_cape", { capeId: selected ?? "", accessToken });
      toast.success("Cape applied!", {
        description: selected ? "Cape activated ✓" : "Cape removed ✓",
      });
      const selectedUrl = capes.find((c) => c.id === selected)?.url ?? null;
      onSelect(selected, selectedUrl);
      onClose();
    } catch (e: any) {
      toast.danger("Error", { description: e?.message ?? "Could not apply cape." });
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md"
      />

      <div className="fixed left-1/2 top-1/2 z-[101] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-border bg-surface text-foreground shadow-[0_32px_90px_rgba(0,0,0,0.9)]">

        <div className="flex items-center justify-between border-b border-border bg-surface-secondary/60 px-5 py-4">
          <div>
            <p className="text-base font-semibold">Change cape</p>
            <p className="mt-0.5 text-xs text-muted">Wardrobe cape profile</p>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-[10px] border border-border bg-surface text-muted transition-colors hover:border-accent/40 hover:text-foreground"
            title="Close"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="flex min-h-[360px]">
          <div
            className="relative flex w-[190px] shrink-0 flex-col items-center justify-end overflow-hidden border-r border-border bg-surface-secondary pb-9"
            style={{
              background:
                "radial-gradient(circle at 50% 18%, color-mix(in oklch, var(--accent) 18%, transparent), transparent 34%), linear-gradient(180deg, var(--color-surface-secondary), var(--color-background))",
            }}
          >
            <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="absolute -left-12 -right-2 -top-5 bottom-2">
              <CapeViewer skinUrl={skinUrl} capeUrl={previewCape} armStyle={armStyle} />
            </div>
            <span className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-muted/45">
              Drag to rotate
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: 380 }}>
            {loading ? (
              <div className="flex h-full min-h-[200px] items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-sm text-muted">
                  <div style={{
                    width: 20, height: 20,
                    border: "2px solid #4b77e733",
                    borderTop: "2px solid #4b77e7",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }} />
                  Loading capes...
                </div>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                gap: 12,
              }}>
                <div
                  onClick={() => setSelected(null)}
                  className="flex cursor-pointer flex-col items-center gap-1.5"
                >
                  <div style={{
                    width: 56, height: 90,
                    border: selected === null ? "2px solid #4b77e7" : "2px solid #2a2a2a",
                    borderRadius: 8,
                    background: "#1a1a1a",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 4,
                    boxShadow: selected === null ? "0 0 8px #4b77e755" : "none",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    fontSize: 11,
                    color: selected === null ? "#4b77e7" : "#444",
                  }}>
                    <span style={{ fontSize: 18 }}>✕</span>
                    <span>None</span>
                  </div>
                </div>

                {capes.map((cape) => (
                  <div
                    key={cape.id}
                    onClick={() => setSelected(cape.id)}
                    className="flex cursor-pointer flex-col items-center gap-1.5"
                  >
                    <CapeThumbnail url={cape.url} size={56} selected={selected === cape.id} />
                    <span style={{
                      fontSize: 10,
                      color: selected === cape.id ? "#4b77e7" : "#555",
                      textAlign: "center", maxWidth: 70,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      transition: "color 0.15s",
                    }}>
                      {cape.alias}
                    </span>
                  </div>
                ))}

                {capes.length === 0 && !loading && (
                  <div className="col-span-full pt-10 text-center text-xs text-muted">
                    No capes found on your account.
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
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={applying}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-accent px-5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!applying && <IconCheck size={16} />}
            {applying ? "Applying..." : "Select"}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}