import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { toast } from "@heroui/react";
import { useInstancesNav } from "../utils/instancesNavStore";
import { useFriendsPanel } from "../utils/friendsPanelStore";
import { useModstack } from "../stores/modstackContext";
import { getInstance } from "../api/instances";
import HomeSidebar from "../components/HomeSidebar";
import {
  IconBox, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight,
  IconFolderOpen, IconPhoto, IconPlayerPlay, IconPlus,
  IconSearch, IconTrash, IconUpload, IconX, IconRefresh, IconDownload,
  IconFilter, IconDotsVertical, IconFolderOff,
  IconArrowLeft, IconPackageExport, IconDeviceFloppy,
  IconFolder, IconAdjustments, IconPackageImport,
  IconStar, IconAlertCircle, IconTerminal2,
  IconExternalLink, IconEye, IconAlertTriangle,
  IconShare3, IconMessage, IconCopy, IconKey,
  IconArrowsSort, IconSettings, IconPuzzle, IconWorld, IconSparkles, IconBraces,
  IconFileDescription, IconPackage, IconFileZip, IconDatabase, IconFileSettings,
  IconFileText, IconFile, IconClipboard, IconPencil, IconArrowRight, IconHome,
  IconClock,
} from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { useInstance } from "../stores/instanceContext";
import { useSettings } from "../stores/settingsContext";
import {
  loadLocalInstances, updateLocalInstance, deleteLocalInstance,
  setSelectedId, getSelectedId, slugify,
  type LocalInstance,
} from "../utils/localInstances";
import {
  loadInstanceRuntimeSettings,
  saveInstanceRuntimeSettings,
  type InstanceRuntimeSettings,
} from "../utils/instanceRuntimeSettings";
import {
  createInstanceShareMessage,
  createInstanceSharePayloadWithAssets,
  decodeInstanceShare,
  encodeInstanceShare,
  importSharedInstance,
} from "../utils/instanceShare";

import { SiModrinth, SiCurseforge } from "@icons-pack/react-simple-icons";

import { LoaderIcon } from "../components/icons/LoaderIcon";
import { useLauncherTranslation } from "../utils/languageContext";

const CF_API_KEY = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";
const CF_GAME_ID = 432;

type ContentSource = "modrinth" | "curseforge";
type Loader = "vanilla" | "fabric" | "forge" | "neoforge";
type McVersion = { id: string; type: string };
type ProjectType = "mod" | "resourcepack" | "shader" | "datapack";
type InstanceTab = "all" | "modpacks" | "local" | "custom";
type ContentFilter = "all" | "mods" | "resourcepacks" | "shaders" | "updates";

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  follows: number;
  author: string;
  categories: string[];
  versions: string[];
  date_modified: string;
  gallery?: { url: string; featured: boolean; title?: string }[];
  body?: string;
  license?: { id: string; name: string };
  source_url?: string;
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  files: { url: string; filename: string; primary: boolean }[];
}

interface InstalledMod {
  id: string;
  name: string;
  author: string;
  version: string;
  filename: string;
  icon_url?: string;
  enabled: boolean;
  has_update?: boolean;
  has_download?: boolean;
}

interface RemoteInstance {
  id: string;
  name: string;
  slug?: string;
  loader: string;
  minecraft_version: string;
  icon_url?: string;
  description?: string;
  modCount?: number;
  code?: string;
  raw?: Instance;
}

interface InstanceLog {
  instance: string;
  type: string;
  message: string;
}

const LOADER_MIN_VERSION: Record<string, string> = {
  vanilla: "1.0",
  fabric: "1.14",
  quilt: "1.14",
  forge: "1.1",
  neoforge: "1.20.1",
};

function filterVersionsForLoader(versions: McVersion[], loader: string): McVersion[] {
  const toNum = (v: string) => {
    const [major, minor, patch] = v.split(".").map(Number);
    return (major ?? 0) * 100000 + (minor ?? 0) * 1000 + (patch ?? 0);
  };
  const minNum = toNum(LOADER_MIN_VERSION[loader] ?? "1.0");
  return versions.filter(v => toNum(v.id) >= minNum);
}

const SORT_OPTIONS = ["Relevance", "Downloads", "Follows", "Newest", "Updated"];
const VIEW_OPTIONS = ["10", "20", "50"];
const SORT_MAP: Record<string, string> = {
  Relevance: "relevance", Downloads: "downloads",
  Follows: "follows", Newest: "newest", Updated: "updated",
};

const CF_SORT_MAP: Record<string, number> = {
  Relevance: 1, Downloads: 6, Follows: 5, Newest: 10, Updated: 3,
};

const CF_CLASS_MAP: Record<ProjectType, number> = {
  mod: 6,
  resourcepack: 12,
  shader: 6552,
  datapack: 17,
};

function toUrl(p?: string | null): string | null {
  if (!p) return null;
  return convertFileSrc(p);
}

function buildFacets(tab: ProjectType, gameVersion: string, loader?: string): string[][] {
  const facets: string[][] = [[`project_type:${tab}`]];
  if (gameVersion && gameVersion !== "Select game version") {
    facets.push([`versions:${gameVersion}`]);
  }
  if (loader && tab === "mod") {
    facets.push([`categories:${loader}`]);
  }
  return facets;
}

function getPageItems(current: number, total: number): (number | "dots")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "dots")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) items.push("dots");
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push("dots");
  items.push(total);
  return items;
}

