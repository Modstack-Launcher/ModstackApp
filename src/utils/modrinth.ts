import { MinecraftServer } from "./anyserver";

const SEARCH_API = "https://api.modrinth.com/v2/search";
const PROJECTS_API = "https://api.modrinth.com/v3/projects";
const PROJECT_API = "https://api.modrinth.com/v3/project";

const HEADERS = {
  "User-Agent": "modstack-launcher/1.0 (github.com/user/modstack)",
  Accept: "application/json",
};

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

export function mapModrinthServer(raw: any): MinecraftServer {
  const javaServer = raw.minecraft_java_server || {};
  const mcServer = raw.minecraft_server || {};
  const ping = javaServer.ping?.data || null;

  // Determine game edition type
  let game: "mc_java" | "mc_bedrock" | "mc_crossplay" = "mc_java";
  const allTags = [
    ...(raw.categories || []),
    ...(raw.additional_categories || [])
  ].map((t: string) => t.toLowerCase());

  if (allTags.includes("crossplay") || allTags.includes("hybrid")) {
    game = "mc_crossplay";
  } else if (allTags.includes("bedrock") || allTags.includes("pe") || allTags.includes("pocket") || raw.minecraft_bedrock_server?.address) {
    game = "mc_bedrock";
  }

  // Address
  const ip = javaServer.address || raw.minecraft_bedrock_server?.address || "play.modrinth.com";

  // Minecraft versions
  const version = mcServer.active_version 
    ? formatVersionString(mcServer.active_version)
    : (raw.game_versions && raw.game_versions.length > 0 
        ? formatVersionString(raw.game_versions) 
        : "1.20");

  return {
    id: raw.id || raw.slug,
    name: raw.name || raw.title || "Modrinth Server",
    description: raw.summary || raw.description || "",
    game: game,
    version: version,
    ip: ip,
    port: javaServer.port || 25565,
    votes: raw.followers || 0,
    players: {
      online: ping?.players_online ?? 0,
      max: ping?.players_max ?? 20,
    },
    icon_url: raw.icon_url || undefined,
    banner_url: raw.banner_url || undefined,
    uptime: ping ? 100 : undefined,
    tags: [...(raw.categories || []), ...(raw.additional_categories || [])],
    reviews: [],
    screenshots: raw.gallery ? raw.gallery.map((g: any) => typeof g === "string" ? g : g.url) : [],
  };
}

export async function fetchModrinthServers(filters: {
  game?: string;
  sort?: string;
  search?: string;
  limit?: number;
  version?: string;
}): Promise<MinecraftServer[]> {
  const params = new URLSearchParams();
  
  if (filters.search) {
    params.set("query", filters.search.trim());
  }

  const limit = filters.limit || 50;
  params.set("limit", String(limit));
  
  // Set facets for minecraft_java_server
  const facets: string[][] = [["project_type:minecraft_java_server"]];
  if (filters.version && filters.version !== "all") {
    facets.push([`versions:${filters.version}`]);
  }
  params.set("facets", JSON.stringify(facets));

  // Map sort filters
  // sortFilter: most_votes | most_players | recent | random
  let index = "relevance";
  if (filters.sort === "most_votes") {
    index = "follows";
  } else if (filters.sort === "most_players") {
    index = "downloads";
  } else if (filters.sort === "recent") {
    index = "newest";
  }
  params.set("index", index);

  try {
    const res = await fetch(`${SEARCH_API}?${params}`, {
      headers: HEADERS,
    });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    const hits = data.hits || [];

    if (hits.length === 0) {
      return [];
    }

    // Extract slugs/ids to fetch details in bulk
    const slugs = hits.map((hit: any) => hit.slug);

    // Fetch bulk details from v3 API
    const encodedSlugs = encodeURIComponent(JSON.stringify(slugs));
    const detailsRes = await fetch(`${PROJECTS_API}?ids=${encodedSlugs}`, {
      headers: HEADERS,
    });

    if (!detailsRes.ok) {
      throw new Error(`HTTP error! status: ${detailsRes.status}`);
    }

    const detailsData = await detailsRes.json();
    
    // Sort detailsData in the same order as hits to maintain the search relevance/sorting
    const detailsMap = new Map<string, any>();
    for (const d of detailsData) {
      detailsMap.set(d.slug, d);
      detailsMap.set(d.id, d);
    }

    const servers: MinecraftServer[] = [];
    for (const hit of hits) {
      const detail = detailsMap.get(hit.slug) || detailsMap.get(hit.project_id);
      if (detail) {
        servers.push(mapModrinthServer(detail));
      } else {
        // Fallback to mapping the search hit as best as we can
        servers.push({
          id: hit.project_id,
          name: hit.title || "Modrinth Server",
          description: hit.description || "",
          game: "mc_java",
          version: hit.versions ? formatVersionString(hit.versions) : "1.20",
          ip: "play.modrinth.com",
          votes: hit.follows || 0,
          players: {
            online: 0,
            max: 20,
          },
          icon_url: hit.icon_url || undefined,
          tags: hit.categories || [],
        });
      }
    }

    let result = servers;
    // Filter by game edition if "game" filter is active
    if (filters.game && filters.game !== "all") {
      result = servers.filter(s => s.game === filters.game);
    }

    // Sort randomly if requested
    if (filters.sort === "random") {
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    }

    return result;
  } catch (error) {
    console.error("fetchModrinthServers error:", error);
    throw error;
  }
}

export async function fetchModrinthServerDetails(id: string): Promise<MinecraftServer> {
  try {
    const res = await fetch(`${PROJECT_API}/${id}`, {
      headers: HEADERS,
    });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    return mapModrinthServer(data);
  } catch (error) {
    console.error(`fetchModrinthServerDetails error for ID ${id}:`, error);
    throw error;
  }
}