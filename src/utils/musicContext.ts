import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  thumbnail?: string;
  externalUrl?: string;
  provider?: "youtube" | "spotify" | "local";
  videoId?: string;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  trackIds: string[];
  createdAt: number;
}

interface StoredMusicState {
  tracks: MusicTrack[];
  playlists: MusicPlaylist[];
  currentIndex: number;
  volume: number;
  youtubePlaylistUrl: string;
}

interface MusicState extends StoredMusicState {
  isPlaying: boolean;
  miniPlayerHidden: boolean;
  addTrack: (track: Omit<MusicTrack, "id"> & { id?: string }) => void;
  addTracks: (tracks: MusicTrack[]) => void;
  createPlaylist: (name: string, trackIds?: string[]) => MusicPlaylist;
  removePlaylist: (id: string) => void;
  updatePlaylist: (id: string, changes: Partial<Pick<MusicPlaylist, "name" | "description" | "logoUrl">>) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  playPlaylist: (id: string) => void;
  removeTrack: (id: string) => void;
  playTrack: (id: string) => void;
  togglePlayback: () => void;
  hideMiniPlayer: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  setPlaying: (value: boolean) => void;
  setVolume: (value: number) => void;
  setYoutubePlaylistUrl: (value: string) => void;
}

const STORAGE_KEY = "modstack.music";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadMusicState(): StoredMusicState {
  if (typeof localStorage === "undefined") {
    return { tracks: [], playlists: [], currentIndex: 0, volume: 0.7, youtubePlaylistUrl: "" };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<StoredMusicState>;
    return {
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      currentIndex: Number.isInteger(parsed.currentIndex) ? parsed.currentIndex || 0 : 0,
      volume: typeof parsed.volume === "number" ? parsed.volume : 0.7,
      youtubePlaylistUrl: typeof parsed.youtubePlaylistUrl === "string" ? parsed.youtubePlaylistUrl : "",
    };
  } catch {
    return { tracks: [], playlists: [], currentIndex: 0, volume: 0.7, youtubePlaylistUrl: "" };
  }
}