async function pickImage(): Promise<string | null> {
  try {
    const p = await open({
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function cfModToHit(mod: any): ModrinthHit {
  const versions: string[] = Array.from(new Set([
    ...(mod.latestFilesIndexes ?? []).map((f: any) => f.gameVersion).filter(Boolean),
    ...(mod.gameVersionLatestFiles ?? []).map((f: any) => f.gameVersion).filter(Boolean),
  ])).sort().reverse() as string[];

  const loaders: string[] = Array.from(new Set(
    (mod.latestFilesIndexes ?? []).map((f: any) => f.modLoader)
      .filter((l: any) => l !== null && l !== undefined)
      .map((l: any) => {
        const map: Record<number, string> = { 1: "forge", 2: "cauldron", 3: "liteloader", 4: "fabric", 5: "quilt", 6: "neoforge" };
        return map[l] ?? String(l).toLowerCase();
      })
  )) as string[];

  const contentCategories: string[] = (mod.categories ?? [])
    .map((c: any) => c.name?.toLowerCase() ?? "")
    .filter((c: string) => !["fabric", "forge", "neoforge", "quilt", "cauldron"].includes(c));

  return {
    project_id: String(mod.id),
    slug: String(mod.id),
    title: mod.name ?? "Unknown",
    description: mod.summary ?? "",
    icon_url: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? undefined,
    downloads: mod.downloadCount ?? 0,
    follows: mod.thumbsUpCount ?? 0,
    author: mod.authors?.[0]?.name ?? "",
    categories: [...loaders, ...contentCategories],
    versions,
    date_modified: mod.dateModified ?? mod.dateUpdated ?? "",
    body: mod.summary ?? "",
    license: mod.links?.websiteUrl
      ? { id: "cf", name: `CurseForge — ${mod.links.websiteUrl}` }
      : undefined,
    source_url: mod.links?.websiteUrl,
    gallery: (mod.screenshots ?? []).map((s: any) => ({
      url: s.url,
      featured: false,
      title: s.title ?? "",
    })),
  };
}

function channelStyle(type: string) {
  if (type === "release") return { bg: "bg-[var(--color-accent)]/15", text: "text-[var(--color-accent)]", border: "border-[var(--color-accent)]/30", dot: "bg-[var(--color-accent)]" };
  if (type === "beta") return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-400" };
  return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-400" };
}

function SimpleDropdown({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 border border-border rounded-[12px] px-3 py-1.5 text-xs cursor-pointer hover:border-accent/40 transition-colors"
        style={{ backgroundColor: "var(--color-surface)" }}>
        <span className="text-muted">{label}: </span>
        <span className="text-foreground font-medium">{value}</span>
        <IconChevronDown size={12} className="text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-[12px] border border-border shadow-xl overflow-hidden min-w-[120px]"
          style={{ backgroundColor: "var(--color-overlay)" }}>
          {options.map(opt => (
            <button key={opt} type="button" onClick={() => { onChange(opt); setOpen(false); }}
              className={["w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-3",
                opt === value ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10" : "text-foreground hover:bg-white/5"].join(" ")}>
              {opt}
              {opt === value && <IconCheck size={11} className="text-[var(--color-accent)] flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionFilterDropdown({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border text-xs font-semibold transition-all",
          open
            ? "border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/5"
            : "border-border text-muted hover:text-foreground hover:border-white/10"
        ].join(" ")}
        style={{ backgroundColor: open ? undefined : "var(--color-surface)" }}>
        <IconFilter size={11} />
        {label}
        {value !== "All" && (
          <span className="px-1.5 py-0.5 rounded-[5px] bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] font-bold">{value}</span>
        )}
        <IconChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-[12px] border border-border shadow-2xl overflow-hidden w-52"
          style={{ backgroundColor: "var(--color-overlay)" }}>
          <div className="p-2 border-b border-border">
            <div className="relative">
              <IconSearch size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-7 pr-2 py-1.5 rounded-[8px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">No results</div>
            ) : (
              filtered.map(opt => (
                <button key={opt} type="button"
                  onClick={() => { onChange(opt); setOpen(false); setSearch(""); }}
                  className={["w-full flex items-center justify-between px-3 py-2 text-xs transition-colors",
                    opt === value ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10" : "text-foreground hover:bg-white/5"
                  ].join(" ")}>
                  <span>{opt}</span>
                  {opt === value && <IconCheck size={11} className="text-[var(--color-accent)] flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
          {value !== "All" && (
            <div className="border-t border-border p-1.5">
              <button type="button"
                onClick={() => { onChange("All"); setOpen(false); setSearch(""); }}
                className="w-full text-left px-3 py-1.5 rounded-[8px] text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors">
                Show all versions
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VersionDropdown({ value, onChange, versions, loading }: {
  value: string; onChange: (v: string) => void; versions: McVersion[]; loading: boolean;
}) {
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-[15px] bg-field-background border border-border text-sm text-foreground hover:border-accent/40 transition-colors">
        <span className={value ? "text-foreground" : "text-muted"}>
          {loading ? t("inst.loading") : value || t("inst.gameVersion")}
        </span>
        <IconChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-overlay border border-border rounded-[15px] overflow-hidden shadow-xl">
          <div className="max-h-40 overflow-y-auto">
            {loading
              ? <div className="px-3 py-2 text-xs text-muted">{t("inst.loading")}</div>
              : versions.map(v => (
                <button key={v.id} type="button"
                  onClick={() => { onChange(v.id); setOpen(false); }}
                  className={["w-full flex items-center justify-between px-3 py-2 text-xs transition-colors",
                    value === v.id ? "bg-accent/10 text-accent" : "text-foreground hover:bg-surface-secondary"].join(" ")}>
                  {v.id}
                  {value === v.id && <IconCheck size={12} />}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useVersions() {
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        setVersions((data?.versions ?? []).filter((v: McVersion) => v.type === "release" && /^\d+\.\d+(\.\d+)?$/.test(v.id)));
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { versions, loading };
}

function GalleryLightbox({ images, initialIndex, onClose }: {
  images: { url: string; title?: string }[];
  initialIndex: number;
  onClose: () => void;
}) {
  const t = useLauncherTranslation();
  const [idx, setIdx] = useState(initialIndex);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [images.length]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 select-none" onClick={onClose}>
      <div className="flex items-center justify-between px-6 py-4 bg-black/50 border-b border-white/5 flex-shrink-0 backdrop-blur-md"
        onClick={e => e.stopPropagation()}>
        <div className="min-w-0">
          {images[idx]?.title && (
            <p className="text-sm font-semibold text-white truncate">{images[idx].title}</p>
          )}
          <p className="text-xs text-white/50 mt-0.5">{idx + 1} of {images.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.open(images[idx].url, "_blank")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs transition-all border border-white/10">
            <IconExternalLink size={13} /> {t("inst.openOriginal")}
          </button>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all border border-white/10">
            <IconX size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center p-6" onClick={onClose}>
        <button onClick={e => { e.stopPropagation(); prev(); }}
          className="absolute left-4 z-10 w-11 h-11 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center border border-white/10 backdrop-blur-sm transition-all">
          <IconChevronLeft size={22} />
        </button>
        <img src={images[idx].url} alt={images[idx].title ?? ""}
          className="max-w-full max-h-[calc(100vh-160px)] object-contain rounded-xl shadow-2xl"
          onClick={e => e.stopPropagation()} />
        <button onClick={e => { e.stopPropagation(); next(); }}
          className="absolute right-4 z-10 w-11 h-11 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center border border-white/10 backdrop-blur-sm transition-all">
          <IconChevronRight size={22} />
        </button>
      </div>

      {images.length > 1 && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 px-6 py-3 bg-black/50 border-t border-white/5 overflow-x-auto"
          onClick={e => e.stopPropagation()}>
          {images.map((img, i) => (
            <button key={i} onClick={() => setIdx(i)}
              className={["w-14 h-10 rounded-[6px] overflow-hidden flex-shrink-0 transition-all border-2",
                i === idx ? "border-white/60 opacity-100" : "border-transparent opacity-40 hover:opacity-70"
              ].join(" ")}>
              <img src={img.url} className="w-full h-full object-cover" alt="" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

function ModrinthGalleryGrid({ gallery, loading }: { gallery: { url: string; featured: boolean; title?: string }[]; loading: boolean }) {
  const t = useLauncherTranslation();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-muted py-4 px-6">
      <IconRefresh size={13} className="animate-spin" /> {t("inst.loading")}
    </div>
  );
  if (gallery.length === 0) return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-3 opacity-40">
      <IconPhoto size={36} className="text-muted" /><p className="text-sm text-muted">{t("inst.noGallery")}</p>
    </div>
  );
  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {gallery.map((img, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden border border-border group cursor-pointer"
              style={{ backgroundColor: "var(--color-surface)" }}
              onClick={() => setLightboxIdx(idx)}>
              <div className="relative overflow-hidden">
                <img src={img.url} className="w-full object-cover h-44 group-hover:scale-105 transition-transform duration-300" alt={img.title ?? ""} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-sm">
                    <IconEye size={18} className="text-white" />
                  </div>
                </div>
              </div>
              {(img.title || img.featured) && (
                <div className="px-3 py-2.5">
                  {img.title && <p className="text-sm font-semibold text-foreground">{img.title}</p>}
                  {img.featured && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)] font-medium mt-0.5">
                      <IconStar size={9} /> {t("inst.featured")}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {lightboxIdx !== null && (
        <GalleryLightbox images={gallery} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </>
  );
}

function ModrinthDetailView({
  hit, installedSlugs, onBack, onInstall, gameVersion, loader,
}: {
  hit: ModrinthHit;
  installedSlugs: Set<string>;
  onBack: () => void;
  onInstall: (hit: ModrinthHit, versionId?: string) => Promise<void>;
  gameVersion?: string;
  loader?: string;
}) {
  const t = useLauncherTranslation();
  const [installing, setInstalling] = useState<string | null>(null);
  const [fullData, setFullData] = useState<ModrinthHit | null>(null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [activeTab, setActiveTab] = useState<"description" | "versions" | "gallery">("description");

  const [mrVersions, setMrVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionGameFilter, setVersionGameFilter] = useState(gameVersion ?? "All");
  const [versionChannelFilter, setVersionChannelFilter] = useState("All");

  const isInstalled = installedSlugs.has(hit.slug);

  useEffect(() => {
    let alive = true;
    setLoadingFull(true);
    fetch(`https://api.modrinth.com/v2/project/${hit.slug}`, {
      headers: { "User-Agent": "Launcher/1.0" },
    })
      .then(r => r.json())
      .then(d => { if (alive) setFullData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingFull(false); });
    return () => { alive = false; };
  }, [hit.slug]);

  useEffect(() => {
    if (activeTab !== "versions") return;
    let alive = true;
    setLoadingVersions(true);
    const params = new URLSearchParams();
    if (gameVersion) params.set("game_versions", JSON.stringify([gameVersion]));
    if (loader) params.set("loaders", JSON.stringify([loader]));
    const qs = params.toString();
    fetch(`https://api.modrinth.com/v2/project/${hit.slug}/version${qs ? `?${qs}` : ""}`, {
      headers: { "User-Agent": "Launcher/1.0" },
    })
      .then(r => r.json())
      .then(d => { if (alive) setMrVersions(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingVersions(false); });
    return () => { alive = false; };
  }, [hit.slug, activeTab, gameVersion, loader]);

  const data = fullData ?? hit;
  const gallery = fullData?.gallery ?? [];

  const allGameVersions = ["All", ...Array.from(new Set(mrVersions.flatMap(v => v.game_versions))).sort().reverse()];
  const allChannels = ["All", "Release", "Beta", "Alpha"];

  const filteredVersions = mrVersions.filter(v => {
    const gameOk = versionGameFilter === "All" || v.game_versions.includes(versionGameFilter);
    const channelOk = versionChannelFilter === "All" || v.version_type === versionChannelFilter.toLowerCase();
    const loaderOk = !loader || v.loaders?.includes(loader);
    return gameOk && channelOk && loaderOk;
  });

  const bodyHtml: string = (() => {
    if (!fullData?.body) return `<p>${data.description ?? ""}</p>`;
    try {
      return fullData.body
        .replace(/^#{3}\s(.+)$/gm, "<h3>$1</h3>")
        .replace(/^#{2}\s(.+)$/gm, "<h2>$1</h2>")
        .replace(/^#{1}\s(.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/^[-*]\s(.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
        .replace(/\n\n/g, "</p><p>")
        .trim();
    } catch {
      return `<p>${data.description ?? ""}</p>`;
    }
  })();

  const handleInstallLatest = async () => {
    setInstalling("latest");
    try { await onInstall(hit); } finally { setInstalling(null); }
  };

  const handleInstallVersion = async (version: ModrinthVersion) => {
    setInstalling(version.id);
    try { await onInstall(hit, version.id); } finally { setInstalling(null); }
  };

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-start gap-5 px-6 py-5 border-b border-border flex-shrink-0">
        <div className="w-16 h-16 rounded-xl overflow-hidden border border-border flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "var(--color-surface)" }}>
          {hit.icon_url
            ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" />
            : <IconBox size={28} className="text-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-foreground leading-tight">{hit.title}</h1>
            {isInstalled && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-[10px] font-semibold">
                <IconCheck size={9} /> {t("inst.installed")}
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-0.5">{t("inst.by")} {hit.author}</p>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <IconDownload size={12} className="text-[var(--color-accent)]" />
              <span className="text-foreground font-medium">{formatDownloads(hit.downloads)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <IconStar size={12} className="text-[var(--color-accent)]" />
              <span className="text-foreground font-medium">{formatDownloads(hit.follows)}</span>
            </span>
            {hit.date_modified && (
              <span className="text-xs text-muted">{t("inst.updatedAgo")} {timeAgo(hit.date_modified)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconArrowLeft size={14} /> {t("inst.back")}
          </button>
          {isInstalled ? (
            <button disabled
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 cursor-default">
              <IconCheck size={14} /> {t("inst.installed")}
            </button>
          ) : (
            <button onClick={handleInstallLatest} disabled={installing !== null}
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-bold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-50">
              <IconDownload size={14} />
              {installing === "latest" ? t("inst.installing") + "..." : t("inst.installLatest")}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-border flex-shrink-0">
        {[
          { key: "description", label: t("inst.description") },
          { key: "versions", label: `${t("inst.versions")}${mrVersions.length > 0 ? ` (${mrVersions.length})` : ""}` },
          { key: "gallery", label: `${t("inst.gallery")}${gallery.length > 0 ? ` (${gallery.length})` : ""}` },
        ].map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
              activeTab === tab.key ? "bg-[var(--color-accent)] text-black" : "text-muted hover:text-foreground"].join(" ")}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "description" && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loadingFull ? (
              <div className="flex items-center gap-2 text-xs text-muted py-4">
                <IconRefresh size={13} className="animate-spin" /> {t("inst.loading")}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {gallery[0]?.url && (
                  <div className="rounded-xl overflow-hidden border border-border">
                    <img src={gallery[0].url} className="w-full object-cover max-h-72" alt="" />
                  </div>
                )}
                <div
                  className="modpack-body text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  style={{ color: "var(--color-foreground)" }}
                />
              </div>
            )}
          </div>
          <div className="w-56 flex-shrink-0 border-l border-border overflow-y-auto px-4 py-5 flex flex-col gap-5">
            {hit.versions && hit.versions.length > 0 && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.compatibility")}</p>
                <p className="text-[10px] text-muted mb-1.5">Minecraft: Java Edition</p>
                <div className="flex flex-wrap gap-1">
                  {hit.versions.slice(0, 8).map(v => (
                    <span key={v} className="px-1.5 py-0.5 rounded-[6px] border border-border text-[10px] text-muted font-mono"
                      style={{ backgroundColor: "var(--color-surface)" }}>
                      {v}
                    </span>
                  ))}
                  {hit.versions.length > 8 && (
                    <span className="text-[10px] text-muted">+{hit.versions.length - 8} more</span>
                  )}
                </div>
              </div>
            )}
            {hit.categories.some(c => ["fabric", "forge", "neoforge", "quilt"].includes(c)) && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.platforms")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {hit.categories
                    .filter(c => ["fabric", "forge", "neoforge", "quilt"].includes(c))
                    .map(c => (
                      <span key={c} className="px-2.5 py-1 rounded-full border border-border text-xs text-muted capitalize"
                        style={{ backgroundColor: "var(--color-surface)" }}>
                        {c}
                      </span>
                    ))}
                </div>
              </div>
            )}
            {hit.categories.filter(c => !["fabric", "forge", "neoforge", "quilt"].includes(c)).length > 0 && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.tags")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {hit.categories
                    .filter(c => !["fabric", "forge", "neoforge", "quilt"].includes(c))
                    .map(c => (
                      <span key={c} className="px-2.5 py-1 rounded-full border border-border text-xs text-muted capitalize"
                        style={{ backgroundColor: "var(--color-surface)" }}>
                        {c}
                      </span>
                    ))}
                </div>
              </div>
            )}
            {fullData?.license && (
              <div>
                <p className="text-xs font-bold text-foreground mb-1">{t("inst.license")}</p>
                <p className="text-xs text-muted">{fullData.license.name || fullData.license.id}</p>
              </div>
            )}
            {hit.date_modified && (
              <div>
                <p className="text-xs font-bold text-foreground mb-1">{t("inst.lastUpdated")}</p>
                <p className="text-xs text-muted">{timeAgo(hit.date_modified)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "versions" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border flex-shrink-0">
            <VersionFilterDropdown
              label={t("inst.gameVersions")}
              value={versionGameFilter}
              options={allGameVersions}
              onChange={setVersionGameFilter}
            />
            <VersionFilterDropdown
              label={t("inst.channels")}
              value={versionChannelFilter}
              options={allChannels}
              onChange={setVersionChannelFilter}
            />
            <span className="ml-auto text-xs text-muted flex-shrink-0">{filteredVersions.length} {t("inst.versions").toLowerCase()}</span>
          </div>

          <div className="flex items-center px-5 py-2 border-b border-border flex-shrink-0 text-[11px] font-semibold text-muted tracking-wide">
            <div className="w-24 flex-shrink-0">{t("inst.channels")}</div>
            <div className="flex-1">{t("inst.name")}</div>
            <div className="w-32 flex-shrink-0">{t("inst.gameVersion")}</div>
            <div className="w-24 flex-shrink-0">{t("inst.platforms")}</div>
            <div className="w-24 flex-shrink-0">Published</div>
            <div className="w-20 flex-shrink-0 text-right">Downloads</div>
            <div className="w-28 flex-shrink-0" />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingVersions ? (
              <div className="flex items-center justify-center py-16">
                <IconRefresh size={20} className="text-muted animate-spin" />
              </div>
            ) : filteredVersions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 opacity-40">
                <IconBox size={36} className="text-muted" />
                <p className="text-sm text-muted">{t("inst.noVersionsMatch")}</p>
              </div>
            ) : (
              filteredVersions.map((v, idx) => {
                const c = channelStyle(v.version_type);
                const isFirst = idx === 0 && versionGameFilter === "All" && versionChannelFilter === "All";
                return (
                  <div key={v.id}
                    className="flex items-center px-5 py-3 border-b border-border hover:bg-white/[0.02] transition-colors">
                    <div className="w-24 flex-shrink-0">
                      <span className={["flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full border text-[10px] font-semibold", c.bg, c.border, c.text].join(" ")}>
                        <span className={["w-1.5 h-1.5 rounded-full flex-shrink-0", c.dot].join(" ")} />
                        {v.version_type.charAt(0).toUpperCase() + v.version_type.slice(1)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{v.name}</p>
                        {isFirst && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded-[5px] bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[9px] font-bold uppercase tracking-wide">
                            {t("inst.latest")}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted font-mono mt-0.5">{v.version_number}</p>
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <div className="flex flex-wrap gap-1">
                        {v.game_versions.slice(0, 2).map(gv => (
                          <span key={gv} className="px-1.5 py-0.5 rounded-[5px] border border-border text-[10px] text-muted font-mono"
                            style={{ backgroundColor: "var(--color-surface)" }}>
                            {gv}
                          </span>
                        ))}
                        {v.game_versions.length > 2 && (
                          <span className="text-[10px] text-muted">+{v.game_versions.length - 2}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <div className="flex flex-wrap gap-1">
                        {v.loaders.map(l => (
                          <span key={l} className="px-1.5 py-0.5 rounded-[5px] border border-border text-[10px] text-muted capitalize"
                            style={{ backgroundColor: "var(--color-surface)" }}>
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <p className="text-xs text-muted">{timeAgo(v.date_published)}</p>
                    </div>
                    <div className="w-20 flex-shrink-0 text-right">
                      <p className="text-xs text-muted">{formatDownloads(v.downloads)}</p>
                    </div>
                    <div className="w-28 flex-shrink-0 flex justify-end">
                      <button
                        onClick={() => !isInstalled && handleInstallVersion(v)}
                        disabled={installing !== null || isInstalled}
                        className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-xs font-semibold border-2 transition-all",
                          isInstalled
                            ? "border-[var(--color-accent)]/20 text-[var(--color-accent)]/50 cursor-default"
                            : installing === v.id
                              ? "border-border text-muted cursor-not-allowed"
                              : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-black"
                        ].join(" ")}>
                        {installing === v.id
                          ? <><IconRefresh size={11} className="animate-spin" /> {t("inst.installing")}...</>
                          : isInstalled
                            ? <><IconCheck size={11} /> {t("inst.installed")}</>
                            : <><IconDownload size={11} /> {t("inst.install")}</>}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "gallery" && (
        <ModrinthGalleryGrid gallery={gallery} loading={loadingFull} />
      )}

      <style>{`
        .modpack-body h1 { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--color-foreground); }
        .modpack-body h2 { font-size: 1.05rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--color-foreground); }
        .modpack-body h3 { font-size: 0.95rem; font-weight: 600; margin: 0.75rem 0 0.4rem; color: var(--color-foreground); }
        .modpack-body p { margin: 0.5rem 0; color: rgba(255,255,255,0.75); }
        .modpack-body a { color: var(--color-accent); text-decoration: underline; }
        .modpack-body a:hover { color: var(--color-accent); }
        .modpack-body ul, .modpack-body ol { padding-left: 1.25rem; margin: 0.5rem 0; }
        .modpack-body li { margin: 0.2rem 0; color: rgba(255,255,255,0.75); }
        .modpack-body strong { font-weight: 600; color: var(--color-foreground); }
        .modpack-body em { font-style: italic; }
        .modpack-body img { max-width: 100%; border-radius: 8px; margin: 0.5rem 0; }
        .modpack-body hr { border: none; border-top: 1px solid var(--color-border); margin: 1rem 0; }
        .modpack-body code { font-family: monospace; font-size: 0.85em; background: rgba(255,255,255,0.07); padding: 0.1rem 0.3rem; border-radius: 4px; }
        .modpack-body pre { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem; overflow-x: auto; margin: 0.5rem 0; }
        .modpack-body blockquote { border-left: 3px solid var(--color-accent); padding-left: 0.75rem; margin: 0.5rem 0; opacity: 0.7; }
      `}</style>
    </div>
  );
}

const MODPACK_CATEGORIES = [
  "Adventure", "Challenging", "Combat", "Kitchen Sink",
  "Lightweight", "Magic", "Multiplayer", "Quests",
  "Sci-Fi", "Skyblock", "Technology", "Vanilla-like",
];

function ModpacksTab({
  localInstances, onInstalled, initialHit, onConsumeInitialHit,
}: {
  localInstances: LocalInstance[];
  onInstalled: (inst: LocalInstance) => void;
  initialHit?: ModrinthHit | null;
  onConsumeInitialHit?: () => void;
}) {
  const t = useLauncherTranslation();
  const [source, setSource] = useState<ContentSource>("modrinth");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [sortBy, setSortBy] = useState("Downloads");
  const [viewCount, setViewCount] = useState(20);
  const [selectedHit, setSelectedHit] = useState<ModrinthHit | null>(null);
  const [selectedCfHit, setSelectedCfHit] = useState<ModrinthHit | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [mcFilter, setMcFilter] = useState("");
  const installedSlugs = new Set(localInstances.map(i => i.id.replace(/^modrinth-/, "")));
  const totalPages = Math.max(1, Math.ceil(totalHits / viewCount));
  const [catFilters, setCatFilters] = useState<Set<string>>(new Set());
  const [loaderFilters, setLoaderFilters] = useState<Set<string>>(new Set());
  const [licenseOpen, setLicenseOpen] = useState(false);

  const toggleSet = (set: Set<string>, val: string): Set<string> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };

  useEffect(() => {
    if (initialHit) {
      setSource("modrinth");
      setSelectedHit(initialHit);
      onConsumeInitialHit?.();
    }
  }, [initialHit]);

  const search = async (currentPage = page) => {
    setLoading(true); setError(null);
    try {
      if (source === "modrinth") {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        params.set("limit", String(viewCount));
        params.set("offset", String(currentPage * viewCount));
        params.set("index", SORT_MAP[sortBy] ?? "downloads");
        const facets: string[][] = [["project_type:modpack"]];
        if (mcFilter) facets.push([`versions:${mcFilter}`]);
        if (catFilters.size > 0) facets.push([...catFilters].map(c => `categories:${c.toLowerCase()}`));
        if (loaderFilters.size > 0) facets.push([...loaderFilters].map(l => `categories:${l.toLowerCase()}`));
        params.set("facets", JSON.stringify(facets));
        const res = await fetch(`https://api.modrinth.com/v2/search?${params}`, { cache: "no-store", headers: { "User-Agent": "Launcher/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data.hits) ? data.hits : []);
        setTotalHits(typeof data.total_hits === "number" ? data.total_hits : 0);
      } else {
        const cfSort = CF_SORT_MAP[sortBy] ?? 6;
        const params = new URLSearchParams({
          gameId: String(CF_GAME_ID),
          classId: "4471",
          pageSize: String(viewCount),
          index: String(currentPage * viewCount),
          sortField: String(cfSort),
        });
        if (query.trim()) params.set("searchFilter", query.trim());
        if (mcFilter) params.set("gameVersion", mcFilter);
        if (loaderFilters.size > 0) {
          const loaderMap: Record<string, number> = { Fabric: 4, Forge: 1, NeoForge: 6, Quilt: 5 };
          const firstLoader = [...loaderFilters][0];
          if (loaderMap[firstLoader]) params.set("modLoaderType", String(loaderMap[firstLoader]));
        }
        const res = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, {
          headers: { "x-api-key": CF_API_KEY, "Accept": "application/json" },
        });
        if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
        const data = await res.json();
        setResults((data.data ?? []).map(cfModToHit));
        setTotalHits(data.pagination?.totalCount ?? 0);
      }
    } catch (e: any) {
      setError(`${t("inst.searchError")}: ${e?.message || "unknown"}`);
      setTotalHits(0);
    } finally { setLoading(false); }
  };

  useEffect(() => { search(page); }, [page, sortBy, viewCount, mcFilter, catFilters, loaderFilters, source]);
  const handleSearch = () => { setPage(0); search(0); };

  const handleInstallModrinth = async (hit: ModrinthHit, versionId?: string) => {
    setInstalling(hit.slug);
    try {
      const inst = await invoke<LocalInstance>("install_modrinth_modpack", {
        slug: hit.slug, title: hit.title,
        iconUrl: hit.icon_url ?? null, versionId: versionId ?? null,
      });
      onInstalled(inst);
      toast(`"${hit.title}" ${t("inst.modInstalled")}`);
      setSelectedHit(null);
    } catch (e) {
      toast.danger(t("inst.errorInstalling"), { description: String(e) });
    } finally { setInstalling(null); }
  };

  const handleInstallCurseForge = async (hit: ModrinthHit) => {
    setInstalling(hit.slug);
    try {
      const inst = await invoke<LocalInstance>("install_curseforge_modpack", {
        projectId: hit.project_id,
        title: hit.title,
        iconUrl: hit.icon_url ?? null,
        gameVersion: mcFilter || null,
      });
      onInstalled(inst);
      toast(`"${hit.title}" ${t("inst.modInstalled")}`);
      setSelectedCfHit(null);
    } catch (e) {
      toast.danger(t("inst.errorInstalling"), { description: String(e) });
    } finally { setInstalling(null); }
  };

  const pageItems = getPageItems(page + 1, totalPages);
  const activeFilterCount = catFilters.size + loaderFilters.size + (mcFilter ? 1 : 0);

  if (selectedHit && source === "modrinth") {
    return (
      <ModrinthDetailView
        hit={selectedHit}
        installedSlugs={installedSlugs}
        onBack={() => setSelectedHit(null)}
        onInstall={handleInstallModrinth}
      />
    );
  }

  if (selectedCfHit && source === "curseforge") {
    return (
      <CurseForgeDetailView
        hit={selectedCfHit}
        installedSlugs={installedSlugs}
        onBack={() => setSelectedCfHit(null)}
        onInstall={handleInstallCurseForge}
      />
    );
  }

  const FilterBlock = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-[10px] border border-border overflow-hidden" style={{ backgroundColor: "var(--color-background)" }}>
      {children}
    </div>
  );

  const CheckRow = ({ label, checked, onClick, mono = false }: {
    label: string; checked: boolean; onClick: () => void; mono?: boolean;
  }) => (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2.5 w-full px-3 py-[7px] text-left transition-colors hover:bg-white/[0.04] border-b border-border last:border-b-0">
      <div className={["w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center flex-shrink-0 transition-all",
        checked ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : "border-border"].join(" ")}>
        {checked && <IconCheck size={9} className="text-black" strokeWidth={3} />}
      </div>
      <span className={["text-xs truncate", mono ? "font-mono" : "", checked ? "text-foreground" : "text-muted"].join(" ")}>
        {label}
      </span>
    </button>
  );

  const accentColor = source === "curseforge" ? "#f16436" : "var(--color-accent)";
  const accentHover = source === "curseforge" ? "#d4532a" : "var(--color-accent)";
  const hoverClass = source === "curseforge" ? "cf-install-btn" : "mr-install-btn";

  return (
    <>
      <style>{`
        .mr-install-btn:hover { background-color: var(--color-accent) !important; color: black !important; }
        .cf-install-btn:hover { background-color: #f16436 !important; color: white !important; }
      `}</style>

      <div className="flex w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>

        <div className="w-[195px] flex-shrink-0 flex flex-col gap-4 border-r border-border overflow-y-auto p-3"
          style={{ backgroundColor: "var(--color-background)" }}>

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground tracking-widest uppercase">Filters</span>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setCatFilters(new Set()); setLoaderFilters(new Set()); setMcFilter(""); setPage(0); }}
                className="text-[10px] transition-colors font-medium"
                style={{ color: accentColor }}
                onMouseEnter={e => e.currentTarget.style.color = accentHover}
                onMouseLeave={e => e.currentTarget.style.color = accentColor}>
                Clear ({activeFilterCount})
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-muted tracking-widest uppercase">Source</span>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setSource("modrinth")}
                className={["flex items-center gap-2.5 px-3 py-2 rounded-[9px] border text-xs font-semibold transition-all w-full",
                  source === "modrinth"
                    ? "bg-[#1bd96a]/10 border-[#1bd96a]/30 text-[#1bd96a]"
                    : "border-border text-muted hover:text-foreground hover:bg-white/5"
                ].join(" ")}>
                <SiModrinth size={13} className="flex-shrink-0" />
                Modrinth
                {source === "modrinth" && <IconCheck size={11} className="ml-auto flex-shrink-0" />}
              </button>
              <button
                onClick={() => setSource("curseforge")}
                className={["flex items-center gap-2.5 px-3 py-2 rounded-[9px] border text-xs font-semibold transition-all w-full",
                  source === "curseforge"
                    ? "bg-[#f16436]/10 border-[#f16436]/30 text-[#f16436]"
                    : "border-border text-muted hover:text-foreground hover:bg-white/5"
                ].join(" ")}>
                <SiCurseforge size={13} className="flex-shrink-0" />
                CurseForge
                {source === "curseforge" && <IconCheck size={11} className="ml-auto flex-shrink-0" />}
              </button>
            </div>
          </div>

          {source === "modrinth" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-muted tracking-widest uppercase">Category</span>
              <FilterBlock>
                <div className="max-h-[170px] overflow-y-auto">
                  {MODPACK_CATEGORIES.map(cat => (
                    <CheckRow key={cat} label={cat} checked={catFilters.has(cat)}
                      onClick={() => { setCatFilters(prev => toggleSet(prev, cat)); setPage(0); }} />
                  ))}
                </div>
              </FilterBlock>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-muted tracking-widest uppercase">Game Version</span>
            <FilterBlock>
              <div className="max-h-[170px] overflow-y-auto">
                {[
                  "1.21.5", "1.21.4", "1.21.3", "1.21.1",
                  "1.20.6", "1.20.4", "1.20.2", "1.20.1",
                  "1.19.4", "1.19.2",
                  "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9",
                ].map(ver => (
                  <CheckRow key={ver} label={ver} mono checked={mcFilter === ver}
                    onClick={() => { setMcFilter(prev => prev === ver ? "" : ver); setPage(0); }} />
                ))}
              </div>
            </FilterBlock>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-muted tracking-widest uppercase">Loader</span>
            <FilterBlock>
              {(["Fabric", "Forge", "NeoForge"] as const).map(loader => (
                <CheckRow key={loader} label={loader} checked={loaderFilters.has(loader)}
                  onClick={() => { setLoaderFilters(prev => toggleSet(prev, loader)); setPage(0); }} />
              ))}
            </FilterBlock>
          </div>

          {source === "modrinth" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-muted tracking-widest uppercase">License</span>
              <FilterBlock>
                <CheckRow label="Open Sourced" checked={licenseOpen} onClick={() => setLicenseOpen(v => !v)} />
              </FilterBlock>
            </div>
          )}
        </div>

        <div className="flex flex-col flex-1 min-w-0">

          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
            <div className="relative flex-1" style={{ minWidth: 160 }}>
              <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder={`Search modpacks on ${source === "curseforge" ? "CurseForge" : "Modrinth"}...`}
                className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }}
                onFocus={e => e.currentTarget.style.borderColor = `${accentColor}80`}
                onBlur={e => e.currentTarget.style.borderColor = ""}
              />
            </div>
            <SimpleDropdown label={t("inst.sortBy2")} value={sortBy} options={SORT_OPTIONS} onChange={v => { setSortBy(v); setPage(0); }} />
            <SimpleDropdown label={t("inst.view")} value={String(viewCount)} options={VIEW_OPTIONS} onChange={v => { setViewCount(Number(v)); setPage(0); }} />
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={loading || page === 0}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors">
                <IconChevronLeft size={13} />
              </button>
              {pageItems.map((item, idx) =>
                item === "dots"
                  ? <span key={`d${idx}`} className="text-xs text-muted px-1">...</span>
                  : (
                    <button key={item} onClick={() => setPage((item as number) - 1)} disabled={loading}
                      className={["w-7 h-7 rounded-[8px] text-xs font-semibold transition-all",
                        item === page + 1
                          ? source === "curseforge" ? "bg-[#f16436] text-white" : "bg-[var(--color-accent)] text-black"
                          : "text-muted hover:text-foreground"].join(" ")}>
                      {item}
                    </button>
                  )
              )}
              <button onClick={() => setPage(p => p + 1)} disabled={loading || page >= totalPages - 1}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors">
                <IconChevronRight size={13} />
              </button>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border flex-wrap">
              {[...catFilters].map(c => (
                <span key={c} className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold"
                  style={{ borderColor: `${accentColor}4d`, backgroundColor: `${accentColor}1a`, color: accentColor }}>
                  {c}
                  <button onClick={() => { setCatFilters(prev => toggleSet(prev, c)); setPage(0); }} className="hover:opacity-60 transition-opacity ml-0.5"><IconX size={9} /></button>
                </span>
              ))}
              {[...loaderFilters].map(l => (
                <span key={l} className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold"
                  style={{ borderColor: `${accentColor}4d`, backgroundColor: `${accentColor}1a`, color: accentColor }}>
                  {l}
                  <button onClick={() => { setLoaderFilters(prev => toggleSet(prev, l)); setPage(0); }} className="hover:opacity-60 transition-opacity ml-0.5"><IconX size={9} /></button>
                </span>
              ))}
              {mcFilter && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold"
                  style={{ borderColor: `${accentColor}4d`, backgroundColor: `${accentColor}1a`, color: accentColor }}>
                  {mcFilter}
                  <button onClick={() => { setMcFilter(""); setPage(0); }} className="hover:opacity-60 transition-opacity ml-0.5"><IconX size={9} /></button>
                </span>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && <div className="flex items-center justify-center py-16"><IconRefresh size={20} className="text-muted animate-spin" /></div>}
            {error && (
              <div className="mx-4 mt-4 px-3 py-2.5 rounded-[12px] bg-danger/10 border border-danger/20 flex items-center gap-2">
                <IconAlertCircle size={14} className="text-danger flex-shrink-0" />
                <p className="text-xs text-danger">{error}</p>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
                <IconSearch size={36} className="text-muted" />
                <p className="text-sm text-muted">{t("inst.noModpacks")}</p>
              </div>
            )}
            {!loading && results.map(hit => {
              const isInstalled = installedSlugs.has(hit.slug);
              return (
                <div key={hit.project_id}
                  className="flex items-center gap-4 px-4 py-4 border-b border-border hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() => source === "modrinth" ? setSelectedHit(hit) : setSelectedCfHit(hit)}>
                  <div className="w-14 h-14 rounded-[15px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: "var(--color-surface)" }}>
                    {hit.icon_url ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={22} className="text-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-foreground">{hit.title}</p>
                      <span className="text-xs text-muted">{t("inst.by")} {hit.author}</span>
                      {isInstalled && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: `${accentColor}26`, color: accentColor }}>
                          <IconCheck size={9} /> {t("inst.installed")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{hit.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="flex items-center gap-1 text-[10px] text-muted"><IconDownload size={10} /> {formatDownloads(hit.downloads)}</span>
                      {hit.follows > 0 && <span className="flex items-center gap-1 text-[10px] text-muted"><IconStar size={10} /> {formatDownloads(hit.follows)}</span>}
                      {hit.categories.slice(0, 3).map(cat => (
                        <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted capitalize">{cat}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {isInstalled ? (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border"
                        style={{ borderColor: `${accentColor}4d`, color: accentColor, backgroundColor: `${accentColor}0d` }}>
                        <IconCheck size={12} /> {t("inst.installed")}
                      </span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); source === "modrinth" ? setSelectedHit(hit) : setSelectedCfHit(hit); }}
                        disabled={installing === hit.slug}
                        className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border-2 transition-all disabled:opacity-50", hoverClass].join(" ")}
                        style={{ borderColor: accentColor, color: accentColor, backgroundColor: "transparent" }}>
                        {installing === hit.slug ? "..." : <><IconDownload size={12} /> {t("inst.install")}</>}
                      </button>
                    )}
                    {hit.date_modified && <p className="text-[10px] text-muted">{timeAgo(hit.date_modified)}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function LocalTab({ instances, onSelect, onCreateClick, onImportClick }: {
  instances: LocalInstance[]; onSelect: (id: string) => void; onCreateClick: () => void; onImportClick: () => void;
}) {
  const t = useLauncherTranslation();
  const [search, setSearch] = useState("");
  const filtered = instances.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("inst.searchLocal")}
            className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <button onClick={onImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-border text-xs font-medium text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconPackageImport size={13} /> {t("inst.import")}
          </button>
          <button onClick={onCreateClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors">
            <IconPlus size={13} /> {t("inst.create")}
          </button>        
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 h-full opacity-40">
            <IconBox size={36} className="text-muted" />
            <p className="text-sm text-muted">{t("inst.noLocalInstances")}</p>
            <button onClick={onCreateClick} className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors">{t("inst.createFirst")}</button>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {filtered.map(inst => {
              const iconUrl = toUrl(inst.icon_path);
              return (
                <button key={inst.id} onClick={() => onSelect(inst.id)}
                  className="flex items-center gap-3 p-3 rounded-[15px] border border-border text-left transition-all hover:border-[var(--color-accent)]/30 group"
                  style={{ backgroundColor: "var(--color-surface)" }}>
                  <div className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 overflow-hidden border border-border"
                    style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                    {iconUrl
                      ? <img src={iconUrl} className="w-full h-full object-cover" alt="" />
                      : <LoaderIcon loader={inst.loader} size={36} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-[var(--color-accent)] transition-colors">{inst.title}</p>
                    <p className="text-xs text-muted truncate mt-0.5">{inst.loader.charAt(0).toUpperCase() + inst.loader.slice(1)} {inst.minecraft_version}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomTab() {
  const t = useLauncherTranslation();
  const { launchInstance, launchedInstanceId, installProgress, installStatus } = useInstance();
  const [instances, setInstances] = useState<RemoteInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [code, setCode] = useState("");
  const [addingCode, setAddingCode] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const getLoaderType = (loader: any) => {
    if (typeof loader === "object" && loader !== null) return String(loader.type || "vanilla");
    return String(loader || "vanilla");
  };

  const toPrivateInstance = (raw: any): RemoteInstance => ({
    id: raw.id ?? raw._id ?? String(Math.random()),
    name: raw.title ?? raw.name ?? "Unnamed",
    slug: raw.slug,
    loader: getLoaderType(raw.loader),
    minecraft_version: raw.minecraft_version ?? raw.version ?? "unknown",
    icon_url: raw.icon ?? raw.icon_url ?? null,
    description: raw.description ?? null,
    modCount: raw.mod_count ?? raw.mods?.length ?? null,
    code: raw.id ? localStorage.getItem(raw.id) ?? undefined : undefined,
    raw,
  });

  const loadSavedPrivateInstances = () => {
    const saved: any[] = JSON.parse(localStorage.getItem("codeInstances") || "[]");
    setInstances(saved.map(toPrivateInstance));
  };

  useEffect(() => {
    const fetchCustom = async () => {
      setLoading(true); setError(null);
      try {
        loadSavedPrivateInstances();
      } catch (e) { setError(String(e)); } finally { setLoading(false); }
    };
    fetchCustom();
  }, []);

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpenId(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

  const handleAddPanelCode = async () => {
    const cleanCode = code.trim();
    if (!cleanCode || addingCode) return;
    setAddingCode(true);
    try {
      const fetched: Instance = await getInstance({ code: cleanCode });
      const instance: Instance = {
        ...fetched,
        loader: typeof fetched.loader === "object" && fetched.loader !== null
          ? ((fetched.loader as any).type ?? "vanilla")
          : (fetched.loader ?? "vanilla"),
      } as Instance;
      if (!instance?.id) {
        toast.danger(t("inst.invalidShareCode"), { description: t("home.noInstanceWithCode") });
        return;
      }

      localStorage.setItem(instance.id, cleanCode);
      const savedCodeInstances: Instance[] = JSON.parse(localStorage.getItem("codeInstances") || "[]");
      const nextSaved = [
        instance,
        ...savedCodeInstances.filter((saved) => saved.id !== instance.id),
      ];
      localStorage.setItem("codeInstances", JSON.stringify(nextSaved));
      setInstances(nextSaved.map(toPrivateInstance));
      toast(`${instance.title || instance.id} ${t("inst.importedSuccess")}`);
      setCode("");
      setCodeModalOpen(false);
    } catch (e) {
      toast.danger(t("home.verifyCodeError"), { description: t("home.noInstanceWithCode") });
    } finally {
      setAddingCode(false);
    }
  };

  const removePrivateInstance = (id: string) => {
    const savedCodeInstances: Instance[] = JSON.parse(localStorage.getItem("codeInstances") || "[]");
    const nextSaved = savedCodeInstances.filter((saved) => saved.id !== id);
    localStorage.setItem("codeInstances", JSON.stringify(nextSaved));
    localStorage.removeItem(id);
    setInstances(nextSaved.map(toPrivateInstance));
    setMenuOpenId(null);
    toast(t("inst.deletedToast"));
  };

  const copyPrivateCode = async (inst: RemoteInstance) => {
    const storedCode = inst.code || localStorage.getItem(inst.id) || "";
    if (!storedCode) return;
    await navigator.clipboard.writeText(storedCode);
    setMenuOpenId(null);
    toast(t("inst.copied"));
  };

  const playPrivateInstance = (inst: RemoteInstance) => {
    if (!inst.raw) return;
    launchInstance(inst.raw);
  };

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-foreground">{t("inst.instancePrivate")}</h3>
            <p className="mt-0.5 text-xs text-muted">{t("inst.enterInstanceCode")}</p>
          </div>
          <button
            type="button"
            onClick={() => setCodeModalOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <IconKey size={14} /> Add code
          </button>
        </div>
        {loading && <div className="flex items-center justify-center py-16"><IconRefresh size={20} className="text-muted animate-spin" /></div>}
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-[12px] bg-danger/10 border border-danger/20 flex items-center gap-2">
            <IconAlertCircle size={14} className="text-danger flex-shrink-0" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}
        {!loading && !error && instances.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 h-full opacity-40">
            <IconBox size={36} className="text-muted" />
            <p className="text-sm text-muted">{t("inst.noInstances")}</p>
          </div>
        )}
        {!loading && instances.length > 0 && (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {instances.map(inst => {
              const isLaunched = launchedInstanceId === inst.id;
              const isLaunching = isLaunched && (installProgress > 0 || installStatus !== "");
              const menuOpen = menuOpenId === inst.id;
              const loaderLabel = inst.loader.charAt(0).toUpperCase() + inst.loader.slice(1);

              return (
                <div
                  key={inst.id}
                  className="group flex flex-col overflow-visible rounded-[14px] border border-border transition-all hover:border-[var(--color-accent)]/40"
                  style={{ backgroundColor: "var(--color-surface)" }}
                >
                  <div className="relative h-[72px] flex items-end overflow-hidden rounded-t-[14px]">
                    <div className="absolute inset-0 bg-[var(--color-accent)]/5" />
                    <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(ellipse at 50% 110%, var(--color-accent), transparent 70%)" }} />
                    <div className="relative z-10 m-2 h-10 w-10 overflow-hidden rounded-[10px] border border-white/10 flex items-center justify-center" style={{ backgroundColor: "var(--color-background)" }}>
                      {inst.icon_url
                        ? <img src={inst.icon_url} className="h-full w-full object-cover" alt="" />
                        : <LoaderIcon loader={inst.loader} size={32} />}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3 pt-2">
                    <p className="truncate text-[13px] font-bold leading-tight text-foreground group-hover:text-[var(--color-accent)] transition-colors">
                      {inst.name}
                    </p>
                    <span className="self-start inline-flex items-center gap-1.5 rounded-[6px] border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-muted">
                      <LoaderIcon loader={inst.loader} size={12} />
                      {loaderLabel} · {inst.minecraft_version}
                    </span>
                    {inst.description && <p className="line-clamp-2 text-[11px] text-muted">{inst.description}</p>}

                    <div className="mt-auto flex items-center justify-between border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => isLaunched ? invoke("stop_instance", { instanceId: inst.id }) : playPrivateInstance(inst)}
                        disabled={isLaunching || !inst.raw}
                        className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          isLaunched ? "bg-red-500 text-white hover:bg-red-600" : "bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent)]"
                        }`}
                      >
                        <IconPlayerPlay size={11} />
                        {isLaunching ? t("inst.installing") : isLaunched ? t("inst.close") : t("inst.play")}
                      </button>

                      <div className="relative" ref={menuOpen ? menuRef : null}>
                        <button
                          type="button"
                          onClick={() => setMenuOpenId(menuOpen ? null : inst.id)}
                          className={`flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border transition-all ${
                            menuOpen ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]" : "border-border text-muted hover:bg-white/5 hover:text-foreground"
                          }`}
                        >
                          <IconDotsVertical size={14} />
                        </button>
                        {menuOpen && (
                          <div
                            className="absolute bottom-full right-0 z-50 mb-1.5 w-44 overflow-hidden rounded-[12px] border border-border py-1 shadow-2xl"
                            style={{ backgroundColor: "var(--color-overlay)" }}
                          >
                            <button
                              type="button"
                              onClick={() => copyPrivateCode(inst)}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-foreground transition-colors hover:bg-white/5"
                            >
                              <IconCopy size={13} className="text-muted" />
                              {t("inst.copy")}
                            </button>
                            <button
                              type="button"
                              onClick={() => removePrivateInstance(inst.id)}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              <IconTrash size={13} />
                              {t("inst.delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {codeModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setCodeModalOpen(false); }}
        >
          <div className="w-[420px] rounded-[2px] border border-border p-6 shadow-2xl" style={{ backgroundColor: "var(--color-overlay)" }}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold text-foreground">{t("inst.addInstanceByCode")}</h2>
              <button onClick={() => setCodeModalOpen(false)} className="size-8 rounded-[9px] text-muted hover:bg-white/5 hover:text-foreground">
                <IconX size={16} />
              </button>
            </div>
            <p className="mb-2 text-sm font-semibold text-muted">{t("inst.enterInstanceCode")}</p>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleAddPanelCode();
              }}
              placeholder={t("home.accessCode")}
              type="password"
              className="w-full rounded-[11px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--color-accent)]/50"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setCodeModalOpen(false)} className="rounded-[7px] px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-white/5">
                {t("inst.cancel")}
              </button>
              <button
                onClick={handleAddPanelCode}
                disabled={!code.trim() || addingCode}
                className="rounded-[7px] bg-[var(--color-accent)] px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
              >
                {addingCode ? "Adding..." : "Add code"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function AllTab({ localInstances, onSelect, onCreateClick, onImportClick, onEdit, onDelete }: {
  localInstances: LocalInstance[];
  onSelect: (id: string) => void;
  onCreateClick: () => void;
  onImportClick: () => void;
  onEdit: (inst: LocalInstance) => void;
  onDelete: (inst: LocalInstance) => void;
}) {
  const t = useLauncherTranslation();
  const { launchInstance, launchedInstanceId, installProgress, installStatus } = useInstance();
  const [search, setSearch] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = localInstances.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));

  const handleDeleteInstance = async (inst: LocalInstance) => {
    try {
      await deleteLocalInstance(inst.id);
      onDelete(inst);
    } catch (error) {
      toast.danger(t("inst.delete"), { description: String(error) });
    }
  };

  useEffect(() => {
    if (!menuOpenId) return;
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenId(null);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [menuOpenId]);

  const loaderMeta: Record<string, { pill: string; dot: string; label: string }> = {
    fabric:   { pill: "bg-[#1bd96a]/10 border-[#1bd96a]/20 text-[#1bd96a]", dot: "#1bd96a", label: "Fabric"   },
    forge:    { pill: "bg-[#fb923c]/10 border-[#fb923c]/20 text-[#fb923c]", dot: "#fb923c", label: "Forge"    },
    neoforge: { pill: "bg-[#a855f7]/10 border-[#a855f7]/20 text-[#a855f7]", dot: "#a855f7", label: "NeoForge" },
    vanilla:  { pill: "bg-white/5 border-white/10 text-muted",               dot: "#64748b", label: "Vanilla"  },
  };

  return (
    <div className="flex w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>

      <div className="w-[188px] flex-shrink-0 flex flex-col border-r border-border" style={{ backgroundColor: "var(--color-background)" }}>
        <div className="px-3 pt-3 pb-1">
          <span className="text-[10px] font-bold text-muted tracking-widest uppercase">Recent</span>
        </div>
        <div className="flex flex-col gap-0.5 px-2 flex-1 overflow-y-auto py-1">
          {localInstances.slice(0, 6).map(inst => {
            const iconUrl = toUrl(inst.icon_path);
            return (
              <button
                key={inst.id}
                onClick={() => onSelect(inst.id)}
                className="flex items-center gap-2.5 px-2 py-2 rounded-[10px] text-left transition-all hover:bg-white/[0.04] group w-full"
              >
                <div className="w-8 h-8 rounded-[9px] border border-border overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
                  {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <LoaderIcon loader={inst.loader} size={28} />}
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-foreground truncate leading-tight group-hover:text-[var(--color-accent)] transition-colors">{inst.title}</p>
                  <p className="text-[10px] text-muted mt-0.5 truncate capitalize">{inst.loader} · {inst.minecraft_version}</p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-2 border-t border-border flex flex-col gap-1">
          <button onClick={onCreateClick} className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-left w-full transition-all hover:bg-[var(--color-accent)]/10 group">
            <div className="w-8 h-8 rounded-[9px] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center flex-shrink-0">
              <IconPlus size={15} className="text-[var(--color-accent)]" />
            </div>
            <span className="text-[12px] font-semibold text-[var(--color-accent)]">{t("inst.create")}</span>
          </button>
          <button onClick={onImportClick} className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-left w-full transition-all hover:bg-white/[0.04] group">
            <div className="w-8 h-8 rounded-[9px] border border-border flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
              <IconPackageImport size={15} className="text-muted" />
            </div>
            <span className="text-[12px] font-semibold text-muted group-hover:text-foreground transition-colors">{t("inst.import")}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="relative flex-1">
            <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("inst.search")}
              className="w-full pl-8 pr-3 py-2 rounded-[10px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
              style={{ backgroundColor: "var(--color-surface)" }}
            />
          </div>
          <div className="flex items-center gap-1.5 border border-border rounded-[10px] px-3 py-2 text-xs text-muted cursor-default" style={{ backgroundColor: "var(--color-surface)" }}>
            <IconArrowsSort size={12} />
            <span>Name</span>
            <IconChevronDown size={11} className="text-muted" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 h-full opacity-40">
              <IconBox size={40} className="text-muted" />
              <p className="text-sm text-muted">{t("inst.noInstances")}</p>
              <button onClick={onCreateClick} className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors">{t("inst.createFirst")}</button>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-bold text-muted tracking-widest uppercase mb-3 flex items-center gap-2">
                All instances
                <span className="px-1.5 py-0.5 rounded-[5px] bg-white/5 text-[10px] text-muted font-mono">{filtered.length}</span>
              </p>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {filtered.map(inst => {
                  const iconUrl = toUrl(inst.icon_path);
                  const bgUrl = toUrl(inst.background_path);
                  const meta = loaderMeta[inst.loader] ?? loaderMeta.vanilla;
                  const isLaunched = launchedInstanceId === inst.id;
                  const isLaunching = isLaunched && (installProgress > 0 || installStatus !== "");
                  const menuOpen = menuOpenId === inst.id;

                  return (
                    <div
                      key={inst.id}
                      onClick={() => onSelect(inst.id)}
                      className="group flex flex-col rounded-[14px] border border-border overflow-visible cursor-pointer transition-all hover:border-[var(--color-accent)]/40"
                      style={{ backgroundColor: "var(--color-surface)" }}
                    >
                      <div className="relative h-[72px] flex items-end justify-start flex-shrink-0 overflow-hidden rounded-t-[14px]">
                        {bgUrl ? (
                          <>
                            <img src={bgUrl} className="absolute inset-0 w-full h-full object-cover" alt="" />
                            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 65%)" }} />
                          </>
                        ) : (
                          <>
                            <div className="absolute inset-0" style={{ backgroundColor: `${meta.dot}0d` }} />
                            <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(ellipse at 50% 110%, ${meta.dot}, transparent 70%)` }} />
                          </>
                        )}
                        <div
                          className="relative z-10 m-2 w-10 h-10 rounded-[10px] border border-white/10 overflow-hidden flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: "var(--color-background)" }}
                        >
                          {iconUrl
                            ? <img src={iconUrl} className="w-full h-full object-cover" alt="" />
                            : <LoaderIcon loader={inst.loader} size={32} />}
                        </div>
                      </div>

                      <div className="flex flex-col px-3 pt-2 pb-3 gap-1.5 flex-1">
                        <p className="text-[13px] font-bold text-foreground truncate leading-tight group-hover:text-[var(--color-accent)] transition-colors">
                          {inst.title}
                        </p>
                        <span className={`self-start inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border text-[10px] font-bold ${meta.pill}`}>
                          <LoaderIcon loader={inst.loader} size={12} />
                          {meta.label} · {inst.minecraft_version}
                        </span>
                        <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (isLaunched) {
                                invoke("stop_instance", { instanceId: inst.id });
                              } else {
                                launchInstance({ ...inst, _isLocal: true } as any);
                              }
                            }}
                            disabled={isLaunching}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isLaunched ? "bg-red-500 hover:bg-red-600 text-white" : "bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black"}`}
                          >
                            <IconPlayerPlay size={11} />
                            {isLaunching ? t("inst.installing") : isLaunched ? t("inst.close") : t("inst.play")}
                          </button>

                          <div className="relative" ref={menuOpen ? menuRef : null} onClick={e => e.stopPropagation()}>
                            <button
                              onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpen ? null : inst.id); }}
                              className={`w-[26px] h-[26px] rounded-[7px] border flex items-center justify-center transition-all ${menuOpen ? "border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-border text-muted hover:text-foreground hover:bg-white/5"}`}
                            >
                              <IconDotsVertical size={14} />
                            </button>
                            {menuOpen && (
                              <div
                                className="absolute bottom-full right-0 mb-1.5 z-50 w-44 rounded-[12px] border border-border overflow-hidden shadow-2xl py-1"
                                style={{ backgroundColor: "var(--color-overlay)" }}
                              >
                                <button
                                  onClick={() => { setMenuOpenId(null); onEdit(inst); }}
                                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"
                                >
                                  <IconAdjustments size={13} className="text-muted flex-shrink-0" />
                                  {t("inst.editGeneral") ?? "Edit instance"}
                                </button>
                                <button
                                  onClick={() => { setMenuOpenId(null); invoke("open_local_instance_folder", { id: inst.id }); }}
                                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"
                                >
                                  <IconFolder size={13} className="text-muted flex-shrink-0" />
                                  {t("inst.openFolder")}
                                </button>
                                <div className="my-1 border-t border-border" />
                                <button
                                  onClick={() => { setMenuOpenId(null); handleDeleteInstance(inst); }}
                                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                  <IconTrash size={13} className="flex-shrink-0" />
                                  {t("inst.delete") ?? "Delete"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={onCreateClick}
                  className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/5 transition-all cursor-pointer min-h-[160px]"
                  style={{ backgroundColor: "transparent" }}
                >
                  <IconPlus size={24} className="text-[var(--color-accent)] opacity-50" />
                  <span className="text-[11px] text-muted font-semibold">{t("inst.create")}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InstancesGridView({
  instances, activeTab, setActiveTab, onSelect, onCreateClick, onImportClick, onImportCodeClick, onInstalled, onEdit, onDelete,
  initialModpackHit, onConsumeInitialModpackHit,
}: {
  instances: LocalInstance[]; activeTab: InstanceTab; setActiveTab: (t: InstanceTab) => void;
  onSelect: (id: string) => void; onCreateClick: () => void; onImportClick: () => void; onImportCodeClick: () => void;
  onInstalled: (inst: LocalInstance) => void;
  onEdit: (inst: LocalInstance) => void;
  onDelete: (inst: LocalInstance) => void;
  initialModpackHit?: ModrinthHit | null;
  onConsumeInitialModpackHit?: () => void;
}) {
  const t = useLauncherTranslation();
  const TABS: { label: string; key: InstanceTab }[] = [
    { label: t("inst.allInstances"), key: "all" },
    { label: t("inst.modpacks"), key: "modpacks" },
    { label: t("inst.local"), key: "local" },
    { label: t("inst.instancePrivate"), key: "custom" },
  ];
  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
                activeTab === tab.key ? "bg-[var(--color-accent)] text-black" : "text-muted hover:text-foreground"].join(" ")}>
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={onImportCodeClick}
          className="flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <IconKey size={14} /> {t("inst.importByCode")}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "all" && <AllTab localInstances={instances} onSelect={onSelect} onCreateClick={onCreateClick} onImportClick={onImportClick} onEdit={onEdit} onDelete={onDelete} />}
        {activeTab === "modpacks" && (
          <ModpacksTab
            localInstances={instances}
            onInstalled={onInstalled}
            initialHit={initialModpackHit}
            onConsumeInitialHit={onConsumeInitialModpackHit}
          />
        )}
        {activeTab === "local" && <LocalTab instances={instances} onSelect={onSelect} onCreateClick={onCreateClick} onImportClick={onImportClick} />}
        {activeTab === "custom" && <CustomTab />}
      </div>
    </div>
  );
}

interface FileNode { name: string; path: string; isDir: boolean; children?: FileNode[]; checked: boolean; indeterminate?: boolean; }

function ExportModal({ instance, onClose }: { instance: LocalInstance; onClose: () => void }) {
  const t = useLauncherTranslation();
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modpackName, setModpackName] = useState(instance.title);
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [fileListOpen, setFileListOpen] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([
    { name: "mods/", path: "mods", isDir: true, checked: true, children: [] },
    { name: "config/", path: "config", isDir: true, checked: true, children: [] },
    { name: "resourcepacks/", path: "resourcepacks", isDir: true, checked: true, children: [] },
    { name: "shaderpacks/", path: "shaderpacks", isDir: true, checked: false, children: [] },
    { name: "options.txt", path: "options.txt", isDir: false, checked: false },
    { name: "servers.dat", path: "servers.dat", isDir: false, checked: false },
    { name: "servers.dat_old", path: "servers.dat_old", isDir: false, checked: false },
    { name: "gameData.json", path: "gameData.json", isDir: false, checked: false },
  ]);

  const handleToggle = (path: string, checked: boolean) => {
    setFileTree(prev => prev.map(n => n.path === path ? { ...n, checked } : n));
  };

  const handleExport = async () => {
    if (!modpackName.trim()) return;
    setExporting(true); setError(null);
    const options: Record<string, boolean> = { include_images: true };
    fileTree.forEach(n => { options[n.path] = n.checked; });
    try {
      const path = await invoke<string>("export_local_instance", { id: instance.id, options });
      setExportPath(path); setDone(true);
    } catch (e) { if (!String(e).includes("cancelled")) setError(String(e)); }
    finally { setExporting(false); }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-[14px] w-[500px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--color-overlay)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-[17px] font-semibold text-foreground">{t("inst.exportTitle")}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-white/5 hover:text-foreground">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pb-5 flex flex-col gap-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 112px" }}>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-muted">{t("inst.exportName")}</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-[9px] border border-border transition-colors focus-within:border-[var(--color-accent)]/40" style={{ backgroundColor: "var(--color-surface)" }}>
                  <IconBox size={13} className="text-muted flex-shrink-0" />
                  <input value={modpackName} onChange={e => setModpackName(e.target.value)} className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none min-w-0" placeholder="My modpack..." />
                  {modpackName && <button onClick={() => setModpackName("")} className="text-muted hover:text-foreground transition-colors flex-shrink-0"><IconX size={12} /></button>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-muted">{t("inst.exportVersion")}</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-[9px] border border-border transition-colors focus-within:border-[var(--color-accent)]/40" style={{ backgroundColor: "var(--color-surface)" }}>
                  <IconChevronRight size={13} className="text-muted flex-shrink-0" />
                  <input value={version} onChange={e => setVersion(e.target.value)} className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none min-w-0" placeholder="1.0.0" />
                  {version && <button onClick={() => setVersion("")} className="text-muted hover:text-foreground transition-colors flex-shrink-0"><IconX size={12} /></button>}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted">{t("inst.exportDescription")}</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("inst.exportDescPlaceholder")} rows={3}
                className="px-3 py-2.5 rounded-[9px] border border-border text-sm text-foreground placeholder:text-muted focus:outline-none resize-none transition-colors focus:border-[var(--color-accent)]/40"
                style={{ backgroundColor: "var(--color-surface)" }} />
            </div>

            <div className="rounded-[10px] overflow-hidden border border-border" style={{ backgroundColor: "var(--color-surface)" }}>
              <button type="button" onClick={() => setFileListOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.03]">
                <div className="flex items-center gap-2.5">
                  <IconAdjustments size={14} className="text-muted" />
                  <span className="text-sm font-medium text-foreground">{t("inst.exportFiles")}</span>
                </div>
                <IconChevronDown size={14} className={`text-muted transition-transform ${fileListOpen ? "rotate-180" : ""}`} />
              </button>
              {fileListOpen && (
                <div className="border-t border-border">
                  {fileTree.map((node, i) => (
                    <div key={node.path} onClick={() => handleToggle(node.path, !node.checked)}
                      className="flex items-center justify-between px-4 py-2.5 transition-colors cursor-pointer hover:bg-white/[0.03]"
                      style={{ borderTop: i === 0 ? "none" : "0.5px solid var(--color-border)" }}>
                      <div className="flex items-center gap-3">
                        <div className={["flex items-center justify-center flex-shrink-0 transition-all rounded-[5px]", node.checked ? "bg-[var(--color-accent)]" : "border border-border bg-transparent"].join(" ")} style={{ width: 17, height: 17 }}>
                          {node.checked && <IconCheck size={11} className="text-black" strokeWidth={3} />}
                        </div>
                        <span className={`text-sm ${node.isDir ? "text-foreground" : "text-muted"}`}>{node.name}</span>
                      </div>
                      {node.isDir && <IconChevronDown size={13} className="text-muted opacity-40" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="px-3 py-2.5 rounded-[10px] bg-danger/10 border border-danger/20 text-xs text-danger">{error}</div>}
            {done && exportPath && (
              <div className="px-3 py-2.5 rounded-[10px] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-start gap-2">
                <IconCheck size={13} className="text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[var(--color-accent)]">{t("inst.exportSuccess")}</p>
                  <p className="text-[11px] text-muted mt-0.5 break-all font-mono">{exportPath}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-sm text-muted hover:text-foreground border border-border hover:bg-white/5 transition-colors">
            <IconX size={13} />{done ? t("inst.close") : t("inst.cancel")}
          </button>
          {!done && (
            <button onClick={handleExport} disabled={exporting || !modpackName.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-[8px] text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <IconPackageExport size={14} />{exporting ? t("inst.exporting") : t("inst.export")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ShareInstanceModal({ instance, onClose, onImported }: { instance: LocalInstance; onClose: () => void; onImported: (inst: LocalInstance) => void }) {
  const t = useLauncherTranslation();
  const { account, friends, sendMessage, sendGlobalMessage } = useModstack();
  const openFriendsPanel = useFriendsPanel((state) => state.open);
  const [code, setCode] = useState("");
  const [importCode, setImportCode] = useState("");
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    createInstanceSharePayloadWithAssets(instance)
      .then((payload) => setCode(encodeInstanceShare(payload)))
      .catch(() => setCode(""));
  }, [instance.id]);

  const sendToChat = async (target: "global" | string) => {
    setSending(target);
    try {
      const payload = await createInstanceSharePayloadWithAssets(instance);
      const message = createInstanceShareMessage(instance, payload);
      if (target === "global") sendGlobalMessage(message);
      else sendMessage(target, message);
      openFriendsPanel();
      toast(t("inst.shareSent"));
      onClose();
    } finally {
      setSending(null);
    }
  };

  const importFromCode = async () => {
    const payload = decodeInstanceShare(importCode);
    if (!payload) {
      toast.danger(t("inst.invalidShareCode"));
      return;
    }
    try {
      const imported = await importSharedInstance(payload);
      onImported(imported);
      toast(`${imported.title} ${t("inst.importedSuccess")}`);
      onClose();
    } catch (error) {
      toast.danger(t("inst.importError"), { description: String(error) });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[520px] max-h-[88vh] overflow-hidden rounded-[16px] border border-border shadow-2xl"
        style={{ backgroundColor: "var(--color-overlay)" }}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-[12px] bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center">
              <IconShare3 size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold text-foreground">{t("inst.shareInstance")}</h2>
              <p className="text-xs text-muted truncate">{instance.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-[9px] text-muted transition-colors hover:bg-white/5 hover:text-foreground">
            <IconX size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 pb-6 flex flex-col gap-4">
          <div className="rounded-[13px] border border-border p-4" style={{ backgroundColor: "var(--color-surface)" }}>
            <div className="flex items-center gap-2 mb-3">
              <IconMessage size={16} className="text-[var(--color-accent)]" />
              <p className="text-sm font-semibold text-foreground">{t("inst.shareByChat")}</p>
            </div>
            {!account ? (
              <p className="text-xs text-muted">{t("inst.shareLoginRequired")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => sendToChat("global")}
                  disabled={sending !== null}
                  className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  <span>Modstack Chat</span>
                  <IconShare3 size={14} className="text-muted" />
                </button>
                {friends.map((friend) => (
                  <button
                    key={friend.id}
                    onClick={() => sendToChat(friend.id)}
                    disabled={sending !== null}
                    className="flex items-center justify-between rounded-[10px] border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
                  >
                    <span className="truncate">{friend.username}</span>
                    <IconShare3 size={14} className="text-muted" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[13px] border border-border p-4" style={{ backgroundColor: "var(--color-surface)" }}>
            <div className="flex items-center gap-2 mb-3">
              <IconKey size={16} className="text-[var(--color-accent)]" />
              <p className="text-sm font-semibold text-foreground">{t("inst.shareByCode")}</p>
            </div>
            <div className="flex items-center gap-2 rounded-[10px] bg-background px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-xs font-bold tracking-wide text-foreground">{code}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(code);
                  toast(t("inst.copied"));
                }}
                className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-white/5"
              >
                <IconCopy size={13} /> {t("inst.copy")}
              </button>
            </div>
          </div>

          <div className="rounded-[13px] border border-border p-4" style={{ backgroundColor: "var(--color-surface)" }}>
            <p className="mb-2 text-sm font-semibold text-foreground">{t("inst.importByCode")}</p>
            <div className="flex gap-2">
              <input
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder={t("inst.pasteShareCode")}
                className="min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--color-accent)]/50"
              />
              <button
                onClick={importFromCode}
                disabled={!importCode.trim()}
                className="rounded-[10px] bg-[var(--color-accent)] px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
              >
                {t("inst.import")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ImportShareCodeModal({ onClose, onImported }: { onClose: () => void; onImported: (inst: LocalInstance) => void }) {
  const t = useLauncherTranslation();
  const [code, setCode] = useState("");

  const handleImport = async () => {
    const payload = decodeInstanceShare(code);
    if (!payload) {
      toast.danger(t("inst.invalidShareCode"));
      return;
    }
    try {
      const inst = await importSharedInstance(payload);
      onImported(inst);
      toast(`${inst.title} ${t("inst.importedSuccess")}`);
      onClose();
    } catch (error) {
      toast.danger(t("inst.importError"), { description: String(error) });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] rounded-[2px] border border-border p-6 shadow-2xl" style={{ backgroundColor: "var(--color-overlay)" }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[17px] font-bold text-foreground">{t("inst.addInstanceByCode")}</h2>
          </div>
          <button onClick={onClose} className="size-8 rounded-[9px] text-muted hover:bg-white/5 hover:text-foreground">
            <IconX size={16} />
          </button>
        </div>
        <p className="mb-2 text-sm font-semibold text-muted">{t("inst.enterInstanceCode")}</p>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("inst.pasteShareCode")}
          rows={4}
          className="w-full resize-none rounded-[11px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--color-accent)]/50"
        />
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-[7px] px-4 py-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-white/5">
            {t("inst.cancel")}
          </button>
          <button onClick={handleImport} disabled={!code.trim()} className="rounded-[7px] bg-[var(--color-accent)] px-5 py-2 text-sm font-bold text-black disabled:opacity-40">
            {t("inst.addInstance")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DotsDropdown({ onOpenFolder, onShare, onExport }: { onOpenFolder: () => void; onShare: () => void; onExport: () => void }) {
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const items = [
    { icon: <IconFolder size={14} />, label: t("inst.files"), description: t("inst.openFolder"), action: () => { onOpenFolder(); setOpen(false); }, green: false },
    { icon: <IconShare3 size={14} />, label: t("inst.shareInstance"), description: t("inst.shareInstanceDescription"), action: () => { onShare(); setOpen(false); }, green: true },
    { icon: <IconPackageExport size={14} />, label: t("inst.exportMenuItem"), description: t("inst.exportSaveAs"), action: () => { onExport(); setOpen(false); }, green: true },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className={["w-9 h-9 flex items-center justify-center rounded-[12px] border transition-colors",
          open ? "border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/5" : "border-border text-muted hover:text-foreground hover:bg-white/5"].join(" ")}>
        <IconDotsVertical size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-[15px] border border-border shadow-2xl overflow-hidden"
          style={{ backgroundColor: "var(--color-overlay)" }}>
          <div className="absolute -top-[5px] right-3.5 w-2.5 h-2.5 rotate-45 border-l border-t border-border" style={{ backgroundColor: "var(--color-overlay)" }} />
          <div className="p-1.5 flex flex-col gap-0.5">
            {items.map(item => (
              <button key={item.label} onClick={item.action}
                className={["flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-left w-full transition-all group", item.green ? "hover:bg-[var(--color-accent)]/10" : "hover:bg-white/[0.04]"].join(" ")}>
                <span className={["flex-shrink-0 transition-colors", item.green ? "text-[var(--color-accent)]" : "text-muted group-hover:text-foreground"].join(" ")}>{item.icon}</span>
                <div className="min-w-0">
                  <p className={["text-sm font-medium leading-none", item.green ? "text-[var(--color-accent)]" : "text-foreground"].join(" ")}>{item.label}</p>
                  <p className="text-[11px] text-muted mt-0.5 truncate">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateModal({ onClose, onCreate, onImport, onBrowseModpacks, initialVersion, initialName }: {
  onClose: () => void;
  onCreate: (inst: LocalInstance) => void;
  onImport?: () => void;
  onBrowseModpacks?: () => void;
  initialVersion?: string;
  initialName?: string;
}) {
  const t = useLauncherTranslation();
  const [step, setStep] = useState<"choose" | "custom" | "modpack">(
    initialVersion || initialName ? "custom" : "choose",
  );
  const [modpackQuery, setModpackQuery] = useState("");
  const [modpackResults, setModpackResults] = useState<ModrinthHit[]>([]);
  const [modpackLoading, setModpackLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const { versions, loading: loadingVersions } = useVersions();
  const [name, setName] = useState(initialName ?? "");
  const [loader, setLoader] = useState<Loader>("fabric");
  const [version, setVersion] = useState(initialVersion ?? "");
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedModpack] = useState<string>("");
  const [fetchingModpack] = useState(false);

  useEffect(() => { if (versions.length && !version) setVersion(versions[0].id); }, [versions]);

  useEffect(() => {
    const filtered = filterVersionsForLoader(versions, loader);
    if (filtered.length && !filtered.find(v => v.id === version)) {
      setVersion(filtered[0].id);
    }
  }, [loader, versions]);

  const searchModpacks = async (q: string) => {
    setModpackLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("query", q.trim());
      params.set("limit", "20");
      params.set("facets", JSON.stringify([["project_type:modpack"]]));
      params.set("index", "downloads");
      const res = await fetch(`https://api.modrinth.com/v2/search?${params}`, {
        headers: { "User-Agent": "Launcher/1.0" },
      });
      const data = await res.json();
      setModpackResults(Array.isArray(data.hits) ? data.hits : []);
    } catch {
      setModpackResults([]);
    } finally {
      setModpackLoading(false);
    }
  };

  useEffect(() => {
    if (step !== "modpack") return;
    const timer = setTimeout(() => searchModpacks(modpackQuery), 350);
    return () => clearTimeout(timer);
  }, [modpackQuery, step]);

  useEffect(() => {
    if (step === "modpack") searchModpacks("");
  }, [step]);


  const handleInstallModpack = async (hit: ModrinthHit) => {
    setInstalling(hit.slug);
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${hit.slug}/version`, {
        headers: { "User-Agent": "Launcher/1.0" },
      });
      const modpackVersions = await res.json();
      const target = modpackVersions.find((v: any) => v.version_type === "release") || modpackVersions[0];
      const inst = await invoke<LocalInstance>("install_modrinth_modpack", {
        slug: hit.slug,
        title: hit.title,
        iconUrl: hit.icon_url ?? null,
        versionId: target?.id ?? null,
      });
      onCreate(inst);
      onClose();
    } catch (e) {
      toast.danger(t("inst.errorInstalling"), { description: String(e) });
    } finally {
      setInstalling(null);
    }
  };

  const handleCreate = async () => {
    const title = name.trim();
    if (!title || saving) return;
    setSaving(true);
    if (selectedModpack) {
      try {
        const queryParams = new URLSearchParams({
          game_versions: JSON.stringify([version]),
          loaders: JSON.stringify([loader === "vanilla" ? "fabric" : loader]),
        });
        const res = await fetch(`https://api.modrinth.com/v2/project/${selectedModpack}/version?${queryParams}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const modpackVersions = await res.json();
        if (modpackVersions.length === 0) throw new Error(`No compatible version found for ${version} / ${loader}`);
        const targetVersion = modpackVersions[0];
        const projRes = await fetch(`https://api.modrinth.com/v2/project/${selectedModpack}`);
        if (!projRes.ok) throw new Error(`HTTP ${projRes.status}`);
        const projData = await projRes.json();
        let created = await invoke<LocalInstance>("install_modrinth_modpack", {
          slug: selectedModpack, title, iconUrl: projData.icon_url || null, versionId: targetVersion.id,
        });
        if (iconSrc || bgSrc) {
          created = await updateLocalInstance(created.id, created.title, created.minecraft_version, created.loader, iconSrc, bgSrc, false, false);
        }
        onCreate(created); onClose();
      } catch (e) {
        toast.danger(t("inst.errorInstalling"), { description: String(e) });
      } finally { setSaving(false); }
    } else {
      const inst: LocalInstance = {
        id: slugify(title) || `inst-${Date.now()}`,
        title, minecraft_version: version, loader,
        icon_path: null, background_path: null, created_at: Date.now(),
      };
      try {
        const created = await invoke<LocalInstance>("add_local_instance", {
          instance: inst, iconSrc: iconSrc ?? null, backgroundSrc: bgSrc ?? null,
        });
        onCreate(created); onClose();
      } catch (e) {
        toast.danger(t("inst.errorInstalling"), { description: String(e) });
      } finally { setSaving(false); }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {step === "choose" && (
        <div
          className="rounded-[18px] w-[420px] flex flex-col shadow-2xl border border-white/10 overflow-hidden"
          style={{ backgroundColor: "var(--color-overlay)" }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <span className="text-base font-bold text-foreground">{t("inst.createTitle")}</span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-[10px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <IconX size={16} />
            </button>
          </div>
          <div className="px-6 pb-6 flex flex-col gap-3">
            <button
              onClick={() => setStep("custom")}
              className="flex flex-col items-center justify-center gap-3 p-6 rounded-[14px] border-2 border-dashed border-border hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/5 transition-all group"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              <div className="w-12 h-12 rounded-[12px] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center group-hover:bg-[var(--color-accent)]/20 transition-colors">
                <IconAdjustments size={22} className="text-[var(--color-accent)]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Custom (Empty)</p>
                <p className="text-xs text-muted mt-0.5">Start from scratch with your own config</p>
              </div>
            </button>

            <button
              onClick={() => setStep("modpack")}
              className="flex flex-col items-center justify-center gap-3 p-6 rounded-[14px] border-2 border-dashed border-border hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/5 transition-all group"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              <div className="w-12 h-12 rounded-[12px] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center group-hover:bg-[var(--color-accent)]/20 transition-colors">
                <IconBox size={22} className="text-[var(--color-accent)]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Install Modpack</p>
                <p className="text-xs text-muted mt-0.5">Browse and install from Modrinth</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {step === "custom" && (
        <div
          className="rounded-[15px] w-[460px] flex flex-col shadow-2xl border border-white/10"
          style={{ backgroundColor: "var(--color-overlay)" }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep("choose")}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <IconChevronLeft size={15} />
              </button>
              <span className="text-base font-bold text-foreground">Create instance</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-[10px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <IconX size={16} />
            </button>
          </div>
          <div className="px-6 pb-5 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div
                onClick={async () => { const p = await pickImage(); if (p) setIconSrc(p); }}
                className="w-16 h-16 rounded-[14px] border border-border flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer hover:border-[var(--color-accent)]/40 transition-colors relative group"
                style={{ backgroundColor: "var(--color-surface)" }}
              >
                {iconSrc ? <img src={toUrl(iconSrc) ?? ""} className="w-full h-full object-cover" alt="" /> : <IconBox size={24} className="text-muted" />}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><IconUpload size={14} className="text-white" /></div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={async () => { const p = await pickImage(); if (p) setIconSrc(p); }} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground border border-border px-3 py-1.5 rounded-[9px] transition-colors w-fit"><IconUpload size={11} /> {t("inst.selectIcon")}</button>
                {iconSrc && <button onClick={() => setIconSrc(null)} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground border border-border px-3 py-1.5 rounded-[9px] transition-colors w-[116px]"><IconX size={11} /> {t("inst.removeIcon")}</button>}
              </div>
              <div className="w-px h-12 self-center flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
              <div
                onClick={async () => { const p = await pickImage(); if (p) setBgSrc(p); }}
                className="w-16 h-16 rounded-[14px] border border-border flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer hover:border-[var(--color-accent)]/40 transition-colors relative group"
                style={{ backgroundColor: "var(--color-surface)" }}
              >
                {bgSrc ? <img src={toUrl(bgSrc) ?? ""} className="w-full h-full object-cover" alt="" /> : <IconPhoto size={24} className="text-muted" />}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><IconUpload size={14} className="text-white" /></div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={async () => { const p = await pickImage(); if (p) setBgSrc(p); }} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground border border-border px-3 py-1.5 rounded-[9px] transition-colors w-fit"><IconUpload size={11} /> {t("inst.selectBg")}</button>
                {bgSrc && <button onClick={() => setBgSrc(null)} className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground border border-border px-3 py-1.5 rounded-[9px] transition-colors w-[108px]"><IconX size={11} /> {t("inst.removeBg")}</button>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">{t("inst.name")}</label>
              <input
                autoFocus value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && name.trim()) handleCreate(); }}
                placeholder={`${loader.charAt(0).toUpperCase() + loader.slice(1)} ${version}`}
                className="w-full px-3 py-2 rounded-[10px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-foreground">{t("inst.loader")}</label>
              <div className="flex flex-wrap gap-1.5">
                {(["vanilla", "fabric", "forge", "neoforge"] as Loader[]).map(l => (
                  <button key={l} type="button" onClick={() => setLoader(l)}
                    className={["flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      loader === l ? "bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-accent)]" : "bg-transparent border-border text-muted hover:text-foreground"].join(" ")}>
                    {loader === l && <IconCheck size={11} />}
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-foreground">{t("inst.gameVersion")}</label>
              <VersionDropdown value={version} onChange={setVersion} versions={filterVersionsForLoader(versions, loader)} loading={loadingVersions} />
            </div>
          </div>
          <div className="flex items-center justify-end px-6 py-4 gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors">{t("inst.cancel")}</button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving || fetchingModpack}
              className="flex items-center gap-1.5 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <IconPlus size={14} />{saving ? t("inst.creating") : t("inst.createTitle")}
            </button>
          </div>
        </div>
      )}

      {step === "modpack" && (
        <div
          className="rounded-[18px] w-[520px] flex flex-col shadow-2xl border border-white/10 overflow-hidden"
          style={{ backgroundColor: "var(--color-overlay)", maxHeight: "78vh" }}
        >
          <div className="flex items-center justify-between px-6 py-5 flex-shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStep("choose")}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <IconChevronLeft size={15} />
              </button>
              <span className="text-base font-bold text-foreground">Choose modpack</span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-[10px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <IconX size={16} />
            </button>
          </div>

          <div className="px-6 pb-4 flex-shrink-0 flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">Already know the modpack you want to install?</p>
            <div className="relative">
              <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                autoFocus
                value={modpackQuery}
                onChange={e => setModpackQuery(e.target.value)}
                placeholder="Search for modpack"
                className="w-full pl-8 pr-3 py-2.5 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 min-h-0">
            {modpackLoading ? (
              <div className="flex items-center justify-center py-10">
                <IconRefresh size={20} className="text-muted animate-spin" />
              </div>
            ) : modpackResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 opacity-40">
                <IconSearch size={28} className="text-muted" />
                <p className="text-xs text-muted">No modpacks found</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 pb-3">
                {modpackResults.map(hit => {
                  const isInstalling = installing === hit.slug;
                  return (
                    <button
                      key={hit.project_id}
                      onClick={() => { if (!installing) handleInstallModpack(hit); }}
                      disabled={!!installing}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-[12px] border border-border hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/5 transition-all text-left group disabled:opacity-60"
                      style={{ backgroundColor: "var(--color-surface)" }}
                    >
                      <div
                        className="w-10 h-10 rounded-[10px] overflow-hidden flex-shrink-0 border border-border flex items-center justify-center"
                        style={{ backgroundColor: "var(--color-surface-secondary)" }}
                      >
                        {hit.icon_url
                          ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" />
                          : <IconBox size={18} className="text-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate group-hover:text-[var(--color-accent)] transition-colors">{hit.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted truncate">by {hit.author}</span>
                          <span className="flex items-center gap-1 text-[10px] text-muted flex-shrink-0">
                            <IconDownload size={9} /> {formatDownloads(hit.downloads)}
                          </span>
                        </div>
                      </div>
                      {isInstalling
                        ? <IconRefresh size={15} className="text-[var(--color-accent)] animate-spin flex-shrink-0" />
                        : <IconDownload size={15} className="text-muted group-hover:text-[var(--color-accent)] transition-colors flex-shrink-0" />
                      }
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className="flex-shrink-0 px-6 py-4 flex items-center gap-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <button
              onClick={() => { onClose(); onImport?.(); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <IconPackageImport size={14} /> Import modpack
            </button>
            <button
              onClick={() => { onClose(); onBrowseModpacks?.(); }}
              className="flex items-center gap-1.5 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors ml-auto"
            >
              <SiModrinth size={13} /> Browse modpacks
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

function EditModal({ instance, onClose, onSave, onDelete }: {
  instance: LocalInstance; onClose: () => void; onSave: (updated: LocalInstance) => void; onDelete: (id: string) => void;
}) {
  const t = useLauncherTranslation();
  const { versions, loading: loadingVersions } = useVersions();
  const { maxRAM, windowWidth, windowHeight, fullscreen } = useSettings();
  const [activeSection, setActiveSection] = useState<"general" | "installation" | "window" | "java" | "hooks">("general");
  const [title, setTitle] = useState(instance.title);
  const [loader, setLoader] = useState<Loader>(instance.loader as Loader);
  const [version, setVersion] = useState(instance.minecraft_version);
  const [runtimeSettings, setRuntimeSettings] = useState<InstanceRuntimeSettings>(() =>
    loadInstanceRuntimeSettings(instance.id, maxRAM, windowWidth, windowHeight, fullscreen)
  );
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [clearIcon, setClearIcon] = useState(false);
  const [clearBg, setClearBg] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const iconPreview = iconSrc ?? (clearIcon ? null : instance.icon_path ?? null);
  const bgPreview = bgSrc ?? (clearBg ? null : instance.background_path ?? null);

  useEffect(() => {
    const filtered = filterVersionsForLoader(versions, loader);
    if (filtered.length && !filtered.find(v => v.id === version)) {
      setVersion(filtered[0].id);
    }
  }, [loader, versions]);

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      saveInstanceRuntimeSettings(instance.id, runtimeSettings);
      const updated = await updateLocalInstance(instance.id, title.trim(), version, loader, iconSrc, bgSrc, clearIcon, clearBg);
      onSave(updated); onClose();
    } catch (e) { toast.danger(t("inst.errorSaving"), { description: String(e) }); }
    finally { setSaving(false); }
  };

  const updateRuntime = (patch: Partial<InstanceRuntimeSettings>) => {
    setRuntimeSettings(prev => {
      const next = { ...prev, ...patch };
      if (next.maxRamMb < next.minRamMb) next.maxRamMb = next.minRamMb;
      return next;
    });
  };

  const browseJava = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Java executable", extensions: ["exe"] }],
    });
    if (typeof picked === "string") {
      updateRuntime({ javaMode: "custom", javaPath: picked });
    }
  };

  const handleDelete = async () => {
    try { await deleteLocalInstance(instance.id); onDelete(instance.id); onClose(); }
    catch (e) { toast.danger(t("inst.errorDeleting"), { description: String(e) }); }
  };

  const SECTIONS = [
    { key: "general", label: t("inst.editGeneral") ?? "General", icon: <IconAdjustments size={14} /> },
    { key: "installation", label: t("inst.editInstallation") ?? "Installation", icon: <IconBox size={14} /> },
    { key: "window", label: t("inst.windowTitle") ?? "Window", icon: <IconBox size={14} /> },
    { key: "java", label: t("inst.editJava") ?? "Java and memory", icon: <IconTerminal2 size={14} /> },
    { key: "hooks", label: t("inst.launchHooks") ?? "Launch hooks", icon: <IconExternalLink size={14} /> },
  ] as const;
  const memoryLimit = Math.max(16384, runtimeSettings.maxRamMb, Number(maxRAM) || 0);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-[16px] w-[680px] flex flex-col shadow-2xl border border-white/10 overflow-hidden"
        style={{ backgroundColor: "var(--color-overlay)", height: 520 }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          <div className="w-7 h-7 rounded-[8px] overflow-hidden border border-border flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "var(--color-surface)" }}>
            {iconPreview
              ? <img src={toUrl(iconPreview) ?? ""} className="w-full h-full object-cover" alt="" />
              : <LoaderIcon loader={instance.loader} size={28} />}
          </div>
          <span className="text-sm font-bold text-foreground">{instance.title}</span>
          <IconChevronRight size={13} className="text-muted flex-shrink-0" />
          <span className="text-sm font-semibold text-foreground">
            {SECTIONS.find(s => s.key === activeSection)?.label}
          </span>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-[10px] text-muted hover:text-foreground hover:bg-white/5 transition-colors flex-shrink-0"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div
            className="w-44 flex-shrink-0 flex flex-col p-2 border-r border-border"
            style={{ backgroundColor: "var(--color-background)" }}
          >
            {SECTIONS.map(s => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={[
                  "flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm text-left transition-all",
                  activeSection === s.key
                    ? "bg-[var(--color-accent)] text-black font-semibold"
                    : "text-muted hover:text-foreground hover:bg-white/5",
                ].join(" ")}
              >
                <span className="flex-shrink-0">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

            {activeSection === "general" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">{t("inst.name")}</label>
                  <input
                    autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && title.trim()) handleSave(); }}
                    placeholder={t("inst.name")}
                    className="w-full px-3 py-2 rounded-[10px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
                    style={{ backgroundColor: "var(--color-surface)" }}
                  />
                </div>
            
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold text-foreground">{t("inst.selectIcon") ?? "Icon"}</span>
                    <div
                      onClick={async () => { const p = await pickImage(); if (p) { setIconSrc(p); setClearIcon(false); } }}
                      className="w-16 h-16 rounded-[14px] border border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-[var(--color-accent)]/40 transition-colors relative group"
                      style={{ backgroundColor: "var(--color-surface)" }}
                    >
                      {iconPreview
                        ? <img src={toUrl(iconPreview) ?? ""} className="w-full h-full object-cover" alt="" />
                        : <LoaderIcon loader={instance.loader} size={42} />}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <IconUpload size={16} className="text-white" />
                      </div>
                    </div>
                    {iconPreview && (
                      <button
                        onClick={() => { setIconSrc(null); setClearIcon(true); }}
                        className="text-[10px] text-muted hover:text-danger transition-colors"
                      >
                        {t("inst.removeIcon") ?? "Remove"}
                      </button>
                    )}
                  </div>
            
                  <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold text-foreground">{t("inst.selectBg") ?? "Background"}</span>
                    <div
                      onClick={async () => { const p = await pickImage(); if (p) { setBgSrc(p); setClearBg(false); } }}
                      className="w-24 h-16 rounded-[14px] border border-border flex items-center justify-center overflow-hidden cursor-pointer hover:border-[var(--color-accent)]/40 transition-colors relative group"
                      style={{ backgroundColor: "var(--color-surface)" }}
                    >
                      {bgPreview
                        ? <img src={toUrl(bgPreview) ?? ""} className="w-full h-full object-cover" alt="" />
                        : <IconPhoto size={24} className="text-muted" />}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <IconUpload size={14} className="text-white" />
                      </div>
                    </div>
                    {bgPreview && (
                      <button
                        onClick={() => { setBgSrc(null); setClearBg(true); }}
                        className="text-[10px] text-muted hover:text-danger transition-colors"
                      >
                        {t("inst.removeBg") ?? "Remove"}
                      </button>
                    )}
                  </div>
                </div>
            
                <div className="mt-auto pt-4 border-t border-border">
                  <p className="text-xs font-semibold text-red-400 mb-1">{t("inst.deleteInstance") ?? "Delete instance"}</p>
                  <p className="text-xs text-muted mb-3">{t("inst.deleteWarning") ?? "Permanently deletes this instance including worlds, configs, and all installed content."}</p>
                  {confirmDelete ? (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-xs text-muted border border-border px-3 py-1.5 rounded-[9px] hover:bg-white/5 transition-colors"
                      >
                        {t("inst.cancel")}
                      </button>
                      <button
                        onClick={handleDelete}
                        className="flex items-center gap-1.5 text-xs text-white border border-red-500/40 bg-red-500 px-3 py-1.5 rounded-[9px] hover:bg-red-600 transition-colors font-semibold"
                      >
                        <IconTrash size={12} /> {t("inst.confirmDelete") ?? "Delete instance"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 text-xs text-red-400 border border-red-500/30 px-3 py-1.5 rounded-[9px] hover:bg-red-500/10 transition-colors"
                    >
                      <IconTrash size={12} /> {t("inst.delete") ?? "Delete instance"}
                    </button>
                  )}
                </div>
              </>
            )}

            {activeSection === "installation" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">{t("inst.loader")}</label>
                  <p className="text-xs text-muted -mt-0.5">{t("inst.loaderDesc") ?? "Choose the mod loader for this instance."}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(["vanilla", "fabric", "forge", "neoforge"] as Loader[]).map(l => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLoader(l)}
                        className={[
                          "flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-medium border transition-all",
                          loader === l
                            ? "bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-accent)]"
                            : "bg-transparent border-border text-muted hover:text-foreground",
                        ].join(" ")}
                      >
                        {loader === l && <IconCheck size={12} />}
                        {l.charAt(0).toUpperCase() + l.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">{t("inst.gameVersion")}</label>
                  <p className="text-xs text-muted -mt-0.5">{t("inst.gameVersionDesc") ?? "Select the Minecraft version to use."}</p>
                  <VersionDropdown
                    value={version}
                    onChange={setVersion}
                    versions={filterVersionsForLoader(versions, loader)}
                    loading={loadingVersions}
                  />
                </div>
              </>
            )}

            {activeSection === "window" && (
              <div className="flex flex-col gap-6 max-w-[650px]">
                <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                  <CheckBoxLike
                    checked={runtimeSettings.resolutionMode === "custom"}
                    onChange={checked => updateRuntime({ resolutionMode: checked ? "custom" : "global" })}
                  />
                  {t("inst.customWindowSettings") ?? "Custom window settings"}
                </label>

                <SettingRow
                  title={t("settings.fullscreen.label") ?? "Fullscreen"}
                  description={t("settings.fullscreen.description") ?? "Make the game start in fullscreen when launched."}
                >
                  <ToggleSwitch
                    enabled={runtimeSettings.fullscreen}
                    onChange={value => updateRuntime({ fullscreen: value, resolutionMode: "custom" })}
                  />
                </SettingRow>

                <SettingRow
                  title={t("inst.windowWidth") ?? "Width"}
                  description={t("inst.windowWidthDesc") ?? "The width of the game window when launched."}
                >
                  <CompactNumberField
                    value={runtimeSettings.width}
                    disabled={runtimeSettings.resolutionMode === "global"}
                    onChange={value => updateRuntime({ width: Math.max(320, value), resolutionMode: "custom" })}
                  />
                </SettingRow>

                <SettingRow
                  title={t("inst.windowHeight") ?? "Height"}
                  description={t("inst.windowHeightDesc") ?? "The height of the game window when launched."}
                >
                  <CompactNumberField
                    value={runtimeSettings.height}
                    disabled={runtimeSettings.resolutionMode === "global"}
                    onChange={value => updateRuntime({ height: Math.max(240, value), resolutionMode: "custom" })}
                  />
                </SettingRow>
              </div>
            )}

            {activeSection === "java" && (
              <div className="flex flex-col gap-6 max-w-[650px]">
                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-foreground">{t("inst.javaInstallation") ?? "Java installation"}</h3>
                  <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <CheckBoxLike
                      checked={runtimeSettings.javaMode === "custom"}
                      onChange={checked => updateRuntime({ javaMode: checked ? "custom" : "auto" })}
                    />
                    {t("inst.customJavaInstallation") ?? "Custom Java installation"}
                  </label>
                  <div className="rounded-[16px] p-4 flex items-center gap-3 bg-black/30 border border-white/5">
                    <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-muted bg-white/5">
                      <IconTerminal2 size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground">{t("inst.javaRuntime") ?? "Java runtime"}</p>
                      <input
                        value={runtimeSettings.javaPath}
                        disabled={runtimeSettings.javaMode === "auto"}
                        onChange={e => updateRuntime({ javaPath: e.target.value, javaMode: "custom" })}
                        placeholder={t("inst.javaPathPlaceholder") ?? "Path to java.exe"}
                        className="mt-2 w-full px-3 py-2 rounded-[12px] bg-black/35 border border-transparent text-sm text-foreground placeholder:text-muted disabled:opacity-35 focus:outline-none focus:border-[var(--color-accent)]/40"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={browseJava}
                      className="w-10 h-10 rounded-[12px] flex items-center justify-center border border-border text-[var(--color-accent)] hover:bg-white/5 transition-colors"
                      title={t("inst.browse") ?? "Browse"}
                    >
                      <IconFolderOpen size={16} />
                    </button>
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-foreground">{t("inst.memoryTitle") ?? "Memory allocated"}</h3>
                  <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <CheckBoxLike
                      checked={runtimeSettings.memoryMode === "custom"}
                      onChange={checked => updateRuntime({ memoryMode: checked ? "custom" : "global" })}
                    />
                    {t("inst.customMemoryAllocation") ?? "Custom memory allocation"}
                  </label>
                  <MemorySlider
                    value={runtimeSettings.maxRamMb}
                    min={512}
                    max={memoryLimit}
                    disabled={runtimeSettings.memoryMode === "global"}
                    onChange={value => updateRuntime({
                      maxRamMb: value,
                      minRamMb: Math.max(512, Math.min(runtimeSettings.minRamMb, Math.floor(value / 2))),
                      memoryMode: "custom",
                    })}
                  />
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-foreground">{t("inst.jvmArgs") ?? "Java arguments"}</h3>
                  <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <CheckBoxLike
                      checked={runtimeSettings.extraJvmArgs.trim().length > 0}
                      onChange={checked => updateRuntime({ extraJvmArgs: checked ? runtimeSettings.extraJvmArgs : "" })}
                    />
                    {t("inst.customJavaArguments") ?? "Custom Java arguments"}
                  </label>
                  <input
                    value={runtimeSettings.extraJvmArgs}
                    onChange={e => updateRuntime({ extraJvmArgs: e.target.value })}
                    placeholder={t("inst.jvmArgsPlaceholder") ?? "Enter Java arguments..."}
                    className="w-full px-3 py-2 rounded-[12px] bg-white/[0.03] border border-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40"
                  />
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-foreground">{t("inst.envVars") ?? "Environment variables"}</h3>
                  <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <CheckBoxLike
                      checked={runtimeSettings.environmentVariables.trim().length > 0}
                      onChange={checked => updateRuntime({ environmentVariables: checked ? runtimeSettings.environmentVariables : "" })}
                    />
                    {t("inst.customEnvVars") ?? "Custom environment variables"}
                  </label>
                  <input
                    value={runtimeSettings.environmentVariables}
                    onChange={e => updateRuntime({ environmentVariables: e.target.value })}
                    placeholder={t("inst.envVarsPlaceholder") ?? "Enter environmental variables..."}
                    className="w-full px-3 py-2 rounded-[12px] bg-white/[0.03] border border-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40"
                  />
                </section>
              </div>
            )}

            {activeSection === "hooks" && (
              <div className="flex flex-col gap-6 max-w-[650px]">
                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-bold text-foreground">{t("inst.gameLaunchHooks") ?? "Game launch hooks"}</h3>
                  <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <CheckBoxLike
                      checked={
                        !!runtimeSettings.preLaunchCommand.trim() ||
                        !!runtimeSettings.wrapperCommand.trim() ||
                        !!runtimeSettings.postExitCommand.trim()
                      }
                      onChange={checked => {
                        if (!checked) updateRuntime({ preLaunchCommand: "", wrapperCommand: "", postExitCommand: "" });
                      }}
                    />
                    {t("inst.customLaunchHooks") ?? "Custom launch hooks"}
                  </label>
                  <p className="text-sm text-muted leading-normal">{t("inst.launchHooksDesc") ?? "Hooks allow advanced users to run certain system commands before and after launching the game."}</p>
                </section>

                <HookField
                  title={t("inst.preLaunch") ?? "Pre-launch"}
                  description={t("inst.preLaunchDesc") ?? "Ran before the instance is launched."}
                  placeholder={t("inst.preLaunchPlaceholder") ?? "Enter pre-launch command..."}
                  value={runtimeSettings.preLaunchCommand}
                  onChange={value => updateRuntime({ preLaunchCommand: value })}
                />
                <HookField
                  title={t("inst.wrapper") ?? "Wrapper"}
                  description={t("inst.wrapperDesc") ?? "Wrapper command for launching Minecraft."}
                  placeholder={t("inst.wrapperPlaceholder") ?? "Enter wrapper command..."}
                  value={runtimeSettings.wrapperCommand}
                  onChange={value => updateRuntime({ wrapperCommand: value })}
                />
                <HookField
                  title={t("inst.postExit") ?? "Post-exit"}
                  description={t("inst.postExitDesc") ?? "Ran after the game closes."}
                  placeholder={t("inst.postExitPlaceholder") ?? "Enter post-exit command..."}
                  value={runtimeSettings.postExitCommand}
                  onChange={value => updateRuntime({ postExitCommand: value })}
                />
              </div>
            )}
          </div>
        </div>

        <div
          className="flex items-center justify-end px-5 py-3 gap-2 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            {t("inst.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconCheck size={14} />
            {saving ? t("inst.saving") : t("inst.saveChanges")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!enabled)}
      className={["relative w-9 h-5 rounded-full transition-colors flex-shrink-0 overflow-hidden", enabled ? "bg-[var(--color-accent)]" : "bg-border"].join(" ")}>
      <span className={["absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", enabled ? "left-[18px]" : "left-0.5"].join(" ")} />
    </button>
  );
}

function CheckBoxLike({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "w-5 h-5 rounded-[5px] border flex items-center justify-center transition-colors flex-shrink-0",
        checked ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-black" : "border-border bg-transparent text-transparent hover:border-[var(--color-accent)]/50",
      ].join(" ")}
    >
      <IconCheck size={13} />
    </button>
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_250px] gap-6 items-center">
      <div className="min-w-0">
        <p className="text-lg font-bold text-foreground leading-tight">{title}</p>
        <p className="text-sm text-muted leading-normal mt-1">{description}</p>
      </div>
      <div className="flex justify-end">{children}</div>
    </div>
  );
}

function CompactNumberField({ value, disabled, onChange }: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className="w-full px-3 py-2 rounded-[12px] bg-white/[0.03] border border-transparent text-sm text-foreground placeholder:text-muted disabled:opacity-35 focus:outline-none focus:border-[var(--color-accent)]/40"
    />
  );
}

function MemorySlider({ value, min, max, disabled, onChange }: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className={["grid grid-cols-[1fr_84px] gap-4 items-center", disabled ? "opacity-35" : ""].join(" ")}>
      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={256}
          value={value}
          disabled={disabled}
          onChange={e => onChange(Number(e.target.value))}
          className="modstack-memory-slider w-full"
          style={{ "--slider-fill": `${pct}%` } as React.CSSProperties}
        />
        <div className="flex justify-between text-xs text-muted">
          <span>{min} MB</span>
          <span>{max} MB</span>
        </div>
      </div>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-full px-3 py-2 rounded-[12px] bg-white/[0.03] border border-transparent text-sm font-bold text-foreground disabled:opacity-60 focus:outline-none focus:border-[var(--color-accent)]/40"
      />
    </div>
  );
}

function HookField({ title, description, placeholder, value, onChange }: {
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-[12px] bg-white/[0.03] border border-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/40"
      />
      <p className="text-sm text-muted leading-normal">{description}</p>
    </section>
  );
}

function WorldsTab({ instance }: { instance: LocalInstance }) {
  const t = useLauncherTranslation();
  const [worlds, setWorlds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    invoke<any[]>("get_instance_worlds", { instanceId: instance.id })
      .then(w => setWorlds(w))
      .catch(e => console.error("worlds error:", e))
      .finally(() => setLoading(false));
  }, [instance.id]);
  if (loading) return <div className="flex items-center justify-center flex-1 h-full"><IconRefresh size={20} className="text-muted animate-spin" /></div>;
  if (worlds.length === 0) return <div className="flex flex-col items-center justify-center flex-1 h-full gap-3 opacity-40"><IconBox size={36} className="text-muted" /><p className="text-sm text-muted">{t("inst.noWorlds")}</p></div>;
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {worlds.map((world: any) => {
          const iconUrl = world.icon_path ? convertFileSrc(world.icon_path) : null;
          return (
            <div key={world.folder_name} className="flex items-center gap-3 p-3 rounded-[15px] border border-border" style={{ backgroundColor: "var(--color-surface)" }}>
              <div className="w-12 h-12 rounded-[10px] overflow-hidden flex-shrink-0 flex items-center justify-center border border-border" style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <IconBox size={20} className="text-muted" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{world.name}</p>
                <p className="text-xs text-muted mt-0.5">{timeAgo(new Date(world.last_played * 1000).toISOString())}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ScreenshotInfo { name: string; path: string; created: number; }

function ScreenshotLightbox({ current, screenshots, onClose, onSelect, onDelete, onOpenNative }: {
  current: ScreenshotInfo; screenshots: ScreenshotInfo[]; onClose: () => void;
  onSelect: (s: ScreenshotInfo) => void; onDelete: (s: ScreenshotInfo) => void; onOpenNative: (s: ScreenshotInfo) => void;
}) {
  const t = useLauncherTranslation();
  const currentIndex = screenshots.findIndex(s => s.name === current.name);
  const handlePrev = (e?: React.MouseEvent) => { if (e) e.stopPropagation(); onSelect(currentIndex > 0 ? screenshots[currentIndex - 1] : screenshots[screenshots.length - 1]); };
  const handleNext = (e?: React.MouseEvent) => { if (e) e.stopPropagation(); onSelect(currentIndex < screenshots.length - 1 ? screenshots[currentIndex + 1] : screenshots[0]); };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") handlePrev(); if (e.key === "ArrowRight") handleNext(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, screenshots]);
  const srcUrl = convertFileSrc(current.path);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 select-none animate-fade-in" onClick={onClose}>
      <div className="flex items-center justify-between px-6 py-4 bg-black/40 border-b border-white/5 flex-shrink-0 backdrop-blur-md" onClick={e => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate" title={current.name}>{current.name}</p>
          <p className="text-xs text-white/60 mt-0.5">{currentIndex + 1} of {screenshots.length} • {timeAgo(new Date(current.created * 1000).toISOString())}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onOpenNative(current)} title={t("inst.openOriginal")} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all cursor-pointer"><IconExternalLink size={16} /></button>
          <button onClick={() => onDelete(current)} title={t("inst.delete")} className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-all cursor-pointer"><IconTrash size={16} /></button>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all ml-2 cursor-pointer"><IconX size={16} /></button>
        </div>
      </div>
      <div className="flex-1 relative flex items-center justify-center p-4">
        <button onClick={handlePrev} className="absolute left-6 z-10 w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white flex items-center justify-center border border-white/10 backdrop-blur-sm transition-all cursor-pointer"><IconChevronLeft size={24} /></button>
        <img src={srcUrl} className="max-w-full max-h-[calc(100vh-140px)] object-contain rounded-lg shadow-2xl transition-all duration-300" alt={current.name} onClick={e => e.stopPropagation()} />
        <button onClick={handleNext} className="absolute right-6 z-10 w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white flex items-center justify-center border border-white/10 backdrop-blur-sm transition-all cursor-pointer"><IconChevronRight size={24} /></button>
      </div>
    </div>,
    document.body
  );
}

function ScreenshotsTab({ instance }: { instance: LocalInstance }) {
  const t = useLauncherTranslation();
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotInfo | null>(null);
  const loadScreenshots = () => {
    setLoading(true);
    invoke<ScreenshotInfo[]>("get_instance_screenshots", { instanceId: instance.id }).then(setScreenshots).catch(e => console.error("Error loading screenshots:", e)).finally(() => setLoading(false));
  };
  useEffect(() => { loadScreenshots(); }, [instance.id]);
  const handleDelete = async (screenshot: ScreenshotInfo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete "${screenshot.name}"?`)) return;
    try {
      await invoke("delete_instance_file", { instanceId: instance.id, filePath: `screenshots/${screenshot.name}` });
      toast(t("inst.screenshotDeleted"));
      setScreenshots(prev => prev.filter(s => s.name !== screenshot.name));
      if (selectedScreenshot?.name === screenshot.name) setSelectedScreenshot(null);
    } catch (err) { toast.danger(t("inst.errorDeletingScreenshot"), { description: String(err) }); }
  };
  const handleOpenNative = async (screenshot: ScreenshotInfo, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try { await invoke("open_instance_screenshot", { instanceId: instance.id, fileName: screenshot.name }); }
    catch (err) { toast.danger(t("inst.errorOpeningScreenshot"), { description: String(err) }); }
  };
  const handleOpenFolder = async () => {
    try { await invoke("open_instance_screenshots_folder", { instanceId: instance.id }); }
    catch (err) { toast.danger(t("inst.errorOpeningScreenshotsFolder"), { description: String(err) }); }
  };
  if (loading) return <div className="flex items-center justify-center flex-1 h-full"><IconRefresh size={20} className="text-muted animate-spin" /></div>;
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-transparent">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted"><IconPhoto size={13} /><span>{screenshots.length} {screenshots.length === 1 ? t("inst.screenshot") : t("inst.screenshots")}</span></div>
        <div className="flex items-center gap-2">
          <button onClick={loadScreenshots} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-border text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors flex-shrink-0 cursor-pointer"><IconRefresh size={12} /> {t("inst.refresh")}</button>
          <button onClick={handleOpenFolder} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-white/5 border border-border text-foreground hover:bg-white/10 transition-colors flex-shrink-0 cursor-pointer"><IconFolderOpen size={12} /> {t("inst.openFolder")}</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40 py-20">
            <IconPhoto size={48} className="text-muted" />
            <p className="text-sm text-muted font-semibold">{t("inst.noScreenshots")}</p>
            <p className="text-xs text-muted max-w-[250px] text-center leading-normal">{t("inst.screenshotHint")}</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {screenshots.map((s) => {
              const srcUrl = convertFileSrc(s.path);
              return (
                <div key={s.name} onClick={() => setSelectedScreenshot(s)}
                  className="group flex flex-col rounded-[15px] border border-border overflow-hidden cursor-pointer hover:border-white/20 hover:shadow-lg transition-all"
                  style={{ backgroundColor: "var(--color-surface)" }}>
                  <div className="relative aspect-video bg-black/40 flex items-center justify-center overflow-hidden border-b border-border">
                    <img src={srcUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" alt={s.name} />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity duration-200">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedScreenshot(s); }} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all border border-white/10 cursor-pointer"><IconEye size={14} /></button>
                      <button onClick={(e) => handleOpenNative(s, e)} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all border border-white/10 cursor-pointer"><IconExternalLink size={14} /></button>
                      <button onClick={(e) => handleDelete(s, e)} className="w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 flex items-center justify-center transition-all border border-red-500/20 cursor-pointer"><IconTrash size={14} /></button>
                    </div>
                  </div>
                  <div className="p-3 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate" title={s.name}>{s.name}</p>
                    <p className="text-[10px] text-muted mt-1">{timeAgo(new Date(s.created * 1000).toISOString())}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selectedScreenshot && (
        <ScreenshotLightbox current={selectedScreenshot} screenshots={screenshots} onClose={() => setSelectedScreenshot(null)} onSelect={setSelectedScreenshot} onDelete={(s) => handleDelete(s)} onOpenNative={(s) => handleOpenNative(s)} />
      )}
    </div>
  );
}

interface FileEntry { name: string; path: string; is_dir: boolean; size?: number; children?: FileEntry[]; }

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ["txt", "json", "log", "cfg", "toml", "properties", "yaml", "yml", "xml", "md", "ini"].includes(ext ?? "");
}

function countItems(children?: FileEntry[]): string {
  if (!children) return "—";
  const n = children.length;
  return `${n} ${n === 1 ? "item" : "items"}`;
}

function FileIconTabler({ name, isDir }: { name: string; isDir: boolean }) {
  if (isDir) {
    const ext = name.toLowerCase();
    if (ext === "config" || ext === "configs" || ext === "defaultconfigs") return <IconSettings size={15} color="#9ca3af" />;
    if (ext === "mods") return <IconPuzzle size={15} color="#a78bfa" />;
    if (ext === "saves") return <IconWorld size={15} color="#34d399" />;
    if (ext === "resourcepacks") return <IconPhoto size={15} color="#f472b6" />;
    if (ext === "shaderpacks") return <IconSparkles size={15} color="#fbbf24" />;
    if (ext === "datapacks") return <IconBraces size={15} color="var(--color-accent)" />;
    if (ext === "logs" || ext === "crash-reports") return <IconFileDescription size={15} color="#f87171" />;
    return <IconFolder size={15} color="#fbbf24" />;
  }
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return <IconBraces size={15} color="var(--color-accent)" />;
  if (ext === "jar") return <IconPackage size={15} color="#a78bfa" />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return <IconPhoto size={15} color="#f472b6" />;
  if (ext === "zip" || ext === "mrpack" || ext === "mrstack") return <IconFileZip size={15} color="#fb923c" />;
  if (ext === "dat" || ext === "nbt") return <IconDatabase size={15} color="#94a3b8" />;
  if (ext === "log") return <IconFileDescription size={15} color="#f87171" />;
  if (ext === "toml" || ext === "cfg" || ext === "ini" || ext === "properties") return <IconFileSettings size={15} color="#94a3b8" />;
  if (ext === "txt" || ext === "md") return <IconFileText size={15} color="#d1d5db" />;
  return <IconFile size={15} color="#6b7280" />;
}

function FileActionsMenu({ entry, instanceId, onRename, onRefresh }: { entry: FileEntry; instanceId: string; onDelete: () => void; onRename: () => void; onRefresh: () => void; }) {
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const handleCopyName = () => { navigator.clipboard.writeText(entry.name); setOpen(false); };
  const handleCopyPath = () => { navigator.clipboard.writeText(entry.path); setOpen(false); };
  const handleOpenFolder = async () => { await invoke("open_local_instance_folder", { id: instanceId }); setOpen(false); };
  const handleRename = () => { onRename(); setOpen(false); };
  const handleDelete = async () => {
    try { await invoke("delete_instance_file", { instanceId, filePath: entry.path }); onRefresh(); }
    catch (e) { toast.danger(t("inst.errorDeleting"), { description: String(e) }); }
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted hover:text-foreground hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"><IconDotsVertical size={14} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-[12px] border border-border shadow-2xl overflow-hidden py-1" style={{ backgroundColor: "var(--color-overlay)" }}>
          <button onClick={handleCopyName} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"><IconCopy size={14} /> {t("inst.copyFilename")}</button>
          <button onClick={handleCopyPath} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"><IconClipboard size={14} /> {t("inst.copyPath")}</button>
          <button onClick={handleOpenFolder} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"><IconFolderOpen size={14} /> {t("inst.openInFolder")}</button>
          <div className="my-1 border-t border-border" />
          <button onClick={handleRename} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors"><IconPencil size={14} /> {t("inst.rename")}</button>
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted hover:bg-white/5 transition-colors cursor-not-allowed opacity-50"><IconArrowRight size={14} /> {t("inst.move")}</button>
          <div className="my-1 border-t border-border" />
          <button onClick={handleDelete} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"><IconTrash size={14} /> {t("inst.delete")}</button>
        </div>
      )}
    </div>
  );
}

function TextViewer({ instance, file, onBack, onSaved }: { instance: LocalInstance; file: FileEntry; onBack: () => void; onSaved?: () => void; }) {
  const t = useLauncherTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    invoke<string>("read_instance_file", { instanceId: instance.id, filePath: file.path })
      .then(c => { let display = c; if (file.name.endsWith(".json")) { try { display = JSON.stringify(JSON.parse(c), null, 2); } catch {} } setContent(display); setOriginal(display); })
      .catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [file.path]);
  const isDirty = content !== original;
  const lines = (content ?? "").split("\n");
  const handleSave = async () => {
    if (!isDirty || content === null) return;
    setSaving(true);
    try { await invoke("write_instance_file", { instanceId: instance.id, filePath: file.path, content }); setOriginal(content); toast(t("inst.fileSaved")); onSaved?.(); }
    catch (e) { toast.danger(t("inst.errorSavingFile"), { description: String(e) }); }
    finally { setSaving(false); }
  };
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => { if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop; };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") { e.preventDefault(); const ta = e.currentTarget; const start = ta.selectionStart; const end = ta.selectionEnd; const newVal = content!.substring(0, start) + "  " + content!.substring(end); setContent(newVal); requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; }); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
  };
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors flex-shrink-0"><IconChevronLeft size={14} /> {t("inst.back")}</button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileIconTabler name={file.name} isDir={false} />
          <span className="text-sm font-medium text-foreground truncate">{file.name}</span>
          {content !== null && <span className="text-xs text-muted">{lines.length} {t("inst.lines")} · {formatSize(file.size)}</span>}
          {isDirty && <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] flex-shrink-0" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDirty && <button onClick={() => setContent(original)} className="px-3 py-1.5 rounded-[8px] text-xs text-muted border border-border hover:bg-white/5 transition-colors">{t("inst.discard")}</button>}
          <button onClick={handleSave} disabled={!isDirty || saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <IconDeviceFloppy size={13} />{saving ? t("inst.saving") : t("inst.save")}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: "#000" }}>
        {loading && <div className="flex items-center justify-center h-full"><IconRefresh size={18} className="text-muted animate-spin" /></div>}
        {error && <div className="p-4 text-xs text-red-400">{error}</div>}
        {!loading && !error && content !== null && (
          <div className="flex h-full overflow-hidden font-mono text-xs" style={{ lineHeight: "1.6rem" }}>
            <div ref={lineNumbersRef} className="select-none flex-shrink-0 overflow-hidden border-r border-white/10" style={{ backgroundColor: "#0a0a0a", color: "rgba(255,255,255,0.2)", minWidth: 52, textAlign: "right", padding: "16px 12px", lineHeight: "1.6rem", overflowY: "hidden" }}>
              {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea ref={textareaRef} value={content} onChange={e => setContent(e.target.value)} onScroll={handleScroll} onKeyDown={handleKeyDown} spellCheck={false} className="flex-1 resize-none focus:outline-none"
              style={{ backgroundColor: "#000", color: "var(--color-accent)", padding: "16px", lineHeight: "1.6rem", fontFamily: "monospace", fontSize: 12, border: "none", overflowY: "auto", whiteSpace: "pre", overflowX: "auto" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function RenameModal({ entry, instanceId, onClose, onDone }: { entry: FileEntry; instanceId: string; onClose: () => void; onDone: () => void; }) {
  const t = useLauncherTranslation();
  const [name, setName] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!name.trim() || name === entry.name) { onClose(); return; }
    setSaving(true);
    try { await invoke("rename_instance_file", { instanceId, filePath: entry.path, newName: name.trim() }); onDone(); onClose(); }
    catch (e) { toast.danger(t("inst.errorRenaming"), { description: String(e) }); }
    finally { setSaving(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-[15px] w-80 flex flex-col gap-4 shadow-2xl border border-white/10 p-5" style={{ backgroundColor: "var(--color-overlay)" }}>
        <p className="text-sm font-semibold text-foreground">{t("inst.rename")}</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          className="w-full px-3 py-2 rounded-[10px] border border-border bg-transparent text-sm text-foreground focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors"
          style={{ backgroundColor: "var(--color-surface)" }} />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-xs text-muted border border-border hover:bg-white/5 transition-colors">{t("inst.cancel")}</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors disabled:opacity-50">{saving ? t("inst.saving") : t("inst.rename")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function FilesTab({ instance }: { instance: LocalInstance }) {
  const t = useLauncherTranslation();
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [viewingFile, setViewingFile] = useState<FileEntry | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "size" | "modified">("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);

  const loadTree = () => { setLoading(true); setSelected(new Set()); invoke<FileEntry[]>("get_instance_files", { instanceId: instance.id }).then(setTree).catch(e => console.error(e)).finally(() => setLoading(false)); };
  useEffect(() => { loadTree(); }, [instance.id]);

  const currentEntries: FileEntry[] = (() => { let entries = tree; for (const segment of currentPath) { const found = entries.find(e => e.name === segment && e.is_dir); entries = found?.children ?? []; } return entries; })();
  const handleSort = (col: "name" | "size" | "modified") => { if (sortBy === col) setSortAsc(v => !v); else { setSortBy(col); setSortAsc(true); } };
  const sorted = [...currentEntries].filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => { if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; let cmp = 0; if (sortBy === "name") cmp = a.name.localeCompare(b.name); else if (sortBy === "size") cmp = (a.size ?? 0) - (b.size ?? 0); return sortAsc ? cmp : -cmp; });
  const toggleSelect = (path: string) => { setSelected(prev => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; }); };
  const toggleAll = () => { if (selected.size === sorted.length) setSelected(new Set()); else setSelected(new Set(sorted.map(e => e.path))); };
  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const someSelected = selected.size > 0 && !allSelected;

  const SortHeader = ({ col, label, className = "" }: { col: "name" | "size" | "modified"; label: string; className?: string }) => (
    <button onClick={() => handleSort(col)} className={`flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-foreground tracking-wide uppercase transition-colors ${className}`}>
      {label}{sortBy === col && <IconChevronDown size={10} className={`transition-transform ${sortAsc ? "" : "rotate-180"}`} />}
    </button>
  );

  if (viewingFile) return <TextViewer instance={instance} file={viewingFile} onBack={() => setViewingFile(null)} />;
  if (loading) return <div className="flex items-center justify-center flex-1 h-full"><IconRefresh size={20} className="text-muted animate-spin" /></div>;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <button onClick={() => { setCurrentPath([]); setSearch(""); setSelected(new Set()); }}
          className={`w-8 h-8 flex items-center justify-center rounded-[10px] border transition-colors flex-shrink-0 ${currentPath.length === 0 ? "border-white/10 text-foreground bg-white/5" : "border-border text-muted hover:text-foreground hover:bg-white/5"}`}>
          <IconHome size={15} />
        </button>
        <div className="flex items-center gap-1 flex-1 min-w-0 text-xs overflow-hidden">
          <button onClick={() => { setCurrentPath([]); setSearch(""); }} className="text-muted hover:text-foreground transition-colors flex-shrink-0">{instance.title}</button>
          {currentPath.map((seg, i) => (
            <span key={i} className="flex items-center gap-1 flex-shrink-0">
              <span className="text-muted opacity-30 mx-0.5">/</span>
              <button onClick={() => { setCurrentPath(currentPath.slice(0, i + 1)); setSearch(""); }} className={`transition-colors truncate max-w-[120px] ${i === currentPath.length - 1 ? "text-foreground font-medium" : "text-muted hover:text-foreground"}`}>{seg}</button>
            </span>
          ))}
        </div>
        <div className="relative w-48 flex-shrink-0">
          <IconSearch size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("inst.search") + "..."} className="w-full pl-7 pr-3 py-1.5 rounded-[10px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors" style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <button onClick={loadTree} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-border text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors flex-shrink-0"><IconRefresh size={12} /> {t("inst.refresh")}</button>
        <button onClick={() => invoke("open_local_instance_folder", { id: instance.id })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-white/5 border border-border text-foreground hover:bg-white/10 transition-colors flex-shrink-0"><IconFolderOpen size={13} /> {t("inst.openFolder")}</button>
      </div>
      <div className="flex items-center px-4 py-2 border-b border-border flex-shrink-0 gap-3">
        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          <button onClick={toggleAll} className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all ${allSelected ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : someSelected ? "bg-[var(--color-accent)]/30 border-[var(--color-accent)]/50" : "border-border hover:border-[var(--color-accent)]/40"}`}>
            {allSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
            {someSelected && <div className="w-2 h-0.5 bg-[var(--color-accent)] rounded-full" />}
          </button>
        </div>
        <SortHeader col="name" label={t("inst.name")} className="flex-1" />
        <SortHeader col="size" label="Size" className="w-28" />
        <div className="w-36 text-[11px] font-semibold text-muted tracking-wide uppercase">Created</div>
        <SortHeader col="modified" label="Modified" className="w-36" />
        <div className="w-16 text-[11px] font-semibold text-muted tracking-wide uppercase text-right">"Actions"</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40"><IconFolderOff size={36} className="text-muted" /><p className="text-sm text-muted">{t("inst.emptyFolder")}</p></div>
        ) : (
          sorted.map(entry => {
            const isSelected = selected.has(entry.path);
            return (
              <div key={entry.path}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border transition-colors group cursor-pointer ${isSelected ? "bg-[var(--color-accent)]/5" : "hover:bg-white/[0.025]"}`}
                onClick={() => { if (entry.is_dir) { setCurrentPath([...currentPath, entry.name]); setSearch(""); setSelected(new Set()); } else if (isTextFile(entry.name)) setViewingFile(entry); }}>
                <div className="w-5 flex-shrink-0 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelect(entry.path); }}>
                  <div className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all cursor-pointer ${isSelected ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : "border-border hover:border-[var(--color-accent)]/50"}`}>
                    {isSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
                  </div>
                </div>
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <FileIconTabler name={entry.name} isDir={entry.is_dir} />
                  <span className={`text-sm truncate ${entry.is_dir ? "text-foreground font-medium" : "text-muted group-hover:text-foreground transition-colors"}`}>{entry.name}</span>
                </div>
                <div className="w-28 flex-shrink-0"><span className="text-xs text-muted">{entry.is_dir ? countItems(entry.children) : formatSize(entry.size)}</span></div>
                <div className="w-36 flex-shrink-0"><span className="text-xs text-muted">—</span></div>
                <div className="w-36 flex-shrink-0"><span className="text-xs text-muted">{formatDate((entry as any).modified)}</span></div>
                <div className="w-16 flex-shrink-0 flex justify-end">
                  <FileActionsMenu entry={entry} instanceId={instance.id} onDelete={loadTree} onRename={() => setRenamingEntry(entry)} onRefresh={loadTree} />
                </div>
              </div>
            );
          })
        )}
      </div>
      {renamingEntry && <RenameModal entry={renamingEntry} instanceId={instance.id} onClose={() => setRenamingEntry(null)} onDone={loadTree} />}
    </div>
  );
}

function InstanceContentView({
  instance, onBackToMenu, onSwitchToDownload, onEdit, onShare, onExport, onOpenFolder,
}: {
  instance: LocalInstance; onBackToMenu: () => void; onSwitchToDownload: () => void;
  onEdit: () => void; onShare: () => void; onExport: () => void; onOpenFolder: () => void;
}) {
  const { launchInstance, launchedInstanceId, installProgress, installStatus } = useInstance();
  const isThisLaunched = launchedInstanceId === instance.id;

  const [filter, setFilter] = useState<ContentFilter>("all");
  const [search, setSearch] = useState("");
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [activeTab, setActiveTab] = useState<"Content" | "Files" | "Worlds" | "Logs" | "Screenshots">("Content");
  const [loadingMods, setLoadingMods] = useState(false);
  const [instanceLogger, setInstanceLogger] = useState<InstanceLog[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const [uploadingLog, setUploadingLog] = useState(false);
  const [logUrl, setLogUrl] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [logSearch, setLogSearch] = useState("");
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const t = useLauncherTranslation();

  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);

  const toggleModSelection = (modId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMods(prev => {
      const next = new Set(prev);
      if (next.has(modId)) next.delete(modId); else next.add(modId);
      return next;
    });
  };

  const toggleAllMods = () => {
    if (selectedMods.size === filteredMods.length && filteredMods.length > 0) {
      setSelectedMods(new Set());
    } else {
      setSelectedMods(new Set(filteredMods.map(m => m.id)));
    }
  };

  const deleteSelectedMods = async () => {
    if (deletingSelected) return;
    setDeletingSelected(true);
    const toDelete = [...selectedMods];
    try {
      for (const modId of toDelete) {
        const mod = mods.find(m => m.id === modId);
        if (mod) {
          await invoke("delete_mod", { instanceId: instance.id, filename: mod.filename });
        }
      }
      setMods(prev => prev.filter(m => !selectedMods.has(m.id)));
      setSelectedMods(new Set());
      toast(`${toDelete.length} ${t("inst.modRemoved")}`);
    } catch (e) {
      toast.danger(t("inst.errorRemoving"), { description: String(e) });
    } finally {
      setDeletingSelected(false);
    }
  };

  const iconUrl = toUrl(instance.icon_path);
  const instanceIdentifier = `${instance.id}-`;
  const [playtime, setPlaytime] = useState(0);

  useEffect(() => { invoke<number>("get_instance_playtime", { instanceId: instance.id }).then(setPlaytime); }, [instance.id]);

  const handlePlay = () => { launchInstance({ ...instance, _isLocal: true } as any); };

  useEffect(() => {
    const unlisten = listen<InstanceLog>("instance-logger", (event) => { setInstanceLogger(prev => [...prev, event.payload]); });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    if (activeTab === "Logs" && autoScrollLogs) { setTimeout(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, 50); }
  }, [instanceLogger, activeTab, autoScrollLogs]);

  const handleUploadLog = async () => {
    if (instanceLogs.length === 0) return;
    setUploadingLog(true);
    setLogUrl(null);
    try {
      const text = instanceLogs.map(l => l.message).join("\n");
      const body = new URLSearchParams({ content: text });
      const res = await fetch("https://api.mclo.gs/1/log", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      const data = await res.json();
      if (data.success && data.url) {
        setLogUrl(data.url);
        await navigator.clipboard.writeText(data.url);
        toast(t("logs.copied"));
      } else {
        throw new Error(data.error ?? "Unknown error");
      }
    } catch (e) {
      toast.danger(t("logs.uploadError"), { description: String(e) });
    } finally { setUploadingLog(false); }
  };

  const projectTypeForFilter = (): string => {
    if (filter === "resourcepacks") return "resourcepack";
    if (filter === "shaders") return "shader";
    return "mod";
  };
  const effectiveLoader = instance.loader !== "vanilla" ? instance.loader : undefined;

  const loadMods = async () => {
    setLoadingMods(true);
    setSelectedMods(new Set()); 
    try {
      const result = await invoke<InstalledMod[]>("get_installed_mods", { instanceId: instance.id, projectType: projectTypeForFilter() });
      setMods(result);
      invoke<string[]>("check_mod_updates", { instanceId: instance.id, projectType: projectTypeForFilter(), gameVersion: instance.minecraft_version, loader: effectiveLoader ?? null })
        .then(outdated => { if (outdated.length > 0) setMods(prev => prev.map(m => ({ ...m, has_update: outdated.includes(m.id) }))); })
        .catch(() => {});
    } catch (e) { console.error("Error loading mods:", e); } finally { setLoadingMods(false); }
  };

  useEffect(() => {
    invoke("reindex_instance_mods", { instanceId: instance.id, projectType: projectTypeForFilter() }).catch(() => {}).finally(() => loadMods());
  }, [instance.id, filter]);

  const handleToggleMod = async (mod: InstalledMod, enabled: boolean) => {
    setMods(prev => prev.map(m => m.id === mod.id ? { ...m, enabled, filename: enabled ? m.filename.replace(".disabled", "") : m.filename.endsWith(".disabled") ? m.filename : `${m.filename}.disabled` } : m));
    try { await invoke("toggle_mod", { instanceId: instance.id, filename: mod.filename, enabled }); }
    catch (e) { setMods(prev => prev.map(m => m.id === mod.id ? { ...m, enabled: !enabled, filename: mod.filename } : m)); toast.danger(t("inst.errorToggling"), { description: String(e) }); }
  };

  const handleDeleteMod = async (mod: InstalledMod) => {
    try { await invoke("delete_mod", { instanceId: instance.id, filename: mod.filename }); setMods(prev => prev.filter(m => m.id !== mod.id)); toast(`"${mod.name}" ${t("inst.modRemoved")}`); }
    catch (e) { toast.danger(t("inst.errorRemoving"), { description: String(e) }); }
  };

  const handleUpdateMod = async (mod: InstalledMod) => {
    setMods(prev => prev.map(m => m.id === mod.id ? { ...m, has_update: false } : m));
    try {
      await invoke("delete_mod", { instanceId: instance.id, filename: mod.filename });
      const updated = await invoke<InstalledMod>("modrinth_install", { instanceId: instance.id, slug: mod.id, projectType: projectTypeForFilter(), gameVersion: instance.minecraft_version, loader: effectiveLoader ?? null, versionId: null });
      setMods(prev => prev.map(m => m.id === mod.id ? { ...updated, has_update: false } : m));
      toast(`"${mod.name}" ${t("inst.modUpdated")}`);
    } catch (e) { setMods(prev => prev.map(m => m.id === mod.id ? { ...m, has_update: true } : m)); toast.danger(t("inst.errorUpdating"), { description: String(e) }); }
  };

  const handleUpdateAllMods = async () => {
    const outdated = mods.filter((m) => m.has_update);
    if (updatingAll || outdated.length === 0) return;
    setUpdatingAll(true);
    let updatedCount = 0;
    try {
      for (const mod of outdated) {
        try {
          await invoke("delete_mod", { instanceId: instance.id, filename: mod.filename });
          const updated = await invoke<InstalledMod>("modrinth_install", {
            instanceId: instance.id,
            slug: mod.id,
            projectType: projectTypeForFilter(),
            gameVersion: instance.minecraft_version,
            loader: effectiveLoader ?? null,
            versionId: null,
          });
          updatedCount += 1;
          setMods(prev => prev.map(m => m.id === mod.id ? { ...updated, has_update: false } : m));
        } catch (e) {
          setMods(prev => prev.map(m => m.id === mod.id ? { ...m, has_update: true } : m));
          console.error("Error updating content:", e);
        }
      }
      toast(`${updatedCount}/${outdated.length} ${t("inst.modUpdated")}`);
    } finally {
      setUpdatingAll(false);
    }
  };

  const totalCount = mods.length;
  const FILTERS: { label: string; key: ContentFilter }[] = [
    { label: t("inst.all"), key: "all" }, { label: t("inst.mods"), key: "mods" }, { label: t("inst.resourcePacks"), key: "resourcepacks" },
    { label: t("inst.shaders"), key: "shaders" },
  ];
  const updateCount = mods.filter((m) => m.has_update).length;
  const loaderLabel = instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1);
  const filteredMods = mods.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const instanceLogs = instanceLogger.filter(l => l.instance === instanceIdentifier);
  const getLogLevel = (log: InstanceLog): "info" | "warn" | "error" => {
    const text = `${log.type} ${log.message}`.toLowerCase();
    if (text.includes("error") || text.includes("exception") || text.includes("fatal")) return "error";
    if (text.includes("warn")) return "warn";
    return "info";
  };
  const logCounts = instanceLogs.reduce((acc, log) => {
    acc[getLogLevel(log)] += 1;
    return acc;
  }, { info: 0, warn: 0, error: 0 });
  const visibleLogs = instanceLogs.filter((log) => {
    const matchesLevel = logFilter === "all" || getLogLevel(log) === logFilter;
    const needle = logSearch.trim().toLowerCase();
    return matchesLevel && (!needle || log.message.toLowerCase().includes(needle));
  });

  const allModsSelected = filteredMods.length > 0 && selectedMods.size === filteredMods.length;
  const someModsSelected = selectedMods.size > 0 && !allModsSelected;

  const getPlaytimeLabel = () => {
    if (playtime === 0) return t("inst.neverPlayed");
    const h = Math.floor(playtime / 3600);
    const m = Math.floor((playtime % 3600) / 60);
    if (h > 0) return t("inst.hoursPlayed").replace("{h}", String(h)).replace("{m}", String(m));
    if (m > 0) return t("inst.minutesPlayed").replace("{m}", String(m));
    return t("inst.secondsPlayed").replace("{s}", String(playtime));
  };

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-[15px] overflow-hidden border border-border flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
            {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <LoaderIcon loader={instance.loader} size={42} />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{instance.title}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-sm text-muted">{loaderLabel} {instance.minecraft_version}</p>
              <span className="text-muted text-xs">•</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                <IconClock size={11} />
                {getPlaytimeLabel()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBackToMenu} className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors"><IconArrowLeft size={14} /> {t("inst.mainMenu")}</button>
          <button
            onClick={isThisLaunched ? () => invoke("stop_instance", { instanceId: instance.id }) : handlePlay}
            disabled={installProgress > 0 || installStatus !== ""}
            className={`flex items-center gap-2 px-5 py-2 rounded-[12px] text-sm font-bold text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isThisLaunched ? "bg-[#ef4444] hover:bg-[#dc2626]" : "bg-[var(--color-accent)] hover:bg-[var(--color-accent)]"}`}>
            <IconPlayerPlay size={15} fill="currentColor" />
            {installStatus !== "" || installProgress > 0 ? t("inst.installing") : isThisLaunched ? t("inst.close") : t("inst.play")}
          </button>
          <button onClick={onEdit} className="w-9 h-9 flex items-center justify-center rounded-[12px] border border-border text-muted hover:text-foreground hover:bg-white/5 transition-colors"><IconAdjustments size={17} /></button>
          <DotsDropdown onOpenFolder={onOpenFolder} onShare={onShare} onExport={onExport} />
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-border">
        {(["Content", "Files", "Worlds", "Logs", "Screenshots"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={["flex items-center gap-1.5 px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all", activeTab === tab ? "bg-[var(--color-accent)] text-black" : "text-muted hover:text-foreground hover:bg-white/5"].join(" ")}>
            {tab === "Content" && <span className="w-2 h-2 rounded-full bg-current opacity-80" />}
            {tab === "Files" && <IconFolderOpen size={13} />}
            {tab === "Worlds" && <IconBox size={13} />}
            {tab === "Screenshots" && <IconPhoto size={13} />}
            {tab === "Logs" && (
              <span className="relative flex items-center">
                <IconTerminal2 size={13} />
                {instanceLogs.length > 0 && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
              </span>
            )}
            {tab === "Content" ? t("inst.contentTab") : tab === "Files" ? t("inst.filesTab") : tab === "Worlds" ? t("inst.worldsTab") : tab === "Logs" ? t("inst.logsTab") : t("inst.screenshotsTab")}
            {tab === "Logs" && instanceLogs.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none" style={{ backgroundColor: activeTab === "Logs" ? "rgba(0,0,0,0.2)" : "rgba(34,197,94,0.15)", color: activeTab === "Logs" ? "black" : "var(--color-accent)" }}>
                {instanceLogs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab !== "Logs" && activeTab !== "Worlds" && activeTab !== "Files" && activeTab !== "Screenshots" && (
        <>
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border flex-wrap">
            <div className="relative" style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 500 }}>
              <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t("inst.search")} ${totalCount} projects...`}
                className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }} />
            </div>
            <button onClick={onSwitchToDownload} className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent)] text-black transition-colors flex-shrink-0"><IconSearch size={14} /> {t("inst.browseContent")}</button>
            <div className="flex items-center gap-1 ml-1">
              <IconFilter size={13} className="text-muted flex-shrink-0" />
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)} className={["px-3 py-1.5 rounded-full text-xs font-semibold transition-all", filter === f.key ? "bg-[var(--color-accent)] text-black" : "text-muted hover:text-foreground border border-border"].join(" ")}>{f.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-3 ml-auto flex-shrink-0">
              {updateCount > 0 && (
                <button
                  onClick={handleUpdateAllMods}
                  disabled={updatingAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] text-sm font-semibold border border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50"
                >
                  <IconRefresh size={14} className={updatingAll ? "animate-spin" : ""} />
                  {updatingAll ? "Actualizando..." : `Actualizar todo (${updateCount})`}
                </button>
              )}
              <button onClick={loadMods} className="flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors font-medium"><IconRefresh size={14} className={loadingMods ? "animate-spin" : ""} /> {t("inst.refresh")}</button>
            </div>
          </div>

          <div className="flex items-center px-5 py-2.5 border-b border-border">
            <div className="w-6 flex items-center justify-center mr-3 flex-shrink-0">
              <button
                type="button"
                onClick={toggleAllMods}
                className={[
                  "w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all",
                  allModsSelected
                    ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
                    : someModsSelected
                      ? "bg-[var(--color-accent)]/40 border-[var(--color-accent)]/60"
                      : "border-border hover:border-[var(--color-accent)]/50",
                ].join(" ")}
              >
                {allModsSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
                {someModsSelected && <div className="w-2 h-0.5 bg-white rounded-full" />}
              </button>
            </div>

            <div className="flex-1 text-xs font-semibold text-muted tracking-wide">Project</div>
            <div className="w-52 text-xs font-semibold text-muted tracking-wide">{t("inst.version")}</div>

            {selectedMods.size > 0 ? (
              <button
                onClick={deleteSelectedMods}
                disabled={deletingSelected}
                className="w-28 flex items-center justify-end gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {deletingSelected
                  ? <IconRefresh size={12} className="animate-spin" />
                  : <IconTrash size={12} />}
                {deletingSelected ? "Deleting..." : `Delete (${selectedMods.size})`}
              </button>
            ) : (
              <div className="w-28 text-xs font-semibold text-muted tracking-wide text-right">Actions</div>
            )}
          </div>
        </>
      )}

      {activeTab === "Files" && <FilesTab instance={instance} />}
      {activeTab === "Worlds" && <WorldsTab instance={instance} />}
      {activeTab === "Screenshots" && <ScreenshotsTab instance={instance} />}

      {activeTab !== "Logs" && activeTab !== "Worlds" && activeTab !== "Files" && activeTab !== "Screenshots" && (
        <div className="flex-1 overflow-y-auto">
          {loadingMods ? (
            <div className="flex items-center justify-center h-full opacity-30"><IconRefresh size={24} className="text-muted animate-spin" /></div>
          ) : filteredMods.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-full opacity-30"><IconBox size={36} className="text-muted" /><p className="text-sm text-muted">{t("inst.noContent")}</p></div>
          ) : (
            filteredMods.map(mod => {
              const isSelected = selectedMods.has(mod.id);
              return (
                <div
                  key={mod.id}
                  className={[
                    "flex flex-row items-stretch px-5 border-b border-border transition-colors",
                    isSelected ? "bg-[var(--color-accent)]/5" : "hover:bg-white/[0.025]",
                  ].join(" ")}
                  style={{ minHeight: 64 }}
                >
                  <div
                    className="flex items-center justify-center w-6 mr-3 flex-shrink-0 cursor-pointer"
                    onClick={(e) => toggleModSelection(mod.id, e)}
                  >
                    <div className={[
                      "w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all",
                      isSelected ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : "border-border hover:border-[var(--color-accent)]/40",
                    ].join(" ")}>
                      {isSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-[12px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: "var(--color-surface)" }}>
                      {mod.icon_url ? <img src={mod.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={20} className="text-muted" />}
                    </div>
                    <div className="min-w-0">
                      <p className={["text-sm font-semibold truncate", mod.enabled ? "text-foreground" : "text-muted line-through"].join(" ")}>{mod.name}</p>
                      {mod.author && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-3.5 h-3.5 rounded-full bg-[var(--color-accent)]/20 flex items-center justify-center flex-shrink-0 text-[8px] text-[var(--color-accent)]">✦</span>
                          <p className="text-xs text-muted truncate">{mod.author}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-52 min-w-0 pr-4 flex flex-col justify-center">
                    <p className="text-sm font-medium text-foreground truncate">{mod.version || "—"}</p>
                    <p className="text-xs text-muted truncate">{mod.filename}</p>
                  </div>

                  <div className="w-28 flex items-center justify-end gap-2.5">
                    {mod.has_update && <button onClick={() => handleUpdateMod(mod)} className="text-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"><IconRefresh size={15} /></button>}
                    <ToggleSwitch enabled={mod.enabled} onChange={v => handleToggleMod(mod, v)} />
                    <button onClick={() => handleDeleteMod(mod)} className="text-muted hover:text-danger transition-colors"><IconTrash size={15} /></button>
                    <button className="text-muted hover:text-foreground transition-colors"><IconDotsVertical size={15} /></button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "Logs" && (
        <div className="flex-1 flex flex-col min-h-0 bg-[#05070b]">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-8 rounded-[8px] border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)] flex items-center justify-center">
                <IconTerminal2 size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{t("logs.title")}</p>
                <p className="text-xs text-muted">{instanceLogs.length} {t("logs.lines")} · {visibleLogs.length} {t("logs.visible")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {logUrl && (
                <a href={logUrl} target="_blank" rel="noopener noreferrer"
                  className="flex max-w-[200px] items-center gap-1 truncate rounded-[8px] border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/10 px-2.5 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15">
                  <IconExternalLink size={12} /> {logUrl}
                </a>
              )}
              <button onClick={() => setAutoScrollLogs(v => !v)}
                className={["flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs transition-colors", autoScrollLogs ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-border text-muted hover:text-foreground hover:bg-white/5"].join(" ")}>
                <IconChevronDown size={12} /> {t("logs.autoScroll")}
              </button>
              <button onClick={handleUploadLog} disabled={uploadingLog || instanceLogs.length === 0}
                className="flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40">
                {uploadingLog
                  ? <><IconRefresh size={12} className="animate-spin" /> {t("logs.uploading")}</>
                  : <><IconUpload size={12} /> {t("logs.upload")}</>}
              </button>
              <button onClick={() => { setInstanceLogger([]); setLogUrl(null); }}
                className="flex items-center gap-1 rounded-[8px] border border-danger/25 px-2.5 py-1.5 text-xs text-danger transition-colors hover:bg-danger/10">
                <IconTrash size={12} /> {t("logs.clear")}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border bg-black/20">
            <div className="relative min-w-0 flex-1">
              <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder={t("logs.search")}
                className="h-8 w-full rounded-[8px] border border-border bg-surface pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted focus:border-[var(--color-accent)]/50"
              />
            </div>
            {([
              { key: "all", label: t("logs.all"), count: instanceLogs.length, icon: IconTerminal2 },
              { key: "info", label: t("logs.info"), count: logCounts.info, icon: IconTerminal2 },
              { key: "warn", label: t("logs.warn"), count: logCounts.warn, icon: IconAlertTriangle },
              { key: "error", label: t("logs.errors"), count: logCounts.error, icon: IconAlertCircle },
            ] as const).map(({ key, label, count, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setLogFilter(key)}
                className={["flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-xs font-semibold transition-colors", logFilter === key ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)] text-black" : "border-border text-muted hover:bg-white/5 hover:text-foreground"].join(" ")}
              >
                <Icon size={13} /> {label}
                <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] leading-none">{count}</span>
              </button>
            ))}
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto bg-[#030406] font-mono text-xs">
            {instanceLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                <IconTerminal2 size={36} className="text-[var(--color-accent)]" />
                <p className="text-sm font-sans text-muted">{t("logs.waiting")}</p>
              </div>
            ) : (
              visibleLogs.map((log, i) => {
                const level = getLogLevel(log);
                const color = level === "error" ? "text-red-300" : level === "warn" ? "text-amber-300" : "text-[var(--color-accent)]";
                return (
                  <div key={`${i}-${log.message}`} className={["grid grid-cols-[56px_64px_minmax(0,1fr)] gap-3 border-b border-white/[0.03] px-4 py-1.5 leading-relaxed hover:bg-white/[0.035]", i % 2 === 0 ? "bg-white/[0.015]" : ""].join(" ")}>
                    <span className="select-none text-right text-white/25">{String(i + 1).padStart(3, "0")}</span>
                    <span className={["select-none font-semibold uppercase", color].join(" ")}>{level}</span>
                    <span className={["min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]", color].join(" ")}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CurseForgeDetailView({
  hit, installedSlugs, onBack, onInstall,
}: {
  hit: ModrinthHit;
  installedSlugs: Set<string>;
  onBack: () => void;
  onInstall: (hit: ModrinthHit) => Promise<void>;
}) {
  const t = useLauncherTranslation();
  const [installing, setInstalling] = useState(false);
  const [fullData, setFullData] = useState<any>(null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [activeTab, setActiveTab] = useState<"description" | "versions" | "gallery">("description");
  const [cfVersions, setCfVersions] = useState<any[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const isInstalled = installedSlugs.has(hit.slug.toLowerCase());

  useEffect(() => {
    let alive = true;
    setLoadingFull(true);
    fetch(`https://api.curseforge.com/v1/mods/${hit.project_id}`, {
      headers: { "x-api-key": CF_API_KEY, "Accept": "application/json" },
    })
      .then(r => r.json())
      .then(d => { if (alive) setFullData(d.data ?? null); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingFull(false); });
    return () => { alive = false; };
  }, [hit.project_id]);

  useEffect(() => {
    if (activeTab !== "versions") return;
    let alive = true;
    setLoadingVersions(true);
    fetch(`https://api.curseforge.com/v1/mods/${hit.project_id}/files?pageSize=50`, {
      headers: { "x-api-key": CF_API_KEY, "Accept": "application/json" },
    })
      .then(r => r.json())
      .then(d => { if (alive) setCfVersions(Array.isArray(d.data) ? d.data : []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingVersions(false); });
    return () => { alive = false; };
  }, [hit.project_id, activeTab]);

  const gallery = fullData?.screenshots ?? [];

  const handleInstall = async () => {
    setInstalling(true);
    try { await onInstall(hit); } finally { setInstalling(false); }
  };

  const cfChannelStyle = (type: number) => {
    if (type === 1) return { bg: "bg-[var(--color-accent)]/15", text: "text-[var(--color-accent)]", border: "border-[var(--color-accent)]/30", dot: "bg-[var(--color-accent)]", label: "Release" };
    if (type === 2) return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-400", label: "Beta" };
    return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-400", label: "Alpha" };
  };

  const loaderTags = hit.categories.filter(c => ["fabric", "forge", "neoforge", "quilt", "cauldron", "liteloader"].includes(c));
  const contentTags = hit.categories.filter(c => !["fabric", "forge", "neoforge", "quilt", "cauldron", "liteloader"].includes(c));

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-start gap-5 px-6 py-5 border-b border-border flex-shrink-0">
        <div className="w-16 h-16 rounded-xl overflow-hidden border border-border flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "var(--color-surface)" }}>
          {hit.icon_url
            ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" />
            : <IconBox size={28} className="text-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-foreground leading-tight">{hit.title}</h1>
            {isInstalled && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f16436]/15 text-[#f16436] text-[10px] font-semibold">
                <IconCheck size={9} /> {t("inst.installed")}
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-0.5">{t("inst.by")} {hit.author}</p>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <IconDownload size={12} className="text-[#f16436]" />
              <span className="text-foreground font-medium">{formatDownloads(hit.downloads)}</span>
            </span>
            {hit.follows > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <IconStar size={12} className="text-[#f16436]" />
                <span className="text-foreground font-medium">{formatDownloads(hit.follows)}</span>
              </span>
            )}
            {hit.date_modified && (
              <span className="text-xs text-muted">{t("inst.updatedAgo")} {timeAgo(hit.date_modified)}</span>
            )}
            {hit.source_url && (
              <a href={hit.source_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[#f16436] hover:underline">
                <IconExternalLink size={11} /> {t("inst.openCurseForge")}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconArrowLeft size={14} /> {t("inst.back")}
          </button>
          {isInstalled ? (
            <button disabled
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[#f16436]/10 text-[#f16436] border border-[#f16436]/30 cursor-default">
              <IconCheck size={14} /> {t("inst.installed")}
            </button>
          ) : (
            <button onClick={handleInstall} disabled={installing}
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-bold bg-[#f16436] hover:bg-[#d4532a] text-white transition-colors disabled:opacity-50">
              <IconDownload size={14} />
              {installing ? t("inst.installing") + "..." : t("inst.installLatest")}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-border flex-shrink-0">
        {[
          { key: "description", label: t("inst.description") },
          { key: "versions", label: `${t("inst.versions")}${cfVersions.length > 0 ? ` (${cfVersions.length})` : ""}` },
          { key: "gallery", label: `${t("inst.gallery")}${gallery.length > 0 ? ` (${gallery.length})` : ""}` },
        ].map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
              activeTab === tab.key ? "bg-[#f16436] text-white" : "text-muted hover:text-foreground"].join(" ")}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "description" && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loadingFull ? (
              <div className="flex items-center gap-2 text-xs text-muted py-4">
                <IconRefresh size={13} className="animate-spin" /> {t("inst.loading")}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {gallery[0]?.url && (
                  <div className="rounded-xl overflow-hidden border border-border">
                    <img src={gallery[0].url} className="w-full object-cover max-h-72" alt="" />
                  </div>
                )}
                <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {fullData?.summary ?? hit.description}
                </p>
              </div>
            )}
          </div>
          <div className="w-56 flex-shrink-0 border-l border-border overflow-y-auto px-4 py-5 flex flex-col gap-5">
            {hit.versions.length > 0 && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.compatibility")}</p>
                <p className="text-[10px] text-muted mb-1.5">Minecraft: Java Edition</p>
                <div className="flex flex-wrap gap-1">
                  {hit.versions.slice(0, 8).map(v => (
                    <span key={v} className="px-1.5 py-0.5 rounded-[6px] border border-border text-[10px] text-muted font-mono"
                      style={{ backgroundColor: "var(--color-surface)" }}>
                      {v}
                    </span>
                  ))}
                  {hit.versions.length > 8 && (
                    <span className="text-[10px] text-muted">+{hit.versions.length - 8} more</span>
                  )}
                </div>
              </div>
            )}
            {loaderTags.length > 0 && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.platforms")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {loaderTags.map(c => (
                    <span key={c} className="px-2.5 py-1 rounded-full border border-[#f16436]/30 text-xs text-[#f16436] bg-[#f16436]/5 capitalize">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {contentTags.length > 0 && (
              <div>
                <p className="text-xs font-bold text-foreground mb-2">{t("inst.tags")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {contentTags.map(c => (
                    <span key={c} className="px-2.5 py-1 rounded-full border border-border text-xs text-muted capitalize"
                      style={{ backgroundColor: "var(--color-surface)" }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {hit.date_modified && (
              <div>
                <p className="text-xs font-bold text-foreground mb-1">{t("inst.lastUpdated")}</p>
                <p className="text-xs text-muted">{timeAgo(hit.date_modified)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "versions" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center px-5 py-2 border-b border-border flex-shrink-0 text-[11px] font-semibold text-muted tracking-wide">
            <div className="w-24 flex-shrink-0">{t("inst.channels")}</div>
            <div className="flex-1">{t("inst.name")}</div>
            <div className="w-36 flex-shrink-0">{t("inst.gameVersion")}</div>
            <div className="w-24 flex-shrink-0">Published</div>
            <div className="w-20 flex-shrink-0 text-right">Size</div>
            <div className="w-28 flex-shrink-0" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingVersions ? (
              <div className="flex items-center justify-center py-16">
                <IconRefresh size={20} className="text-muted animate-spin" />
              </div>
            ) : cfVersions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 opacity-40">
                <IconBox size={36} className="text-muted" />
                <p className="text-sm text-muted">{t("inst.noVersionsFound")}</p>
              </div>
            ) : (
              cfVersions.map((v, idx) => {
                const c = cfChannelStyle(v.releaseType);
                const isFirst = idx === 0;
                const gameVersions: string[] = v.gameVersions ?? [];
                const loaders = gameVersions.filter((gv: string) => ["Fabric", "Forge", "NeoForge", "Quilt"].includes(gv));
                const mcVersions = gameVersions.filter((gv: string) => !["Fabric", "Forge", "NeoForge", "Quilt"].includes(gv));
                const sizeKB = v.fileLength ? (v.fileLength / 1024).toFixed(0) : null;
                return (
                  <div key={v.id}
                    className="flex items-center px-5 py-3 border-b border-border hover:bg-white/[0.02] transition-colors">
                    <div className="w-24 flex-shrink-0">
                      <span className={["flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full border text-[10px] font-semibold", c.bg, c.border, c.text].join(" ")}>
                        <span className={["w-1.5 h-1.5 rounded-full flex-shrink-0", c.dot].join(" ")} />
                        {c.label}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{v.displayName}</p>
                        {isFirst && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded-[5px] bg-[#f16436]/10 text-[#f16436] text-[9px] font-bold uppercase tracking-wide">
                            {t("inst.latest")}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted font-mono mt-0.5">ID: {v.id}</p>
                    </div>
                    <div className="w-36 flex-shrink-0">
                      <div className="flex flex-wrap gap-1">
                        {mcVersions.slice(0, 2).map((gv: string) => (
                          <span key={gv} className="px-1.5 py-0.5 rounded-[5px] border border-border text-[10px] text-muted font-mono"
                            style={{ backgroundColor: "var(--color-surface)" }}>
                            {gv}
                          </span>
                        ))}
                        {loaders.map((l: string) => (
                          <span key={l} className="px-1.5 py-0.5 rounded-[5px] border border-[#f16436]/30 text-[10px] text-[#f16436] bg-[#f16436]/5 capitalize">
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <p className="text-xs text-muted">{v.fileDate ? timeAgo(v.fileDate) : "—"}</p>
                    </div>
                    <div className="w-20 flex-shrink-0 text-right">
                      <p className="text-xs text-muted">{sizeKB ? `${Number(sizeKB).toLocaleString()} KB` : "—"}</p>
                    </div>
                    <div className="w-28 flex-shrink-0 flex justify-end">
                      <button
                        onClick={() => !isInstalled && onInstall(hit)}
                        disabled={isInstalled}
                        className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-xs font-semibold border-2 transition-all",
                          isInstalled
                            ? "border-[#f16436]/20 text-[#f16436]/50 cursor-default"
                            : "border-[#f16436] text-[#f16436] hover:bg-[#f16436] hover:text-white"
                        ].join(" ")}>
                        {isInstalled ? <><IconCheck size={11} /> {t("inst.installed")}</> : <><IconDownload size={11} /> {t("inst.install")}</>}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === "gallery" && (
        <ModrinthGalleryGrid gallery={gallery} loading={loadingFull} />
      )}
    </div>
  );
}

function InstanceDownloadView({ instance, onBack }: { instance: LocalInstance; onBack: () => void }) {
  const t = useLauncherTranslation();
  const [source, setSource] = useState<ContentSource>("modrinth");
  const [tab, setTab] = useState<ProjectType>("mod");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [sortBy, setSortBy] = useState("Relevance");
  const [viewCount, setViewCount] = useState(20);
  const [selectedHit, setSelectedHit] = useState<ModrinthHit | null>(null);
  const totalPages = Math.max(1, Math.ceil(totalHits / viewCount));
  const iconUrl = toUrl(instance.icon_path);
  const effectiveLoader = instance.loader !== "vanilla" ? instance.loader : undefined;
  const effectiveLoaderForSearch = tab === "mod" ? effectiveLoader : undefined;
  const [installedFilenames, setInstalledFilenames] = useState<Set<string>>(new Set());
  const [selectedCfHit, setSelectedCfHit] = useState<ModrinthHit | null>(null);

  useEffect(() => {
    invoke<string[]>("get_installed_mod_slugs", { instanceId: instance.id, projectType: tab })
      .then(slugs => setInstalledFilenames(new Set(slugs.map(s => s.toLowerCase())))).catch(() => {});
  }, [instance.id, tab]);

  const install = async (hit: ModrinthHit, versionId?: string) => {
    setInstalling(hit.slug);
    try {
      if (source === "curseforge") {
        await invoke("curseforge_install", { instanceId: instance.id, modId: hit.project_id, projectType: tab, gameVersion: instance.minecraft_version });
      } else {
        await invoke("modrinth_install", { instanceId: instance.id, slug: hit.slug, projectType: tab, gameVersion: instance.minecraft_version, loader: effectiveLoaderForSearch, versionId: versionId ?? null });
      }
      setInstalledFilenames(prev => new Set([...prev, hit.slug.toLowerCase()]));
      toast(`"${hit.title}" ${t("inst.modInstalled")}`);
    } catch (e) { toast.danger(t("inst.errorInstalling"), { description: String(e) }); }
    finally { setInstalling(null); }
  };

  useEffect(() => { setPage(0); setResults([]); }, [tab, source]);
  useEffect(() => { search(page); }, [page, tab, sortBy, viewCount, source]);
  const handleSearch = () => { setPage(0); search(0); };

  const queryIsFirstRender = useRef(true);
  useEffect(() => {
    if (queryIsFirstRender.current) { queryIsFirstRender.current = false; return; }
    const timer = setTimeout(() => { setPage(0); search(0); }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const search = async (currentPage = page) => {
    setLoading(true); setError(null);
    try {
      if (source === "modrinth") {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        params.set("limit", String(viewCount));
        params.set("offset", String(currentPage * viewCount));
        params.set("index", SORT_MAP[sortBy] ?? "relevance");
        params.set("facets", JSON.stringify(buildFacets(tab, instance.minecraft_version, effectiveLoaderForSearch)));
        const res = await fetch(`https://api.modrinth.com/v2/search?${params}`, { cache: "no-store", headers: { "User-Agent": "Launcher/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(Array.isArray(data.hits) ? data.hits : []);
        setTotalHits(typeof data.total_hits === "number" ? data.total_hits : 0);
      } else {
        const classId = CF_CLASS_MAP[tab] ?? 6;
        const sortField = CF_SORT_MAP[sortBy] ?? 1;
        const params = new URLSearchParams({ gameId: String(CF_GAME_ID), classId: String(classId), pageSize: String(viewCount), index: String(currentPage), sortField: String(sortField) });
        if (query.trim()) params.set("searchFilter", query.trim());
        if (instance.minecraft_version) params.set("gameVersion", instance.minecraft_version);
        const res = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, { headers: { "x-api-key": CF_API_KEY, "Accept": "application/json" } });
        if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
        const data = await res.json();
        setResults((data.data ?? []).map(cfModToHit));
        setTotalHits(data.pagination?.totalCount ?? 0);
      }
    } catch (e: any) { setError(`${t("inst.searchError")}: ${e?.message || "unknown"}`); setTotalHits(0); }
    finally { setLoading(false); }
  };

  const CONTENT_TYPE_TABS = [
    { label: t("inst.mods"), type: "mod" as ProjectType },
    { label: t("inst.resourcePacks"), type: "resourcepack" as ProjectType },
    { label: t("inst.dataPacks"), type: "datapack" as ProjectType },
    { label: t("inst.shaders"), type: "shader" as ProjectType },
  ];
  const pageItems = getPageItems(page + 1, totalPages);

  if (selectedHit && source === "modrinth") {
    return (
      <ModrinthDetailView hit={selectedHit} installedSlugs={installedFilenames} onBack={() => setSelectedHit(null)}
        onInstall={async (hit, versionId) => { await install(hit, versionId); setSelectedHit(null); }}
        gameVersion={instance.minecraft_version} loader={effectiveLoaderForSearch} />
    );
  }

  if (selectedCfHit && source === "curseforge") {
    return (
      <CurseForgeDetailView hit={selectedCfHit} installedSlugs={installedFilenames} onBack={() => setSelectedCfHit(null)}
        onInstall={async (hit) => { await install(hit); setSelectedCfHit(null); }} />
    );
  }

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-[15px] overflow-hidden border border-border flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
            {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <LoaderIcon loader={instance.loader} size={42} />}
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">{instance.title}</h1>
            <p className="text-xs text-muted">{instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1)} {instance.minecraft_version}</p>
          </div>
        </div>
        <button onClick={onBack} className="flex items-center gap-2 px-3 py-1.5 rounded-[12px] border border-border text-sm text-foreground hover:bg-white/5 transition-colors"><IconArrowLeft size={14} /> {t("inst.backToInstance")}</button>
      </div>

      <div className="flex items-center gap-1 px-5 py-2 border-b border-border">
        {CONTENT_TYPE_TABS.map(ct => (
          <button key={ct.type} onClick={() => setTab(ct.type)}
            className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all", tab === ct.type ? (source === "curseforge" ? "bg-[#f16436] text-white" : "bg-[var(--color-accent)] text-black") : "text-muted hover:text-foreground"].join(" ")}>
            {ct.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={() => setSource("modrinth")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border transition-all", source === "modrinth" ? "bg-[#1bd96a]/15 border-[#1bd96a]/40 text-[#1bd96a]" : "border-border text-muted hover:text-foreground"].join(" ")}>
            <SiModrinth size={12} /> {t("inst.modrinthSource")}
          </button>
          <button onClick={() => setSource("curseforge")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border transition-all", source === "curseforge" ? "bg-[#f16436]/15 border-[#f16436]/40 text-[#f16436]" : "border-border text-muted hover:text-foreground"].join(" ")}>
            <SiCurseforge size={12} /> {t("inst.curseforgeSource")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border">
        <div className="relative flex-1 max-w-lg">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder={`${t("inst.search")} ${tab === "mod" ? t("inst.mods").toLowerCase() : tab === "resourcepack" ? t("inst.resourcePacks").toLowerCase() : tab === "datapack" ? t("inst.dataPacks").toLowerCase() : t("inst.shaders").toLowerCase()} on ${source === "curseforge" ? t("inst.curseforgeSource") : t("inst.modrinthSource")}...`}
            className="w-full pl-8 pr-3 py-1.5 rounded-[12px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <SimpleDropdown label={t("inst.sortBy2")} value={sortBy} options={SORT_OPTIONS} onChange={v => { setSortBy(v); setPage(0); }} />
        <SimpleDropdown label={t("inst.view")} value={String(viewCount)} options={VIEW_OPTIONS} onChange={v => { setViewCount(Number(v)); setPage(0); }} />
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={loading || page === 0} className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors"><IconChevronLeft size={13} /></button>
        {pageItems.map((item, idx) =>
          item === "dots" ? <span key={`d${idx}`} className="text-xs text-muted px-1">...</span> : (
            <button key={item} onClick={() => setPage((item as number) - 1)} disabled={loading}
              className={["w-7 h-7 rounded-[8px] text-xs font-semibold transition-all", item === page + 1 ? (source === "curseforge" ? "bg-[#f16436] text-white" : "bg-[var(--color-accent)] text-black") : "text-muted hover:text-foreground"].join(" ")}>
              {item}
            </button>
          )
        )}
        <button onClick={() => setPage(p => p + 1)} disabled={loading || page >= totalPages - 1} className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors"><IconChevronRight size={13} /></button>
      </div>

      <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
        <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border border-border text-muted"><IconBox size={11} /> {instance.minecraft_version}</span>
        {effectiveLoader && <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border border-border text-muted"><IconBox size={11} /> {effectiveLoader.charAt(0).toUpperCase() + effectiveLoader.slice(1)}</span>}
        <span className={["flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border font-medium", source === "curseforge" ? "border-[#f16436]/30 text-[#f16436] bg-[#f16436]/5" : "border-[#1bd96a]/30 text-[#1bd96a] bg-[#1bd96a]/5"].join(" ")}>
          {source === "curseforge" ? t("inst.curseforgeSource") : t("inst.modrinthSource")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-12"><span className="text-xs text-muted">{t("inst.search")}...</span></div>}
        {error && <div className="mx-5 mt-4 px-3 py-2 rounded-[12px] bg-danger/10 border border-danger/20 text-xs text-danger">{error}</div>}
        {!loading && !error && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40"><IconSearch size={32} className="text-muted" /><p className="text-sm text-muted">{t("inst.noResults")}</p></div>
        )}
        {!loading && results.map(hit => {
          const isInstalled = installedFilenames.has(hit.slug.toLowerCase());
          const loaderTags = hit.categories.filter(c => ["fabric", "forge", "neoforge", "quilt", "cauldron", "liteloader"].includes(c));
          const contentTags = hit.categories.filter(c => !["fabric", "forge", "neoforge", "quilt", "cauldron", "liteloader"].includes(c));
          return (
            <div key={hit.project_id}
              className="flex items-center gap-4 px-5 py-4 border-b border-border hover:bg-white/[0.02] transition-colors cursor-pointer"
              onClick={() => source === "modrinth" ? setSelectedHit(hit) : setSelectedCfHit(hit)}>
              <div className="w-14 h-14 rounded-[15px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: "var(--color-surface)" }}>
                {hit.icon_url ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={22} className="text-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-foreground">{hit.title}</p>
                  <span className="text-xs text-muted">{t("inst.by")} {hit.author}</span>
                </div>
                <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{hit.description}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="flex items-center gap-1 text-[10px] text-muted">
                    <IconDownload size={10} /> {formatDownloads(hit.downloads)}
                  </span>
                  {hit.follows > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-muted">
                      <IconStar size={10} /> {formatDownloads(hit.follows)}
                    </span>
                  )}
                  {hit.date_modified && (
                    <span className="text-[10px] text-muted">{timeAgo(hit.date_modified)}</span>
                  )}
                  {(loaderTags.length > 0 || hit.versions.length > 0 || contentTags.length > 0) && (
                    <span className="text-muted opacity-20 text-[10px]">·</span>
                  )}
                  {loaderTags.map(c => (
                    <span key={c}
                      className={["text-[9px] px-1.5 py-0.5 rounded-[5px] border font-semibold capitalize",
                        source === "curseforge"
                          ? "border-[#f16436]/30 text-[#f16436] bg-[#f16436]/5"
                          : "border-[var(--color-accent)]/30 text-[var(--color-accent)] bg-[var(--color-accent)]/5"
                      ].join(" ")}>
                      {c}
                    </span>
                  ))}
                  {hit.versions.slice(0, 3).map(v => (
                    <span key={v} className="text-[9px] px-1.5 py-0.5 rounded-[5px] border border-border text-muted font-mono"
                      style={{ backgroundColor: "var(--color-surface)" }}>
                      {v}
                    </span>
                  ))}
                  {hit.versions.length > 3 && (
                    <span className="text-[9px] text-muted">+{hit.versions.length - 3} more</span>
                  )}
                  {contentTags.slice(0, 2).map(cat => (
                    <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted capitalize">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); if (!isInstalled) { if (source === "modrinth") setSelectedHit(hit); else setSelectedCfHit(hit); } }}
                  disabled={installing === hit.slug || isInstalled}
                  className={["flex items-center gap-1.5 px-4 py-1.5 rounded-[12px] text-sm font-semibold border-2 transition-all",
                    isInstalled ? "border-[var(--color-accent)]/30 text-[var(--color-accent)] bg-[var(--color-accent)]/10 cursor-default"
                    : installing === hit.slug ? "border-border text-muted cursor-not-allowed"
                    : source === "curseforge" ? "border-[#f16436] text-[#f16436] hover:bg-[#f16436] hover:text-white"
                    : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-black"].join(" ")}>
                  {isInstalled ? <><IconCheck size={14} /> {t("inst.installed")}</> : installing === hit.slug ? t("inst.installing") + "..." : <><IconPlus size={14} /> {t("inst.install")}</>}
                </button>
                <p className="text-[10px] text-muted">↓ {formatDownloads(hit.downloads)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type AppView = "grid" | "instance-content" | "instance-download";

export default function Instances() {
  const t = useLauncherTranslation();
  const { fetchInstances, setInstances: setContextInstances } = useInstance();
  const [instances, setInstances] = useState<LocalInstance[]>([]);
  const [selectedId, setLocalSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{ version?: string; name?: string } | null>(null);
  const [editTarget, setEditTarget] = useState<LocalInstance | null>(null);
  const [exportTarget, setExportTarget] = useState<LocalInstance | null>(null);
  const [shareTarget, setShareTarget] = useState<LocalInstance | null>(null);
  const [showImportCode, setShowImportCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AppView>("grid");
  const [instanceTab, setInstanceTab] = useState<InstanceTab>("all");
  const [initialModpackHit, setInitialModpackHit] = useState<ModrinthHit | null>(null);
  const consumePendingTab = useInstancesNav((s) => s.consumeTab);
  const consumePendingModpackHit = useInstancesNav((s) => s.consumeModpackHit);
  const consumePendingCreate = useInstancesNav((s) => s.consumeCreate);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const pendingCreate = consumePendingCreate();
    const pendingHit = consumePendingModpackHit();
    const pendingTab = consumePendingTab();
    if (pendingCreate) {
      setCreateDefaults(pendingCreate);
      setShowCreate(true);
      setInstanceTab("all");
      setView("grid");
    } else if (pendingHit) {
      setInitialModpackHit({
        ...pendingHit,
        icon_url: pendingHit.icon_url ?? undefined, 
        follows: 0,
        categories: [],
        versions: [],
        date_modified: "",
      });
      setInstanceTab("modpacks");
      setView("grid");
    } else if (pendingTab) {
      setInstanceTab(pendingTab);
      setView("grid");
    }
    const handleOpenLocal = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setLocalSelectedId(id); setSelectedId(id); setView("instance-content");
    };
    const handleOpenMenu = () => {
      setView("grid");
      setInstanceTab("all");
    };
    const handleNavigateModpack = (e: Event) => {
      const detail = (e as CustomEvent<{ hit: ModrinthHit }>).detail;
      if (!detail?.hit) return;
      setInitialModpackHit(detail.hit);
      setInstanceTab("modpacks");
      setView("grid");
    };
    const handleCreateInstance = (e: Event) => {
      const detail = (e as CustomEvent<{ version?: string; name?: string }>).detail ?? {};
      setCreateDefaults(detail);
      setShowCreate(true);
      setInstanceTab("all");
      setView("grid");
    };
    const handleSharedImported = (e: Event) => {
      const inst = (e as CustomEvent<LocalInstance>).detail;
      if (!inst?.id) return;
      setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
      setLocalSelectedId(inst.id);
      setSelectedId(inst.id);
      fetchInstances();
      setView("instance-content");
    };
    window.addEventListener("open-local-instance", handleOpenLocal);
    window.addEventListener("open-instances-menu", handleOpenMenu);
    window.addEventListener("navigate-to-modpack", handleNavigateModpack);
    window.addEventListener("create-local-instance", handleCreateInstance);
    window.addEventListener("modstack-shared-instance-imported", handleSharedImported);
    (async () => {
      try {
        const list = await loadLocalInstances();
        setInstances(list);
        const sid = getSelectedId() ?? list[0]?.id ?? null;
        setLocalSelectedId(sid);
      } catch (e) { console.error("Error loading local instances", e); }
      finally { setLoading(false); }
      const { listen, emit } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("open-mrstack", async (event) => {
        if (!event.payload) return;
        try {
          const inst = await invoke<LocalInstance>("import_mrstack", { mrstackPath: event.payload });
          setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
          setLocalSelectedId(inst.id); setSelectedId(inst.id);
          fetchInstances(); setView("instance-content");
        } catch (_) {}
      });
      emit("frontend-ready");
    })();
    return () => {
      unlisten?.();
      window.removeEventListener("open-local-instance", handleOpenLocal);
      window.removeEventListener("open-instances-menu", handleOpenMenu);
      window.removeEventListener("navigate-to-modpack", handleNavigateModpack);
      window.removeEventListener("create-local-instance", handleCreateInstance);
      window.removeEventListener("modstack-shared-instance-imported", handleSharedImported);
    };
  }, []);

  const selected = instances.find(i => i.id === selectedId) ?? instances[0] ?? null;

  const selectInstance = (id: string) => { setLocalSelectedId(id); setSelectedId(id); setView("instance-content"); };
  const handleCreated = (inst: LocalInstance) => { setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]); setLocalSelectedId(inst.id); setSelectedId(inst.id); fetchInstances(); toast(`Instance "${inst.title}" ${t("inst.createdSuccess")}`); };
  const handleInstalled = (inst: LocalInstance) => { setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]); fetchInstances(); };
  const handleSaved = (updated: LocalInstance) => { setInstances(prev => prev.map(i => i.id === updated.id ? updated : i)); fetchInstances(); toast(t("inst.savedToast")); };
  const handleDeleted = (id: string) => { setInstances(prev => { const next = prev.filter(i => i.id !== id); setLocalSelectedId(next[0]?.id ?? null); setContextInstances(next as any); return next; }); setView("grid"); fetchInstances(); toast.danger(t("inst.deletedToast")); };

  const handleImport = async () => {
    try {
      const picked = await open({ multiple: false, filters: [{ name: "Modpack", extensions: ["mrstack", "mrpack", "zip"] }] });
      if (!picked || typeof picked !== "string") return;
      const inst = await invoke<LocalInstance>("import_mrstack", { mrstackPath: picked });
      setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
      setLocalSelectedId(inst.id); setSelectedId(inst.id);
      fetchInstances();
    } catch (e) { if (!String(e).includes("cancelled")) toast.danger(t("inst.importError"), { description: String(e) }); }
  };

  if (loading) return <div className="w-full h-full flex items-center justify-center"><span className="text-xs text-muted">{t("inst.loading")}</span></div>;

  return (
    <div className="w-full h-full flex min-h-0">
    <div className="flex-1 h-full flex flex-col min-h-0">
      {view === "grid" && (
        <InstancesGridView
          instances={instances}
          activeTab={instanceTab}
          setActiveTab={setInstanceTab}
          onSelect={selectInstance}
          onCreateClick={() => setShowCreate(true)}
          onImportClick={handleImport}
          onImportCodeClick={() => setShowImportCode(true)}
          onInstalled={handleInstalled}
          onEdit={inst => setEditTarget(inst)}
          onDelete={inst => handleDeleted(inst.id)}
          initialModpackHit={initialModpackHit}
          onConsumeInitialModpackHit={() => setInitialModpackHit(null)}
        />
      )}
      {view === "instance-content" && selected && (
        <InstanceContentView instance={selected} onBackToMenu={() => setView("grid")} onSwitchToDownload={() => setView("instance-download")} onEdit={() => setEditTarget(selected)} onShare={() => setShareTarget(selected)} onExport={() => setExportTarget(selected)}
          onOpenFolder={async () => { try { await invoke("open_local_instance_folder", { id: selected.id }); } catch (e) { toast.danger(t("inst.errorOpenFolder"), { description: String(e) }); } }} />
      )}
      {view === "instance-download" && selected && (
        <InstanceDownloadView instance={selected} onBack={() => setView("instance-content")} />
      )}
      {showCreate && (
        <CreateModal
          onClose={() => { setShowCreate(false); setCreateDefaults(null); }}
          onCreate={handleCreated}
          onImport={handleImport}
          initialVersion={createDefaults?.version}
          initialName={createDefaults?.name}
          onBrowseModpacks={() => {
            setShowCreate(false);
            setCreateDefaults(null);
            setInstanceTab("modpacks");
          }}
        />
      )}
      {editTarget && <EditModal instance={editTarget} onClose={() => setEditTarget(null)} onSave={handleSaved} onDelete={handleDeleted} />}
      {showImportCode && <ImportShareCodeModal onClose={() => setShowImportCode(false)} onImported={(inst) => { setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]); setLocalSelectedId(inst.id); setSelectedId(inst.id); fetchInstances(); setView("instance-content"); }} />}
      {shareTarget && <ShareInstanceModal instance={shareTarget} onClose={() => setShareTarget(null)} onImported={(inst) => { setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]); setLocalSelectedId(inst.id); setSelectedId(inst.id); fetchInstances(); }} />}
      {exportTarget && <ExportModal instance={exportTarget} onClose={() => setExportTarget(null)} />}
    </div>
    <HomeSidebar />
    </div>
  );
}