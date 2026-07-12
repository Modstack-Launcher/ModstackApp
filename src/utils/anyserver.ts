import { invoke } from "@tauri-apps/api/core";

export interface MinecraftServer {
  id: string;
  name: string;
  description: string;
  game: "mc_java" | "mc_bedrock" | "mc_crossplay";
  version: string;
  ip: string;
  port?: number;
  votes: number;
  players: {
    online: number;
    max: number;
  };
  icon_url?: string;
  banner_url?: string;
  uptime?: number;
  tags?: string[];
  reviews?: {
    author: string;
    rating: number;
    text: string;
    date: string;
  }[];
  screenshots?: string[];
  source?: "anyserver" | "modrinth" | "featured";
}

function formatVersionString(versionInput: string | string[]): string {
  let versions: string[] = [];
  if (Array.isArray(versionInput)) {
    versions = versionInput.map(v => v.trim()).filter(Boolean);
  } else if (typeof versionInput === "string") {
    if (versionInput.includes("-")) {
      return versionInput.replace(/\s*-\s*/g, "-");
    }
    versions = versionInput.split(",").map(v => v.trim()).filter(Boolean);
  }

  if (versions.length === 0) return "1.20";
  if (versions.length === 1) return versions[0];

  const parseVersion = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    return clean.split(".").map(x => parseInt(x, 10) || 0);
  };

  const compareVersions = (v1: string, v2: string) => {
    const parts1 = parseVersion(v1);
    const parts2 = parseVersion(v2);
    const maxLen = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 !== p2) return p1 - p2;
    }
    return 0;
  };

  const sorted = [...versions].sort(compareVersions);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  if (min === max) return min;
  return `${min}-${max}`;
}

function mapServer(raw: any): MinecraftServer {
  if (!raw) {
    throw new Error("Invalid server data");
  }

  // Determine game edition type
  let game: "mc_java" | "mc_bedrock" | "mc_crossplay" = "mc_java";
  const edition = String(raw.edition || "").toLowerCase();
  if (edition.includes("cross") || edition.includes("hybrid")) {
    game = "mc_crossplay";
  } else if (edition.includes("bedrock") || edition.includes("pe") || edition.includes("pocket")) {
    game = "mc_bedrock";
  }

  // Construct icon/thumbnail URL
  const address = raw.address || "";
  const icon_url = raw.thumbnail 
    ? `https://cdn.anyserver.pro/thumbnails/${raw.thumbnail}`
    : `https://api.mcsrvstat.us/icon/${address}`;

  return {
    id: String(raw.id),
    name: raw.name || "Minecraft Server",
    description: raw.server_description || raw.description || "",
    game: game,
    version: formatVersionString(raw.version || "1.20"),
    ip: address,
    port: raw.port || 25565,
    votes: raw.votes || 0,
    players: {
      online: raw.player_count || 0,
      max: raw.max_players || 20,
    },
    icon_url: icon_url,
    banner_url: raw.banner_url || `https://images.unsplash.com/photo-1616469829581-73993eb86b02?auto=format&fit=crop&w=800&q=80`,
    uptime: raw.uptime || (raw.is_online ? 100 : 0),
    tags: raw.category ? raw.category.split(",").map((s: string) => s.trim()) : [],
  };
}

export async function fetchServers(filters: {
  game?: string;
  sort?: string;
  search?: string;
  limit?: number;
  version?: string;
}): Promise<MinecraftServer[]> {
  const query: [string, string][] = [];
  
  if (filters.game && filters.game !== "all") {
    query.push(["game", filters.game]);
  }
  if (filters.sort) {
    query.push(["sort", filters.sort]);
  }
  if (filters.search) {
    query.push(["search", filters.search]);
  }
  if (filters.limit) {
    query.push(["limit", String(filters.limit)]);
  }
  if (filters.version) {
    query.push(["version", filters.version === "all" ? "any" : filters.version]);
  }

  try {
    const rawData: any = await invoke("anyserver_get", {
      path: "/servers",
      query: query,
    });

    const serversArray = Array.isArray(rawData) 
      ? rawData 
      : (rawData && Array.isArray(rawData.servers) ? rawData.servers : []);

    return serversArray.map(mapServer);
  } catch (error) {
    console.error("fetchServers invoke error:", error);
    throw new Error(String(error));
  }
}

export async function fetchServerDetails(id: string): Promise<MinecraftServer> {
  try {
    const rawData: any = await invoke("anyserver_get", {
      path: `/servers/${id}`,
      query: [],
    });
    
    const serverObj = rawData && rawData.server ? rawData.server : rawData;
    return mapServer(serverObj);
  } catch (error) {
    console.error(`fetchServerDetails invoke error for ID ${id}:`, error);
    throw new Error(String(error));
  }
}

export async function fetchAnyServerConfig(): Promise<{ minecraft_versions: string[]; minecraft_categories: string[] }> {
  try {
    const rawData: any = await invoke("anyserver_get", {
      path: "/config",
      query: [],
    });
    return {
      minecraft_versions: Array.isArray(rawData?.minecraft_versions) ? rawData.minecraft_versions : [],
      minecraft_categories: Array.isArray(rawData?.minecraft_categories) ? rawData.minecraft_categories : [],
    };
  } catch (error) {
    console.error("fetchAnyServerConfig error:", error);
    throw error;
  }
}
