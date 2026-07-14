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
  activeTrackIds: string[] | null;
  volume: number;
  youtubePlaylistUrl: string;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
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
  clearActivePlaylist: () => void;
  clearLibrary: () => void;
  removeTrack: (id: string) => void;
  playTrack: (id: string) => void;
  togglePlayback: () => void;
  hideMiniPlayer: () => void;
  nextTrack: (forceAdvance?: boolean) => void;
  previousTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeatMode: () => void;
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
    return { tracks: [], playlists: [], currentIndex: 0, activeTrackIds: null, volume: 0.7, youtubePlaylistUrl: "", shuffle: false, repeatMode: "off" };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<StoredMusicState> & { queue?: string[]; currentQueueIndex?: number };
    const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
    const currentIndex =
      typeof parsed.currentIndex === "number" ? parsed.currentIndex :
      typeof parsed.currentQueueIndex === "number" ? parsed.currentQueueIndex : 0;
    return {
      tracks,
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      currentIndex: Math.max(0, Math.min(currentIndex, Math.max(0, tracks.length - 1))),
      activeTrackIds: null,
      volume: typeof parsed.volume === "number" ? parsed.volume : 0.7,
      youtubePlaylistUrl: typeof parsed.youtubePlaylistUrl === "string" ? parsed.youtubePlaylistUrl : "",
      shuffle: Boolean(parsed.shuffle),
      repeatMode: parsed.repeatMode === "one" || parsed.repeatMode === "all" ? parsed.repeatMode : "off",
    };
  } catch {
    return { tracks: [], playlists: [], currentIndex: 0, activeTrackIds: null, volume: 0.7, youtubePlaylistUrl: "", shuffle: false, repeatMode: "off" };
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
      const nextState: StoredMusicState = {
        tracks: [...state.tracks.filter((t) => t.id !== nextTrack.id), nextTrack],
        playlists: state.playlists,
        currentIndex: state.tracks.length === 0 ? 0 : state.currentIndex,
        activeTrackIds: state.activeTrackIds,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
        shuffle: state.shuffle,
        repeatMode: state.repeatMode,
      };
      saveMusicState(nextState);
      return nextState;
    });
  },

  addTracks: (tracks) => {
    set((state) => {
      const storedById = new Map(state.tracks.map((t) => [t.id, t]));
      tracks.forEach((t) => storedById.set(t.id, t));
      const nextTracks = Array.from(storedById.values());
      const nextState: StoredMusicState = {
        tracks: nextTracks,
        playlists: state.playlists,
        currentIndex: state.tracks.length === 0 ? 0 : state.currentIndex,
        activeTrackIds: state.activeTrackIds,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
        shuffle: state.shuffle,
        repeatMode: state.repeatMode,
      };
      saveMusicState(nextState);
      return nextState;
    });
  },

  createPlaylist: (name, trackIds) => {
    const playlist: MusicPlaylist = {
      id: createId(),
      name: name.trim() || "New playlist",
      trackIds: trackIds || [],
      createdAt: Date.now(),
    };
    set((state) => {
      const nextState: StoredMusicState = { ...state, playlists: [...state.playlists, playlist] };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
    return playlist;
  },

  removePlaylist: (id) => {
    set((state) => {
      const nextState: StoredMusicState = { ...state, playlists: state.playlists.filter((p) => p.id !== id) };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  updatePlaylist: (id, changes) => {
    set((state) => {
      const nextState: StoredMusicState = {
        ...state,
        playlists: state.playlists.map((p) => (p.id === id ? { ...p, ...changes } : p)),
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
      const nextState: StoredMusicState = {
        ...state,
        playlists: state.playlists.map((p) => {
          if (p.id !== playlistId) return p;
          return { ...p, trackIds: Array.from(new Set([...p.trackIds, ...trackIds])) };
        }),
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  removeTrackFromPlaylist: (playlistId, trackId) => {
    set((state) => {
      const nextState: StoredMusicState = {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p,
        ),
      };
      saveMusicState(nextState);
      return { playlists: nextState.playlists };
    });
  },

  playPlaylist: (id) => {
    const state = get();
    const playlist = state.playlists.find((p) => p.id === id);
    if (!playlist) return;

    const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
    const playlistTrackIds = playlist.trackIds.filter((tid) => {
      const t = tracksById.get(tid);
      return Boolean(t) && isPlayableTrack(t);
    });

    if (playlistTrackIds.length === 0) return;

    set((s) => {
      const nextState: StoredMusicState = {
        ...s,
        currentIndex: 0,
        activeTrackIds: playlistTrackIds,
      };
      saveMusicState(nextState);
      const firstTrack = tracksById.get(playlistTrackIds[0])!;
      syncDiscord([firstTrack], 0, true);
      return { ...nextState, isPlaying: true, miniPlayerHidden: false };
    });
  },

  clearActivePlaylist: () => {
    set((s) => {
      const nextState: StoredMusicState = { ...s, activeTrackIds: null, currentIndex: 0 };
      saveMusicState(nextState);
      return nextState;
    });
  },

  clearLibrary: () => {
    set((state) => {
      const nextState: StoredMusicState = {
        ...state,
        tracks: [],
        playlists: state.playlists.map((playlist) => ({ ...playlist, trackIds: [] })),
        currentIndex: 0,
        activeTrackIds: null,
      };
      saveMusicState(nextState);
      syncDiscord([], 0, false);
      return { ...nextState, isPlaying: false };
    });
  },

  removeTrack: (id) => {
    set((state) => {
      const removedIndex = state.tracks.findIndex((t) => t.id === id);
      const tracks = state.tracks.filter((t) => t.id !== id);
      const currentIndex =
        tracks.length === 0 ? 0
        : Math.min(
            removedIndex >= 0 && removedIndex < state.currentIndex
              ? state.currentIndex - 1
              : state.currentIndex,
            tracks.length - 1,
          );
      const nextState: StoredMusicState = {
        tracks,
        playlists: state.playlists,
        currentIndex,
        activeTrackIds: state.activeTrackIds,
        volume: state.volume,
        youtubePlaylistUrl: state.youtubePlaylistUrl,
        shuffle: state.shuffle,
        repeatMode: state.repeatMode,
      };
      saveMusicState(nextState);
      const nextIsPlaying = tracks.length > 0 && state.isPlaying;
      syncDiscord(tracks, currentIndex, nextIsPlaying);
      return { ...nextState, isPlaying: nextIsPlaying };
    });
  },

  playTrack: (id) => {
    const state = get();
    const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
    const activeTracks = state.activeTrackIds
      ? state.activeTrackIds.map((tid) => tracksById.get(tid)).filter((t): t is MusicTrack => Boolean(t))
      : state.tracks;
    const index = activeTracks.findIndex((t) => t.id === id && isPlayableTrack(t));
    if (index === -1) {
      const libIndex = state.tracks.findIndex((t) => t.id === id && isPlayableTrack(t));
      if (libIndex === -1) return;
      set((s) => {
        const nextState: StoredMusicState = { ...s, currentIndex: libIndex, activeTrackIds: null };
        saveMusicState(nextState);
        syncDiscord(s.tracks, libIndex, true);
        return { currentIndex: libIndex, activeTrackIds: null, isPlaying: true, miniPlayerHidden: false };
      });
      return;
    }
    set((s) => {
      const nextState: StoredMusicState = { ...s, currentIndex: index };
      saveMusicState(nextState);
      syncDiscord(activeTracks, index, true);
      return { currentIndex: index, isPlaying: true, miniPlayerHidden: false };
    });
  },

  togglePlayback: () => {
    if (get().tracks.length === 0) return;
    set((state) => {
      const nextIsPlaying = !state.isPlaying;
      syncDiscord(state.tracks, state.currentIndex, nextIsPlaying);
      return { isPlaying: nextIsPlaying, miniPlayerHidden: state.isPlaying ? state.miniPlayerHidden : false };
    });
  },

  hideMiniPlayer: () => {
    syncDiscord(get().tracks, get().currentIndex, false);
    set({ isPlaying: false, miniPlayerHidden: true });
  },

  nextTrack: (forceAdvance = false) => {
    set((state) => {
      const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
      const activeTracks = state.activeTrackIds
        ? state.activeTrackIds.map((id) => tracksById.get(id)).filter((t): t is MusicTrack => Boolean(t))
        : state.tracks;
      if (activeTracks.length === 0) return state;
      let currentIndex = state.currentIndex;
      if (state.repeatMode === "one" && !forceAdvance) {
        currentIndex = state.currentIndex;
      } else if (state.shuffle && activeTracks.length > 1) {
        const playableIndexes = activeTracks
          .map((track, index) => isPlayableTrack(track) ? index : -1)
          .filter((index) => index >= 0 && index !== state.currentIndex);
        if (playableIndexes.length > 0) currentIndex = playableIndexes[Math.floor(Math.random() * playableIndexes.length)];
      } else {
        for (let offset = 1; offset <= activeTracks.length; offset++) {
          const nextIndex = state.currentIndex + offset;
          if (nextIndex >= activeTracks.length && state.repeatMode === "off") break;
          const wrappedIndex = nextIndex % activeTracks.length;
          if (isPlayableTrack(activeTracks[wrappedIndex])) { currentIndex = wrappedIndex; break; }
        }
      }
      const nextState: StoredMusicState = { ...state, currentIndex };
      saveMusicState(nextState);
      syncDiscord(activeTracks, currentIndex, true);
      return { currentIndex, isPlaying: true, miniPlayerHidden: false };
    });
  },

  previousTrack: () => {
    set((state) => {
      const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
      const activeTracks = state.activeTrackIds
        ? state.activeTrackIds.map((id) => tracksById.get(id)).filter((t): t is MusicTrack => Boolean(t))
        : state.tracks;
      if (activeTracks.length === 0) return state;
      let currentIndex = state.currentIndex;
      if (state.shuffle && activeTracks.length > 1) {
        const playableIndexes = activeTracks
          .map((track, index) => isPlayableTrack(track) ? index : -1)
          .filter((index) => index >= 0 && index !== state.currentIndex);
        if (playableIndexes.length > 0) currentIndex = playableIndexes[Math.floor(Math.random() * playableIndexes.length)];
      } else {
        for (let offset = 1; offset <= activeTracks.length; offset++) {
          const prevIndex = state.currentIndex - offset;
          if (prevIndex < 0 && state.repeatMode === "off") break;
          const wrappedIndex = (prevIndex + activeTracks.length) % activeTracks.length;
          if (isPlayableTrack(activeTracks[wrappedIndex])) { currentIndex = wrappedIndex; break; }
        }
      }
      const nextState: StoredMusicState = { ...state, currentIndex };
      saveMusicState(nextState);
      syncDiscord(activeTracks, currentIndex, true);
      return { currentIndex, isPlaying: true, miniPlayerHidden: false };
    });
  },

  toggleShuffle: () => {
    set((state) => {
      const nextState: StoredMusicState = { ...state, shuffle: !state.shuffle };
      saveMusicState(nextState);
      return { shuffle: nextState.shuffle };
    });
  },

  toggleRepeatMode: () => {
    set((state) => {
      const repeatMode = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off";
      const nextState: StoredMusicState = { ...state, repeatMode };
      saveMusicState(nextState);
      return { repeatMode };
    });
  },

  setPlaying: (value) => {
    set((state) => {
      syncDiscord(state.tracks, state.currentIndex, value);
      return { isPlaying: value, miniPlayerHidden: value ? false : state.miniPlayerHidden };
    });
  },

  setVolume: (volume) => {
    const normalized = Math.min(1, Math.max(0, volume));
    set((state) => {
      const nextState: StoredMusicState = { ...state, volume: normalized };
      saveMusicState(nextState);
      return { volume: normalized };
    });
  },

  setYoutubePlaylistUrl: (youtubePlaylistUrl) => {
    set((state) => {
      const nextState: StoredMusicState = { ...state, youtubePlaylistUrl };
      saveMusicState(nextState);
      return { youtubePlaylistUrl };
    });
  },
}));

export function getCurrentTrack(state: Pick<MusicState, "tracks" | "currentIndex" | "activeTrackIds">) {
  const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
  const activeTracks = state.activeTrackIds
    ? state.activeTrackIds.map((id) => tracksById.get(id)).filter((t): t is MusicTrack => Boolean(t))
    : state.tracks;
  return activeTracks[state.currentIndex] ?? null;
}
