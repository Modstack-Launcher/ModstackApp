import { useEffect, useState, useTransition, useRef } from "react";
import {
  fetchServers,
  fetchServerDetails,
  MinecraftServer
} from "../utils/anyserver";
import {
  fetchModrinthServers,
  fetchModrinthServerDetails,
  fetchModrinthServerModpack,
  ModrinthServerModpack
} from "../utils/modrinth";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { toast } from "@heroui/react";
import { IconServer, IconSearch, IconCopy, IconCheck, IconExternalLink, IconX, IconNetwork, IconChevronDown, IconInfoCircle, IconDownload } from "@tabler/icons-react";
import { useLauncherTranslation } from "../utils/languageContext";

function mergeDefaultServers(anyServers: MinecraftServer[], modrinthServers: MinecraftServer[]): MinecraftServer[] {
  const merged: MinecraftServer[] = [];
  const topAnyCount = Math.min(anyServers.length, 10);
  for (let i = 0; i < topAnyCount; i++) merged.push(anyServers[i]);
  let anyIdx = topAnyCount, modIdx = 0;
  while (anyIdx < anyServers.length || modIdx < modrinthServers.length) {
    if (modIdx < modrinthServers.length) merged.push(modrinthServers[modIdx++]);
    if (anyIdx < anyServers.length) merged.push(anyServers[anyIdx++]);
  }
  return merged;
}

function getGameLabel(game: string, t: (k: any) => string) {
  switch (game) {
    case "mc_java": return t("sb.java");
    case "mc_bedrock": return t("sb.bedrock");
    case "mc_crossplay": return t("sb.crossplay");
    default: return "Minecraft";
  }
}

function getEditionClass(game: string) {
  switch (game) {
    case "mc_java": return "tag-java";
    case "mc_bedrock": return "tag-bedrock";
    case "mc_crossplay": return "tag-cross";
    default: return "";
  }
}

