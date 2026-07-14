import type { MusicTrack } from "./musicContext";
import { invoke } from "@tauri-apps/api/core";

export type MusicProvider = "youtube" | "spotify" | "local";

export interface MusicSearchResult {
  id: string;
  provider: MusicProvider;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: string;
  externalUrl: string;
  playbackUrl?: string;
  videoId?: string;
}

export interface PlaylistImportStats {
  found: number;
  total: number;
}

interface SpotifyImage {
  url?: string;
}

interface SpotifyPlaylistTrack {
  track?: {
    id?: string;
    name?: string;
    external_urls?: { spotify?: string };
    external_ids?: { isrc?: string };
    preview_url?: string | null;
    artists?: { name?: string }[];
    album?: { name?: string; images?: SpotifyImage[] };
  } | null;
}

interface SpotifyTrackCandidate {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  thumbnail?: string;
}

interface NativeSpotifyTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  external_url: string;
  playback_url: string;
  album?: string;
  isrc?: string;
}

interface InvidiousVideo {
  videoId?: string;
  title?: string;
  author?: string;
  videoThumbnails?: { url?: string }[];
}

const INVIDIOUS_INSTANCES = [
  "https://inv.thepixora.com",
  "https://inv.nadeko.net",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://invidious.f5.si",
];

const INVIDIOUS_TIMEOUT_MS = 3000;

let instanceIndex = 0;
let lastSpotifyImportStats: PlaylistImportStats | null = null;

export function getLastSpotifyImportStats() {
  return lastSpotifyImportStats;
}

