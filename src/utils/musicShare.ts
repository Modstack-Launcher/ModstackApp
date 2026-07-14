import type { MusicPlaylist, MusicTrack } from "./musicContext";

export interface MusicShareTrack {
  title: string;
  artist: string;
  provider?: MusicTrack["provider"];
  videoId?: string;
  url?: string;
  thumbnail?: string;
  externalUrl?: string;
}

export interface MusicPlaylistSharePayload {
  type: "modstack-music-playlist";
  version: 1;
  name: string;
  description?: string;
  logoUrl?: string;
  tracks: MusicShareTrack[];
}

const PORTABLE_PREFIX = "MSM-";
const LEGACY_PREFIX = "HARMONY_PLAYLIST_SHARE:";
const REGISTRY_KEY = "modstack.musicShare.codes";
const MESSAGE_RE = /\[\[MODSTACK_MUSIC:([A-Za-z0-9_-]+)\]\]/;
const LEGACY_RE = /HARMONY_PLAYLIST_SHARE:\s*([A-Za-z0-9+/=_\-\s]+)/;
const MAX_SHARED_TRACKS = 120;

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64Url(value: string) {
  const compact = value.replace(/\s+/g, "");
  const padded = compact.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(compact.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function rowToTrack(row: unknown): MusicShareTrack | null {
  if (!Array.isArray(row) || !row[0]) return null;
  const provider = row[2] === "spotify" || row[2] === "local" ? row[2] : "youtube";
  return {
    title: String(row[0]),
    artist: String(row[1] || ""),
    provider,
    videoId: row[3] ? String(row[3]) : undefined,
    url: row[4] ? String(row[4]) : undefined,
    thumbnail: row[5] ? String(row[5]) : undefined,
    externalUrl: row[6] ? String(row[6]) : undefined,
  };
}

function expandPayload(value: unknown): MusicPlaylistSharePayload | null {
  if (!value || typeof value !== "object") return null;
  const compact = value as {
    t?: unknown;
    v?: unknown;
    n?: unknown;
    d?: unknown;
    l?: unknown;
    s?: unknown;
    type?: unknown;
    version?: unknown;
    name?: unknown;
    description?: unknown;
    logoUrl?: unknown;
    logo?: unknown;
    tracks?: unknown;
    songs?: unknown;
  };
  const isCompact = compact.t === "msp" && compact.v === 1;
  const isLegacy = compact.version === 1 || compact.type === "modstack-music-playlist" || compact.type === "harmony-playlist";
  if (!isCompact && !isLegacy) return null;
  const rawTracks = isCompact ? compact.s : compact.tracks || compact.songs;
  const name = isCompact ? compact.n : compact.name;
  if (!name || !Array.isArray(rawTracks)) return null;
  const tracks: MusicShareTrack[] = rawTracks
    .map((row: unknown) => {
      if (Array.isArray(row)) return rowToTrack(row);
      if (!row || typeof row !== "object") return null;
      const track = row as Partial<MusicShareTrack>;
      if (!track.title) return null;
      return {
        title: String(track.title),
        artist: String(track.artist || ""),
        provider: track.provider || "youtube",
        videoId: track.videoId,
        url: track.url,
        thumbnail: track.thumbnail,
        externalUrl: track.externalUrl,
      };
    })
    .filter((track: MusicShareTrack | null): track is MusicShareTrack => Boolean(track));
  if (tracks.length === 0) return null;
  return {
    type: "modstack-music-playlist",
    version: 1,
    name: String(name),
    description: (isCompact ? compact.d : compact.description) ? String(isCompact ? compact.d : compact.description) : undefined,
    logoUrl: (isCompact ? compact.l : compact.logoUrl || compact.logo) ? String(isCompact ? compact.l : compact.logoUrl || compact.logo) : undefined,
    tracks,
  };
}

export function createMusicPlaylistSharePayload(
  playlist: MusicPlaylist,
  tracks: MusicTrack[],
): MusicPlaylistSharePayload {
  return {
    type: "modstack-music-playlist",
    version: 1,
    name: playlist.name,
    description: playlist.description,
    logoUrl: playlist.logoUrl,
    tracks: tracks.slice(0, MAX_SHARED_TRACKS).map((track) => ({
      title: track.title,
      artist: track.artist,
      provider: track.provider || "youtube",
      videoId: track.videoId,
      url: track.url,
      thumbnail: track.thumbnail,
      externalUrl: track.externalUrl,
    })),
  };
}

function loadRegistry(): Record<string, MusicPlaylistSharePayload> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function encodeMusicPlaylistShare(payload: MusicPlaylistSharePayload) {
  return `${LEGACY_PREFIX}${toBase64(JSON.stringify({
    version: 1,
    name: payload.name,
    description: payload.description,
    logoUrl: payload.logoUrl,
    tracks: payload.tracks,
  }))}`;
}

export function decodeMusicPlaylistShare(code: string): MusicPlaylistSharePayload | null {
  const clean = code.trim().replace(/^modstack:\/\//i, "");
  const encoded = clean.startsWith(LEGACY_PREFIX)
    ? clean.slice(LEGACY_PREFIX.length).replace(/\s+/g, "")
    : clean;
  const registry = loadRegistry();
  if (registry[encoded]) return registry[encoded];
  const raw = encoded.startsWith(PORTABLE_PREFIX) ? encoded.slice(PORTABLE_PREFIX.length) : encoded;
  try {
    return expandPayload(JSON.parse(fromBase64Url(raw)));
  } catch {
    return null;
  }
}

export function createMusicPlaylistShareMessage(payload: MusicPlaylistSharePayload) {
  return encodeMusicPlaylistShare(payload);
}

export function parseMusicPlaylistShareMessage(content: string) {
  const match = content.match(MESSAGE_RE) || content.match(LEGACY_RE);
  if (!match) return null;
  const code = match[0].startsWith(LEGACY_PREFIX) ? `${LEGACY_PREFIX}${match[1].replace(/\s+/g, "")}` : match[1];
  const payload = decodeMusicPlaylistShare(code);
  if (!payload) return null;
  return { payload, code };
}

export function cleanMusicPlaylistShareMessage(content: string) {
  return content.replace(MESSAGE_RE, "").replace(LEGACY_RE, "").trim();
}

export function sharedTrackToMusicTrack(track: MusicShareTrack, index: number): MusicTrack {
  const videoId = track.videoId;
  const provider = track.provider || (videoId ? "youtube" : "local");
  return {
    id: `${provider}:shared:${videoId || `${Date.now()}-${index}`}`,
    title: track.title,
    artist: track.artist,
    url: track.url || (videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : ""),
    thumbnail: track.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : undefined),
    externalUrl: track.externalUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined),
    provider,
    videoId,
  };
}