function saveMusicState(state: StoredMusicState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isPlayableTrack(track?: MusicTrack | null) {
  if (!track) return false;
  if (track.provider === "youtube") return Boolean(track.videoId);
  return Boolean(track.url);
}

function syncDiscord(tracks: MusicTrack[], currentIndex: number, isPlaying: boolean) {
  const track = tracks[currentIndex] ?? null;
  if (isPlaying && track) {
    invoke("discord_set_music", {
      track: track.title,
      thumbnail: track.thumbnail ?? null,
    }).catch(() => {});
  } else {
    invoke("discord_set_music", { track: null, thumbnail: null }).catch(() => {});
  }
}

const initialState = loadMusicState();

export const useMusic = create<MusicState>((set, get) => ({
  ...initialState,
  isPlaying: false,
  miniPlayerHidden: false,

  addTrack: (track) => {
    const nextTrack = { ...track, id: track.id || createId() };
    set((state) => {
      const nextState = {
        tracks: [
          ...state.tracks.filter((storedTrack) => storedTrack.id !== nextTrack.id),
          nextTrack,
        ],
        playlists: state.playlists,
        currentIndex: state.tracks.length === 0 ? 0 : state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return nextState;
    });
  },

  addTracks: (tracks) => {
    set((state) => {
      const storedById = new Map(state.tracks.map((track) => [track.id, track]));
      tracks.forEach((track) => storedById.set(track.id, track));
      const nextTracks = Array.from(storedById.values());
      const nextState = {
        tracks: nextTracks,
        playlists: state.playlists,
        currentIndex: state.tracks.length === 0 ? 0 : state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return nextState;
    });
  },

  createPlaylist: (name, trackIds) => {
    const playlist = {
      id: createId(),
      name: name.trim() || "New playlist",
      trackIds: trackIds || get().tracks.map((track) => track.id),
      createdAt: Date.now(),
    };
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: [...state.playlists, playlist],
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
    return playlist;
  },

  removePlaylist: (id) => {
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists.filter((playlist) => playlist.id !== id),
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  updatePlaylist: (id, changes) => {
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists.map((playlist) =>
          playlist.id === id ? { ...playlist, ...changes } : playlist,
        ),
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  addTrackToPlaylist: (playlistId, trackId) => {
    get().addTracksToPlaylist(playlistId, [trackId]);
  },

  addTracksToPlaylist: (playlistId, trackIds) => {
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists.map((playlist) => {
          if (playlist.id !== playlistId) return playlist;
          const nextTrackIds = Array.from(new Set([...playlist.trackIds, ...trackIds]));
          return { ...playlist, trackIds: nextTrackIds };
        }),
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  removeTrackFromPlaylist: (playlistId, trackId) => {
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists.map((playlist) =>
          playlist.id === playlistId
            ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
            : playlist,
        ),
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  playPlaylist: (id) => {
    const state = get();
    const playlist = state.playlists.find((item) => item.id === id);
    const firstTrackId = playlist?.trackIds.find((trackId) =>
      state.tracks.some((track) => track.id === trackId && isPlayableTrack(track)),
    );
    if (firstTrackId) state.playTrack(firstTrackId);
  },

  removeTrack: (id) => {
    set((state) => {
      const removedIndex = state.tracks.findIndex((track) => track.id === id);
      const tracks = state.tracks.filter((track) => track.id !== id);
      const currentIndex =
        tracks.length === 0
          ? 0
          : Math.min(
              removedIndex >= 0 && removedIndex < state.currentIndex
                ? state.currentIndex - 1
                : state.currentIndex,
              tracks.length - 1,
            );
      const nextState = {
        tracks,
        playlists: state.playlists.map((playlist) => ({
          ...playlist,
          trackIds: playlist.trackIds.filter((trackId) => trackId !== id),
        })),
        currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      const nextIsPlaying = tracks.length > 0 && state.isPlaying;
      syncDiscord(tracks, currentIndex, nextIsPlaying);
      return { ...nextState, isPlaying: nextIsPlaying };
    });
  },

  playTrack: (id) => {
    const index = get().tracks.findIndex(
      (track) => track.id === id && isPlayableTrack(track),
    );
    if (index === -1) return;
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists,
        currentIndex: index,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      syncDiscord(state.tracks, index, true);
      return { currentIndex: index, isPlaying: true, miniPlayerHidden: false };
    });
  },

  togglePlayback: () => {
    if (get().tracks.length === 0) return;
    set((state) => {
      const nextIsPlaying = !state.isPlaying;
      syncDiscord(state.tracks, state.currentIndex, nextIsPlaying);
      return {
        isPlaying: nextIsPlaying,
        miniPlayerHidden: state.isPlaying ? state.miniPlayerHidden : false,
      };
    });
  },

  hideMiniPlayer: () => {
    syncDiscord(get().tracks, get().currentIndex, false);
    set({ isPlaying: false, miniPlayerHidden: true });
  },

  nextTrack: () => {
    set((state) => {
      if (state.tracks.length === 0) return state;
      let currentIndex = state.currentIndex;
      for (let offset = 1; offset <= state.tracks.length; offset += 1) {
        const nextIndex = (state.currentIndex + offset) % state.tracks.length;
        if (isPlayableTrack(state.tracks[nextIndex])) {
          currentIndex = nextIndex;
          break;
        }
      }
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists,
        currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      syncDiscord(state.tracks, currentIndex, true);
      return { currentIndex, isPlaying: true, miniPlayerHidden: false };
    });
  },

  previousTrack: () => {
    set((state) => {
      if (state.tracks.length === 0) return state;
      let currentIndex = state.currentIndex;
      for (let offset = 1; offset <= state.tracks.length; offset += 1) {
        const previousIndex =
          (state.currentIndex - offset + state.tracks.length) % state.tracks.length;
        if (isPlayableTrack(state.tracks[previousIndex])) {
          currentIndex = previousIndex;
          break;
        }
      }
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists,
        currentIndex,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      syncDiscord(state.tracks, currentIndex, true);
      return { currentIndex, isPlaying: true, miniPlayerHidden: false };
    });
  },

  setPlaying: (value) => {
    set((state) => {
      syncDiscord(state.tracks, state.currentIndex, value);
      return {
        isPlaying: value,
        miniPlayerHidden: value ? false : state.miniPlayerHidden,
      };
    });
  },

  setVolume: (volume) => {
    const normalized = Math.min(1, Math.max(0, volume));
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists,
        currentIndex: state.currentIndex,
        volume: normalized,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { volume: normalized };
    });
  },

  setYoutubePlaylistUrl: (youtubePlaylistUrl) => {
    set((state) => {
      const nextState = {
        tracks: state.tracks,
        playlists: state.playlists,
        currentIndex: state.currentIndex,
        volume: state.volume,
        youtubePlaylistUrl,
      };
      saveMusicState(nextState);
      return { youtubePlaylistUrl };
    });
  },
}));

export function getCurrentTrack(state: Pick<MusicState, "tracks" | "currentIndex">) {
  return state.tracks[state.currentIndex] ?? null;
}