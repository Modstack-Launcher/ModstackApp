import { MinecraftServer } from "./anyserver";

const FEATURED_SERVERS = [
  {
    id: "hypixel",
    name: "Hypixel",
    ip: "mc.hypixel.net",
    description: "Minigames, SkyBlock, Bed Wars, SkyWars, and more.",
    version: "1.8-1.21.8",
    tags: ["Minigames", "SkyBlock", "Bed Wars"],
  },
  {
    id: "minehut",
    name: "Minehut",
    ip: "minehut.com",
    description: "Community Minecraft servers and minigames.",
    version: "1.20-1.21.8",
    tags: ["Community", "Minigames"],
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    ip: "play.cubecraft.net",
    description: "Featured minigames, SkyWars, EggWars, and seasonal modes.",
    version: "1.19-1.21.8",
    tags: ["Minigames", "SkyWars", "EggWars"],
  },
  {
    id: "mccisland",
    name: "MCC Island",
    ip: "play.mccisland.net",
    description: "Noxcrew's MCC-inspired public server.",
    version: "1.20-1.21.8",
    tags: ["Minigames", "Parkour", "PvP"],
  },
  {
    id: "pvplegacy",
    name: "PvP Legacy",
    ip: "play.pvplegacy.net",
    description: "Practice PvP with custom kits and duels.",
    version: "1.20-1.21.8",
    tags: ["PvP", "Duels", "Practice"],
  },
  {
    id: "complexgaming",
    name: "Complex Gaming",
    ip: "hub.mc-complex.com",
    description: "Large network with Pixelmon, survival, skyblock, and more.",
    version: "1.20-1.21.8",
    tags: ["Network", "Survival", "Pixelmon"],
  },
] as const;

function motdToText(motd: any, fallback: string) {
  const clean = motd?.clean;
  if (Array.isArray(clean)) {
    const text = clean.join(" ").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return fallback;
}

function versionToText(version: any, fallback: string) {
  if (typeof version === "string" && version.trim()) return version.trim();
  if (typeof version?.name === "string" && version.name.trim()) return version.name.trim();
  return fallback;
}

async function pingFeaturedServer(server: (typeof FEATURED_SERVERS)[number]): Promise<MinecraftServer> {
  try {
    const res = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(server.ip)}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return {
      id: `featured-${server.id}`,
      name: server.name,
      description: motdToText(data.motd, server.description),
      game: "mc_java",
      version: versionToText(data.version, server.version),
      ip: server.ip,
      port: 25565,
      votes: data.players?.online ?? 0,
      players: {
        online: data.players?.online ?? 0,
        max: data.players?.max ?? 0,
      },
      icon_url: `https://api.mcsrvstat.us/icon/${encodeURIComponent(server.ip)}`,
      uptime: data.online ? 100 : 0,
      tags: [...server.tags],
      source: "featured",
    };
  } catch {
    return {
      id: `featured-${server.id}`,
      name: server.name,
      description: server.description,
      game: "mc_java",
      version: server.version,
      ip: server.ip,
      port: 25565,
      votes: 0,
      players: {
        online: 0,
        max: 0,
      },
      icon_url: `https://api.mcsrvstat.us/icon/${encodeURIComponent(server.ip)}`,
      uptime: 0,
      tags: [...server.tags],
      source: "featured",
    };
  }
}

export async function fetchFeaturedServers(filters: {
  game?: string;
  sort?: string;
  search?: string;
  limit?: number;
} = {}): Promise<MinecraftServer[]> {
  if (filters.game && filters.game !== "all" && filters.game !== "mc_java") {
    return [];
  }

  const search = filters.search?.trim().toLowerCase();
  const matched = search
    ? FEATURED_SERVERS.filter((server) =>
        [server.name, server.ip, server.description, ...server.tags]
          .join(" ")
          .toLowerCase()
          .includes(search),
      )
    : FEATURED_SERVERS;

  let servers = await Promise.all(matched.map(pingFeaturedServer));

  if (filters.sort === "most_players" || filters.sort === "most_votes") {
    servers = [...servers].sort((a, b) => b.players.online - a.players.online);
  } else if (filters.sort === "random") {
    servers = [...servers];
    for (let i = servers.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [servers[i], servers[j]] = [servers[j], servers[i]];
    }
  }

  return servers.slice(0, filters.limit ?? servers.length);
}
