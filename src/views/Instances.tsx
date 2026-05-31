import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { Button, Input, Label, TextField, toast } from "@heroui/react";
import {
  IconBox, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight,
  IconFolderOpen, IconPhoto, IconPlayerPlay, IconPlus,
  IconSearch, IconTrash, IconUpload, IconX, IconRefresh, IconDownload,
  IconFilter, IconDotsVertical,
  IconArrowLeft, IconPackageExport,
  IconFolder, IconAdjustments, IconPackageImport,
  IconStar, IconAlertCircle, IconTerminal2,
} from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { useInstance } from "../stores/instanceContext";
import {
  loadLocalInstances, updateLocalInstance, deleteLocalInstance,
  setSelectedId, getSelectedId, slugify,
  type LocalInstance,
} from "../utils/localInstances";

import "@tabler/icons-webfont/dist/tabler-icons.css";

const CF_API_KEY = "$2a$10$piVONlDwyu/KXz.jZDFQ/eEdKEBmLYfEDK7vlLixtgevppSHQm06C";
const CF_GAME_ID = 432;

type ContentSource = "modrinth" | "curseforge";
type Loader = "vanilla" | "fabric" | "forge" | "neoforge";
type McVersion = { id: string; type: string };
type ProjectType = "mod" | "resourcepack" | "shader" | "datapack";
type InstanceTab = "all" | "modpacks" | "local" | "custom";
type ContentFilter = "all" | "mods" | "resourcepacks" | "updates";

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
}

interface InstanceLog {
  instance: string;
  type: string;
  message: string;
}

const LOADER_EMOJI: Record<Loader, string> = {
  vanilla: "🌿", fabric: "🧵", forge: "⚒️", neoforge: "🔥",
};
const LOADERS: Loader[] = ["vanilla", "fabric", "forge", "neoforge"];

const CURATED_MODPACKS = [
  { name: "None", slug: "" },
  { name: "Fabulously Optimized", slug: "fabulously-optimized" },
  { name: "Sop", slug: "sop" },
  { name: "Adrenaline", slug: "adrenaline" },
];

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
  return {
    project_id: String(mod.id),
    slug: String(mod.id),
    title: mod.name ?? "Unknown",
    description: mod.summary ?? "",
    icon_url: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? undefined,
    downloads: mod.downloadCount ?? 0,
    follows: mod.thumbsUpCount ?? 0,
    author: mod.authors?.[0]?.name ?? "",
    categories: mod.categories?.map((c: any) => c.name?.toLowerCase() ?? "") ?? [],
    versions: [],
    date_modified: mod.dateModified ?? "",
  };
}

