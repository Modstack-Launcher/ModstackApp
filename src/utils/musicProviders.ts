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

type ThumbnailMap = {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
};

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: ThumbnailMap;
  };
}

interface YouTubePlaylistItem {
  snippet?: {
    title?: string;
    videoOwnerChannelTitle?: string;
    channelTitle?: string;
    resourceId?: { videoId?: string };
    thumbnails?: ThumbnailMap;
  };
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

function getYoutubeApiKey() {
  return import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;
}

function getSpotifyClientId() {
  return import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
}

function getSpotifyClientSecret() {
  return import.meta.env.VITE_SPOTIFY_CLIENT_SECRET as string | undefined;
}

function getBestThumbnail(thumbnails?: ThumbnailMap) {
  return thumbnails?.medium?.url || thumbnails?.high?.url || thumbnails?.default?.url || "";
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

export async function searchYouTubeMusic(query: string): Promise<MusicSearchResult[]> {
  const apiKey = getYoutubeApiKey();
  if (!apiKey) {
    throw new Error("Missing VITE_YOUTUBE_API_KEY");
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    maxResults: "18",
    q: query,
    key: apiKey,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) throw new Error(`YouTube search failed: ${response.status}`);
  const data = (await response.json()) as { items?: YouTubeSearchItem[] };

  return (data.items || [])
    .filter((item) => item.id?.videoId && item.snippet?.title)
    .map((item) => {
      const videoId = item.id?.videoId || "";
      return {
        id: videoId,
        provider: "youtube",
        title: item.snippet?.title || "YouTube track",
        artist: item.snippet?.channelTitle || "YouTube Music",
        thumbnail: getBestThumbnail(item.snippet?.thumbnails),
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        playbackUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
        videoId,
      };
    });
}

export async function importYouTubePlaylist(url: string): Promise<MusicSearchResult[]> {
  const apiKey = getYoutubeApiKey();
  const playlistId = getYoutubePlaylistId(url);
  if (!apiKey) throw new Error("Missing VITE_YOUTUBE_API_KEY");
  if (!playlistId) throw new Error("Invalid YouTube playlist URL");

  const params = new URLSearchParams({
    part: "snippet",
    playlistId,
    maxResults: "50",
    key: apiKey,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
  );
  if (!response.ok) throw new Error(`YouTube playlist import failed: ${response.status}`);
  const data = (await response.json()) as { items?: YouTubePlaylistItem[] };

  return (data.items || [])
    .filter((item) => item.snippet?.resourceId?.videoId && item.snippet?.title)
    .map((item) => {
      const videoId = item.snippet?.resourceId?.videoId || "";
      return {
        id: videoId,
        provider: "youtube",
        title: item.snippet?.title || "YouTube track",
        artist:
          item.snippet?.videoOwnerChannelTitle ||
          item.snippet?.channelTitle ||
          "YouTube Music",
        thumbnail: getBestThumbnail(item.snippet?.thumbnails),
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        playbackUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
        videoId,
      };
    });
}

async function findYouTubeFallbackTrack(query: string) {
  const apiKey = getYoutubeApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    maxResults: "1",
    q: query,
    key: apiKey,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { items?: YouTubeSearchItem[] };
  const item = data.items?.find((entry) => entry.id?.videoId && entry.snippet?.title);
  if (!item?.id?.videoId) return null;

  const videoId = item.id.videoId;
  return {
    videoId,
    thumbnail: getBestThumbnail(item.snippet?.thumbnails),
    externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    playbackUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
  };
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
    fields:
      "items(track(id,name,external_urls,preview_url,artists(name),album(images)))",
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
          track?.artists
            ?.map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Spotify",
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
        provider: "youtube",
        thumbnail: track.thumbnail || fallback.thumbnail,
        externalUrl: track.externalUrl || fallback.externalUrl,
        playbackUrl: fallback.playbackUrl,
        videoId: fallback.videoId,
      };
    }),
  );
}
