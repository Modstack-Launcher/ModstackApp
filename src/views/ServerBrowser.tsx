import { useEffect, useState, useTransition } from "react";
import { 
  fetchServers, 
  fetchServerDetails, 
  MinecraftServer 
} from "../utils/anyserver";
import {
  fetchModrinthServers,
  fetchModrinthServerDetails
} from "../utils/modrinth";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { 
  Button, 
  Input, 
  toast,
  Autocomplete,
  ListBox
} from "@heroui/react";
import { 
  Search, 
  Server, 
  Copy, 
  Check, 
  ExternalLink, 
  ThumbsUp, 
  Users, 
  Globe,
  Info,
  X
} from "lucide-react";

function mergeDefaultServers(anyServers: MinecraftServer[], modrinthServers: MinecraftServer[]): MinecraftServer[] {
  const merged: MinecraftServer[] = [];
  const topAnyCount = Math.min(anyServers.length, 10);
  
  for (let i = 0; i < topAnyCount; i++) {
    merged.push(anyServers[i]);
  }
  
  let anyIdx = topAnyCount;
  let modIdx = 0;
  
  while (anyIdx < anyServers.length || modIdx < modrinthServers.length) {
    if (modIdx < modrinthServers.length) {
      merged.push(modrinthServers[modIdx++]);
    }
    if (anyIdx < anyServers.length) {
      merged.push(anyServers[anyIdx++]);
    }
  }
  return merged;
}

