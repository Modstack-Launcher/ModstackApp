import type { MusicTrack } from "./musicContext";

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

interface SpotifyImage {
  url?: string;
}

interface SpotifyPlaylistTrack {
  track?: {
    id?: string;
    name?: string;
    external_urls?: { spotify?: string };
    preview_url?: string | null;
    artists?: { name?: string }[];
    album?: { images?: SpotifyImage[] };
  } | null;
}

interface InvidiousVideo {
  videoId?: string;
  title?: string;
  author?: string;
  videoThumbnails?: { url?: string }[];
}

async function invFetch(path: string): Promise<Response> {
  if (import.meta.env.DEV) {
    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const res = await fetch(`/inv${path}`);
        if (res.ok) return res;
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error("Invidious proxy failed");
  }
  const res = await fetch(`https://inv.thepixora.com${path}`);
  if (res.ok) return res;
  throw new Error("Invidious failed");
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
    const playlistIndex = parsed.pathname.split("/").findIndex((part) => part === "playlist");
    return playlistIndex >= 0 ? parsed.pathname.split("/")[playlistIndex + 1] || "" : "";
  } catch {
    return "";
  }
}

export function toTrack(result: MusicSearchResult): MusicTrack {
  return {
    id: `${result.provider}:${result.id}`,
    title: result.title,
    artist: result.artist,
    url: result.playbackUrl || "",
    thumbnail: result.thumbnail,
    externalUrl: result.externalUrl,
    provider: result.provider,
    videoId: result.videoId,
  };
}

function bestThumbnail(thumbnails?: { url?: string }[]) {
  return thumbnails?.[0]?.url || "";
}

export async function searchYouTubeMusic(query: string): Promise<MusicSearchResult[]> {
  const res = await invFetch(`/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
  const data = await res.json() as InvidiousVideo[];

  return (Array.isArray(data) ? data : [])
    .filter((item) => item.videoId && item.title)
    .slice(0, 18)
    .map((item) => ({
      id: item.videoId!,
      provider: "youtube" as MusicProvider,
      title: item.title || "YouTube track",
      artist: item.author || "YouTube Music",
      thumbnail: bestThumbnail(item.videoThumbnails),
      externalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
      playbackUrl: `https://www.youtube.com/embed/${item.videoId}?autoplay=1&rel=0`,
      videoId: item.videoId,
    }));
}

export async function searchYouTubeTrending(regionCode = "US", maxResults = 10): Promise<MusicSearchResult[]> {
  const res = await invFetch(`/api/v1/trending?region=${regionCode}&type=music`);
  const data = await res.json() as InvidiousVideo[];

  return (Array.isArray(data) ? data : [])
    .filter((item) => item.videoId && item.title)
    .slice(0, maxResults)
    .map((item) => ({
      id: item.videoId!,
      provider: "youtube" as MusicProvider,
      title: item.title || "YouTube track",
      artist: item.author || "YouTube",
      thumbnail: bestThumbnail(item.videoThumbnails),
      externalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
      playbackUrl: `https://www.youtube.com/embed/${item.videoId}?autoplay=1&rel=0`,
      videoId: item.videoId,
    }));
}

export async function importYouTubePlaylist(url: string): Promise<MusicSearchResult[]> {
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

    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    if (!res.ok) throw new Error(`YouTube playlist import failed: ${res.status}`);

    const data = await res.json() as { items?: any[]; nextPageToken?: string };
    allItems.push(...(data.items || []));
    pageToken = data.nextPageToken;

  } while (pageToken && allItems.length < MAX_SONGS);

  return allItems
    .slice(0, MAX_SONGS)
    .filter((item: any) => item.snippet?.resourceId?.videoId && item.snippet?.title)
    .map((item: any) => {
      const videoId = item.snippet.resourceId.videoId;
      return {
        id: videoId,
        provider: "youtube" as MusicProvider,
        title: item.snippet.title,
        artist: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle || "YouTube",
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        playbackUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
        videoId,
      };
    });
}

async function findYouTubeFallbackTrack(query: string) {
  try {
    const results = await searchYouTubeMusic(query);
    const item = results[0];
    if (!item) return null;
    return {
      videoId: item.videoId,
      thumbnail: item.thumbnail,
      externalUrl: item.externalUrl,
      playbackUrl: item.playbackUrl,
    };
  } catch {
    return null;
  }
}

async function getSpotifyAccessToken() {
  const clientId = getSpotifyClientId();
  const clientSecret = getSpotifyClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Missing VITE_SPOTIFY_CLIENT_ID or VITE_SPOTIFY_CLIENT_SECRET");
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
  if (!response.ok) throw new Error(`Spotify auth failed: ${response.status}`);
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Spotify did not return an access token");
  return data.access_token;
}

export async function importSpotifyPlaylist(url: string): Promise<MusicSearchResult[]> {
  const playlistId = getSpotifyPlaylistId(url);
  if (!playlistId) throw new Error("Invalid Spotify playlist URL");

  const token = await getSpotifyAccessToken();
  const params = new URLSearchParams({
    fields: "items(track(id,name,external_urls,preview_url,artists(name),album(images)))",
    limit: "50",
  });
  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Spotify playlist import failed: ${response.status}`);
  const data = (await response.json()) as { items?: SpotifyPlaylistTrack[] };

  const spotifyTracks: MusicSearchResult[] = (data.items || [])
    .filter((item) => item.track?.id && item.track?.name)
    .map((item) => {
      const track = item.track;
      const id = track?.id || "";
      const images = track?.album?.images || [];
      return {
        id,
        provider: "spotify" as const,
        title: track?.name || "Spotify track",
        artist:
          track?.artists?.map((artist) => artist.name).filter(Boolean).join(", ") || "Spotify",
        thumbnail: images[1]?.url || images[0]?.url || images[2]?.url || "",
        externalUrl: track?.external_urls?.spotify || `https://open.spotify.com/track/${id}`,
        playbackUrl: track?.preview_url || "",
      };
    });

  return Promise.all(
    spotifyTracks.map(async (track) => {
      if (track.playbackUrl) return track;
      const fallback = await findYouTubeFallbackTrack(`${track.title} ${track.artist}`);
      if (!fallback) return track;
      return {
        ...track,
        id: `${track.id}:youtube:${fallback.videoId}`,
        provider: "youtube" as MusicProvider,
        thumbnail: track.thumbnail || fallback.thumbnail,
        externalUrl: track.externalUrl || fallback.externalUrl,
        playbackUrl: fallback.playbackUrl,
        videoId: fallback.videoId,
      };
    }),
  );
}