function channelStyle(type: string) {
  if (type === "release") return { bg: "bg-[#22c55e]/15", text: "text-[#22c55e]", border: "border-[#22c55e]/30", dot: "bg-[#22c55e]" };
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
                opt === value ? "text-[#22c55e] bg-[#22c55e]/10" : "text-foreground hover:bg-white/5"].join(" ")}>
              {opt}
              {opt === value && <IconCheck size={11} className="text-[#22c55e] flex-shrink-0" />}
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
            ? "border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/5"
            : "border-border text-muted hover:text-foreground hover:border-white/10"
        ].join(" ")}
        style={{ backgroundColor: open ? undefined : "var(--color-surface)" }}>
        <IconFilter size={11} />
        {label}
        {value !== "All" && (
          <span className="px-1.5 py-0.5 rounded-[5px] bg-[#22c55e]/15 text-[#22c55e] text-[10px] font-bold">{value}</span>
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
                className="w-full pl-7 pr-2 py-1.5 rounded-[8px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/40 transition-colors"
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
                    opt === value ? "text-[#22c55e] bg-[#22c55e]/10" : "text-foreground hover:bg-white/5"
                  ].join(" ")}>
                  <span>{opt}</span>
                  {opt === value && <IconCheck size={11} className="text-[#22c55e] flex-shrink-0" />}
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
          {loading ? "Loading..." : value || "Select version"}
        </span>
        <IconChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-overlay border border-border rounded-[15px] overflow-hidden shadow-xl">
          <div className="max-h-44 overflow-y-auto">
            {loading
              ? <div className="px-3 py-2 text-xs text-muted">Loading...</div>
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

function LoaderPill({ value, selected, onClick }: { value: Loader; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={["flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
        selected ? "bg-accent/15 border-accent/40 text-accent" : "bg-transparent border-border text-muted hover:text-foreground"].join(" ")}>
      {selected && <IconCheck size={11} />}
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </button>
  );
}

function ImagePickRow({ label, previewSrc, onPick, onClear, icon }: {
  label: string; previewSrc: string | null; onPick: () => void; onClear: () => void; icon: React.ReactNode;
}) {
  const url = toUrl(previewSrc);
  return (
    <div className="flex items-center gap-3">
      <div onClick={onPick}
        className="w-16 h-12 rounded-[15px] border border-border bg-surface flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer hover:border-accent/40 transition-colors relative group">
        {url ? <img src={url} className="w-full h-full object-cover" alt="" /> : <span className="text-muted">{icon}</span>}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <IconUpload size={14} className="text-white" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-1">
        <span className="text-xs text-muted">{label}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onPick}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground border border-border px-2.5 py-1 rounded-[10px] transition-colors">
            <IconUpload size={11} /> Choose
          </button>
          {previewSrc && (
            <button type="button" onClick={onClear}
              className="flex items-center gap-1.5 text-xs text-danger/70 hover:text-danger border border-border px-2.5 py-1 rounded-[10px] transition-colors">
              <IconX size={11} /> Remove
            </button>
          )}
        </div>
      </div>
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

function ModrinthDetailView({
  hit, installedSlugs, onBack, onInstall,
}: {
  hit: ModrinthHit;
  installedSlugs: Set<string>;
  onBack: () => void;
  onInstall: (hit: ModrinthHit, versionId?: string) => Promise<void>;
}) {
  const [installing, setInstalling] = useState<string | null>(null);
  const [fullData, setFullData] = useState<ModrinthHit | null>(null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [activeTab, setActiveTab] = useState<"description" | "versions" | "gallery">("description");

  const [mrVersions, setMrVersions] = useState<ModrinthVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionGameFilter, setVersionGameFilter] = useState("All");
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
    fetch(`https://api.modrinth.com/v2/project/${hit.slug}/version`, {
      headers: { "User-Agent": "Launcher/1.0" },
    })
      .then(r => r.json())
      .then(d => { if (alive) setMrVersions(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingVersions(false); });
    return () => { alive = false; };
  }, [hit.slug, activeTab]);

  const data = fullData ?? hit;
  const gallery = fullData?.gallery ?? [];

  const allGameVersions = ["All", ...Array.from(new Set(mrVersions.flatMap(v => v.game_versions))).sort().reverse()];
  const allChannels = ["All", "Release", "Beta", "Alpha"];

  const filteredVersions = mrVersions.filter(v => {
    const gameOk = versionGameFilter === "All" || v.game_versions.includes(versionGameFilter);
    const channelOk = versionChannelFilter === "All" || v.version_type === versionChannelFilter.toLowerCase();
    return gameOk && channelOk;
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
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] text-[10px] font-semibold">
                <IconCheck size={9} /> Installed
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-0.5">by {hit.author}</p>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <IconDownload size={12} className="text-[#22c55e]" />
              <span className="text-foreground font-medium">{formatDownloads(hit.downloads)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <IconStar size={12} className="text-[#22c55e]" />
              <span className="text-foreground font-medium">{formatDownloads(hit.follows)}</span>
            </span>
            {hit.date_modified && (
              <span className="text-xs text-muted">Updated {timeAgo(hit.date_modified)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-center">
          <button onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconArrowLeft size={14} /> Back
          </button>
          {isInstalled ? (
            <button disabled
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-semibold bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30 cursor-default">
              <IconCheck size={14} /> Installed
            </button>
          ) : (
            <button onClick={handleInstallLatest} disabled={installing !== null}
              className="flex items-center gap-2 px-5 py-2 rounded-[10px] text-sm font-bold bg-[#22c55e] hover:bg-[#16a34a] text-black transition-colors disabled:opacity-50">
              <IconDownload size={14} />
              {installing === "latest" ? "Installing..." : "Install latest"}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-border flex-shrink-0">
        {[
          { key: "description", label: "Description" },
          { key: "versions", label: `Versions${mrVersions.length > 0 ? ` (${mrVersions.length})` : ""}` },
          { key: "gallery", label: `Gallery${gallery.length > 0 ? ` (${gallery.length})` : ""}` },
        ].map(tab => (
          <button key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
              activeTab === tab.key ? "bg-[#22c55e] text-black" : "text-muted hover:text-foreground"].join(" ")}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "description" && (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loadingFull ? (
              <div className="flex items-center gap-2 text-xs text-muted py-4">
                <IconRefresh size={13} className="animate-spin" /> Loading...
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
                <p className="text-xs font-bold text-foreground mb-2">Compatibility</p>
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
                <p className="text-xs font-bold text-foreground mb-2">Platforms</p>
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
                <p className="text-xs font-bold text-foreground mb-2">Tags</p>
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
                <p className="text-xs font-bold text-foreground mb-1">License</p>
                <p className="text-xs text-muted">{fullData.license.name || fullData.license.id}</p>
              </div>
            )}
            {hit.date_modified && (
              <div>
                <p className="text-xs font-bold text-foreground mb-1">Last updated</p>
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
              label="Game versions"
              value={versionGameFilter}
              options={allGameVersions}
              onChange={setVersionGameFilter}
            />
            <VersionFilterDropdown
              label="Channels"
              value={versionChannelFilter}
              options={allChannels}
              onChange={setVersionChannelFilter}
            />
            <span className="ml-auto text-xs text-muted flex-shrink-0">{filteredVersions.length} versions</span>
          </div>

          <div className="flex items-center px-5 py-2 border-b border-border flex-shrink-0 text-[11px] font-semibold text-muted tracking-wide">
            <div className="w-24 flex-shrink-0">Channel</div>
            <div className="flex-1">Name</div>
            <div className="w-32 flex-shrink-0">Game version</div>
            <div className="w-24 flex-shrink-0">Platform</div>
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
                <p className="text-sm text-muted">No versions match filters</p>
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
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded-[5px] bg-[#22c55e]/10 text-[#22c55e] text-[9px] font-bold uppercase tracking-wide">
                            Latest
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
                            ? "border-[#22c55e]/20 text-[#22c55e]/50 cursor-default"
                            : installing === v.id
                              ? "border-border text-muted cursor-not-allowed"
                              : "border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e] hover:text-black"
                        ].join(" ")}>
                        {installing === v.id
                          ? <><IconRefresh size={11} className="animate-spin" /> Installing...</>
                          : isInstalled
                            ? <><IconCheck size={11} /> Installed</>
                            : <><IconDownload size={11} /> Install</>}
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loadingFull ? (
            <div className="flex items-center gap-2 text-xs text-muted py-4">
              <IconRefresh size={13} className="animate-spin" /> Loading...
            </div>
          ) : gallery.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
              <IconPhoto size={36} className="text-muted" />
              <p className="text-sm text-muted">No gallery images</p>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {gallery.map((img, idx) => (
                <div key={idx} className="rounded-xl overflow-hidden border border-border group cursor-pointer"
                  style={{ backgroundColor: "var(--color-surface)" }}
                  onClick={() => window.open(img.url, "_blank")}>
                  <div className="relative overflow-hidden">
                    <img src={img.url} className="w-full object-cover h-44 group-hover:scale-105 transition-transform duration-300" alt={img.title ?? ""} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </div>
                  {(img.title || img.featured) && (
                    <div className="px-3 py-2.5">
                      {img.title && <p className="text-sm font-semibold text-foreground">{img.title}</p>}
                      {img.featured && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#22c55e] font-medium mt-0.5">
                          <IconStar size={9} /> Featured
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .modpack-body h1 { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--color-foreground); }
        .modpack-body h2 { font-size: 1.05rem; font-weight: 700; margin: 1rem 0 0.5rem; color: var(--color-foreground); }
        .modpack-body h3 { font-size: 0.95rem; font-weight: 600; margin: 0.75rem 0 0.4rem; color: var(--color-foreground); }
        .modpack-body p { margin: 0.5rem 0; color: rgba(255,255,255,0.75); }
        .modpack-body a { color: #22c55e; text-decoration: underline; }
        .modpack-body a:hover { color: #16a34a; }
        .modpack-body ul, .modpack-body ol { padding-left: 1.25rem; margin: 0.5rem 0; }
        .modpack-body li { margin: 0.2rem 0; color: rgba(255,255,255,0.75); }
        .modpack-body strong { font-weight: 600; color: var(--color-foreground); }
        .modpack-body em { font-style: italic; }
        .modpack-body img { max-width: 100%; border-radius: 8px; margin: 0.5rem 0; }
        .modpack-body hr { border: none; border-top: 1px solid var(--color-border); margin: 1rem 0; }
        .modpack-body code { font-family: monospace; font-size: 0.85em; background: rgba(255,255,255,0.07); padding: 0.1rem 0.3rem; border-radius: 4px; }
        .modpack-body pre { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 0.75rem; overflow-x: auto; margin: 0.5rem 0; }
        .modpack-body blockquote { border-left: 3px solid #22c55e; padding-left: 0.75rem; margin: 0.5rem 0; opacity: 0.7; }
      `}</style>
    </div>
  );
}

function ModpacksTab({ localInstances, onInstalled }: { localInstances: LocalInstance[]; onInstalled: (inst: LocalInstance) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ModrinthHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const [sortBy, setSortBy] = useState("Downloads");
  const [viewCount, setViewCount] = useState(20);
  const [selectedHit, setSelectedHit] = useState<ModrinthHit | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [mcFilter, setMcFilter] = useState("");
  const installedSlugs = new Set(localInstances.map(i => i.id.replace(/^modrinth-/, "")));
  const totalPages = Math.max(1, Math.ceil(totalHits / viewCount));
  const { versions } = useVersions();

  const search = async (currentPage = page) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      params.set("limit", String(viewCount));
      params.set("offset", String(currentPage * viewCount));
      params.set("index", SORT_MAP[sortBy] ?? "downloads");
      const facets: string[][] = [["project_type:modpack"]];
      if (mcFilter) facets.push([`versions:${mcFilter}`]);
      params.set("facets", JSON.stringify(facets));
      const res = await fetch(`https://api.modrinth.com/v2/search?${params}`, { cache: "no-store", headers: { "User-Agent": "Launcher/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data.hits) ? data.hits : []);
      setTotalHits(typeof data.total_hits === "number" ? data.total_hits : 0);
    } catch (e: any) {
      setError(`Search error: ${e?.message || "unknown"}`);
      setTotalHits(0);
    } finally { setLoading(false); }
  };

  useEffect(() => { search(page); }, [page, sortBy, viewCount, mcFilter]);
  const handleSearch = () => { setPage(0); search(0); };

  const handleInstall = async (hit: ModrinthHit, versionId?: string) => {
    setInstalling(hit.slug);
    try {
      const inst = await invoke<LocalInstance>("install_modrinth_modpack", {
        slug: hit.slug,
        title: hit.title,
        iconUrl: hit.icon_url ?? null,
        versionId: versionId ?? null,
      });
      onInstalled(inst);
      toast(`"${hit.title}" installed successfully`);
      setSelectedHit(null);
    } catch (e) {
      toast.danger("Error installing modpack", { description: String(e) });
    } finally { setInstalling(null); }
  };

  const pageItems = getPageItems(page + 1, totalPages);

  if (selectedHit) {
    return (
      <ModrinthDetailView
        hit={selectedHit}
        installedSlugs={installedSlugs}
        onBack={() => setSelectedHit(null)}
        onInstall={handleInstall}
      />
    );
  }

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-wrap">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search modpacks on Modrinth..."
            className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/50 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <SimpleDropdown label="Version" value={mcFilter || "All"} options={["All", ...versions.slice(0, 15).map(v => v.id)]} onChange={v => { setMcFilter(v === "All" ? "" : v); setPage(0); }}/>
        <SimpleDropdown label="Sort" value={sortBy} options={SORT_OPTIONS} onChange={v => { setSortBy(v); setPage(0); }} />
        <SimpleDropdown label="View" value={String(viewCount)} options={VIEW_OPTIONS} onChange={v => { setViewCount(Number(v)); setPage(0); }} />
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={loading || page === 0}
            className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors">
            <IconChevronLeft size={13} />
          </button>
          {pageItems.map((item, idx) =>
            item === "dots" ? <span key={`d${idx}`} className="text-xs text-muted px-1">...</span> : (
              <button key={item} onClick={() => setPage((item as number) - 1)} disabled={loading}
                className={["w-7 h-7 rounded-[8px] text-xs font-semibold transition-all",
                  item === page + 1 ? "bg-[#22c55e] text-black" : "text-muted hover:text-foreground"].join(" ")}>
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
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-16"><IconRefresh size={20} className="text-muted animate-spin" /></div>}
        {error && (
          <div className="mx-5 mt-4 px-3 py-2.5 rounded-[12px] bg-danger/10 border border-danger/20 flex items-center gap-2">
            <IconAlertCircle size={14} className="text-danger flex-shrink-0" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}
        {!loading && !error && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
            <IconSearch size={36} className="text-muted" />
            <p className="text-sm text-muted">No modpacks found</p>
          </div>
        )}
        {!loading && results.map(hit => {
          const isInstalled = installedSlugs.has(hit.slug);
          return (
            <div key={hit.project_id}
              className="flex items-center gap-4 px-5 py-4 border-b border-border hover:bg-white/[0.02] transition-colors cursor-pointer"
              onClick={() => setSelectedHit(hit)}>
              <div className="w-14 h-14 rounded-[15px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: "var(--color-surface)" }}>
                {hit.icon_url ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={22} className="text-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-foreground">{hit.title}</p>
                  <span className="text-xs text-muted">by {hit.author}</span>
                  {isInstalled && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] text-[10px] font-semibold">
                      <IconCheck size={9} /> Installed
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{hit.description}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-muted"><IconDownload size={10} /> {formatDownloads(hit.downloads)}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted"><IconStar size={10} /> {formatDownloads(hit.follows)}</span>
                  {hit.categories.slice(0, 2).map(cat => (
                    <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted capitalize">{cat}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {isInstalled ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[#22c55e] border border-[#22c55e]/30 bg-[#22c55e]/5">
                    <IconCheck size={12} /> Installed
                  </span>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setSelectedHit(hit); }} disabled={installing === hit.slug}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border-2 border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e] hover:text-black transition-all disabled:opacity-50">
                    {installing === hit.slug ? "..." : <><IconDownload size={12} /> Install</>}
                  </button>
                )}
                <p className="text-[10px] text-muted">{timeAgo(hit.date_modified)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LocalTab({ instances, onSelect, onCreateClick, onImportClick }: {
  instances: LocalInstance[]; onSelect: (id: string) => void; onCreateClick: () => void; onImportClick: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = instances.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search local instances..."
            className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/50 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <button onClick={onImportClick} className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground font-medium transition-colors">
            <IconPackageImport size={14} /> Import
          </button>
          <button onClick={onCreateClick} className="text-sm text-[#22c55e] hover:text-[#16a34a] font-medium transition-colors">+ Create instance</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 h-full opacity-40">
            <IconBox size={36} className="text-muted" />
            <p className="text-sm text-muted">No local instances</p>
            <button onClick={onCreateClick} className="text-xs text-[#22c55e] hover:text-[#16a34a] transition-colors">Create your first instance</button>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {filtered.map(inst => {
              const iconUrl = toUrl(inst.icon_path);
              return (
                <button key={inst.id} onClick={() => onSelect(inst.id)}
                  className="flex items-center gap-3 p-3 rounded-[15px] border border-border text-left transition-all hover:border-[#22c55e]/30 group"
                  style={{ backgroundColor: "var(--color-surface)" }}>
                  <div className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 overflow-hidden border border-border text-xl"
                    style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                    {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <span>{LOADER_EMOJI[inst.loader as Loader] ?? "📦"}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-[#22c55e] transition-colors">{inst.title}</p>
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

function CustomTab({ onSelect }: { onSelect: (id: string, name: string) => void }) {
  const [instances, setInstances] = useState<RemoteInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCustom = async () => {
      setLoading(true); setError(null);
      try {
        const saved: any[] = JSON.parse(localStorage.getItem("codeInstances") || "[]");
        setInstances(saved.map((r: any) => ({
          id: r.id ?? r._id ?? String(Math.random()),
          name: r.title ?? r.name ?? "Unnamed",
          slug: r.slug,
          loader: typeof r.loader === "object" ? (r.loader?.type ?? "vanilla") : (r.loader ?? "vanilla"),
          minecraft_version: r.minecraft_version ?? r.version ?? "unknown",
          icon_url: r.icon ?? r.icon_url ?? null,
          description: r.description ?? null,
          modCount: r.mod_count ?? r.mods?.length ?? null,
        })));
      } catch (e) { setError(String(e)); } finally { setLoading(false); }
    };
    fetchCustom();
  }, []);

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex-1 overflow-y-auto p-5">
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
            <p className="text-sm text-muted">No instances found</p>
          </div>
        )}
        {!loading && instances.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {instances.map(inst => (
              <button key={inst.id} onClick={() => onSelect(inst.id, inst.name)}
                className="flex items-center gap-3 p-3 rounded-[15px] border border-border text-left transition-all hover:border-[#22c55e]/30 group"
                style={{ backgroundColor: "var(--color-surface)" }}>
                <div className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 overflow-hidden border border-border text-xl"
                  style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                  {inst.icon_url ? <img src={inst.icon_url} className="w-full h-full object-cover" alt="" /> : <span>{LOADER_EMOJI[inst.loader as Loader] ?? "📦"}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-[#22c55e] transition-colors">{inst.name}</p>
                  <p className="text-xs text-muted truncate mt-0.5">{inst.loader.charAt(0).toUpperCase() + inst.loader.slice(1)} {inst.minecraft_version}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AllTab({ localInstances, onSelect, onCreateClick, onImportClick }: {
  localInstances: LocalInstance[]; onSelect: (id: string) => void; onCreateClick: () => void; onImportClick: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sortBy] = useState("Name");
  const filtered = localInstances.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <div className="relative flex-1 max-w-lg">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
            className="w-full pl-9 pr-3 py-1.5 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1.5 border border-border rounded-[12px] px-3 py-1.5 text-sm text-foreground"
            style={{ backgroundColor: "var(--color-surface)" }}>
            <span className="text-muted text-xs">Sort by:</span>
            <span className="text-sm">{sortBy}</span>
            <IconChevronDown size={13} className="text-muted" />
          </div>
        </div>
        <button onClick={onImportClick} className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground font-medium transition-colors">
          <IconPackageImport size={14} /> Import
        </button>
        <button onClick={onCreateClick} className="text-sm text-[#22c55e] hover:text-[#16a34a] font-medium transition-colors">Create instance</button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 h-full opacity-50">
            <IconBox size={40} className="text-muted" />
            <p className="text-sm text-muted">No instances found</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {filtered.map(inst => {
              const iconUrl = toUrl(inst.icon_path);
              return (
                <button key={inst.id} onClick={() => onSelect(inst.id)}
                  className="flex items-center gap-3 p-3 rounded-[15px] border border-border text-left transition-all hover:border-border/60 group"
                  style={{ backgroundColor: "var(--color-surface)" }}>
                  <div className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 overflow-hidden border border-border text-xl"
                    style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                    {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <span>{LOADER_EMOJI[inst.loader as Loader] ?? "📦"}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-[#22c55e] transition-colors">{inst.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <IconBox size={11} className="text-muted flex-shrink-0" />
                      <p className="text-xs text-muted truncate">{inst.loader.charAt(0).toUpperCase() + inst.loader.slice(1)} {inst.minecraft_version}</p>
                    </div>
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

function InstancesGridView({ instances, activeTab, setActiveTab, onSelect, onCreateClick, onImportClick, onInstalled }: {
  instances: LocalInstance[]; activeTab: InstanceTab; setActiveTab: (t: InstanceTab) => void;
  onSelect: (id: string) => void; onCreateClick: () => void; onImportClick: () => void; onInstalled: (inst: LocalInstance) => void;
}) {
  const TABS: { label: string; key: InstanceTab }[] = [
    { label: "All instances", key: "all" },
    { label: "Modpacks", key: "modpacks" },
    { label: "Local", key: "local" },
    { label: "Instance Private", key: "custom" },
  ];
  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
                activeTab === tab.key ? "bg-[#22c55e] text-black" : "text-muted hover:text-foreground"].join(" ")}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "all" && <AllTab localInstances={instances} onSelect={onSelect} onCreateClick={onCreateClick} onImportClick={onImportClick} />}
        {activeTab === "modpacks" && <ModpacksTab localInstances={instances} onInstalled={onInstalled} />}
        {activeTab === "local" && <LocalTab instances={instances} onSelect={onSelect} onCreateClick={onCreateClick} onImportClick={onImportClick} />}
        {activeTab === "custom" && <CustomTab onSelect={(id) => onSelect(id)} />}
      </div>
    </div>
  );
}

interface FileNode { name: string; path: string; isDir: boolean; children?: FileNode[]; checked: boolean; indeterminate?: boolean; }

function FileTreeNode({ node, depth, onToggle }: { node: FileNode; depth: number; onToggle: (path: string, checked: boolean) => void }) {
  const [expanded, setExpanded] = useState(depth === 0);
  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 px-2 rounded-[8px] hover:bg-white/[0.03] transition-colors group"
        style={{ paddingLeft: `${8 + depth * 16}px` }}>
        {node.isDir && (
          <button type="button" onClick={() => setExpanded(v => !v)} className="text-muted hover:text-foreground transition-colors flex-shrink-0">
            <IconChevronDown size={12} className={`transition-transform ${expanded ? "" : "-rotate-90"}`} />
          </button>
        )}
        {!node.isDir && <span className="w-4 flex-shrink-0" />}
        <div className={["w-4 h-4 rounded-[4px] border flex items-center justify-center flex-shrink-0 cursor-pointer transition-all",
          node.checked ? "bg-[#22c55e] border-[#22c55e]" : node.indeterminate ? "bg-[#22c55e]/30 border-[#22c55e]/50" : "border-border bg-transparent hover:border-[#22c55e]/40"].join(" ")}
          onClick={() => onToggle(node.path, !node.checked)}>
          {node.checked && <IconCheck size={10} className="text-black" strokeWidth={3} />}
          {node.indeterminate && !node.checked && <div className="w-2 h-0.5 bg-[#22c55e] rounded-full" />}
        </div>
        <span className={`text-xs truncate ${node.isDir ? "text-foreground font-medium" : "text-muted"}`}>{node.name}</span>
      </div>
      {node.isDir && expanded && node.children && (
        <div>{node.children.map(child => <FileTreeNode key={child.path} node={child} depth={depth + 1} onToggle={onToggle} />)}</div>
      )}
    </div>
  );
}

function ExportModal({ instance, onClose }: { instance: LocalInstance; onClose: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modpackName, setModpackName] = useState(instance.title);
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([
    { name: "mods", path: "mods", isDir: true, checked: true, children: [] },
    { name: "config", path: "config", isDir: true, checked: true, children: [] },
    { name: "resourcepacks", path: "resourcepacks", isDir: true, checked: true, children: [] },
    { name: "shaderpacks", path: "shaderpacks", isDir: true, checked: false, children: [] },
    { name: "options.txt", path: "options.txt", isDir: false, checked: false },
    { name: "servers.dat", path: "servers.dat", isDir: false, checked: false },
    { name: "servers.dat_old", path: "servers.dat_old", isDir: false, checked: false },
    { name: "gameData.json", path: "gameData.json", isDir: false, checked: false },
  ]);

  const handleToggle = (path: string, checked: boolean) => { setFileTree(prev => toggleNode(prev, path, checked)); };
  function toggleNode(nodes: FileNode[], path: string, checked: boolean): FileNode[] {
    return nodes.map(n => {
      if (n.path === path) return { ...n, checked, children: n.children ? toggleAllChildren(n.children, checked) : undefined };
      if (n.children) {
        const newChildren = toggleNode(n.children, path, checked);
        const allChecked = newChildren.every(c => c.checked);
        const someChecked = newChildren.some(c => c.checked || c.indeterminate);
        return { ...n, children: newChildren, checked: allChecked, indeterminate: !allChecked && someChecked };
      }
      return n;
    });
  }
  function toggleAllChildren(nodes: FileNode[], checked: boolean): FileNode[] {
    return nodes.map(n => ({ ...n, checked, children: n.children ? toggleAllChildren(n.children, checked) : undefined }));
  }
  const selectedCount = countSelected(fileTree);
  function countSelected(nodes: FileNode[]): number {
    return nodes.reduce((acc, n) => {
      if (n.isDir) return acc + (n.checked || n.indeterminate ? 1 : 0) + countSelected(n.children ?? []);
      return acc + (n.checked ? 1 : 0);
    }, 0);
  }
  const handleExport = async () => {
    if (!modpackName.trim()) return;
    setExporting(true); setError(null);
    const options: Record<string, boolean> = { include_images: includeImages };
    fileTree.forEach(n => { options[n.path] = n.checked || !!n.indeterminate; });
    try {
      const path = await invoke<string>("export_local_instance", { id: instance.id, options });
      setExportPath(path); setDone(true);
    } catch (e) { if (!String(e).includes("cancelled")) setError(String(e)); }
    finally { setExporting(false); }
  };
  const iconUrl = toUrl(instance.icon_path);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl w-[500px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--color-overlay)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[10px] overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
              {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <span className="text-base">{LOADER_EMOJI[instance.loader as Loader] ?? "📦"}</span>}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-none">Export modpack</p>
              <p className="text-xs text-muted mt-0.5">{instance.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"><IconX size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-xs font-medium text-muted">Modpack Name</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] border border-border focus-within:border-[#22c55e]/40 transition-colors" style={{ backgroundColor: "var(--color-surface)" }}>
                  <IconBox size={13} className="text-muted flex-shrink-0" />
                  <input value={modpackName} onChange={e => setModpackName(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none min-w-0" placeholder="My modpack..." />
                  {modpackName && <button onClick={() => setModpackName("")} className="text-muted hover:text-foreground transition-colors"><IconX size={12} /></button>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 w-28">
                <label className="text-xs font-medium text-muted">Version</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] border border-border focus-within:border-[#22c55e]/40 transition-colors" style={{ backgroundColor: "var(--color-surface)" }}>
                  <input value={version} onChange={e => setVersion(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none min-w-0" placeholder="1.0.0" />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted">Description <span className="opacity-40">(optional)</span></label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's special about this modpack..." rows={2}
                className="px-3 py-2.5 rounded-[12px] border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/40 resize-none transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }} />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
              <span className="text-[10px] text-muted uppercase tracking-widest">Include</span>
              <div className="h-px flex-1" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
            </div>
            <div onClick={() => setIncludeImages(v => !v)}
              className="flex items-center gap-3 px-3.5 py-3 rounded-[12px] border cursor-pointer transition-all"
              style={{ backgroundColor: includeImages ? "rgba(34,197,94,0.06)" : "var(--color-surface)", borderColor: includeImages ? "rgba(34,197,94,0.25)" : "var(--color-border)" }}>
              <div className={["w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors", includeImages ? "bg-[#22c55e]/15" : "bg-white/5"].join(" ")}>
                <IconPhoto size={17} className={includeImages ? "text-[#22c55e]" : "text-muted"} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={["text-sm font-medium transition-colors", includeImages ? "text-foreground" : "text-muted"].join(" ")}>Icon and background</p>
                <p className="text-xs text-muted mt-0.5">Instance icon and background image</p>
              </div>
              <div className={["w-5 h-5 rounded-[6px] border flex items-center justify-center flex-shrink-0 transition-all", includeImages ? "bg-[#22c55e] border-[#22c55e]" : "border-border bg-transparent"].join(" ")}>
                {includeImages && <IconCheck size={11} className="text-black" strokeWidth={3} />}
              </div>
            </div>
            <div>
              <button type="button" onClick={() => setFileTreeOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-[12px] border border-border transition-colors hover:border-white/10"
                style={{ backgroundColor: "var(--color-surface)" }}>
                <div className="flex items-center gap-2">
                  <IconFolderOpen size={14} className="text-muted" />
                  <span className="text-sm text-foreground">Files and folders</span>
                  {selectedCount > 0 && <span className="px-1.5 py-0.5 rounded-[6px] bg-[#22c55e]/15 text-[#22c55e] text-xs font-semibold">{selectedCount}</span>}
                </div>
                <IconChevronDown size={13} className={["text-muted transition-transform", fileTreeOpen ? "rotate-180" : ""].join(" ")} />
              </button>
              {fileTreeOpen && (
                <div className="mt-1 rounded-[12px] border border-border overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
                  <div className="max-h-52 overflow-y-auto py-1.5">
                    {fileTree.map(node => <FileTreeNode key={node.path} node={node} depth={0} onToggle={handleToggle} />)}
                  </div>
                </div>
              )}
            </div>
            {error && <div className="px-3 py-2.5 rounded-[12px] bg-danger/10 border border-danger/20 text-xs text-danger">{error}</div>}
            {done && exportPath && (
              <div className="px-3 py-2.5 rounded-[12px] bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-start gap-2">
                <IconCheck size={13} className="text-[#22c55e] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-[#22c55e] font-semibold">Exported successfully!</p>
                  <p className="text-[11px] text-muted mt-0.5 break-all font-mono">{exportPath}</p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center justify-between px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-xs text-muted">{selectedCount} folder{selectedCount !== 1 ? "s" : ""} · {includeImages ? "with" : "without"} images</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm text-muted hover:text-foreground border border-border hover:bg-white/5 transition-colors">
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button onClick={handleExport} disabled={exporting || !modpackName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-semibold bg-[#22c55e] hover:bg-[#16a34a] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <IconPackageExport size={14} />
                {exporting ? "Exporting..." : "Export"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DotsDropdown({ onOpenFolder, onExport }: { onOpenFolder: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const items = [
    { icon: <IconFolder size={14} />, label: "Files", description: "Open instance folder", action: () => { onOpenFolder(); setOpen(false); }, green: false },
    { icon: <IconPackageExport size={14} />, label: "Export", description: "Save as .mrstack", action: () => { onExport(); setOpen(false); }, green: true },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className={["w-9 h-9 flex items-center justify-center rounded-[12px] border transition-colors",
          open ? "border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/5" : "border-border text-muted hover:text-foreground hover:bg-white/5"].join(" ")}>
        <IconDotsVertical size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-[15px] border border-border shadow-2xl overflow-hidden"
          style={{ backgroundColor: "var(--color-overlay)" }}>
          <div className="absolute -top-[5px] right-3.5 w-2.5 h-2.5 rotate-45 border-l border-t border-border" style={{ backgroundColor: "var(--color-overlay)" }} />
          <div className="p-1.5 flex flex-col gap-0.5">
            {items.map(item => (
              <button key={item.label} onClick={item.action}
                className={["flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-left w-full transition-all group", item.green ? "hover:bg-[#22c55e]/10" : "hover:bg-white/[0.04]"].join(" ")}>
                <span className={["flex-shrink-0 transition-colors", item.green ? "text-[#22c55e]" : "text-muted group-hover:text-foreground"].join(" ")}>{item.icon}</span>
                <div className="min-w-0">
                  <p className={["text-sm font-medium leading-none", item.green ? "text-[#22c55e]" : "text-foreground"].join(" ")}>{item.label}</p>
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

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (inst: LocalInstance) => void }) {
  const { versions, loading: loadingVersions } = useVersions();
  const [name, setName] = useState("");
  const [loader, setLoader] = useState<Loader>("vanilla");
  const [version, setVersion] = useState("");
  const [selectedModpack, setSelectedModpack] = useState<string>("");
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (versions.length && !version) setVersion(versions[0].id); }, [versions]);
  const handleCreate = async () => {
    const title = name.trim();
    if (!title || saving) return;
    setSaving(true);

    if (selectedModpack) {
      try {
        const queryParams = new URLSearchParams({
          game_versions: JSON.stringify([version]),
          loaders: JSON.stringify([loader === "vanilla" ? "fabric" : loader])
        });
        const res = await fetch(`https://api.modrinth.com/v2/project/${selectedModpack}/version?${queryParams}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const modpackVersions = await res.json();

        if (modpackVersions.length === 0) {
           throw new Error(`No compatible version found for ${version} / ${loader}`);
        }

        const targetVersion = modpackVersions[0];

        const projRes = await fetch(`https://api.modrinth.com/v2/project/${selectedModpack}`);
        if (!projRes.ok) throw new Error(`HTTP ${projRes.status}`);
        const projData = await projRes.json();

        let created = await invoke<LocalInstance>("install_modrinth_modpack", {
          slug: selectedModpack,
          title: title,
          iconUrl: projData.icon_url || null,
          versionId: targetVersion.id,
        });
        if (iconSrc || bgSrc) {
          created = await updateLocalInstance(created.id, created.title, created.minecraft_version, created.loader, iconSrc, bgSrc, false, false);
        }
        onCreate(created);
        onClose();
      } catch (e) { toast.danger("Error creating instance with modpack", { description: String(e) }); }
      finally { setSaving(false); }
    } else {
      const inst: LocalInstance = {
        id: slugify(title) || `inst-${Date.now()}`,
        title, minecraft_version: version, loader,
        icon_path: null, background_path: null, created_at: Date.now(),
      };
      try {
        const created = await invoke<LocalInstance>("add_local_instance", { instance: inst, iconSrc: iconSrc ?? null, backgroundSrc: bgSrc ?? null });
        onCreate(created);
        onClose();
      } catch (e) { toast.danger("Error creating instance", { description: String(e) }); }
      finally { setSaving(false); }
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-[15px] w-[420px] flex flex-col gap-5 shadow-2xl border border-white/10 overflow-hidden"
        style={{ backgroundColor: "var(--color-overlay)" }}>
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="text-sm font-semibold text-foreground">Create instance</span>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors"><IconX size={16} /></button>
        </div>
        <div className="px-5 flex flex-col gap-4">
          <TextField variant="secondary" value={name} onChange={setName}>
            <Label className="text-xs text-muted mb-1">Name</Label>
            <Input autoFocus placeholder="My survival instance..." onKeyDown={e => { if (e.key === "Enter" && name.trim()) handleCreate(); }} />
          </TextField>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Loader</span>
            <div className="flex flex-wrap gap-1.5">{LOADERS.map(l => <LoaderPill key={l} value={l} selected={loader === l} onClick={() => setLoader(l)} />)}</div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Minecraft Version</span>
            <VersionDropdown value={version} onChange={setVersion} versions={versions} loading={loadingVersions} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Curated Modpack</span>
            <select
              value={selectedModpack}
              onChange={e => setSelectedModpack(e.target.value)}
              className="w-full px-3 py-2 rounded-[15px] bg-field-background border border-border text-sm text-foreground hover:border-accent/40 transition-colors focus:outline-none"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              {CURATED_MODPACKS.map(m => (
                <option key={m.slug} value={m.slug}>{m.name}</option>
              ))}
            </select>
          </div>
          <ImagePickRow label="Icon" previewSrc={iconSrc}
            onPick={async () => { const p = await pickImage(); if (p) setIconSrc(p); }}
            onClear={() => setIconSrc(null)} icon={<IconBox size={18} />} />
          <ImagePickRow label="Background image" previewSrc={bgSrc}
            onPick={async () => { const p = await pickImage(); if (p) setBgSrc(p); }}
            onClear={() => setBgSrc(null)} icon={<IconPhoto size={18} />} />
        </div>
        <div className="flex gap-2 justify-end px-5 pb-5">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button onPress={handleCreate} isDisabled={!name.trim() || saving}>
            <IconPlus size={14} /> {saving ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function EditModal({ instance, onClose, onSave, onDelete }: {
  instance: LocalInstance; onClose: () => void; onSave: (updated: LocalInstance) => void; onDelete: (id: string) => void;
}) {
  const { versions, loading: loadingVersions } = useVersions();
  const [title, setTitle] = useState(instance.title);
  const [loader, setLoader] = useState<Loader>(instance.loader as Loader);
  const [version, setVersion] = useState(instance.minecraft_version);
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [clearIcon, setClearIcon] = useState(false);
  const [clearBg, setClearBg] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const iconPreview = iconSrc ?? (clearIcon ? null : instance.icon_path ?? null);
  const bgPreview = bgSrc ?? (clearBg ? null : instance.background_path ?? null);
  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await updateLocalInstance(instance.id, title.trim(), version, loader, iconSrc, bgSrc, clearIcon, clearBg);
      onSave(updated); onClose();
    } catch (e) { toast.danger("Error saving", { description: String(e) }); }
    finally { setSaving(false); }
  };
  const handleDelete = async () => {
    try { await deleteLocalInstance(instance.id); onDelete(instance.id); onClose(); }
    catch (e) { toast.danger("Error deleting", { description: String(e) }); }
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-[15px] w-[420px] flex flex-col gap-5 shadow-2xl border border-white/10 overflow-hidden"
        style={{ backgroundColor: "var(--color-overlay)" }}>
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="text-sm font-semibold text-foreground">Edit instance</span>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors"><IconX size={16} /></button>
        </div>
        <div className="px-5 flex flex-col gap-4">
          <TextField variant="secondary" value={title} onChange={setTitle}>
            <Label className="text-xs text-muted mb-1">Name</Label>
            <Input placeholder="Instance name" />
          </TextField>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Loader</span>
            <div className="flex flex-wrap gap-1.5">{LOADERS.map(l => <LoaderPill key={l} value={l} selected={loader === l} onClick={() => setLoader(l)} />)}</div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Minecraft Version</span>
            <VersionDropdown value={version} onChange={setVersion} versions={versions} loading={loadingVersions} />
          </div>
          <ImagePickRow label="Icon" previewSrc={iconPreview}
            onPick={async () => { const p = await pickImage(); if (p) { setIconSrc(p); setClearIcon(false); } }}
            onClear={() => { setIconSrc(null); setClearIcon(true); }} icon={<IconBox size={18} />} />
          <ImagePickRow label="Background image" previewSrc={bgPreview}
            onPick={async () => { const p = await pickImage(); if (p) { setBgSrc(p); setClearBg(false); } }}
            onClear={() => { setBgSrc(null); setClearBg(true); }} icon={<IconPhoto size={18} />} />
          <div className="p-3 rounded-[12px] border border-danger/20 bg-danger/5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-danger">Delete instance</p>
              <p className="text-xs text-muted mt-0.5">Deletes the entire folder. This cannot be undone.</p>
            </div>
            {confirmDelete ? (
              <div className="flex gap-1.5">
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted border border-border px-2.5 py-1.5 rounded-[10px] hover:bg-white/5 transition-colors">Cancel</button>
                <button onClick={handleDelete} className="text-xs text-danger border border-danger/30 px-2.5 py-1.5 rounded-[10px] hover:bg-danger/10 transition-colors">Confirm</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-xs text-danger border border-danger/30 px-2.5 py-1.5 rounded-[10px] hover:bg-danger/10 transition-colors">
                <IconTrash size={12} /> Delete
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end px-5 pb-5">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button onPress={handleSave} isDisabled={!title.trim() || saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!enabled)}
      className={["relative w-9 h-5 rounded-full transition-colors flex-shrink-0 overflow-hidden", enabled ? "bg-[#22c55e]" : "bg-border"].join(" ")}>
      <span className={["absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", enabled ? "left-[18px]" : "left-0.5"].join(" ")} />
    </button>
  );
}

function WorldsTab({ instance }: { instance: LocalInstance }) {
  const [worlds, setWorlds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("WorldsTab: invoking get_instance_worlds for", instance.id); 
    invoke<any[]>("get_instance_worlds", { instanceId: instance.id })
      .then(w => { console.log("worlds result:", w); setWorlds(w); })
      .catch(e => console.error("worlds error:", e))
      .finally(() => setLoading(false));
  }, [instance.id]);

  if (loading) return (
    <div className="flex items-center justify-center flex-1 h-full">
      <IconRefresh size={20} className="text-muted animate-spin" />
    </div>
  );

  if (worlds.length === 0) return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-3 opacity-40">
      <IconBox size={36} className="text-muted" />
      <p className="text-sm text-muted">No worlds found</p>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {worlds.map((world: any) => {
          const iconUrl = world.icon_path ? convertFileSrc(world.icon_path) : null;
          return (
            <div key={world.folder_name}
              className="flex items-center gap-3 p-3 rounded-[15px] border border-border"
              style={{ backgroundColor: "var(--color-surface)" }}>
              <div className="w-12 h-12 rounded-[10px] overflow-hidden flex-shrink-0 flex items-center justify-center border border-border"
                style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                {iconUrl
                  ? <img src={iconUrl} className="w-full h-full object-cover" alt="" />
                  : <IconBox size={20} className="text-muted" />}
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

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  children?: FileEntry[];
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "2-digit", day: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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
    if (ext === "config" || ext === "configs" || ext === "defaultconfigs") return <i className="ti ti-settings" style={{ fontSize: 15, color: "#9ca3af" }} />;
    if (ext === "mods") return <i className="ti ti-puzzle" style={{ fontSize: 15, color: "#a78bfa" }} />;
    if (ext === "saves") return <i className="ti ti-world" style={{ fontSize: 15, color: "#34d399" }} />;
    if (ext === "resourcepacks") return <i className="ti ti-photo" style={{ fontSize: 15, color: "#f472b6" }} />;
    if (ext === "shaderpacks") return <i className="ti ti-sparkles" style={{ fontSize: 15, color: "#fbbf24" }} />;
    if (ext === "datapacks") return <i className="ti ti-braces" style={{ fontSize: 15, color: "#60a5fa" }} />;
    if (ext === "logs" || ext === "crash-reports") return <i className="ti ti-file-description" style={{ fontSize: 15, color: "#f87171" }} />;
    return <i className="ti ti-folder" style={{ fontSize: 15, color: "#fbbf24" }} />;
  }
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "json") return <i className="ti ti-braces" style={{ fontSize: 15, color: "#60a5fa" }} />;
  if (ext === "jar") return <i className="ti ti-package" style={{ fontSize: 15, color: "#a78bfa" }} />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return <i className="ti ti-photo" style={{ fontSize: 15, color: "#f472b6" }} />;
  if (ext === "zip" || ext === "mrpack" || ext === "mrstack") return <i className="ti ti-file-zip" style={{ fontSize: 15, color: "#fb923c" }} />;
  if (ext === "dat" || ext === "nbt") return <i className="ti ti-database" style={{ fontSize: 15, color: "#94a3b8" }} />;
  if (ext === "log") return <i className="ti ti-file-description" style={{ fontSize: 15, color: "#f87171" }} />;
  if (ext === "toml" || ext === "cfg" || ext === "ini" || ext === "properties") return <i className="ti ti-file-settings" style={{ fontSize: 15, color: "#94a3b8" }} />;
  if (ext === "txt" || ext === "md") return <i className="ti ti-file-text" style={{ fontSize: 15, color: "#d1d5db" }} />;
  return <i className="ti ti-file" style={{ fontSize: 15, color: "#6b7280" }} />;
}

function FileActionsMenu({ entry, instanceId, onRename, onRefresh }: {
  entry: FileEntry;
  instanceId: string;
  onDelete: () => void;
  onRename: () => void;
  onRefresh: () => void;
}) {
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
  const handleOpenFolder = async () => {
    await invoke("open_local_instance_folder", { id: instanceId });
    setOpen(false);
  };
  const handleRename = () => { onRename(); setOpen(false); };
  const handleDelete = async () => {
    try {
      await invoke("delete_instance_file", { instanceId, filePath: entry.path });
      onRefresh();
    } catch (e) { toast.danger("Error deleting", { description: String(e) }); }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center rounded-[8px] text-muted hover:text-foreground hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
      >
        <IconDotsVertical size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-48 rounded-[12px] border border-border shadow-2xl overflow-hidden py-1"
          style={{ backgroundColor: "var(--color-overlay)" }}
        >
          <button onClick={handleCopyName}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors">
            <i className="ti ti-copy" style={{ fontSize: 14 }} /> Copy filename
          </button>
          <button onClick={handleCopyPath}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors">
            <i className="ti ti-clipboard" style={{ fontSize: 14 }} /> Copy full path
          </button>
          <button onClick={handleOpenFolder}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors">
            <i className="ti ti-folder-open" style={{ fontSize: 14 }} /> Open in folder
          </button>
          <div className="my-1 border-t border-border" />
          <button onClick={handleRename}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-white/5 transition-colors">
            <i className="ti ti-pencil" style={{ fontSize: 14 }} /> Rename
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted hover:bg-white/5 transition-colors cursor-not-allowed opacity-50">
            <i className="ti ti-arrow-right" style={{ fontSize: 14 }} /> Move
          </button>
          <div className="my-1 border-t border-border" />
          <button onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
            <i className="ti ti-trash" style={{ fontSize: 14 }} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function TextViewer({ instance, file, onBack, onSaved }: { 
  instance: LocalInstance; 
  file: FileEntry; 
  onBack: () => void;
  onSaved?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    invoke<string>("read_instance_file", { instanceId: instance.id, filePath: file.path })
      .then(c => {
        let display = c;
        if (file.name.endsWith(".json")) {
          try { display = JSON.stringify(JSON.parse(c), null, 2); } catch {}
        }
        setContent(display);
        setOriginal(display);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [file.path]);

  const isDirty = content !== original;
  const lines = (content ?? "").split("\n");

  const handleSave = async () => {
    if (!isDirty || content === null) return;
    setSaving(true);
    try {
      await invoke("write_instance_file", { 
        instanceId: instance.id, 
        filePath: file.path, 
        content 
      });
      setOriginal(content);
      toast("File saved");
      onSaved?.();
    } catch (e) {
      toast.danger("Error saving", { description: String(e) });
    } finally { setSaving(false); }
  };

  // Sync line numbers scroll with textarea
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Tab key support
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = content!.substring(0, start) + "  " + content!.substring(end);
      setContent(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors flex-shrink-0">
          <IconChevronLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileIconTabler name={file.name} isDir={false} />
          <span className="text-sm font-medium text-foreground truncate">{file.name}</span>
          {content !== null && (
            <span className="text-xs text-muted">{lines.length} lines · {formatSize(file.size)}</span>
          )}
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-[#22c55e] flex-shrink-0" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDirty && (
            <button
              onClick={() => setContent(original)}
              className="px-3 py-1.5 rounded-[8px] text-xs text-muted border border-border hover:bg-white/5 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#22c55e] hover:bg-[#16a34a] text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className="ti ti-device-floppy" style={{ fontSize: 13 }} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: "#000" }}>
        {loading && (
          <div className="flex items-center justify-center h-full">
            <IconRefresh size={18} className="text-muted animate-spin" />
          </div>
        )}
        {error && <div className="p-4 text-xs text-red-400">{error}</div>}
        {!loading && !error && content !== null && (
          <div className="flex h-full overflow-hidden font-mono text-xs" style={{ lineHeight: "1.6rem" }}>
            <div
              ref={lineNumbersRef}
              className="select-none flex-shrink-0 overflow-hidden border-r border-white/10"
              style={{
                backgroundColor: "#0a0a0a",
                color: "rgba(255,255,255,0.2)",
                minWidth: 52,
                textAlign: "right",
                padding: "16px 12px",
                lineHeight: "1.6rem",
                overflowY: "hidden",
              }}
            >
              {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className="flex-1 resize-none focus:outline-none"
              style={{
                backgroundColor: "#000",
                color: "#22c55e",
                padding: "16px",
                lineHeight: "1.6rem",
                fontFamily: "monospace",
                fontSize: 12,
                border: "none",
                overflowY: "auto",
                whiteSpace: "pre",
                overflowX: "auto",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RenameModal({ entry, instanceId, onClose, onDone }: {
  entry: FileEntry; instanceId: string; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || name === entry.name) { onClose(); return; }
    setSaving(true);
    try {
      await invoke("rename_instance_file", { instanceId, filePath: entry.path, newName: name.trim() });
      onDone();
      onClose();
    } catch (e) { toast.danger("Error renaming", { description: String(e) }); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-[15px] w-80 flex flex-col gap-4 shadow-2xl border border-white/10 p-5"
        style={{ backgroundColor: "var(--color-overlay)" }}>
        <p className="text-sm font-semibold text-foreground">Rename</p>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          className="w-full px-3 py-2 rounded-[10px] border border-border bg-transparent text-sm text-foreground focus:outline-none focus:border-[#22c55e]/50 transition-colors"
          style={{ backgroundColor: "var(--color-surface)" }}
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-xs text-muted border border-border hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#22c55e] hover:bg-[#16a34a] text-black transition-colors disabled:opacity-50">
            {saving ? "Saving..." : "Rename"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function FilesTab({ instance }: { instance: LocalInstance }) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [viewingFile, setViewingFile] = useState<FileEntry | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "size" | "modified">("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);

  const loadTree = () => {
    setLoading(true);
    setSelected(new Set());
    invoke<FileEntry[]>("get_instance_files", { instanceId: instance.id })
      .then(setTree)
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTree(); }, [instance.id]);

  const currentEntries: FileEntry[] = (() => {
    let entries = tree;
    for (const segment of currentPath) {
      const found = entries.find(e => e.name === segment && e.is_dir);
      entries = found?.children ?? [];
    }
    return entries;
  })();

  const handleSort = (col: "name" | "size" | "modified") => {
    if (sortBy === col) setSortAsc(v => !v);
    else { setSortBy(col); setSortAsc(true); }
  };

  const sorted = [...currentEntries]
    .filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else if (sortBy === "size") cmp = (a.size ?? 0) - (b.size ?? 0);
      return sortAsc ? cmp : -cmp;
    });

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map(e => e.path)));
  };
  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const someSelected = selected.size > 0 && !allSelected;

  const SortHeader = ({ col, label, className = "" }: { col: "name" | "size" | "modified"; label: string; className?: string }) => (
    <button onClick={() => handleSort(col)}
      className={`flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-foreground tracking-wide uppercase transition-colors ${className}`}>
      {label}
      {sortBy === col && <IconChevronDown size={10} className={`transition-transform ${sortAsc ? "" : "rotate-180"}`} />}
    </button>
  );

  if (viewingFile) return <TextViewer instance={instance} file={viewingFile} onBack={() => setViewingFile(null)} />;

  if (loading) return (
    <div className="flex items-center justify-center flex-1 h-full">
      <IconRefresh size={20} className="text-muted animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <button
          onClick={() => { setCurrentPath([]); setSearch(""); setSelected(new Set()); }}
          className={`w-8 h-8 flex items-center justify-center rounded-[10px] border transition-colors flex-shrink-0 ${
            currentPath.length === 0
              ? "border-white/10 text-foreground bg-white/5"
              : "border-border text-muted hover:text-foreground hover:bg-white/5"
          }`}
        >
          <i className="ti ti-home" style={{ fontSize: 15 }} />
        </button>

        <div className="flex items-center gap-1 flex-1 min-w-0 text-xs overflow-hidden">
          <button
            onClick={() => { setCurrentPath([]); setSearch(""); }}
            className="text-muted hover:text-foreground transition-colors flex-shrink-0"
          >
            {instance.title}
          </button>
          {currentPath.map((seg, i) => (
            <span key={i} className="flex items-center gap-1 flex-shrink-0">
              <span className="text-muted opacity-30 mx-0.5">/</span>
              <button
                onClick={() => { setCurrentPath(currentPath.slice(0, i + 1)); setSearch(""); }}
                className={`transition-colors truncate max-w-[120px] ${i === currentPath.length - 1 ? "text-foreground font-medium" : "text-muted hover:text-foreground"}`}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        <div className="relative w-48 flex-shrink-0">
          <IconSearch size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-7 pr-3 py-1.5 rounded-[10px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/50 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }}
          />
        </div>

        <button onClick={loadTree}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-border text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors flex-shrink-0">
          <IconRefresh size={12} /> Refresh
        </button>

        <button
          onClick={() => invoke("open_local_instance_folder", { id: instance.id })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-white/5 border border-border text-foreground hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <i className="ti ti-folder-open" style={{ fontSize: 13 }} /> Open folder
        </button>
      </div>

      <div className="flex items-center px-4 py-2 border-b border-border flex-shrink-0 gap-3">
        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          <button
            onClick={toggleAll}
            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all ${
              allSelected ? "bg-[#22c55e] border-[#22c55e]" :
              someSelected ? "bg-[#22c55e]/30 border-[#22c55e]/50" :
              "border-border hover:border-[#22c55e]/40"
            }`}
          >
            {allSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
            {someSelected && <div className="w-2 h-0.5 bg-[#22c55e] rounded-full" />}
          </button>
        </div>
        <SortHeader col="name" label="Name" className="flex-1" />
        <SortHeader col="size" label="Size" className="w-28" />
        <div className="w-36 text-[11px] font-semibold text-muted tracking-wide uppercase">Created</div>
        <SortHeader col="modified" label="Modified" className="w-36" />
        <div className="w-16 text-[11px] font-semibold text-muted tracking-wide uppercase text-right">Actions</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <i className="ti ti-folder-off text-muted" style={{ fontSize: 36 }} />
            <p className="text-sm text-muted">Empty folder</p>
          </div>
        ) : (
          sorted.map(entry => {
            const isSelected = selected.has(entry.path);
            return (
              <div
                key={entry.path}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border transition-colors group cursor-pointer ${
                  isSelected ? "bg-[#22c55e]/5" : "hover:bg-white/[0.025]"
                }`}
                onClick={() => {
                  if (entry.is_dir) {
                    setCurrentPath([...currentPath, entry.name]);
                    setSearch("");
                    setSelected(new Set());
                  } else if (isTextFile(entry.name)) {
                    setViewingFile(entry);
                  }
                }}
              >
                <div className="w-5 flex-shrink-0 flex items-center justify-center" onClick={e => { e.stopPropagation(); toggleSelect(entry.path); }}>
                  <div className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all cursor-pointer ${
                    isSelected ? "bg-[#22c55e] border-[#22c55e]" : "border-border hover:border-[#22c55e]/50"
                  }`}>
                    {isSelected && <IconCheck size={10} className="text-black" strokeWidth={3} />}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <FileIconTabler name={entry.name} isDir={entry.is_dir} />
                  <span className={`text-sm truncate ${entry.is_dir ? "text-foreground font-medium" : "text-muted group-hover:text-foreground transition-colors"}`}>
                    {entry.name}
                  </span>
                </div>

                <div className="w-28 flex-shrink-0">
                  <span className="text-xs text-muted">
                    {entry.is_dir ? countItems(entry.children) : formatSize(entry.size)}
                  </span>
                </div>

                <div className="w-36 flex-shrink-0">
                  <span className="text-xs text-muted">—</span>
                </div>

                <div className="w-36 flex-shrink-0">
                  <span className="text-xs text-muted">{formatDate((entry as any).modified)}</span>
                </div>

                <div className="w-16 flex-shrink-0 flex justify-end">
                  <FileActionsMenu
                    entry={entry}
                    instanceId={instance.id}
                    onDelete={loadTree}
                    onRename={() => setRenamingEntry(entry)}
                    onRefresh={loadTree}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {renamingEntry && (
        <RenameModal
          entry={renamingEntry}
          instanceId={instance.id}
          onClose={() => setRenamingEntry(null)}
          onDone={loadTree}
        />
      )}
    </div>
  );
}

function InstanceContentView({
  instance, onBackToMenu, onSwitchToDownload, onEdit, onExport, onOpenFolder,
}: {
  instance: LocalInstance; onBackToMenu: () => void; onSwitchToDownload: () => void;
  onEdit: () => void; onExport: () => void; onOpenFolder: () => void;
}) {
  const { launchInstance, launchedInstanceId, installProgress, installStatus } = useInstance();
  const isThisLaunched = launchedInstanceId === instance.id;

  const [filter, setFilter] = useState<ContentFilter>("all");
  const [search, setSearch] = useState("");
  const [mods, setMods] = useState<InstalledMod[]>([]);
  const [activeTab, setActiveTab] = useState<"Content" | "Files" | "Worlds" | "Logs">("Content");
  const [loadingMods, setLoadingMods] = useState(false);
  const [instanceLogger, setInstanceLogger] = useState<InstanceLog[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  
  const iconUrl = toUrl(instance.icon_path);
  const instanceIdentifier = `${instance.id}-`;

  const [playtime, setPlaytime] = useState(0);

  useEffect(() => {
      invoke<number>("get_instance_playtime", { instanceId: instance.id })
          .then(setPlaytime);
  }, [instance.id]);

  const handlePlay = () => {
    launchInstance({ ...instance, _isLocal: true } as any);
  };

  useEffect(() => {
    const unlisten = listen<InstanceLog>("instance-logger", (event) => {
      setInstanceLogger(prev => [...prev, event.payload]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    if (activeTab === "Logs") {
      setTimeout(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, 50);
    }
  }, [instanceLogger, activeTab]);

  const projectTypeForFilter = (): string => { if (filter === "resourcepacks") return "resourcepack"; return "mod"; };
  const loadMods = async () => {
    setLoadingMods(true);
    try {
      const result = await invoke<InstalledMod[]>("get_installed_mods", { instanceId: instance.id, projectType: projectTypeForFilter() });
      setMods(result);
    } catch (e) { console.error("Error loading mods:", e); } finally { setLoadingMods(false); }
  };
  useEffect(() => { loadMods(); }, [instance.id, filter]);

  const handleToggleMod = async (mod: InstalledMod, enabled: boolean) => {
    setMods(prev => prev.map(m => m.id === mod.id ? {
      ...m,
      enabled,
      filename: enabled
        ? m.filename.replace(".disabled", "")
        : m.filename.endsWith(".disabled") ? m.filename : `${m.filename}.disabled`
    } : m));

    try {
      await invoke("toggle_mod", {
        instanceId: instance.id,
        filename: mod.filename,
        enabled
      });
    } catch (e) {
      setMods(prev => prev.map(m => m.id === mod.id ? {
        ...m,
        enabled: !enabled,
        filename: mod.filename
      } : m));
      toast.danger("Error toggling mod", { description: String(e) });
    }
  };

  const handleDeleteMod = async (mod: InstalledMod) => {
    try {
      await invoke("delete_mod", { instanceId: instance.id, filename: mod.filename });
      setMods(prev => prev.filter(m => m.id !== mod.id));
      toast(`"${mod.name}" removed`);
    } catch (e) { toast.danger("Error removing mod", { description: String(e) }); }
  };

  const totalCount = mods.length;
  const FILTERS: { label: string; key: ContentFilter }[] = [
    { label: "All", key: "all" }, { label: "Mods", key: "mods" }, { label: "Resource Packs", key: "resourcepacks" },
  ];
  const loaderLabel = instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1);
  const filteredMods = mods.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const instanceLogs = instanceLogger.filter(l => l.instance === instanceIdentifier);

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-[15px] overflow-hidden border border-border flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
            {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <span>{LOADER_EMOJI[instance.loader as Loader] ?? "📦"}</span>}
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{instance.title}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-sm text-muted">{loaderLabel} {instance.minecraft_version}</p>
              <span className="text-muted text-xs">•</span>
              <span className="flex items-center gap-1 text-xs text-muted">
                <i className="ti ti-clock" style={{ fontSize: 11 }} />
                {playtime === 0 ? "Never played" : (() => {
                  const h = Math.floor(playtime / 3600);
                  const m = Math.floor((playtime % 3600) / 60);
                  if (h > 0) return `${h}h ${m}m played`;
                  if (m > 0) return `${m}m played`;
                  return `${playtime}s played`;
                })()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBackToMenu} className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] border border-border text-sm text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconArrowLeft size={14} /> Main menu
          </button>
          <button
            onClick={isThisLaunched ? () => invoke("kill_minecraft") : handlePlay}
            disabled={installProgress > 0 || installStatus !== ""}
            className={`flex items-center gap-2 px-5 py-2 rounded-[12px] text-sm font-bold text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed
              ${isThisLaunched 
                ? "bg-[#ef4444] hover:bg-[#dc2626]" 
                : "bg-[#22c55e] hover:bg-[#16a34a]"
              }`}>
            <IconPlayerPlay size={15} fill="currentColor" />
            {installStatus !== "" || installProgress > 0 ? "Installing" : isThisLaunched ? "Close" : "Play"}
          </button>
          <button onClick={onEdit} className="w-9 h-9 flex items-center justify-center rounded-[12px] border border-border text-muted hover:text-foreground hover:bg-white/5 transition-colors">
            <IconAdjustments size={17} />
          </button>
          <DotsDropdown onOpenFolder={onOpenFolder} onExport={onExport} />
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-border">
        {(["Content", "Files", "Worlds", "Logs"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={["flex items-center gap-1.5 px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
              activeTab === tab ? "bg-[#22c55e] text-black" : "text-muted hover:text-foreground hover:bg-white/5"].join(" ")}>
            {tab === "Content" && <span className="w-2 h-2 rounded-full bg-current opacity-80" />}
            {tab === "Files" && <IconFolderOpen size={13} />}
            {tab === "Worlds" && <IconBox size={13} />}
            {tab === "Logs" && (
              <span className="relative flex items-center">
                <IconTerminal2 size={13} />
                {instanceLogs.length > 0 && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
              </span>
            )}
            {tab}
            {tab === "Logs" && instanceLogs.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none"
                style={{ backgroundColor: activeTab === "Logs" ? "rgba(0,0,0,0.2)" : "rgba(34,197,94,0.15)", color: activeTab === "Logs" ? "black" : "#22c55e" }}>
                {instanceLogs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab !== "Logs" && activeTab !== "Worlds" && activeTab !== "Files" && (
        <>
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border flex-wrap">
            <div className="relative" style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 500 }}>
              <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${totalCount} projects...`}
                className="w-full pl-8 pr-3 py-2 rounded-[12px] border border-border bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-[#22c55e]/50 transition-colors"
                style={{ backgroundColor: "var(--color-surface)" }} />
            </div>
            <button onClick={onSwitchToDownload}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] text-sm font-semibold bg-[#22c55e] hover:bg-[#16a34a] text-black transition-colors flex-shrink-0">
              <IconSearch size={14} /> Browse content
            </button>
            <div className="flex items-center gap-1 ml-1">
              <IconFilter size={13} className="text-muted flex-shrink-0" />
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={["px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                    filter === f.key ? "bg-[#22c55e] text-black" : "text-muted hover:text-foreground border border-border"].join(" ")}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 ml-auto flex-shrink-0">
              <button onClick={loadMods} className="flex items-center gap-1.5 text-sm text-[#22c55e] hover:text-[#16a34a] transition-colors font-medium">
                <IconRefresh size={14} className={loadingMods ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
          </div>
          <div className="flex items-center px-5 py-2.5 border-b border-border">
            <div className="w-6 flex items-center justify-center mr-3 flex-shrink-0">
              <div className="w-4 h-4 rounded-[4px] border border-border bg-transparent hover:border-[#22c55e]/40 cursor-pointer transition-all" />
            </div>
            <div className="flex-1 text-xs font-semibold text-muted tracking-wide">Project</div>
            <div className="w-52 text-xs font-semibold text-muted tracking-wide">Version</div>
            <div className="w-28 text-xs font-semibold text-muted tracking-wide text-right">Actions</div>
          </div>
        </>
      )}

      {activeTab === "Files" && (
        <FilesTab instance={instance} />
      )}
      
      {activeTab === "Worlds" && (
        <WorldsTab instance={instance} />
      )}
    
      {activeTab !== "Logs" && activeTab !== "Worlds" && activeTab !== "Files" && (
        <div className="flex-1 overflow-y-auto">
          {loadingMods ? (
            <div className="flex items-center justify-center h-full opacity-30"><IconRefresh size={24} className="text-muted animate-spin" /></div>
          ) : filteredMods.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-full opacity-30">
              <IconBox size={36} className="text-muted" />
              <p className="text-sm text-muted">No content installed</p>
            </div>
          ) : (
            filteredMods.map(mod => (
              <div key={mod.id} className="flex flex-row items-stretch px-5 border-b border-border hover:bg-white/[0.025] transition-colors" style={{ minHeight: 64 }}>
                <div className="flex items-center justify-center w-6 mr-3 flex-shrink-0">
                  <div className="w-4 h-4 rounded-[4px] border border-border bg-transparent hover:border-[#22c55e]/40 cursor-pointer transition-all" />
                </div>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-[12px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: "var(--color-surface)" }}>
                    {mod.icon_url ? <img src={mod.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={20} className="text-muted" />}
                  </div>
                  <div className="min-w-0">
                    <p className={["text-sm font-semibold truncate", mod.enabled ? "text-foreground" : "text-muted line-through"].join(" ")}>{mod.name}</p>
                    {mod.author && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#22c55e]/20 flex items-center justify-center flex-shrink-0 text-[8px] text-[#22c55e]">✦</span>
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
                  {mod.has_download && <IconDownload size={15} className="text-[#22c55e]" />}
                  {mod.has_update && <IconRefresh size={15} className="text-[#22c55e]" />}
                  <ToggleSwitch enabled={mod.enabled} onChange={v => handleToggleMod(mod, v)} />
                  <button onClick={() => handleDeleteMod(mod)} className="text-muted hover:text-danger transition-colors"><IconTrash size={15} /></button>
                  <button className="text-muted hover:text-foreground transition-colors"><IconDotsVertical size={15} /></button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "Logs" && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-2 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted">
              <IconTerminal2 size={13} />
              <span>{instanceLogs.length} lines</span>
            </div>
            <button onClick={() => setInstanceLogger([])} className="text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1">
              <IconTrash size={12} /> Clear
            </button>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto bg-black font-mono text-xs">
            {instanceLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
                <IconTerminal2 size={36} className="text-green-500" />
                <p className="text-sm font-sans text-muted">Waiting for instance logs...</p>
              </div>
            ) : (
              instanceLogs.map((log, i) => (
                <div key={i}
                  className={["w-full px-4 py-0.5 first:pt-3 last:pb-3 leading-relaxed",
                    i % 2 === 0 ? "bg-white/[0.02]" : "",
                    log.type === "error" ? "text-red-400" : "text-green-400/80",
                  ].join(" ")}>
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InstanceDownloadView({ instance, onBack }: { instance: LocalInstance; onBack: () => void }) {
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

  useEffect(() => {
    const loadInstalled = async () => {
      try {
        const mods = await invoke<InstalledMod[]>("get_installed_mods", {
          instanceId: instance.id,
          projectType: tab,
        });
        setInstalledFilenames(new Set(mods.map(m => m.id.toLowerCase())));
      } catch {}
    };
    loadInstalled();
  }, [instance.id, tab]);

  const install = async (hit: ModrinthHit, versionId?: string) => {
    setInstalling(hit.slug);
    try {
      if (source === "curseforge") {
        await invoke("curseforge_install", {
          instanceId: instance.id,
          modId: hit.project_id,
          projectType: tab,
          gameVersion: instance.minecraft_version,
        });
      } else {
        await invoke("modrinth_install", {
          instanceId: instance.id,
          slug: hit.slug,
          projectType: tab,
          gameVersion: instance.minecraft_version,
          loader: effectiveLoaderForSearch,
          versionId: versionId ?? null,
        });
      }
      setInstalledFilenames(prev => new Set([...prev, hit.slug.toLowerCase()]));
      toast(`"${hit.title}" installed successfully`);
    } catch (e) {
      toast.danger("Error installing", { description: String(e) });
    } finally {
      setInstalling(null);
    }
  };

  useEffect(() => { setPage(0); setResults([]); }, [tab, source]);
  useEffect(() => { search(page); }, [page, tab, sortBy, viewCount, source]);
  const handleSearch = () => { setPage(0); search(0); };

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
        const params = new URLSearchParams({
          gameId: String(CF_GAME_ID),
          classId: String(classId),
          pageSize: String(viewCount),
          index: String(currentPage),
          sortField: String(sortField),
        });
        if (query.trim()) params.set("searchFilter", query.trim());
        if (instance.minecraft_version) params.set("gameVersion", instance.minecraft_version);
        const res = await fetch(`https://api.curseforge.com/v1/mods/search?${params}`, {
          headers: { "x-api-key": CF_API_KEY, "Accept": "application/json" },
        });
        if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
        const data = await res.json();
        setResults((data.data ?? []).map(cfModToHit));
        setTotalHits(data.pagination?.totalCount ?? 0);
      }
    } catch (e: any) {
      setError(`Search error: ${e?.message || "unknown"}`);
      setTotalHits(0);
    } finally { setLoading(false); }
  };

  const CONTENT_TYPE_TABS = [
    { label: "Mods", type: "mod" as ProjectType },
    { label: "Resource Packs", type: "resourcepack" as ProjectType },
    { label: "Data Packs", type: "datapack" as ProjectType },
    { label: "Shaders", type: "shader" as ProjectType },
  ];
  const pageItems = getPageItems(page + 1, totalPages);

  if (selectedHit && source === "modrinth") {
    return (
      <ModrinthDetailView
        hit={selectedHit}
        installedSlugs={installedFilenames}
        onBack={() => setSelectedHit(null)}
        onInstall={async (hit, versionId) => {
          await install(hit, versionId);
          setSelectedHit(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col w-full h-full" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-[15px] overflow-hidden border border-border flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: "var(--color-surface)" }}>
            {iconUrl ? <img src={iconUrl} className="w-full h-full object-cover" alt="" /> : <span>{LOADER_EMOJI[instance.loader as Loader] ?? "📦"}</span>}
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">{instance.title}</h1>
            <p className="text-xs text-muted">{instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1)} {instance.minecraft_version}</p>
          </div>
        </div>
        <button onClick={onBack} className="flex items-center gap-2 px-3 py-1.5 rounded-[12px] border border-border text-sm text-foreground hover:bg-white/5 transition-colors">
          <IconArrowLeft size={14} /> Back to instance
        </button>
      </div>

      <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Install content to instance</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSource("modrinth")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border transition-all",
              source === "modrinth"
                ? "bg-[#1bd96a]/15 border-[#1bd96a]/40 text-[#1bd96a]"
                : "border-border text-muted hover:text-foreground"].join(" ")}>
            <span className="w-2 h-2 rounded-full bg-[#1bd96a]" />
            Modrinth
          </button>
          <button
            onClick={() => setSource("curseforge")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold border transition-all",
              source === "curseforge"
                ? "bg-[#f16436]/15 border-[#f16436]/40 text-[#f16436]"
                : "border-border text-muted hover:text-foreground"].join(" ")}>
            <span className="w-2 h-2 rounded-full bg-[#f16436]" />
            CurseForge
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-5 py-2 border-b border-border">
        {CONTENT_TYPE_TABS.map(t => (
          <button key={t.type} onClick={() => setTab(t.type)}
            className={["px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all",
              tab === t.type
                ? source === "curseforge" ? "bg-[#f16436] text-white" : "bg-[#22c55e] text-black"
                : "text-muted hover:text-foreground"].join(" ")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border">
        <div className="relative flex-1 max-w-lg">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder={`Search ${tab === "mod" ? "mods" : tab === "resourcepack" ? "resource packs" : tab === "datapack" ? "data packs" : "shaders"} on ${source === "curseforge" ? "CurseForge" : "Modrinth"}...`}
            className="w-full pl-8 pr-3 py-1.5 rounded-[12px] border border-border bg-transparent text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors"
            style={{ backgroundColor: "var(--color-surface)" }} />
        </div>
        <SimpleDropdown label="Sort by" value={sortBy} options={SORT_OPTIONS} onChange={v => { setSortBy(v); setPage(0); }} />
        <SimpleDropdown label="View" value={String(viewCount)} options={VIEW_OPTIONS} onChange={v => { setViewCount(Number(v)); setPage(0); }} />
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={loading || page === 0}
            className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors">
            <IconChevronLeft size={13} />
          </button>
          {pageItems.map((item, idx) =>
            item === "dots" ? <span key={`d${idx}`} className="text-xs text-muted px-1">...</span> : (
              <button key={item} onClick={() => setPage((item as number) - 1)} disabled={loading}
                className={["w-7 h-7 rounded-[8px] text-xs font-semibold transition-all",
                  item === page + 1
                    ? source === "curseforge" ? "bg-[#f16436] text-white" : "bg-[#22c55e] text-black"
                    : "text-muted hover:text-foreground"].join(" ")}>
                {item}
              </button>
            )
          )}
          <button onClick={() => setPage(p => p + 1)} disabled={loading || page >= totalPages - 1}
            className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-border text-muted hover:text-foreground disabled:opacity-30 transition-colors">
            <IconChevronRight size={13} />
          </button>
        <div className="flex items-center gap-1 ml-auto">
        </div>
      </div>

      <div className="flex items-center gap-2 px-5 py-2 border-b border-border">
        <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border border-border text-muted">
          <IconBox size={11} /> {instance.minecraft_version}
        </span>
        {effectiveLoader && (
          <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border border-border text-muted">
            <IconBox size={11} /> {effectiveLoader.charAt(0).toUpperCase() + effectiveLoader.slice(1)}
          </span>
        )}
        <span className={["flex items-center gap-1 text-xs px-2 py-1 rounded-[8px] border font-medium",
          source === "curseforge" ? "border-[#f16436]/30 text-[#f16436] bg-[#f16436]/5" : "border-[#1bd96a]/30 text-[#1bd96a] bg-[#1bd96a]/5"].join(" ")}>
          {source === "curseforge" ? "CurseForge" : "Modrinth"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center py-12"><span className="text-xs text-muted">Searching...</span></div>}
        {error && <div className="mx-5 mt-4 px-3 py-2 rounded-[12px] bg-danger/10 border border-danger/20 text-xs text-danger">{error}</div>}
        {!loading && !error && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
            <IconSearch size={32} className="text-muted" />
            <p className="text-sm text-muted">No results found</p>
          </div>
        )}
        {!loading && results.map(hit => {
          const isInstalled = installedFilenames.has(hit.slug.toLowerCase());
          return (
            <div key={hit.project_id}
              className="flex items-center gap-4 px-5 py-4 border-b border-border hover:bg-white/[0.02] transition-colors cursor-pointer"
              onClick={() => source === "modrinth" && setSelectedHit(hit)}>
              <div className="w-14 h-14 rounded-[15px] border border-border overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: "var(--color-surface)" }}>
                {hit.icon_url ? <img src={hit.icon_url} className="w-full h-full object-cover" alt="" /> : <IconBox size={22} className="text-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{hit.title}</p>
                  <span className="text-xs text-muted">by {hit.author}</span>
                </div>
                <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{hit.description}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-muted"><IconDownload size={10} /> {formatDownloads(hit.downloads)}</span>
                  {hit.date_modified && <span className="text-[10px] text-muted">{timeAgo(hit.date_modified)}</span>}
                  {hit.categories.slice(0, 2).map(cat => (
                    <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted capitalize">{cat}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (!isInstalled) {
                      if (source === "modrinth") setSelectedHit(hit);
                      else install(hit);
                    }
                  }}
                  disabled={installing === hit.slug || isInstalled}
                  className={["flex items-center gap-1.5 px-4 py-1.5 rounded-[12px] text-sm font-semibold border-2 transition-all",
                    isInstalled
                      ? "border-[#22c55e]/30 text-[#22c55e] bg-[#22c55e]/10 cursor-default"
                      : installing === hit.slug
                        ? "border-border text-muted cursor-not-allowed"
                        : source === "curseforge"
                          ? "border-[#f16436] text-[#f16436] hover:bg-[#f16436] hover:text-white"
                          : "border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e] hover:text-black"
                  ].join(" ")}>
                  {isInstalled
                    ? <><IconCheck size={14} /> Installed</>
                    : installing === hit.slug
                      ? "Installing..."
                      : <><IconPlus size={14} /> Install</>}
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
  const { fetchInstances, setInstances: setContextInstances } = useInstance();
  const [instances, setInstances] = useState<LocalInstance[]>([]);
  const [selectedId, setLocalSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<LocalInstance | null>(null);
  const [exportTarget, setExportTarget] = useState<LocalInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<AppView>("grid");
  const [instanceTab, setInstanceTab] = useState<InstanceTab>("all");
  
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const handleOpenLocal = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setLocalSelectedId(id);
      setSelectedId(id);
      setView("instance-content");
    };
    window.addEventListener("open-local-instance", handleOpenLocal);

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
          setLocalSelectedId(inst.id);
          setSelectedId(inst.id);
          fetchInstances();
          setView("instance-content");
          toast(`Instance "${inst.title}" imported successfully`);
        } catch (_) {}
      });
      emit("frontend-ready");
    })();

    return () => {
      unlisten?.();
      window.removeEventListener("open-local-instance", handleOpenLocal);
    };
  }, []);

  const selected = instances.find(i => i.id === selectedId) ?? instances[0] ?? null;

  const selectInstance = (id: string) => {
    setLocalSelectedId(id);
    setSelectedId(id);
    setView("instance-content");
  };

  const handleCreated = (inst: LocalInstance) => {
    setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
    setLocalSelectedId(inst.id);
    setSelectedId(inst.id);
    fetchInstances();
    toast(`Instance "${inst.title}" created`);
  };

  const handleInstalled = (inst: LocalInstance) => {
    setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
    fetchInstances();
  };

  const handleSaved = (updated: LocalInstance) => {
    setInstances(prev => prev.map(i => i.id === updated.id ? updated : i));
    fetchInstances();
    toast("Changes saved");
  };

  const handleDeleted = (id: string) => {
    setInstances(prev => {
      const next = prev.filter(i => i.id !== id);
      setLocalSelectedId(next[0]?.id ?? null);
      setContextInstances(next as any);  
      return next;
    });
    setView("grid"); 
    fetchInstances();
    toast.danger("Instance deleted");
  };

  const handleImport = async () => {
      try {
        const picked = await open({
          multiple: false,
          filters: [{ 
            name: "Modpack", 
            extensions: ["mrstack", "mrpack", "zip"] 
          }]
        });
        if (!picked || typeof picked !== "string") return;
        const inst = await invoke<LocalInstance>("import_mrstack", { mrstackPath: picked });
        setInstances(prev => [inst, ...prev.filter(i => i.id !== inst.id)]);
        setLocalSelectedId(inst.id);
        setSelectedId(inst.id);
        fetchInstances();
        toast(`Instance "${inst.title}" imported successfully`);
      } catch (e) {
        if (!String(e).includes("cancelled")) toast.danger("Error importing", { description: String(e) });
      }
  };

  if (loading) {
    return <div className="w-full h-full flex items-center justify-center"><span className="text-xs text-muted">Loading...</span></div>;
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {view === "grid" && (
        <InstancesGridView
          instances={instances}
          activeTab={instanceTab}
          setActiveTab={setInstanceTab}
          onSelect={selectInstance}
          onCreateClick={() => setShowCreate(true)}
          onImportClick={handleImport}
          onInstalled={handleInstalled}
        />
      )}
      {view === "instance-content" && selected && (
        <InstanceContentView
          instance={selected}
          onBackToMenu={() => setView("grid")}
          onSwitchToDownload={() => setView("instance-download")}
          onEdit={() => setEditTarget(selected)}
          onExport={() => setExportTarget(selected)}
          onOpenFolder={async () => {
            try { await invoke("open_local_instance_folder", { id: selected.id }); }
            catch (e) { toast.danger("Could not open folder", { description: String(e) }); }
          }}
        />
      )}
      {view === "instance-download" && selected && (
        <InstanceDownloadView instance={selected} onBack={() => setView("instance-content")} />
      )}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />}
      {editTarget && <EditModal instance={editTarget} onClose={() => setEditTarget(null)} onSave={handleSaved} onDelete={handleDeleted} />}
      {exportTarget && <ExportModal instance={exportTarget} onClose={() => setExportTarget(null)} />}
    </div>
  );
}