export default function ServerBrowser() {
  const [provider, setProvider] = useState<"default" | "anyserver" | "modrinth">("default");
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [sortFilter, setSortFilter] = useState("random");
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detail Modal State
  const [selectedServer, setSelectedServer] = useState<MinecraftServer | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Debounced search / filter transition
  const [, startTransition] = useTransition();

  const loadServers = async () => {
    setLoading(true);
    setError(null);
    try {
      let results: MinecraftServer[] = [];
      if (provider === "anyserver") {
        const res = await fetchServers({
          game: gameFilter,
          sort: sortFilter,
          search: searchTerm,
          limit: 50,
        });
        results = res.map(s => ({ ...s, source: "anyserver" as const }));
      } else if (provider === "modrinth") {
        const res = await fetchModrinthServers({
          game: gameFilter,
          sort: sortFilter,
          search: searchTerm,
          limit: 50,
        });
        results = res.map(s => ({ ...s, source: "modrinth" as const }));
      } else {
        // Default: fetch from both in parallel
        let anyErrorOccurred = false;
        let modErrorOccurred = false;
        
        const [anyRes, modRes] = await Promise.all([
          fetchServers({
            game: gameFilter,
            sort: sortFilter,
            search: searchTerm,
            limit: 50,
          }).catch((err) => {
            console.error("Error fetching AnyServer:", err);
            anyErrorOccurred = true;
            return [] as MinecraftServer[];
          }),
          fetchModrinthServers({
            game: gameFilter,
            sort: sortFilter,
            search: searchTerm,
            limit: 50,
          }).catch((err) => {
            console.error("Error fetching Modrinth:", err);
            modErrorOccurred = true;
            return [] as MinecraftServer[];
          })
        ]);

        if (anyErrorOccurred && modErrorOccurred) {
          throw new Error("Failed to fetch listings from both AnyServer.pro and Modrinth.");
        }

        if (anyErrorOccurred) {
          toast.danger("Warning", {
            description: "Failed to fetch from AnyServer.pro API. Only Modrinth listings are shown."
          });
        }
        if (modErrorOccurred) {
          toast.danger("Warning", {
            description: "Failed to fetch from Modrinth API. Only AnyServer.pro listings are shown."
          });
        }

        const anyMapped = anyRes.map(s => ({ ...s, source: "anyserver" as const }));
        const modMapped = modRes.map(s => ({ ...s, source: "modrinth" as const }));
        
        results = mergeDefaultServers(anyMapped, modMapped);
      }

      startTransition(() => {
        setServers(results);
      });
    } catch (err: any) {
      console.error("Error loading servers:", err);
      setError(err?.message || String(err));
      toast.danger("Error loading servers", {
        description: `Failed to fetch server listings: ${err?.message || String(err)}`
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
  }, [gameFilter, sortFilter, provider]);

  const getSortOptions = () => {
    if (provider === "anyserver") {
      return (
        <>
          <option value="most_votes">Most Votes</option>
          <option value="most_players">Most Players</option>
          <option value="recent">Recently Added</option>
          <option value="random">Random</option>
        </>
      );
    } else if (provider === "modrinth") {
      return (
        <>
          <option value="most_votes">Most Followers</option>
          <option value="most_players">Most Downloads</option>
          <option value="recent">Recently Added</option>
          <option value="random">Relevance</option>
        </>
      );
    } else {
      return (
        <>
          <option value="most_votes">Most Votes / Followers</option>
          <option value="most_players">Most Players / Downloads</option>
          <option value="recent">Recently Added</option>
          <option value="random">Random / Relevance</option>
        </>
      );
    }
  };

  // Handle Search on Enter or button click
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadServers();
  };

  const handleCopyIP = (ip: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(ip);
    setCopiedId(id);
    toast("IP address copied!", {
      description: `Copied "${ip}" to your clipboard.`
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenDetails = async (server: MinecraftServer) => {
    setModalOpen(true);
    setSelectedServer(server);
    setDetailsLoading(true);
    try {
      const isAnyServer = server.source === "anyserver";
      const detailed = isAnyServer
        ? await fetchServerDetails(server.id)
        : await fetchModrinthServerDetails(server.id);
      setSelectedServer({ ...detailed, source: server.source });
    } catch (error) {
      console.error("Error loading server details:", error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const getGameLabel = (game: string) => {
    switch (game) {
      case "mc_java":
        return "Java Edition";
      case "mc_bedrock":
        return "Bedrock Edition";
      case "mc_crossplay":
        return "Crossplay (Java/Bedrock)";
      default:
        return "Minecraft";
    }
  };

  const getGameBadgeColor = (game: string) => {
    switch (game) {
      case "mc_java":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/25";
      case "mc_bedrock":
        return "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25";
      case "mc_crossplay":
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25";
      default:
        return "bg-white/10 text-white/70";
    }
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-background text-foreground">
      {/* Header Banner */}
      <div className="relative overflow-hidden flex-shrink-0 bg-gradient-to-r from-emerald-950/40 via-surface to-background px-6 py-6 border-b border-border/40">
        <div className="absolute right-0 top-0 w-96 h-full bg-radial-gradient from-accent/5 via-transparent to-transparent pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center text-accent shadow-inner">
            <Server className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Server Browser 
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent font-semibold uppercase tracking-wider font-mono">
                {provider === "default" ? "Default" : provider === "anyserver" ? "AnyServer.pro" : "Modrinth"}
              </span>
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {provider === "default"
                ? "Browse featured servers from AnyServer.pro and Modrinth."
                : provider === "anyserver" 
                ? "Discover, vote, and connect to high-performance Minecraft servers."
                : "Discover and join servers from the Modrinth community."
              }
            </p>
          </div>
        </div>
      </div>

      {/* Filter panel */}
      <form onSubmit={handleSearchSubmit} className="flex-shrink-0 p-4 bg-surface-secondary border-b border-border/20 flex flex-col md:flex-row gap-3 items-end">
        <div className="w-full md:w-44 flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Provider</label>
          <Autocomplete
            value={provider}
            onChange={(value) => {
              if (value === "default" || value === "anyserver" || value === "modrinth") {
                setProvider(value);
              }
            }}
            className="w-full"
          >
            <Autocomplete.Trigger className="h-[40px] px-3 bg-surface border border-border/40 hover:border-accent/40 rounded-lg text-sm text-foreground focus:outline-none transition-all cursor-pointer">
              <Autocomplete.Value>
                {provider === "default" ? "Default" : provider === "anyserver" ? "AnyServer.pro" : "Modrinth"}
              </Autocomplete.Value>
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover offset={4} placement="bottom start">
              <ListBox>
                <ListBox.Item id="default" textValue="Default">
                  <span>Default</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="anyserver" textValue="AnyServer.pro">
                  <span>AnyServer.pro</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="modrinth" textValue="Modrinth">
                  <span>Modrinth</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Autocomplete.Popover>
          </Autocomplete>
        </div>

        <div className="flex-1 w-full flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Search Keywords</label>
          <div className="relative">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, description, tags..."
              className="w-full bg-background border border-border/40 hover:border-accent/40 focus-within:border-accent rounded-lg transition-all pl-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  loadServers();
                }
              }}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
          </div>
        </div>

        <div className="w-full md:w-44 flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Game Edition</label>
          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            className="w-full h-[40px] px-3 bg-surface border border-border/40 hover:border-accent/40 focus:border-accent rounded-lg text-sm text-foreground focus:outline-none transition-all cursor-pointer"
          >
            <option value="all">All Editions</option>
            <option value="mc_java">Java Edition</option>
            <option value="mc_bedrock">Bedrock Edition</option>
            <option value="mc_crossplay">Crossplay</option>
          </select>
        </div>

        <div className="w-full md:w-44 flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">Sort By</label>
          <select
            value={sortFilter}
            onChange={(e) => setSortFilter(e.target.value)}
            className="w-full h-[40px] px-3 bg-surface border border-border/40 hover:border-accent/40 focus:border-accent rounded-lg text-sm text-foreground focus:outline-none transition-all cursor-pointer"
          >
            {getSortOptions()}
          </select>
        </div>

        <Button 
          type="submit" 
          className="h-[40px] w-full md:w-auto bg-accent text-accent-foreground font-semibold px-5 rounded-lg hover:bg-accent-hover transition-all flex items-center gap-2"
        >
          <Search className="size-4" />
          Search
        </Button>
      </form>

      {/* Main Server Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        {loading ? (
          // Skeleton Loader
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-surface border border-border/30 rounded-xl p-4 flex flex-col gap-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-white/5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-white/5 rounded w-3/4" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-white/5 rounded w-full" />
                  <div className="h-3 bg-white/5 rounded w-5/6" />
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-white/5 rounded w-1/4" />
                  <div className="h-8 bg-white/5 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          // Error State
          <div className="w-full py-16 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center text-danger border border-danger/25">
              <Server className="size-8 text-danger" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Failed to connect to {provider === "default" ? "AnyServer.pro / Modrinth" : provider === "anyserver" ? "AnyServer.pro" : "Modrinth"}
              </h3>
              <p className="text-xs text-muted max-w-sm mt-1">
                {error}. Please check your connection or try again later.
              </p>
            </div>
            <Button 
              onPress={() => loadServers()}
              className="bg-accent text-accent-foreground font-semibold py-2 px-5 rounded-lg mt-2 hover:bg-accent-hover transition-all"
            >
              Retry Connection
            </Button>
          </div>
        ) : servers.length === 0 ? (
          // Empty State
          <div className="w-full py-16 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center text-muted-foreground border border-border/40">
              <Server className="size-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">No servers found</h3>
              <p className="text-xs text-muted max-w-sm mt-1">
                We couldn't find any servers matching your criteria. Try adjusting your search query or filters.
              </p>
            </div>
            <Button 
              onPress={() => {
                setSearchTerm("");
                setGameFilter("all");
                setSortFilter("most_votes");
              }}
              className="bg-surface border border-border hover:bg-surface-secondary text-foreground text-xs py-2 px-4 rounded-lg mt-2"
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          // Server Grid
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((server) => (
              <div 
                key={server.id}
                onClick={() => handleOpenDetails(server)}
                className="group bg-surface border border-border/30 hover:border-accent/40 rounded-xl p-4 flex flex-col justify-between hover:shadow-xl hover:shadow-accent/5 hover:-translate-y-0.5 cursor-pointer transition-all duration-300 relative overflow-hidden"
              >
                {/* Glow on hover */}
                <div className="absolute inset-0 bg-radial-gradient from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none duration-500" />
                
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex gap-3">
                      {server.icon_url ? (
                        <img 
                          src={server.icon_url} 
                          alt={server.name}
                          className="w-12 h-12 rounded-lg bg-surface-secondary border border-border/40 object-contain shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = ""; // Fallback
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-accent shrink-0">
                          <Server className="size-6" />
                        </div>
                      )}
                      
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm text-foreground truncate group-hover:text-accent transition-colors" title={server.name}>
                          {server.name}
                        </h4>
                        <span className="text-[10px] font-mono text-muted flex items-center gap-1.5 mt-0.5">
                          <span className="relative flex size-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500"></span>
                          </span>
                          {server.players.online.toLocaleString()} / {server.players.max.toLocaleString()} online
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Card Body */}
                  <p className="text-xs text-muted mt-3 line-clamp-2 leading-relaxed">
                    {server.description}
                  </p>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${getGameBadgeColor(server.game)}`}>
                      {getGameLabel(server.game)}
                    </span>
                    <span className="text-[10px] bg-surface-secondary text-muted border border-border/20 px-2 py-0.5 rounded font-mono">
                      v{server.version}
                    </span>
                    {server.source && (
                      <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                        server.source === "anyserver"
                          ? "bg-sky-500/10 text-sky-400 border border-sky-500/25"
                          : "bg-teal-500/10 text-teal-400 border border-teal-500/25"
                      }`}>
                        {server.source === "anyserver" ? "AnyServer.pro" : "Modrinth"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="mt-4 pt-3 border-t border-border/20 flex items-center justify-end gap-2">
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={(e) => handleCopyIP(server.ip, server.id, e)}
                      className="bg-surface-secondary hover:bg-surface-hover text-foreground/90 text-xs px-2.5 min-w-0 h-8 rounded-lg flex items-center gap-1.5 border border-border/30 hover:border-accent/40"
                    >
                      {copiedId === server.id ? (
                        <>
                          <Check className="size-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5 text-muted group-hover/btn:text-foreground" />
                          <span>Copy IP</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Server Details Modal Overlay */}
      {modalOpen && selectedServer && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setModalOpen(false)}
        >
          <div 
            className="w-full max-w-2xl bg-surface border border-border/40 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] relative animate-zoom-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button 
              onClick={() => setModalOpen(false)}
              className="absolute right-6 top-6 z-10 w-8 h-8 rounded-lg bg-surface-secondary hover:bg-surface-hover flex items-center justify-center text-foreground/80 hover:text-foreground border border-border/40 transition-all"
            >
              <X className="size-4" />
            </button>

            {/* Compact Space-Saving Header */}
            <div className="p-6 pb-4 border-b border-border/20 flex items-center justify-between gap-4 flex-shrink-0 relative">
              <div className="flex gap-4 items-center min-w-0">
                {selectedServer.icon_url ? (
                  <img 
                    src={selectedServer.icon_url} 
                    alt={selectedServer.name}
                    className="w-12 h-12 rounded-lg bg-surface-secondary border border-border/40 object-contain shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-accent/25 border border-accent/40 flex items-center justify-center text-accent shrink-0">
                    <Server className="size-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-foreground truncate pr-6">{selectedServer.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] bg-accent/15 text-accent font-semibold px-2 py-0.5 rounded border border-accent/20">
                      {getGameLabel(selectedServer.game)}
                    </span>
                    <span className="text-[10px] bg-surface-secondary text-muted font-mono px-2 py-0.5 rounded border border-border/20">
                      v{selectedServer.version}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              {detailsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
                  <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  <span className="text-xs">Fetching comprehensive details...</span>
                </div>
              ) : (
                <>
                  {/* Quick Info Bar */}
                  <div className="grid grid-cols-3 gap-3 bg-surface-secondary p-4 rounded-xl border border-border/20">
                    <div className="flex flex-col items-center justify-center text-center p-2">
                      <Users className="size-5 text-accent mb-1" />
                      <span className="text-[10px] text-muted font-semibold uppercase tracking-wider">Players</span>
                      <span className="text-sm font-bold text-foreground mt-0.5">
                        {selectedServer.players.online.toLocaleString()} <span className="text-xs text-muted">/ {selectedServer.players.max.toLocaleString()}</span>
                      </span>
                    </div>

                    <div className="flex flex-col items-center justify-center text-center p-2 border-x border-border/20">
                      <ThumbsUp className="size-5 text-accent mb-1" />
                      <span className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                        {selectedServer.source === "anyserver" ? "Votes" : "Followers"}
                      </span>
                      <span className="text-sm font-bold text-foreground mt-0.5">{selectedServer.votes.toLocaleString()}</span>
                    </div>

                    <div className="flex flex-col items-center justify-center text-center p-2">
                      <Globe className="size-5 text-accent mb-1" />
                      <span className="text-[10px] text-muted font-semibold uppercase tracking-wider">IP Address</span>
                      <span className="text-xs font-mono font-bold text-accent mt-1 select-all truncate max-w-full px-2" title={selectedServer.ip}>
                        {selectedServer.ip}
                      </span>
                    </div>
                  </div>

                  {/* Description Section */}
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Info className="size-4 text-accent" />
                      About Server
                    </h3>
                    <div className="text-sm text-foreground/80 leading-relaxed bg-surface-secondary/40 border border-border/10 p-4 rounded-xl font-sans whitespace-pre-wrap">
                      {selectedServer.description}
                    </div>
                  </div>

                  {/* Tags Section */}
                  {selectedServer.tags && selectedServer.tags.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Categories / Tags</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedServer.tags.map((tag) => (
                          <span key={tag} className="text-xs bg-surface-secondary text-foreground/75 px-3 py-1 rounded-full border border-border/30">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reviews Section */}
                  {selectedServer.reviews && selectedServer.reviews.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Player Reviews</h3>
                      <div className="flex flex-col gap-3">
                        {selectedServer.reviews.map((rev, index) => (
                          <div key={index} className="bg-surface-secondary/50 border border-border/20 p-3.5 rounded-xl flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-foreground">{rev.author}</span>
                              <div className="flex gap-0.5">
                                {[...Array(5)].map((_, i) => (
                                  <ThumbsUp key={i} className={`size-3 ${i < rev.rating ? "text-accent fill-accent" : "text-muted opacity-40"}`} />
                                ))}
                              </div>
                            </div>
                            <p className="text-xs text-foreground/80 leading-relaxed italic">"{rev.text}"</p>
                            <span className="text-[10px] text-muted self-end mt-1">{rev.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-surface-secondary border-t border-border/30 flex gap-3 justify-between items-center flex-shrink-0">
              <a 
                href={selectedServer.source === "anyserver"
                  ? `https://anyserver.pro/server/${selectedServer.id}`
                  : `https://modrinth.com/server/${selectedServer.id}`
                } 
                onClick={(e) => {
                  e.preventDefault();
                  const url = selectedServer.source === "anyserver"
                    ? `https://anyserver.pro/server/${selectedServer.id}`
                    : `https://modrinth.com/server/${selectedServer.id}`;
                  openShell(url).catch(console.error);
                }}
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-accent hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                {selectedServer.source === "anyserver" ? "Vote on AnyServer.pro" : "View on Modrinth"} <ExternalLink className="size-3.5" />
              </a>

              <div className="flex gap-2">
                <Button 
                  variant="secondary"
                  onPress={() => handleCopyIP(selectedServer.ip, selectedServer.id)}
                  className="bg-surface hover:bg-surface-hover text-foreground border border-border/40 hover:border-accent/40 rounded-lg text-xs font-semibold px-4 h-9 flex items-center gap-1.5"
                >
                  {copiedId === selectedServer.id ? (
                    <>
                      <Check className="size-4 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-4 text-muted" />
                      <span>Copy Server IP</span>
                    </>
                  )}
                </Button>
                <Button 
                  onPress={() => {
                    handleCopyIP(selectedServer.ip, selectedServer.id);
                    setModalOpen(false);
                    toast.success("Ready to join!", {
                      description: "Server IP copied to clipboard. Paste in Minecraft server list."
                    });
                  }}
                  className="bg-accent text-accent-foreground hover:bg-accent-hover rounded-lg text-xs font-bold px-5 h-9 flex items-center gap-1.5 shadow-lg shadow-accent/15"
                >
                  <Server className="size-4" />
                  Connect & Join
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
