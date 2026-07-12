import { type ReactNode, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
import { useAuth } from "../stores/authContext";
import { useModstack } from "../stores/modstackContext";
import { useLauncherTranslation, TranslationKey } from "../utils/languageContext";
import { useNavigation } from "../hooks/useNavigation";
import { useInstancesNav } from "../utils/instancesNavStore";
import { useFriendsPanel } from "../utils/friendsPanelStore";
import { fetchServers, MinecraftServer } from "../utils/anyserver";
import { fetchModrinthServers } from "../utils/modrinth";
import { loadLocalInstances, type LocalInstance } from "../utils/localInstances";
import { avatarUrl } from "../utils/modstack";
import HomeSidebar from "../components/HomeSidebar";
import {
  IconBox,
  IconDownload,
  IconUsers,
  IconUser,
  IconLibrary,
  IconServer,
  IconRefresh,
  IconLayoutGrid,
  IconStopwatch,
  IconDotsVertical,
  IconCopy,
  IconPlayerPlay,
  IconX,
  IconAlertCircle,
  IconPlus,
  IconMessage,
  IconTrash,
  IconChevronRight,
} from "@tabler/icons-react";



const MODRINTH_HEADERS = {
  "User-Agent": "modstack-launcher/1.0 (github.com/user/modstack)",
  Accept: "application/json",
};

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  author: string;
  gallery?: string[];
  featured_gallery?: string | null;
}

interface HomeStats {
  total: number;
  played: number;
  withMods: number;
  avgSessionMinutes: number;
}