async function invFetch(path: string): Promise<Response> {
  if (import.meta.env.DEV) {
    for (let i = 0; i < INVIDIOUS_INSTANCES.length; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
      try {
        const res = await fetch(`/inv${path}`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return res;
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Invidious proxy failed");
  }

  const tried = new Set<number>();
  while (tried.size < INVIDIOUS_INSTANCES.length) {
    tried.add(instanceIndex);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INVIDIOUS_TIMEOUT_MS);
    try {
      const res = await fetch(`${INVIDIOUS_INSTANCES[instanceIndex]}${path}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch {
    } finally {
      clearTimeout(timer);
    }
    instanceIndex = (instanceIndex + 1) % INVIDIOUS_INSTANCES.length;
  }
  throw new Error("All Invidious instances failed");
}

function getSpotifyClientId() {
  return import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
}

function getSpotifyClientSecret() {
  return import.meta.env.VITE_SPOTIFY_CLIENT_SECRET as string | undefined;
}

export function getYoutubePlaylistId(url: string) {
  try {
    return new URL(url).searchParams.get("list") || "";
  } catch {
    return "";
  }
}

export function getSpotifyPlaylistId(url: string) {
  try {
    const parsed = new URL(url);
    const playlistIndex = parsed.pathname
      .split("/")
      .findIndex((part) => part === "playlist");
    return playlistIndex >= 0
      ? parsed.pathname.split("/")[playlistIndex + 1] || ""
      : "";
  } catch {
    return "";
  }
}

export function toTrack(result: MusicSearchResult): MusicTrack {
  const thumbnail = result.videoId
    ? `https://i.ytimg.com/vi/${result.videoId}/mqdefault.jpg`
    : result.thumbnail;

  return {
    id: `${result.provider}:${result.id}`,
    title: result.title,
    artist: result.artist,
    url: result.playbackUrl || "",
    thumbnail,
    externalUrl: result.externalUrl,
    provider: result.provider,
    videoId: result.videoId,
  };
}

function bestThumbnail(thumbnails?: { url?: string }[], videoId?: string) {
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  return thumbnails?.[0]?.url || "";
}

async function findYouTubeFallbackTrack(query: string) {
  try {
    const results = await searchYouTubeMusic(query);
    return results[0] || null;
  } catch {
    return null;
  }
}

export async function searchYouTubeMusic(
  query: string
): Promise<MusicSearchResult[]> {
  const res = await invFetch(
    `/api/v1/search?q=${encodeURIComponent(query)}&type=video`
  );
  const data = (await res.json()) as InvidiousVideo[];

  return (Array.isArray(data) ? data : [])
    .filter((item) => item.videoId && item.title)
    .slice(0, 18)
    .map((item) => ({
      id: item.videoId!,
      provider: "youtube" as MusicProvider,
      title: item.title || "YouTube track",
      artist: item.author || "YouTube Music",
      thumbnail: bestThumbnail(item.videoThumbnails, item.videoId),
      externalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
      playbackUrl: `https://www.youtube.com/embed/${item.videoId}?autoplay=1&rel=0`,
      videoId: item.videoId,
    }));
}

export async function searchYouTubeTrending(
  regionCode = "US",
  maxResults = 10
): Promise<MusicSearchResult[]> {
  const res = await invFetch(
    `/api/v1/trending?region=${regionCode}&type=music`
  );
  const data = (await res.json()) as InvidiousVideo[];

  return (Array.isArray(data) ? data : [])
    .filter((item) => item.videoId && item.title)
    .slice(0, maxResults)
    .map((item) => ({
      id: item.videoId!,
      provider: "youtube" as MusicProvider,
      title: item.title || "YouTube track",
      artist: item.author || "YouTube",
      thumbnail: bestThumbnail(item.videoThumbnails, item.videoId),
      externalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
      playbackUrl: `https://www.youtube.com/embed/${item.videoId}?autoplay=1&rel=0`,
      videoId: item.videoId,
    }));
}

export async function importYouTubePlaylist(
  url: string
): Promise<MusicSearchResult[]> {
  const playlistId = getYoutubePlaylistId(url);
  if (!playlistId) throw new Error("Invalid YouTube playlist URL");

  const YT_KEY = "AIzaSyBVAKbDz5fMbNJDxDBxFpxMj-AYJbwMnUg";
  const allItems: any[] = [];
  let pageToken: string | undefined = undefined;
  const MAX_SONGS = 300;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      playlistId,
      maxResults: "50",
      key: YT_KEY,
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`
    );
    if (!res.ok) throw new Error(`YouTube playlist import failed: ${res.status}`);

    const data = (await res.json()) as {
      items?: any[];
      nextPageToken?: string;
    };
    allItems.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken && allItems.length < MAX_SONGS);

  return allItems
    .slice(0, MAX_SONGS)
    .filter(
      (item: any) =>
        item.snippet?.resourceId?.videoId && item.snippet?.title
    )
    .map((item: any) => {
      const videoId = item.snippet.resourceId.videoId;
      return {
        id: videoId,
        provider: "youtube" as MusicProvider,
        title: item.snippet.title,
        artist:
          item.snippet.videoOwnerChannelTitle ||
          item.snippet.channelTitle ||
          "YouTube",
        thumbnail:
          item.snippet.thumbnails?.medium?.url ||
          item.snippet.thumbnails?.default?.url ||
          "",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        playbackUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
        videoId,
      };
    });
}

async function getSpotifyAccessToken() {
  const clientId = getSpotifyClientId();
  const clientSecret = getSpotifyClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing VITE_SPOTIFY_CLIENT_ID or VITE_SPOTIFY_CLIENT_SECRET"
    );
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok)
    throw new Error(`Spotify auth failed: ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("Spotify did not return an access token");
  return data.access_token;
}

async function getSpotifyCandidatesWithCredentials(
  url: string
): Promise<SpotifyTrackCandidate[]> {
  const playlistId = getSpotifyPlaylistId(url);
  if (!playlistId) throw new Error("Invalid Spotify playlist URL");

  const token = await getSpotifyAccessToken();
  const candidates: SpotifyTrackCandidate[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?${new URLSearchParams({
    fields: "items(track(id,name,external_urls,external_ids(isrc),preview_url,artists(name),album(name,images))),next",
    limit: "50",
  })}`;

  while (nextUrl && candidates.length < 300) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok)
      throw new Error(`Spotify playlist import failed: ${response.status}`);
    const data = (await response.json()) as { items?: SpotifyPlaylistTrack[]; next?: string | null };

    for (const item of data.items || []) {
      const track = item.track;
      if (!track?.id || !track.name) continue;
      const images = track?.album?.images || [];
      candidates.push({
        title: track?.name || "Spotify track",
        artist:
          track?.artists
            ?.map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Spotify",
        album: track.album?.name || "",
        isrc: track.external_ids?.isrc || "",
        thumbnail:
          images[1]?.url || images[0]?.url || images[2]?.url || "",
      });
    }

    nextUrl = data.next || null;
  }

  return candidates.slice(0, 300);
}

function decodeHtmlEntities(value: string) {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function addSpotifyCandidate(
  candidates: SpotifyTrackCandidate[],
  seen: Set<string>,
  title: string,
  artist: string,
  thumbnail?: string,
) {
  const cleanTitle = decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
  const cleanArtist = decodeHtmlEntities(artist).replace(/\s+/g, " ").trim();
  const key = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
  if (!cleanTitle || !cleanArtist || seen.has(key)) return;
  if (/^(spotify|playlist|episode|album)$/i.test(cleanTitle)) return;
  seen.add(key);
  candidates.push({ title: cleanTitle, artist: cleanArtist, thumbnail });
}

function extractSpotifyJsonCandidates(
  text: string,
  candidates: SpotifyTrackCandidate[],
  seen: Set<string>,
) {
  const trackRe = /"name"\s*:\s*"([^"]{1,160})"[\s\S]{0,900}?"artists"\s*:\s*\[([\s\S]{0,700}?)\]/g;
  for (const match of text.matchAll(trackRe)) {
    const artistNames = Array.from(match[2].matchAll(/"name"\s*:\s*"([^"]{1,120})"/g))
      .map((artistMatch) => artistMatch[1])
      .filter(Boolean);
    if (artistNames.length > 0) addSpotifyCandidate(candidates, seen, match[1], artistNames.join(", "));
  }
}

function extractSpotifyPublicCandidates(text: string): SpotifyTrackCandidate[] {
  const seen = new Set<string>();
  const candidates: SpotifyTrackCandidate[] = [];
  const normalized = decodeHtmlEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n");

  extractSpotifyJsonCandidates(text, candidates, seen);

  const lines = normalized
    .replace(/\\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (candidates.length >= 50) break;
    if (/^(title|spotify|playlist|duration|preview|open app|log in|sign up)$/i.test(line)) continue;
    const cleaned = line.replace(/^[-*#\d.]+\s*/, "").trim();
    const byMatch = cleaned.match(/^(.{2,90}?)\s+(?:by|de|por)\s+(.{2,90})$/i);
    const dashMatch = cleaned.match(/^(.{2,90}?)\s+[-–—]\s+(.{2,90})$/);
    const match = byMatch || dashMatch;
    if (!match) continue;
    addSpotifyCandidate(
      candidates,
      seen,
      match[1].replace(/^["']|["']$/g, ""),
      match[2].replace(/^["']|["']$/g, ""),
    );
  }

  return candidates;
}

async function searchCandidatesOnYouTube(
  candidates: SpotifyTrackCandidate[],
) {
  const results: MusicSearchResult[] = [];
  const queue = candidates.slice(0, 300);
  const concurrency = 6;
  const usedVideoIds = new Set<string>();

  for (let index = 0; index < queue.length; index += concurrency) {
    const chunk = queue.slice(index, index + concurrency);
    const found = await Promise.all(
      chunk.map(async (candidate) => {
        const match = await findYouTubeFallbackTrack(`${candidate.title} ${candidate.artist}`);
        if (!match || (match.videoId && usedVideoIds.has(match.videoId))) return null;
        return {
          ...match,
          thumbnail: match.thumbnail || candidate.thumbnail || "",
        };
      }),
    );
    for (const track of found) {
      if (!track) continue;
      if (track.videoId) usedVideoIds.add(track.videoId);
      results.push(track);
    }
  }
  return results;
}

async function getSpotifyCandidatesFromNativePublic(url: string): Promise<SpotifyTrackCandidate[]> {
  const nativeTracks = await invoke<NativeSpotifyTrack[]>("import_spotify_playlist_public_native", { url });
  return nativeTracks
    .filter((track) => track.title?.trim())
    .slice(0, 300)
    .map((track) => ({
      title: track.title,
      artist: track.artist || "Spotify",
      album: track.album || "",
      isrc: track.isrc || "",
      thumbnail: track.thumbnail,
    }));
}

async function getSpotifyCandidatesFromPublicEmbed(url: string): Promise<SpotifyTrackCandidate[]> {
  const playlistId = getSpotifyPlaylistId(url);
  if (!playlistId) {
    const candidates = extractSpotifyPublicCandidates(url);
    if (candidates.length === 0) throw new Error("Invalid Spotify playlist URL or pasted track list");
    return candidates;
  }

  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  let text = "";
  try {
    const directResponse = await fetch(embedUrl);
    if (directResponse.ok) text = await directResponse.text();
  } catch {
    // Some webviews block Spotify's embed with CORS. The reader fallback still reads the public embed URL.
  }
  if (!text) {
    const readerResponse = await fetch(`https://r.jina.ai/${embedUrl}`);
    if (!readerResponse.ok) throw new Error(`Spotify embed import failed: ${readerResponse.status}`);
    text = await readerResponse.text();
  }
  const candidates = extractSpotifyPublicCandidates(text);
  if (candidates.length === 0) {
    throw new Error("No se pudo leer esta playlist. Prueba con una playlist pública o pega otro link.");
  }
  return candidates;
}

export async function importSpotifyPlaylist(url: string): Promise<MusicSearchResult[]> {
  let candidates: SpotifyTrackCandidate[] = [];
  lastSpotifyImportStats = null;
  try {
    candidates = await getSpotifyCandidatesFromNativePublic(url);
  } catch (error) {
    try {
      candidates = await getSpotifyCandidatesFromPublicEmbed(url);
    } catch (embedError) {
      if (!getSpotifyClientId() || !getSpotifyClientSecret()) throw embedError;
      console.warn("Spotify public import failed; trying credentials fallback", error, embedError);
      candidates = await getSpotifyCandidatesWithCredentials(url);
    }
  }
  const youtubeTracks = await searchCandidatesOnYouTube(candidates);
  lastSpotifyImportStats = { found: youtubeTracks.length, total: candidates.length };
  if (youtubeTracks.length === 0) {
    throw new Error("No se pudo leer esta playlist. Prueba con una playlist pública o pega otro link.");
  }
  if (youtubeTracks.length < candidates.length) {
    console.warn(`Spotify import: ${youtubeTracks.length}/${candidates.length} tracks were found on YouTube.`);
  }
  return youtubeTracks;
}
