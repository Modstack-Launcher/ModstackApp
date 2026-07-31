import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Tooltip, toast } from "@heroui/react";
import {
  IconArrowsShuffle,
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPlaylistAdd,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { getCurrentTrack, isPlayableTrack, useMusic } from "../utils/musicContext";
import { useLauncherTranslation } from "../utils/languageContext";
import { getInvidiousAudioStreamUrl, getNativeYouTubeAudioStreamUrl, searchYouTubeMusic } from "../utils/musicProviders";

function isRemoteImage(src?: string) {
  return !!src && /^https?:\/\//i.test(src);
}

function MusicImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    setResolvedSrc(src);
    setTriedProxy(false);
  }, [src]);

  if (!src) return null;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={async () => {
        if (isRemoteImage(src) && !triedProxy) {
          setTriedProxy(true);
          try {
            const dataUrl = await invoke<string>("fetch_image_as_base64", { url: src });
            setResolvedSrc(dataUrl);
          } catch {
          }
        }
      }}
    />
  );
}

interface YouTubePlayerEvent {
  target: YouTubePlayer;
  data: number;
}

interface YouTubePlayerErrorEvent {
  data: number;
}

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState?: () => number;
}

interface YouTubePlayerConstructor {
  new (
    element: HTMLElement,
    options: {
      width: number;
      height: number;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
        onError?: (event: YouTubePlayerErrorEvent) => void;
      };
    },
  ): YouTubePlayer;
}

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;
const TRACK_START_DELAY_MS = 0;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${rest}`;
}

function cleanMusicQueryPart(value?: string) {
  return (value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(official|audio|video|lyrics?|karaoke|instrumental|cover|sing\s*king|topic)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAlternateQueries(track: { title: string; artist?: string }) {
  const title = cleanMusicQueryPart(track.title);
  const artist = cleanMusicQueryPart(track.artist);
  const dashParts = title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const likelySong = dashParts.length > 1 ? dashParts.slice(1).join(" ") : title;
  const likelyArtist = dashParts.length > 1 ? dashParts[0] : artist;

  return Array.from(new Set([
    `${title} ${artist}`,
    `${likelyArtist} ${likelySong}`,
    `${likelyArtist} ${likelySong} official audio`,
    `${likelyArtist} ${likelySong} lyrics`,
    `${likelySong} ${likelyArtist} audio`,
    `${likelySong} audio`,
    title,
  ].map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function AddToPlaylistMenu({ trackId, compact = false }: { trackId: string; compact?: boolean }) {
  const playlists = useMusic((state) => state.playlists);
  const addTrackToPlaylist = useMusic((state) => state.addTrackToPlaylist);
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);

  if (playlists.length === 0) {
    return (
      <Tooltip delay={0}>
        <button
          type="button"
          className={compact ? "text-muted opacity-40" : "text-muted opacity-40"}
          disabled
        >
          <IconPlaylistAdd className={compact ? "size-4" : "size-5"} />
        </button>
        <Tooltip.Content placement="top" className="text-sm font-semibold">
          <p>{t("music.noPlaylists")}</p>
        </Tooltip.Content>
      </Tooltip>
    );
  }

  return (
    <div className="relative">
      <Tooltip delay={0}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={compact ? "text-muted hover:text-accent transition-colors" : "text-muted hover:text-accent transition-colors"}
        >
          <IconPlaylistAdd className={compact ? "size-4" : "size-5"} />
        </button>
        <Tooltip.Content placement="top" className="text-sm font-semibold">
          <p>{t("music.addToPlaylist")}</p>
        </Tooltip.Content>
      </Tooltip>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-3 w-56 overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            {t("music.addToPlaylist")}
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {playlists.map((playlist) => {
              const added = playlist.trackIds.includes(trackId);
              return (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={added}
                  onClick={() => {
                    addTrackToPlaylist(playlist.id, trackId);
                    setOpen(false);
                    toast(t("music.addedToPlaylist"), { description: playlist.name });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-45"
                >
                  <IconPlaylistAdd className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                  {added && <span className="text-[10px] text-muted">{t("music.added")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ShuffleButton({ compact = false }: { compact?: boolean }) {
  const shuffle = useMusic((state) => state.shuffle);
  const toggleShuffle = useMusic((state) => state.toggleShuffle);
  const t = useLauncherTranslation();
  const iconSize = compact ? "size-4" : "size-5";

  return (
    <Tooltip delay={0}>
      <button
        type="button"
        onClick={toggleShuffle}
        className={shuffle ? "text-accent transition-colors" : "text-muted hover:text-foreground transition-colors"}
      >
        <IconArrowsShuffle className={iconSize} />
      </button>
      <Tooltip.Content placement="top" className="text-sm font-semibold">
        <p>{t("music.shuffle")}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

function RepeatButton({ compact = false }: { compact?: boolean }) {
  const repeatMode = useMusic((state) => state.repeatMode);
  const toggleRepeatMode = useMusic((state) => state.toggleRepeatMode);
  const t = useLauncherTranslation();
  const iconSize = compact ? "size-4" : "size-5";

  return (
    <Tooltip delay={0}>
      <button
        type="button"
        onClick={toggleRepeatMode}
        className={repeatMode !== "off" ? "text-accent transition-colors" : "text-muted hover:text-foreground transition-colors"}
      >
        {repeatMode === "one" ? <IconRepeatOnce className={iconSize} /> : <IconRepeat className={iconSize} />}
      </button>
      <Tooltip.Content placement="top" className="text-sm font-semibold">
        <p>{repeatMode === "one" ? t("music.repeatOne") : repeatMode === "all" ? t("music.repeatAll") : t("music.repeat")}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

export function MusicExpandedBar() {
  const tracks = useMusic((state) => state.tracks);
  const currentIndex = useMusic((state) => state.currentIndex);
  const activeTrackIds = useMusic((state) => state.activeTrackIds);
  const isPlaying = useMusic((state) => state.isPlaying);
  const miniPlayerHidden = useMusic((state) => state.miniPlayerHidden);
  const volume = useMusic((state) => state.volume);
  const togglePlayback = useMusic((state) => state.togglePlayback);
  const hideMiniPlayer = useMusic((state) => state.hideMiniPlayer);
  const nextTrack = useMusic((state) => state.nextTrack);
  const previousTrack = useMusic((state) => state.previousTrack);
  const setVolume = useMusic((state) => state.setVolume);

  const currentTrack = useMemo(
    () => getCurrentTrack({ tracks, currentIndex, activeTrackIds }),
    [tracks, currentIndex, activeTrackIds],
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const { currentTime, duration } = (e as CustomEvent).detail;
      setCurrentTime(currentTime);
      setDuration(duration);
    };
    window.addEventListener("modstack:music-time", handler);
    return () => window.removeEventListener("modstack:music-time", handler);
  }, []);

  if (!currentTrack || !isPlayableTrack(currentTrack) || miniPlayerHidden) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = (value: number) => {
    window.dispatchEvent(new CustomEvent("modstack:music-seek", { detail: { value } }));
  };

  return (
    <div className="shrink-0 h-24 border-t border-white/5 bg-surface-secondary flex items-center px-4 gap-4">

      <div className="flex items-center gap-3 w-56 shrink-0 min-w-0">
        <div className="size-14 shrink-0 rounded-md overflow-hidden bg-surface-tertiary border border-white/10 flex items-center justify-center">
          {currentTrack.thumbnail
            ? <MusicImage src={currentTrack.thumbnail} alt={currentTrack.title} className="size-full object-cover" />
            : <IconMusic className="size-5 text-accent" />
          }
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{currentTrack.title}</p>
          <p className="truncate text-xs text-muted mt-0.5">{currentTrack.artist || "Modstack Music"}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
        <div className="flex items-center gap-5">
          <AddToPlaylistMenu trackId={currentTrack.id} />
          <ShuffleButton />
          <button
            type="button"
            onClick={previousTrack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <IconPlayerSkipBackFilled className="size-5" />
          </button>
          <button
            type="button"
            onClick={togglePlayback}
            className="size-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
          >
            {isPlaying
              ? <IconPlayerPauseFilled className="size-5 text-black" />
              : <IconPlayerPlayFilled className="size-5 text-black" />
            }
          </button>
          <button
            type="button"
            onClick={() => nextTrack()}
            className="text-muted hover:text-foreground transition-colors"
          >
            <IconPlayerSkipForwardFilled className="size-5" />
          </button>
          <RepeatButton />
        </div>

        <div className="w-full max-w-2xl flex items-center gap-3">
          <span className="text-xs text-muted w-10 text-right shrink-0">{formatTime(currentTime)}</span>
          <div className="relative flex-1 h-4 group cursor-pointer flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white group-hover:bg-accent transition-colors"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-muted w-10 shrink-0">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="w-56 shrink-0 flex items-center justify-end gap-3">
        <IconVolume className="size-4 text-muted shrink-0" />
        <div className="relative w-32 h-4 group cursor-pointer flex items-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white group-hover:bg-accent transition-colors"
              style={{ width: `${volume * 100}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={hideMiniPlayer}
          className="text-muted hover:text-foreground transition-colors ml-2"
        >
          <IconX className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default function MusicMiniPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const youtubeHostRef = useRef<HTMLDivElement>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const youtubeReadyRef = useRef(false);
  const failedTrackRef = useRef<string | null>(null);
  const attemptedEmbedIdsRef = useRef<Set<string>>(new Set());
  const audioRecoveryRef = useRef(false);
  const activeTrackIdRef = useRef<string | null>(null);

  const tracks = useMusic((state) => state.tracks);
  const currentIndex = useMusic((state) => state.currentIndex);
  const activeTrackIds = useMusic((state) => state.activeTrackIds);
  const isPlaying = useMusic((state) => state.isPlaying);
  const miniPlayerHidden = useMusic((state) => state.miniPlayerHidden);
  const volume = useMusic((state) => state.volume);
  const volumeRef = useRef(volume);
  const togglePlayback = useMusic((state) => state.togglePlayback);
  const hideMiniPlayer = useMusic((state) => state.hideMiniPlayer);
  const nextTrack = useMusic((state) => state.nextTrack);
  const previousTrack = useMusic((state) => state.previousTrack);
  const setPlaying = useMusic((state) => state.setPlaying);
  const t = useLauncherTranslation();

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [open, setOpen] = useState(false);
  const [fallbackAudioUrl, setFallbackAudioUrl] = useState<string | null>(null);
  const [fallbackAudioTrackId, setFallbackAudioTrackId] = useState<string | null>(null);
  const [audioStreamLoading, setAudioStreamLoading] = useState(false);
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);
  const [embedVideoId, setEmbedVideoId] = useState<string | null>(null);
  const [playbackDelayReady, setPlaybackDelayReady] = useState(false);

  const currentTrack = useMemo(
    () => getCurrentTrack({ tracks, currentIndex, activeTrackIds }),
    [tracks, currentIndex, activeTrackIds],
  );

  const canPlayCurrentTrack = isPlayableTrack(currentTrack);
  const isYouTube = !!currentTrack?.videoId && currentTrack.provider === "youtube";
  const currentFallbackAudioUrl = fallbackAudioTrackId === currentTrack?.id ? fallbackAudioUrl : null;
  const shouldUseHtmlAudio = !isYouTube || Boolean(currentFallbackAudioUrl);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener("modstack:toggle-mini-player", handler);
    return () => window.removeEventListener("modstack:toggle-mini-player", handler);
  }, []);

  useEffect(() => {
    loadYouTubeApi();
  }, []);

  useEffect(() => {
    if (!currentTrack || miniPlayerHidden) setOpen(false);
  }, [currentTrack, miniPlayerHidden]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("modstack:music-time", { detail: { currentTime, duration } }));
  }, [currentTime, duration]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { value } = (e as CustomEvent).detail;
      setCurrentTime(value);
      if (useEmbedFallback) {
        const player = youtubePlayerRef.current;
        if (youtubeReadyRef.current && typeof player?.seekTo === "function") player.seekTo(value, true);
      } else if (audioRef.current) {
        audioRef.current.currentTime = value;
      }
    };
    window.addEventListener("modstack:music-seek", handler);
    return () => window.removeEventListener("modstack:music-seek", handler);
  }, [useEmbedFallback]);

  useLayoutEffect(() => {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    activeTrackIdRef.current = currentTrack?.id ?? null;
    failedTrackRef.current = null;
    setFallbackAudioUrl(null);
    setFallbackAudioTrackId(null);
    setAudioStreamLoading(Boolean(currentTrack?.videoId && currentTrack.provider === "youtube"));
    setPlaybackDelayReady(false);
    setUseEmbedFallback(false);
    setEmbedVideoId(currentTrack?.videoId ?? null);
    attemptedEmbedIdsRef.current = new Set(currentTrack?.videoId ? [currentTrack.videoId] : []);
    audioRecoveryRef.current = false;
    youtubeReadyRef.current = false;
    queueMicrotask(() => {
      setCurrentTime(0);
      setDuration(0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!currentTrack) {
      setPlaybackDelayReady(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (activeTrackIdRef.current === currentTrack.id) setPlaybackDelayReady(true);
    }, TRACK_START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [currentTrack?.id]);

  const skipFailedTrack = (reason?: string) => {
    if (!currentTrack || failedTrackRef.current === currentTrack.id) return;
    failedTrackRef.current = currentTrack.id;
    toast.danger("No se pudo reproducir esta canción", {
      description: reason || currentTrack.title,
    });
    nextTrack(true);
  };

  const recoverYouTubeAudio = async (track = currentTrack, reason?: string) => {
    if (!track?.videoId || track.provider !== "youtube" || audioRecoveryRef.current) return;
    const requestTrackId = track.id;
    audioRecoveryRef.current = true;
    setAudioStreamLoading(true);
    setUseEmbedFallback(false);

    try {
      for (const query of buildAlternateQueries(track)) {
        if (activeTrackIdRef.current !== requestTrackId) return;
        let results = [];
        try {
          results = await searchYouTubeMusic(query);
        } catch {
          continue;
        }

        for (const result of results) {
          if (!result.videoId || attemptedEmbedIdsRef.current.has(result.videoId)) continue;
          attemptedEmbedIdsRef.current.add(result.videoId);
          const audioUrl = await getInvidiousAudioStreamUrl(result.videoId);
          if (activeTrackIdRef.current !== requestTrackId) return;
          if (audioUrl) {
            setEmbedVideoId(result.videoId);
            setFallbackAudioUrl(audioUrl);
            setFallbackAudioTrackId(requestTrackId);
            return;
          }
        }
      }

      if (activeTrackIdRef.current !== requestTrackId) return;
      const nativeAudioUrl = await getNativeYouTubeAudioStreamUrl(track.videoId);
      if (activeTrackIdRef.current !== requestTrackId) return;
      if (nativeAudioUrl) {
        setEmbedVideoId(track.videoId);
        setFallbackAudioUrl(nativeAudioUrl);
        setFallbackAudioTrackId(requestTrackId);
        return;
      }

      if (activeTrackIdRef.current !== requestTrackId) return;
      skipFailedTrack(reason || "No se encontro una fuente de audio para esta cancion.");
    } finally {
      if (activeTrackIdRef.current === requestTrackId) setAudioStreamLoading(false);
      audioRecoveryRef.current = false;
    }
  };

  useEffect(() => {
    if (!currentTrack?.videoId || !isYouTube || miniPlayerHidden) return;

    let cancelled = false;
    const requestTrack = currentTrack;
    const requestTrackId = currentTrack.id;
    const findAudioUrl = async () => {
      setAudioStreamLoading(true);
      const directUrl = await getInvidiousAudioStreamUrl(requestTrack.videoId!);
      if (cancelled || activeTrackIdRef.current !== requestTrackId) return null;
      if (directUrl) return directUrl;

      for (const query of buildAlternateQueries(requestTrack)) {
        if (cancelled || activeTrackIdRef.current !== requestTrackId) return null;
        let results = [];
        try {
          results = await searchYouTubeMusic(query);
        } catch {
          continue;
        }
        for (const result of results) {
          if (!result.videoId || attemptedEmbedIdsRef.current.has(result.videoId)) continue;
          attemptedEmbedIdsRef.current.add(result.videoId);
          const audioUrl = await getInvidiousAudioStreamUrl(result.videoId);
          if (cancelled || activeTrackIdRef.current !== requestTrackId) return null;
          if (audioUrl) {
            setEmbedVideoId(result.videoId);
            return audioUrl;
          }
        }
      }
      return null;
    };

    findAudioUrl()
      .then((url) => {
        if (cancelled || activeTrackIdRef.current !== requestTrackId) return;
        if (url) {
          setFallbackAudioUrl(url);
          setFallbackAudioTrackId(requestTrackId);
          setUseEmbedFallback(false);
        } else {
          setEmbedVideoId(requestTrack.videoId ?? null);
          setUseEmbedFallback(true);
        }
      })
      .finally(() => {
        if (!cancelled && activeTrackIdRef.current === requestTrackId) setAudioStreamLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.videoId, isYouTube, miniPlayerHidden]);

  // FIX: Cargar la fuente del <audio> SOLO cuando cambia la canción (por id)
  // o el fallback de audio, nunca por cambios de volumen u otro estado del store.
  // Antes esto dependía de `currentTrack` (objeto completo) y comparaba
  // `audio.src !== src`, lo cual es una comparación frágil porque el navegador
  // normaliza `audio.src` a una URL absoluta. Cualquier cambio de estado que
  // regenerara la referencia de `currentTrack` (p. ej. mover el volumen)
  // terminaba re-ejecutando `audio.load()` y reseteando la reproducción.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !canPlayCurrentTrack || !shouldUseHtmlAudio) return;

    const src = currentFallbackAudioUrl || currentTrack.url;
    if (!src) return;

    if (activeTrackIdRef.current !== currentTrack.id) return;
    audio.src = src;
    audio.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentFallbackAudioUrl, shouldUseHtmlAudio, canPlayCurrentTrack]);

  // FIX: Play/pause del <audio> HTML5 en un efecto independiente, que no
  // toca `audio.src` ni dispara `audio.load()`. Así, togglePlayback,
  // cambios de volumen, etc. nunca reinician la canción.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !canPlayCurrentTrack || !shouldUseHtmlAudio) return;

    if (isPlaying && playbackDelayReady) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackDelayReady, currentTrack?.id, canPlayCurrentTrack, shouldUseHtmlAudio, setPlaying]);

  useEffect(() => {
    if (!useEmbedFallback || !isYouTube || !embedVideoId || miniPlayerHidden || !youtubeHostRef.current) {
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      youtubeReadyRef.current = false;
      return;
    }

    let cancelled = false;
    const host = youtubeHostRef.current;
    host.replaceChildren();
    const playerElement = document.createElement("div");
    host.appendChild(playerElement);

    loadYouTubeApi().then(() => {
      if (cancelled || !window.YT || !host.isConnected) return;
      youtubePlayerRef.current?.destroy();
      youtubeReadyRef.current = false;
      youtubePlayerRef.current = new window.YT.Player(playerElement, {
        width: 1,
        height: 1,
        videoId: embedVideoId,
        playerVars: {
          autoplay: isPlaying && playbackDelayReady ? 1 : 0,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            youtubeReadyRef.current = true;
            if (typeof event.target.setVolume === "function") event.target.setVolume(Math.round(volumeRef.current * 100));
            if (typeof event.target.getDuration === "function") setDuration(event.target.getDuration());
            if (isPlaying && playbackDelayReady && typeof event.target.playVideo === "function") event.target.playVideo();
          },
          onStateChange: (event) => {
            if (!window.YT) return;
            if (event.data === window.YT.PlayerState.ENDED) nextTrack();
            if (event.data === window.YT.PlayerState.PLAYING) setPlaying(true);
            if (event.data === window.YT.PlayerState.PAUSED) setPlaying(false);
          },
          onError: (event) => {
            attemptedEmbedIdsRef.current.add(embedVideoId);
            (async () => {
              for (const query of buildAlternateQueries(currentTrack)) {
                let results = [];
                try {
                  results = await searchYouTubeMusic(query);
                } catch {
                  continue;
                }
                const alternate = results.find((result) => result.videoId && !attemptedEmbedIdsRef.current.has(result.videoId));
                if (alternate?.videoId) {
                  attemptedEmbedIdsRef.current.add(alternate.videoId);
                  youtubeReadyRef.current = false;
                  setEmbedVideoId(alternate.videoId);
                  return;
                }
              }
              recoverYouTubeAudio(currentTrack, `YouTube rechazo este audio (${event.data}).`);
            })();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      youtubeReadyRef.current = false;
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, embedVideoId, isYouTube, miniPlayerHidden, playbackDelayReady, useEmbedFallback]);

  useEffect(() => {
    const player = youtubePlayerRef.current;
    if (!player || !useEmbedFallback || !youtubeReadyRef.current) return;
    if (isPlaying && playbackDelayReady && typeof player.playVideo === "function") player.playVideo();
    if ((!isPlaying || !playbackDelayReady) && typeof player.pauseVideo === "function") player.pauseVideo();
  }, [isPlaying, playbackDelayReady, useEmbedFallback]);

  useEffect(() => {
    if (!useEmbedFallback) return;
    const interval = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (!player || !youtubeReadyRef.current) return;
      if (typeof player.getCurrentTime === "function") setCurrentTime(player.getCurrentTime());
      if (typeof player.getDuration === "function") setDuration(player.getDuration());
    }, 500);
    return () => window.clearInterval(interval);
  }, [useEmbedFallback, embedVideoId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    const player = youtubePlayerRef.current;
    if (useEmbedFallback && youtubeReadyRef.current && typeof player?.setVolume === "function") player.setVolume(Math.round(volume * 100));
  }, [useEmbedFallback, volume]);

  const cover = currentTrack?.thumbnail ? (
    <MusicImage src={currentTrack.thumbnail} alt={currentTrack.title} className="size-full object-cover" />
  ) : (
    <IconMusic className="size-5 text-accent" />
  );

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime || 0);
  };

  return (
    <>
      <audio
        ref={audioRef}
        onEnded={() => nextTrack()}
        onError={() => {
          if (isYouTube) {
            void recoverYouTubeAudio(currentTrack, "No se encontro una fuente de audio para esta cancion.");
          } else {
            skipFailedTrack("El archivo de audio no se pudo cargar.");
          }
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        preload="none"
        className="hidden"
      />
      <div ref={youtubeHostRef} className="fixed size-1 opacity-0 pointer-events-none" />
      {open && currentTrack && canPlayCurrentTrack && !miniPlayerHidden && (
        <div className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] border border-white/10 bg-surface-secondary shadow-2xl">
          <div className="flex items-center gap-3 p-3">
            <div className="size-10 shrink-0 bg-accent/15 text-accent flex items-center justify-center">
              {cover}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{currentTrack.title}</p>
              <p className="truncate text-xs text-muted">
                {audioStreamLoading ? "Cargando audio..." : `${formatTime(currentTime)} / ${formatTime(duration)}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <AddToPlaylistMenu trackId={currentTrack.id} compact />
              <ShuffleButton compact />
              <Tooltip delay={0}>
                <Button variant="tertiary" size="sm" isIconOnly onPress={previousTrack}>
                  <IconPlayerSkipBackFilled className="size-4" />
                </Button>
                <Tooltip.Content placement="top" className="text-sm font-semibold">
                  <p>{t("music.previous")}</p>
                </Tooltip.Content>
              </Tooltip>
              <Tooltip delay={0}>
                <Button size="sm" isIconOnly onPress={togglePlayback}>
                  {isPlaying ? <IconPlayerPauseFilled className="size-4" /> : <IconPlayerPlayFilled className="size-4" />}
                </Button>
                <Tooltip.Content placement="top" className="text-sm font-semibold">
                  <p>{isPlaying ? t("music.pause") : t("music.play")}</p>
                </Tooltip.Content>
              </Tooltip>
              <Tooltip delay={0}>
                <Button variant="tertiary" size="sm" isIconOnly onPress={() => nextTrack()}>
                  <IconPlayerSkipForwardFilled className="size-4" />
                </Button>
                <Tooltip.Content placement="top" className="text-sm font-semibold">
                  <p>{t("music.next")}</p>
                </Tooltip.Content>
              </Tooltip>
              <RepeatButton compact />
              <Tooltip delay={0}>
                <Button variant="tertiary" size="sm" isIconOnly onPress={hideMiniPlayer}>
                  <IconX className="size-4" />
                </Button>
                <Tooltip.Content placement="top" className="text-sm font-semibold">
                  <p>{t("music.close")}</p>
                </Tooltip.Content>
              </Tooltip>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