function formatCount(n: number) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function formatSessionAvg(minutes: number) {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function mergeServers(a: MinecraftServer[], b: MinecraftServer[], limit: number) {
  const merged: MinecraftServer[] = [];
  let ai = 0,
    bi = 0;
  while (merged.length < limit && (ai < a.length || bi < b.length)) {
    if (ai < a.length) merged.push(a[ai++]);
    if (merged.length < limit && bi < b.length) merged.push(b[bi++]);
  }
  return merged;
}

function versionToParts(version: string) {
  return version.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
}

function compareVersions(a: string, b: string) {
  const pa = versionToParts(a);
  const pb = versionToParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isCompatibleVersion(instanceVersion: string, serverVersion?: string | null) {
  if (!serverVersion) return true;
  const clean = serverVersion.trim();
  if (!clean) return true;
  if (clean.includes("-")) {
    const [from, to] = clean.split("-").map((v) => v.trim());
    if (from && compareVersions(instanceVersion, from) < 0) return false;
    if (to && compareVersions(instanceVersion, to) > 0) return false;
    return true;
  }
  return clean.split(/[,\s/]+/).some((v) => v && compareVersions(instanceVersion, v) === 0);
}

function SectionLinkTitle({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-fit inline-flex items-center gap-1 text-foreground text-lg font-semibold leading-tight transition-colors duration-150 hover:text-[#4b77e7] focus-visible:outline-none focus-visible:text-[#4b77e7]"
    >
      <span className="underline-offset-4 group-hover:underline group-focus-visible:underline">
        {children}
      </span>
      <IconChevronRight
        size={18}
        strokeWidth={2.25}
        className="opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
      />
    </button>
  );
}

function ModpackCard({
  hit,
  onInstall,
  installing,
  disabled,
}: {
  hit: ModrinthHit;
  onInstall: (hit: ModrinthHit) => void;
  installing?: boolean;
  disabled?: boolean;
}) {
  const bannerUrl = hit.featured_gallery ?? hit.gallery?.[0] ?? hit.icon_url;

  return (
    <button
      onClick={() => !disabled && onInstall(hit)}
      disabled={disabled}
      className="group text-left rounded-[14px] overflow-hidden border transition-all duration-200 ease-out hover:border-white/20 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="relative z-0 h-32 w-full" style={{ background: "var(--color-surface-secondary)" }}>
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <IconBox className="text-muted" size={28} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        <div
          className="absolute top-2 right-2 z-20 w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-sm transition-transform duration-200 group-hover:scale-110"
          style={{ background: "rgba(0,0,0,0.5)" }}
          title={installing ? "Instalando…" : "Ver detalle"}
        >
          <IconRefresh size={12} className={`text-white/80 ${installing ? "animate-spin" : ""}`} />
        </div>

        <div
          className="absolute -bottom-4 left-3 z-20 w-10 h-10 rounded-[10px] border-[3px] overflow-hidden flex items-center justify-center transition-transform duration-200 group-hover:scale-105"
          style={{ borderColor: "var(--color-surface)", background: "var(--color-surface-secondary)" }}
        >
          {hit.icon_url ? (
            <img src={hit.icon_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <IconBox size={14} className="text-muted" />
          )}
        </div>
      </div>
      <div className="relative z-10 pt-6 px-3 pb-3 flex flex-col gap-1">
        <h3
          className="text-sm font-bold truncate transition-colors duration-200 group-hover:brightness-125"
          style={{ color: "var(--color-accent)" }}
        >
          {hit.title}
        </h3>
        <p className="text-xs text-muted line-clamp-2 leading-snug min-h-[2.2em]">{hit.description}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-[11px] text-muted truncate">
            <IconUser size={11} />
            {hit.author}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted shrink-0">
            {installing ? "Instalando…" : (
              <>
                <IconDownload size={11} />
                {formatCount(hit.downloads)}
              </>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

function ModpackCardSkeleton() {
  return (
    <div
      className="rounded-[14px] overflow-hidden border animate-pulse"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="h-32 w-full" style={{ background: "var(--color-surface-secondary)" }} />
      <div className="pt-6 px-3 pb-3 flex flex-col gap-2">
        <div className="h-3.5 w-2/3 rounded" style={{ background: "var(--color-surface-secondary)" }} />
        <div className="h-2.5 w-full rounded" style={{ background: "var(--color-surface-secondary)" }} />
        <div className="h-2.5 w-1/2 rounded" style={{ background: "var(--color-surface-secondary)" }} />
      </div>
    </div>
  );
}

function ServerCard({
  server,
  onPlay,
  onCopy,
  onOpenBrowser,
}: {
  server: MinecraftServer;
  onPlay: (server: MinecraftServer) => void;
  onCopy: (server: MinecraftServer) => void;
  onOpenBrowser: (server: MinecraftServer) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [open, setOpen] = useState(false);
  const tag = server.tags?.[0];
  return (
    <div
      className="group relative flex items-center gap-3 px-3 py-2.5 rounded-[12px] border cursor-pointer transition-all duration-200 ease-out hover:bg-white/5 hover:border-white/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      onClick={() => onPlay(server)}
    >
      <div
        className="w-9 h-9 rounded-[8px] overflow-hidden flex items-center justify-center shrink-0 border transition-transform duration-200 group-hover:scale-105"
        style={{ background: "var(--color-surface-secondary)", borderColor: "var(--color-border)" }}
      >
        {server.icon_url && !imgError ? (
          <img src={server.icon_url} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <IconServer size={16} className="text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate text-foreground transition-colors duration-200 group-hover:text-accent" style={{ color: undefined }}>
            {server.name}
          </span>
          {tag && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0"
              style={{ color: "var(--color-accent)", background: "color-mix(in srgb, var(--color-accent) 15%, transparent)" }}
            >
              {tag}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-xs text-muted">
            <IconUsers size={12} />
            {server.players.online.toLocaleString()}
          </span>
          <span className="text-xs text-muted px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface-secondary)" }}>
            {server.version}
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        className="w-8 h-8 rounded-[9px] flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5 transition-colors"
        aria-label="Menu del servidor"
      >
        <IconDotsVertical size={15} />
      </button>
      {open && (
        <div
          className="absolute right-2 top-11 z-30 w-48 rounded-[12px] border shadow-2xl overflow-hidden p-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-overlay)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setOpen(false); onPlay(server); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[9px] text-xs text-foreground hover:bg-white/5 text-left"
          >
            <IconPlayerPlay size={13} /> Jugar
          </button>
          <button
            onClick={() => { setOpen(false); onCopy(server); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[9px] text-xs text-foreground hover:bg-white/5 text-left"
          >
            <IconCopy size={13} /> Copiar IP
          </button>
          <button
            onClick={() => { setOpen(false); onOpenBrowser(server); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[9px] text-xs text-foreground hover:bg-white/5 text-left"
          >
            <IconServer size={13} /> Ver detalles
          </button>
        </div>
      )}
    </div>
  );
}

function ServerCardSkeleton() {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-[12px] border animate-pulse"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="w-9 h-9 rounded-[8px] shrink-0" style={{ background: "var(--color-surface-secondary)" }} />
      <div className="flex-1 flex flex-col gap-2">
        <div className="h-3 w-1/3 rounded" style={{ background: "var(--color-surface-secondary)" }} />
        <div className="h-2.5 w-1/4 rounded" style={{ background: "var(--color-surface-secondary)" }} />
      </div>
    </div>
  );
}

function StatCard({ icon, value, label, loading }: { icon: React.ReactNode; value: string; label: string; loading?: boolean }) {
  return (
    <div
      className="group rounded-[10px] border px-3 py-2 flex items-center gap-2 transition-all duration-200 ease-out hover:border-white/20 min-w-[120px]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div
        className="w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0"
        style={{ background: "var(--color-surface-secondary)" }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className={`text-foreground text-sm font-bold leading-none ${loading ? "opacity-40" : ""}`}>{value}</div>
        <div className="text-muted text-[9px] font-medium tracking-widest uppercase mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

function FriendAvatar({ avatar, username, size = 36 }: { avatar: string | null; username: string; size?: number }) {
  const url = avatarUrl(avatar);
  if (url) {
    return (
      <img
        src={url}
        alt={username}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, background: "var(--color-surface-secondary)" }}
      className="rounded-full flex items-center justify-center text-foreground font-bold shrink-0"
    >
      {username.charAt(0).toUpperCase()}
    </div>
  );
}

function FriendStatusDot({ status }: { status: string }) {
  const color =
    status === "playing" ? "bg-emerald-400" : status === "online" ? "bg-sky-400" : "bg-white/25";
  return <span className={`inline-block size-2 rounded-full ${color} shrink-0`} />;
}

function friendStatusLabel(friend: any, t: (key: TranslationKey) => string) {
  if (friend.status === "playing") return `${t("friends.playing")} ${friend.activity ?? ""}`.trim();
  if (friend.status === "online") return t("friends.online");
  return t("friends.offline");
}

function FriendsCard({
  friends,
  onOpenFriends,
  onOpenChat,
  onRemoveFriend,
}: {
  friends: any[];
  onOpenFriends: () => void;
  onOpenChat: (id: string) => void;
  onRemoveFriend: (id: string) => void;
}) {
  const t = useLauncherTranslation();
  const sorted = [...friends].sort((a, b) => {
    const rank = (s: string) => (s === "playing" ? 0 : s === "online" ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  return (
    <div
      className="rounded-[14px] border p-4 flex flex-col gap-1"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-center justify-between pb-2">
        <span className="text-foreground font-semibold text-sm">
          {t("home.friends") ?? "Amigos"} ({friends.length})
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted text-xs py-4 text-center">{t("friends.empty") ?? "Todavía no tenés amigos agregados."}</p>
      ) : (
        <div className="flex flex-col">
          {sorted.map((f) => (
            <div
              key={f.id}
              onClick={onOpenFriends}
              className="group flex items-center gap-2.5 py-2 rounded-[10px] px-1.5 -mx-1.5 transition-colors hover:bg-white/5 text-left"
            >
              <FriendAvatar avatar={f.avatar} username={f.username} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                  <FriendStatusDot status={f.status} /> {f.username}
                </p>
                <p className="text-xs text-muted truncate">{friendStatusLabel(f, t)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenChat(f.id); }}
                className="size-8 rounded-[8px] flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5"
                aria-label={t("friends.message")}
              >
                <IconMessage size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveFriend(f.id); }}
                className="size-8 rounded-[8px] flex items-center justify-center text-muted hover:text-danger hover:bg-white/5"
                aria-label={t("friends.removeFriend")}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const t = useLauncherTranslation();
  const { user } = useAuth();
  const { friends, removeFriend } = useModstack();

  const push = useNavigation((s) => s.push);
  const requestModpack = useInstancesNav((s) => s.requestModpack);
  const requestTab = useInstancesNav((s) => s.requestTab);
  const requestCreate = useInstancesNav((s) => s.requestCreate);
  const openFriendsPanel = useFriendsPanel((s) => s.open);

  const [modpacks, setModpacks] = useState<ModrinthHit[]>([]);
  const [loadingModpacks, setLoadingModpacks] = useState(true);

  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [localInstances, setLocalInstances] = useState<LocalInstance[]>([]);
  const [missingServer, setMissingServer] = useState<MinecraftServer | null>(null);

  const [stats, setStats] = useState<HomeStats>({ total: 0, played: 0, withMods: 0, avgSessionMinutes: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      'https://api.modrinth.com/v2/search?facets=%5B%5B%22project_type%3Amodpack%22%5D%5D&index=follows&limit=3',
      { headers: MODRINTH_HEADERS }
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setModpacks(data.hits ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingModpacks(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchServers({ sort: "most_players", limit: 10 }).catch(() => [] as MinecraftServer[]),
      fetchModrinthServers({ sort: "most_players", limit: 10 }).catch(() => [] as MinecraftServer[]),
    ])
      .then(([anyServers, modrinthServers]) => {
        if (!cancelled) setServers(mergeServers(anyServers, modrinthServers, 4));
      })
      .finally(() => {
        if (!cancelled) setLoadingServers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStats(true);
      try {
        const list = await loadLocalInstances();
        setLocalInstances(list);
        const playtimes = await Promise.all(
          list.map((i) => invoke<number>("get_instance_playtime", { instanceId: i.id }).catch(() => 0))
        );
        if (cancelled) return;
        const played = playtimes.filter((p) => p > 0).length;
        const totalSeconds = playtimes.reduce((a, b) => a + b, 0);
        const avgSessionMinutes = played > 0 ? Math.round(totalSeconds / played / 60) : 0;
        const withMods = list.filter((i) => i.loader !== "vanilla").length;
        setStats({ total: list.length, played, withMods, avgSessionMinutes });
      } catch (e) {
        console.error("Error loading home stats:", e);
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInstallModpack = (hit: ModrinthHit) => {
    requestModpack(hit);
    push("instances");
  };

  const handleExploreLibrary = () => {
    requestTab("all");
    push("instances");
  };

  const handleCopyServer = async (server: MinecraftServer) => {
    await navigator.clipboard.writeText(server.ip);
    toast("IP copiada", { description: server.ip });
  };

  const handleOpenServer = async (server: MinecraftServer) => {
    const compatible = localInstances.find((instance) => isCompatibleVersion(instance.minecraft_version, server.version));
    if (!compatible) {
      setMissingServer(server);
      return;
    }
    await handleCopyServer(server);
    toast("Listo para jugar", { description: `Usa ${compatible.title} (${compatible.minecraft_version}) para entrar.` });
  };

  const handleOpenServerBrowser = (_server: MinecraftServer) => {
    push("server_browser");
  };

  const handleOpenFriends = () => {
    openFriendsPanel();
  };

  const handleOpenFriendChat = (id: string) => {
    openFriendsPanel();
    window.dispatchEvent(new CustomEvent("open-friend-chat", { detail: { id } }));
  };

  const greetingName = (user as any)?.minecraft?.name ?? "Jugador";

  return (
    <div className="w-full h-full flex" style={{ background: "var(--color-background)" }}>
      <style>{`
        .custom-scroll { scrollbar-width: thin; scrollbar-color: var(--color-border) transparent; }
        .custom-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-muted); }
        @keyframes home-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: home-fade-in 150ms ease-out; }
      `}</style>

      <div className="flex-1 min-w-0 h-full">
        <div className="w-full h-full overflow-y-auto custom-scroll px-6 py-6">
          <div className="flex flex-col gap-8 pb-6">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-foreground text-[28px] font-bold leading-tight">
                  {t("home.greetingPrefix") ?? "Bienvenido a Modstack,"}{" "}
                  <span style={{ color: "var(--color-accent)" }}>{greetingName}</span>
                </h1>
                <p className="text-muted text-sm mt-1">{t("home.continueWhereLeftOff") ?? "Continúa donde lo dejaste."}</p>
              </div>

              <div className="flex items-stretch gap-3 shrink-0">
                <StatCard
                  icon={<IconLayoutGrid size={16} className="text-muted" />}
                  value={loadingStats ? "—" : String(stats.total)}
                  label={t("home.statInstances") ?? "Instancias"}
                  loading={loadingStats}
                />
                <StatCard
                  icon={<IconStopwatch size={16} className="text-muted" />}
                  value={loadingStats ? "—" : formatSessionAvg(stats.avgSessionMinutes)}
                  label={t("home.statAvgSession") ?? "Sesión promedio"}
                  loading={loadingStats}
                />
                <button
                  className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm border transition-all duration-200 ease-out shrink-0 hover:bg-white/5 hover:border-white/20 active:scale-[0.98]"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  onClick={handleExploreLibrary}
                >
                  <IconLibrary size={16} className="text-muted" />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-foreground font-medium text-xs">{t("home.exploreLibrary") ?? "Explorar biblioteca"}</span>
                    <span className="text-muted text-[10px]">{t("home.exploreInstances") ?? "Explorar tus instancias"}</span>
                  </span>
                </button>
              </div>
            </header>

            <section className="flex flex-col gap-3">
              <SectionLinkTitle onClick={handleExploreLibrary}>
                {t("home.exploreHub") ?? "Explorar centro de contenido"}
              </SectionLinkTitle>
              <div className="grid grid-cols-3 gap-4">
                {loadingModpacks
                  ? Array.from({ length: 3 }).map((_, i) => <ModpackCardSkeleton key={i} />)
                  : modpacks.map((mp) => (
                      <ModpackCard key={mp.project_id} hit={mp} onInstall={handleInstallModpack} />
                    ))}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-6 items-start">
              <section className="flex flex-col gap-3">
                <SectionLinkTitle onClick={() => push("server_browser")}>
                  {t("home.servers") ?? "Servidores"}
                </SectionLinkTitle>
                <div className="flex flex-col gap-2">
                  {loadingServers
                    ? Array.from({ length: 4 }).map((_, i) => <ServerCardSkeleton key={i} />)
                    : servers.map((s) => (
                        <ServerCard
                          key={`${s.source}-${s.id}`}
                          server={s}
                          onPlay={handleOpenServer}
                          onCopy={handleCopyServer}
                          onOpenBrowser={handleOpenServerBrowser}
                        />
                      ))}
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <SectionLinkTitle onClick={handleOpenFriends}>
                  {t("home.friendsSection") ?? "Amigos"}
                </SectionLinkTitle>
                <FriendsCard
                  friends={friends}
                  onOpenFriends={handleOpenFriends}
                  onOpenChat={handleOpenFriendChat}
                  onRemoveFriend={(id) => removeFriend(id).catch(() => {})}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
      {missingServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setMissingServer(null);
        }}>
          <div
            className="w-[420px] rounded-[16px] border shadow-2xl overflow-hidden"
            style={{ borderColor: "var(--color-border)", background: "var(--color-overlay)" }}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
              <div className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-[#4b77e7]/10 text-[#4b77e7]">
                <IconAlertCircle size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">
                  {t("home.missingServerTitle") ?? "No compatible instance found"}
                </p>
                <p className="text-xs text-muted truncate">
                  {missingServer.name} {t("home.missingServerNeeds") ?? "requires"} {missingServer.version || (t("home.compatibleVersion") ?? "a compatible version")}
                </p>
              </div>
              <button
                onClick={() => setMissingServer(null)}
                className="w-8 h-8 rounded-[9px] flex items-center justify-center text-muted hover:text-foreground hover:bg-white/5"
              >
                <IconX size={15} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs leading-relaxed text-muted">
                {t("home.missingServerDescription") ?? "No compatible/available instance was found to play on this server."}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
              <button
                onClick={() => setMissingServer(null)}
                className="px-4 py-2 rounded-[10px] text-xs border text-muted hover:text-foreground hover:bg-white/5"
                style={{ borderColor: "var(--color-border)" }}
              >
                {t("settings.cancel") ?? "Cancel"}
              </button>
              <button
                onClick={() => {
                  const version = missingServer.version?.includes("-") ? missingServer.version.split("-").pop()?.trim() : missingServer.version;
                  requestCreate({ version, name: missingServer.name });
                  setMissingServer(null);
                  push("instances");
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-xs font-semibold text-black"
                style={{ background: "#4b77e7" }}
              >
                <IconPlus size={13} /> {t("inst.create") ?? "Create instance"}
              </button>
            </div>
          </div>
        </div>
      )}
      <HomeSidebar />
    </div>
  );
}
