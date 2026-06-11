import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import {
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { getCurrentTrack, isPlayableTrack, useMusic } from "../utils/musicContext";
import { useLauncherTranslation } from "../utils/languageContext";

interface YouTubePlayerEvent {
  target: YouTubePlayer;
  data: number;
}

interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  destroy: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface YouTubePlayerConstructor {
  new (
    element: HTMLElement,
    options: {
      width: number;
      height: number;
      videoId: string;
      playerVars: Record<string, number>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
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

export function MusicExpandedBar() {
  const tracks = useMusic((state) => state.tracks);
  const currentIndex = useMusic((state) => state.currentIndex);
  const isPlaying = useMusic((state) => state.isPlaying);
  const miniPlayerHidden = useMusic((state) => state.miniPlayerHidden);
  const volume = useMusic((state) => state.volume);
  const togglePlayback = useMusic((state) => state.togglePlayback);
  const hideMiniPlayer = useMusic((state) => state.hideMiniPlayer);
  const nextTrack = useMusic((state) => state.nextTrack);
  const previousTrack = useMusic((state) => state.previousTrack);
  const setVolume = useMusic((state) => state.setVolume);

  const currentTrack = useMemo(
    () => getCurrentTrack({ tracks, currentIndex }),
    [tracks, currentIndex],
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
            ? <img src={currentTrack.thumbnail} alt={currentTrack.title} className="size-full object-cover" />
            : <IconMusic className="size-5 text-accent" />
          }
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{currentTrack.title}</p>
          <p className="truncate text-xs text-muted mt-0.5">{currentTrack.artist || "Modstack Music"}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
        <div className="flex items-center gap-6">
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
            onClick={nextTrack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <IconPlayerSkipForwardFilled className="size-5" />
          </button>
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

  const tracks = useMusic((state) => state.tracks);
  const currentIndex = useMusic((state) => state.currentIndex);
  const isPlaying = useMusic((state) => state.isPlaying);
  const miniPlayerHidden = useMusic((state) => state.miniPlayerHidden);
  const volume = useMusic((state) => state.volume);
  const togglePlayback = useMusic((state) => state.togglePlayback);
  const hideMiniPlayer = useMusic((state) => state.hideMiniPlayer);
  const nextTrack = useMusic((state) => state.nextTrack);
  const previousTrack = useMusic((state) => state.previousTrack);
  const setPlaying = useMusic((state) => state.setPlaying);
  const t = useLauncherTranslation();

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isYouTubeReady, setIsYouTubeReady] = useState(false);
  const [open, setOpen] = useState(false);

  const currentTrack = useMemo(
    () => getCurrentTrack({ tracks, currentIndex }),
    [tracks, currentIndex],
  );

  const canPlayCurrentTrack = isPlayableTrack(currentTrack);
  const isYouTube = !!currentTrack?.videoId && currentTrack.provider === "youtube";

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener("modstack:toggle-mini-player", handler);
    return () => window.removeEventListener("modstack:toggle-mini-player", handler);
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
      if (isYouTube) {
        const player = youtubePlayerRef.current;
        if (isYouTubeReady && typeof player?.seekTo === "function") player.seekTo(value, true);
      } else if (audioRef.current) {
        audioRef.current.currentTime = value;
      }
    };
    window.addEventListener("modstack:music-seek", handler);
    return () => window.removeEventListener("modstack:music-seek", handler);
  }, [isYouTube, isYouTubeReady]);

  useEffect(() => {
    audioRef.current?.pause();
    youtubeReadyRef.current = false;
    setIsYouTubeReady(false);
    queueMicrotask(() => {
      setCurrentTime(0);
      setDuration(0);
    });
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !canPlayCurrentTrack || isYouTube) return;

    if (audio.src !== currentTrack.url) {
      audio.src = currentTrack.url;
      audio.load();
    }

    audio.volume = volume;
    if (isPlaying) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [canPlayCurrentTrack, currentTrack, isPlaying, isYouTube, setPlaying, volume]);

  useEffect(() => {
    if (miniPlayerHidden || !isYouTube || !currentTrack?.videoId || !youtubeHostRef.current) {
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      youtubeReadyRef.current = false;
      setIsYouTubeReady(false);
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
      setIsYouTubeReady(false);
      youtubePlayerRef.current = new window.YT.Player(playerElement, {
        width: 1,
        height: 1,
        videoId: currentTrack.videoId || "",
        playerVars: { autoplay: isPlaying ? 1 : 0, controls: 0, disablekb: 1, rel: 0 },
        events: {
          onReady: (event) => {
            youtubeReadyRef.current = true;
            setIsYouTubeReady(true);
            if (typeof event.target.setVolume === "function") event.target.setVolume(Math.round(volume * 100));
            if (typeof event.target.getDuration === "function") setDuration(event.target.getDuration());
            if (isPlaying && typeof event.target.playVideo === "function") event.target.playVideo();
          },
          onStateChange: (event) => {
            if (!window.YT) return;
            if (event.data === window.YT.PlayerState.ENDED) nextTrack();
            if (event.data === window.YT.PlayerState.PLAYING) setPlaying(true);
            if (event.data === window.YT.PlayerState.PAUSED) setPlaying(false);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      youtubeReadyRef.current = false;
      setIsYouTubeReady(false);
      youtubePlayerRef.current?.destroy();
      youtubePlayerRef.current = null;
      host.replaceChildren();
    };
  }, [currentTrack?.videoId, isYouTube, miniPlayerHidden, nextTrack, setPlaying]);

  useEffect(() => {
    const player = youtubePlayerRef.current;
    if (!player || !isYouTube || !isYouTubeReady) return;
    if (isPlaying && typeof player.playVideo === "function") player.playVideo();
    if (!isPlaying && typeof player.pauseVideo === "function") player.pauseVideo();
  }, [isPlaying, isYouTube, isYouTubeReady]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    const player = youtubePlayerRef.current;
    if (isYouTubeReady && typeof player?.setVolume === "function") player.setVolume(Math.round(volume * 100));
  }, [isYouTubeReady, volume]);

  useEffect(() => {
    if (!isYouTube) return;
    const interval = window.setInterval(() => {
      const player = youtubePlayerRef.current;
      if (!player || !youtubeReadyRef.current) return;
      if (typeof player.getCurrentTime === "function") setCurrentTime(player.getCurrentTime());
      if (typeof player.getDuration === "function") setDuration(player.getDuration());
    }, 500);
    return () => window.clearInterval(interval);
  }, [isYouTube]);

  const cover = currentTrack?.thumbnail ? (
    <img src={currentTrack.thumbnail} alt={currentTrack.title} className="size-full object-cover" />
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
        onEnded={nextTrack}
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
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>
            <div className="flex items-center gap-1">
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
                <Button variant="tertiary" size="sm" isIconOnly onPress={nextTrack}>
                  <IconPlayerSkipForwardFilled className="size-4" />
                </Button>
                <Tooltip.Content placement="top" className="text-sm font-semibold">
                  <p>{t("music.next")}</p>
                </Tooltip.Content>
              </Tooltip>
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