function SBDropdown({ label, value, options, onChange }: {
  label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 border border-border rounded-[12px] px-3 py-1.5 text-xs cursor-pointer hover:border-accent/40 transition-colors"
        style={{ backgroundColor: "var(--color-surface)" }}>
        <span className="text-muted">{label}: </span>
        <span className="text-foreground font-medium">{selected?.label ?? value}</span>
        <IconChevronDown size={12} className="text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-[12px] border border-border shadow-xl overflow-hidden min-w-[140px]"
          style={{ backgroundColor: "var(--color-overlay)" }}>
          {options.map(opt => (
            <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }}
              className={["w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-3",
                opt.value === value ? "text-[#4b77e7] bg-[#4b77e7]/10" : "text-foreground hover:bg-white/5"].join(" ")}>
              {opt.label}
              {opt.value === value && <IconCheck size={11} className="text-[#4b77e7] flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ServerBrowser() {
  const t = useLauncherTranslation();
  const [provider, setProvider] = useState<"default" | "anyserver" | "modrinth">("default");
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [sortFilter, setSortFilter] = useState("random");
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<MinecraftServer | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [installModal, setInstallModal] = useState<{ server: MinecraftServer; modpack: ModrinthServerModpack } | null>(null);
  const [loadingModpack, setLoadingModpack] = useState(false);

  const editionOptions = [
    { label: t("sb.allEditions"), value: "all" },
    { label: t("sb.java"), value: "mc_java" },
    { label: t("sb.bedrock"), value: "mc_bedrock" },
    { label: t("sb.crossplay"), value: "mc_crossplay" },
  ];

  const sortOptions = provider === "anyserver" ? [
    { label: t("sb.mostVotes"), value: "most_votes" },
    { label: t("sb.mostPlayers"), value: "most_players" },
    { label: t("sb.recentlyAdded"), value: "recent" },
    { label: t("sb.random"), value: "random" },
  ] : provider === "modrinth" ? [
    { label: t("sb.mostFollowers"), value: "most_votes" },
    { label: t("sb.mostDownloads"), value: "most_players" },
    { label: t("sb.recentlyAdded"), value: "recent" },
    { label: t("sb.relevance"), value: "random" },
  ] : [
    { label: t("sb.mostVotes"), value: "most_votes" },
    { label: t("sb.mostPlayers"), value: "most_players" },
    { label: t("sb.recentlyAdded"), value: "recent" },
    { label: t("sb.random"), value: "random" },
  ];

  const loadServers = async () => {
    setLoading(true); setError(null);
    try {
      let results: MinecraftServer[] = [];
      if (provider === "anyserver") {
        const res = await fetchServers({ game: gameFilter, sort: sortFilter, search: searchTerm, limit: 50 });
        results = res.map(s => ({ ...s, source: "anyserver" as const }));
      } else if (provider === "modrinth") {
        const res = await fetchModrinthServers({ game: gameFilter, sort: sortFilter, search: searchTerm, limit: 50 });
        results = res.map(s => ({ ...s, source: "modrinth" as const }));
      } else {
        let anyErr = false, modErr = false;
        const [anyRes, modRes] = await Promise.all([
          fetchServers({ game: gameFilter, sort: sortFilter, search: searchTerm, limit: 50 }).catch(e => { console.error(e); anyErr = true; return [] as MinecraftServer[]; }),
          fetchModrinthServers({ game: gameFilter, sort: sortFilter, search: searchTerm, limit: 50 }).catch(e => { console.error(e); modErr = true; return [] as MinecraftServer[]; }),
        ]);
        if (anyErr && modErr) throw new Error(t("sb.failedBoth"));
        if (anyErr) toast.danger("Warning", { description: t("sb.failedAnyserver") });
        if (modErr) toast.danger("Warning", { description: t("sb.failedModrinth") });
        results = mergeDefaultServers(
          anyRes.map(s => ({ ...s, source: "anyserver" as const })),
          modRes.map(s => ({ ...s, source: "modrinth" as const }))
        );
      }
      startTransition(() => setServers(results));
    } catch (err: any) {
      setError(err?.message || String(err));
      toast.danger(t("sb.errorLoading"), { description: err?.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadServers(); }, [gameFilter, sortFilter, provider]);

  const handleCopyIP = (ip: string, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(ip);
    setCopiedId(id);
    toast(t("sb.ipCopied"), { description: `"${ip}" ${t("sb.ipCopiedDesc")}` });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenDetails = async (server: MinecraftServer) => {
    console.log("[DEBUG] handleOpenDetails called. server.source =", server.source, "server =", server);
    if (server.source === "modrinth") {
      console.log("[DEBUG] source is modrinth, fetching modpack for id:", server.id);
      setLoadingModpack(true);
      try {
        const modpack = await fetchModrinthServerModpack(server.id);
        console.log("[DEBUG] fetchModrinthServerModpack returned:", modpack);
        if (modpack) {
          setInstallModal({ server, modpack });
          setLoadingModpack(false);
          return;
        }
      } catch (err) {
        console.error("[DEBUG] fetchModrinthServerModpack threw:", err);
      }
      setLoadingModpack(false);
    } else {
      console.log("[DEBUG] source is NOT modrinth, skipping modpack check entirely");
    }
    setModalOpen(true);
    setSelectedServer(server);
    setDetailsLoading(true);
    try {
      const detailed = server.source === "anyserver"
        ? await fetchServerDetails(server.id)
        : await fetchModrinthServerDetails(server.id);
      setSelectedServer({ ...detailed, source: server.source });
    } catch (e) { console.error(e); }
    finally { setDetailsLoading(false); }
  };

  const handleJoinFromDetails = async (server: MinecraftServer) => {
    console.log("[DEBUG] handleJoinFromDetails called. server.source =", server.source, "server =", server);
    if (server.source === "modrinth") {
      console.log("[DEBUG] source is modrinth, fetching modpack for id:", server.id);
      setLoadingModpack(true);
      try {
        const modpack = await fetchModrinthServerModpack(server.id);
        console.log("[DEBUG] fetchModrinthServerModpack returned:", modpack);
        if (modpack) {
          setModalOpen(false);
          setInstallModal({ server, modpack });
          setLoadingModpack(false);
          return;
        }
      } catch (err) {
        console.error("[DEBUG] fetchModrinthServerModpack threw:", err);
      }
      setLoadingModpack(false);
    } else {
      console.log("[DEBUG] source is NOT modrinth, skipping modpack check entirely");
    }
    handleCopyIP(server.ip, server.id);
    setModalOpen(false);
    toast(t("sb.readyToJoin"), { description: t("sb.copyJoinDesc") });
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0" style={{ backgroundColor: "var(--color-background)" }}>
      <style>{`
        .sb-prov { font-size: 12px; padding: 4px 12px; border-radius: 20px; border: 1px solid transparent; background: transparent; color: var(--color-muted, #888); cursor: pointer; transition: all 0.12s; }
        .sb-prov.active { background: var(--color-surface, #1a1a1a); border-color: var(--color-border, #333); color: var(--color-foreground, #fff); }
        .sb-prov:hover:not(.active) { color: var(--color-foreground, #fff); }
        .sb-search { width: 100%; padding: 6px 10px 6px 32px; font-size: 13px; border-radius: 12px; border: 1px solid var(--color-border, #333); background: var(--color-surface, #1a1a1a); color: var(--color-foreground, #fff); outline: none; box-sizing: border-box; }
        .sb-search:focus { border-color: #4b77e766; }
        .sb-card { background: #020803; border-bottom: 1px solid var(--color-border, #222); padding: 14px 20px; cursor: pointer; transition: background 0.1s; display: flex; align-items: center; gap: 14px; }
        .sb-card:hover { background: #0f182b; }
        .sb-icon { width: 38px; height: 38px; border-radius: 10px; background: var(--color-surface-secondary, #1a1a1a); border: 1px solid var(--color-border, #2a2a2a); display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; }
        .sb-icon img { width: 100%; height: 100%; object-fit: cover; }
        .sb-dot { width: 5px; height: 5px; border-radius: 50%; background: #4b77e7; flex-shrink: 0; display: inline-block; margin-right: 4px; }
        .sb-tag { font-size: 10px; padding: 2px 7px; border-radius: 20px; border: 1px solid var(--color-border, #333); color: var(--color-muted, #888); }
        .sb-tag.tag-java { color: #b45309; border-color: #b4530940; background: #fef3c708; }
        .sb-tag.tag-bedrock { color: #0e7490; border-color: #0e749040; background: #cffafe08; }
        .sb-tag.tag-cross { color: #15803d; border-color: #15803d40; background: #dcfce708; }
        .sb-copy-btn { font-size: 11px; padding: 3px 10px; border-radius: 20px; border: 1px solid var(--color-border, #333); background: transparent; color: var(--color-muted, #888); cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0; }
        .sb-copy-btn:hover { color: var(--color-foreground, #fff); border-color: #4b77e744; }
        .sb-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .sb-modal { background: var(--color-overlay, #111); border: 1px solid var(--color-border, #2a2a2a); border-radius: 16px; width: 100%; max-width: 500px; overflow: hidden; display: flex; flex-direction: column; max-height: 85vh; }
        .sb-stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; border-bottom: 1px solid var(--color-border, #222); }
        .sb-stat { padding: 14px; text-align: center; border-right: 1px solid var(--color-border, #222); }
        .sb-stat:last-child { border-right: none; }
        .sb-ip-box { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; background: var(--color-surface, #1a1a1a); border: 1px solid var(--color-border, #2a2a2a); margin-bottom: 12px; }
        .sb-join { font-size: 12px; padding: 6px 16px; border-radius: 20px; background: #4b77e7; color: #000; border: none; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 5px; }
        .sb-join:hover { background: #5377d0; }
        .sb-close { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--color-border, #2a2a2a); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--color-muted, #888); margin-left: auto; }
        .sb-close:hover { background: var(--color-surface, #1a1a1a); color: var(--color-foreground, #fff); }
      `}</style>

      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <IconServer size={15} style={{ color: "var(--color-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>{t("sb.title")}</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
            {provider === "default" ? t("sb.all") : provider === "anyserver" ? "AnyServer" : "Modrinth"}
          </span>
        </div>
        <div className="flex gap-1">
          {(["default", "anyserver", "modrinth"] as const).map(p => (
            <button key={p} className={`sb-prov ${provider === p ? "active" : ""}`} onClick={() => setProvider(p)}>
              {p === "default" ? t("sb.all") : p === "anyserver" ? "AnyServer" : "Modrinth"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 px-5 py-2.5 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="relative flex-1">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") loadServers(); }}
            placeholder={t("sb.searchPlaceholder")}
            className="sb-search"
          />
        </div>
        <SBDropdown label={t("sb.edition")} value={gameFilter} options={editionOptions} onChange={v => setGameFilter(v)} />
        <SBDropdown label={t("sb.sort")} value={sortFilter} options={sortOptions} onChange={v => setSortFilter(v)} />
        <button
          onClick={loadServers}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-xs font-semibold text-black"
          style={{ background: "#4b77e7" }}
          onMouseEnter={e => (e.currentTarget.style.background = "#5377d0")}
          onMouseLeave={e => (e.currentTarget.style.background = "#4b77e7")}
        >
          <IconSearch size={12} /> {t("sb.search")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex flex-col">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="sb-card" style={{ opacity: 0.4 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-surface-secondary)", flexShrink: 0 }} />
                <div className="flex-1 flex flex-col gap-2">
                  <div style={{ height: 12, borderRadius: 6, background: "var(--color-surface-secondary)", width: "40%" }} />
                  <div style={{ height: 10, borderRadius: 6, background: "var(--color-surface-secondary)", width: "65%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <IconServer size={32} style={{ color: "var(--color-muted)", opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>{t("sb.couldNotLoad")}</p>
            <p className="text-xs" style={{ color: "var(--color-muted)", maxWidth: 300 }}>{error}</p>
            <button onClick={loadServers} className="text-xs px-4 py-1.5 rounded-[10px] mt-1" style={{ border: "1px solid var(--color-border)", color: "var(--color-foreground)", background: "transparent" }}>
              {t("sb.tryAgain")}
            </button>
          </div>
        )}

        {!loading && !error && servers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <IconServer size={32} style={{ color: "var(--color-muted)", opacity: 0.4 }} />
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>{t("sb.noServers")}</p>
          </div>
        )}

        {!loading && !error && servers.map(server => (
          <div key={server.id} className="sb-card" onClick={() => handleOpenDetails(server)}>
            <div className="sb-icon">
              {server.icon_url
                ? <img src={server.icon_url} alt={server.name} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                : <IconServer size={16} style={{ color: "var(--color-muted)" }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate" style={{ color: "var(--color-foreground)" }}>{server.name}</span>
                <span className={`sb-tag ${getEditionClass(server.game)}`}>{getGameLabel(server.game, t)}</span>
                {server.source && (
                  <span className="sb-tag" style={{ color: server.source === "modrinth" ? "#1bd96a" : "#38bdf8", borderColor: server.source === "modrinth" ? "#1bd96a30" : "#38bdf830" }}>
                    {server.source === "modrinth" ? "Modrinth" : "AnyServer"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  <span className="sb-dot" />
                  {server.players.online.toLocaleString()} / {server.players.max.toLocaleString()} {t("sb.online").toLowerCase()}
                </span>
                <span className="text-xs truncate" style={{ color: "var(--color-muted)", maxWidth: 300 }}>{server.description}</span>
              </div>
            </div>
            <button className="sb-copy-btn" onClick={e => handleCopyIP(server.ip, server.id, e)}>
              {copiedId === server.id
                ? <><IconCheck size={11} style={{ color: "#4b77e7" }} /><span style={{ color: "#4b77e7" }}>{t("sb.copied")}</span></>
                : <><IconCopy size={11} /> {t("sb.copyIp")}</>
              }
            </button>
          </div>
        ))}
      </div>

      {loadingModpack && (
        <div className="sb-modal-overlay">
          <div style={{ width: 24, height: 24, border: "2px solid #4b77e7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        </div>
      )}

      {installModal && (
        <div className="sb-modal-overlay" onClick={() => setInstallModal(null)}>
          <div className="sb-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
                {t("sb.installToPlay")}
              </p>
              <button className="sb-close" onClick={() => setInstallModal(null)}>
                <IconX size={13} />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-[12px]" style={{ background: "#4b77e710", border: "1px solid #4b77e730" }}>
                <IconInfoCircle size={16} style={{ color: "#4b77e7", flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: "#4b77e7" }}>{t("sb.contentRequired")}</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                    {t("sb.contentRequiredDesc")}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-foreground)" }}>
                  {t("sb.requiredModpack")}
                </p>
                <div className="flex items-center gap-3 px-3 py-3 rounded-[12px]" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                  <div className="sb-icon" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}>
                    {installModal.modpack.icon_url
                      ? <img src={installModal.modpack.icon_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <IconServer size={18} style={{ color: "var(--color-muted)" }} />
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--color-foreground)" }}>
                      {installModal.modpack.title}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {installModal.modpack.loader.charAt(0).toUpperCase() + installModal.modpack.loader.slice(1)} {installModal.modpack.version}
                      {installModal.modpack.mod_count ? ` · ${installModal.modpack.mod_count} mods` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--color-border)" }}>
              <button
                onClick={() => setInstallModal(null)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-xs border transition-colors"
                style={{ background: "transparent", borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <IconX size={13} /> {t("inst.cancel")}
              </button>
              <button
                onClick={() => {
                  handleCopyIP(installModal.server.ip, installModal.server.id);
                  setInstallModal(null);
                  toast(t("sb.readyToJoin"), { description: t("sb.copyJoinDesc") });
                }}
                className="flex items-center gap-1.5 px-5 py-2 rounded-[10px] text-xs font-semibold text-black transition-colors"
                style={{ background: "#4b77e7" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#5377d0")}
                onMouseLeave={e => (e.currentTarget.style.background = "#4b77e7")}
              >
                <IconDownload size={13} /> {t("sb.install")}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && selectedServer && (
        <div className="sb-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="sb-modal" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="sb-icon">
                {selectedServer.icon_url
                  ? <img src={selectedServer.icon_url} alt={selectedServer.name} />
                  : <IconServer size={16} style={{ color: "var(--color-muted)" }} />
                }
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-foreground)" }}>{selectedServer.name}</p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {selectedServer.source === "modrinth" ? "Modrinth" : "AnyServer.pro"} · {getGameLabel(selectedServer.game, t)}
                </p>
              </div>
              <button className="sb-close" onClick={() => setModalOpen(false)}>
                <IconX size={13} />
              </button>
            </div>

            <div className="sb-stat-grid">
              <div className="sb-stat">
                <p className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>{selectedServer.players.online.toLocaleString()}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{t("sb.online")}</p>
              </div>
              <div className="sb-stat">
                <p className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>{selectedServer.players.max.toLocaleString()}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{t("sb.capacity")}</p>
              </div>
              <div className="sb-stat">
                <p className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>{selectedServer.votes?.toLocaleString() ?? "—"}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{selectedServer.source === "anyserver" ? t("sb.votes") : t("sb.followers")}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div style={{ width: 20, height: 20, border: "2px solid #4b77e7", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                </div>
              ) : (
                <>
                  <div className="sb-ip-box">
                    <IconNetwork size={13} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
                    <span className="text-xs flex-1 truncate" style={{ fontFamily: "monospace", color: "var(--color-foreground)" }}>{selectedServer.ip}</span>
                    <button className="sb-copy-btn" onClick={() => handleCopyIP(selectedServer.ip, selectedServer.id)}>
                      {copiedId === selectedServer.id
                        ? <><IconCheck size={11} style={{ color: "#4b77e7" }} /><span style={{ color: "#4b77e7" }}>{t("sb.copied")}</span></>
                        : <><IconCopy size={11} /> {t("sb.copyIp")}</>
                      }
                    </button>
                  </div>

                  <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--color-muted)" }}>{selectedServer.description}</p>

                  {selectedServer.tags && selectedServer.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedServer.tags.map(tag => (
                        <span key={tag} className="sb-tag">{tag}</span>
                      ))}
                    </div>
                  )}

                  {selectedServer.reviews && selectedServer.reviews.length > 0 && (
                    <div className="mt-4 flex flex-col gap-2">
                      <p className="text-xs font-medium mb-1" style={{ color: "var(--color-foreground)" }}>{t("sb.reviews")}</p>
                      {selectedServer.reviews.map((rev, i) => (
                        <div key={i} className="px-3 py-2.5 rounded-[10px]" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>{rev.author}</span>
                            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{rev.date}</span>
                          </div>
                          <p className="text-xs italic" style={{ color: "var(--color-muted)" }}>"{rev.text}"</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid var(--color-border)" }}>
              <button
                className="flex items-center gap-1 text-xs"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#4b77e7", padding: 0 }}
                onClick={() => {
                  const url = selectedServer.source === "anyserver"
                    ? `https://anyserver.pro/server/${selectedServer.id}`
                    : `https://modrinth.com/server/${selectedServer.id}`;
                  openShell(url).catch(console.error);
                }}
              >
                {selectedServer.source === "anyserver" ? t("sb.voteOn") : t("sb.viewOn")}
                <IconExternalLink size={11} />
              </button>
              <button
                className="sb-join"
                onClick={() => handleJoinFromDetails(selectedServer)}
              >
                <IconServer size={12} /> {t("sb.copyJoin")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}