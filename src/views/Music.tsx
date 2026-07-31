import { FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Input, Label, Surface, TextField, toast } from "@heroui/react";
import {
  IconBrandSpotify,
  IconBrandYoutubeFilled,
  IconEdit,
  IconExternalLink,
  IconGripVertical,
  IconHomeFilled,
  IconMinus,
  IconMusic,
  IconPhoto,
  IconPlayerPlayFilled,
  IconPlaylist,
  IconPlaylistAdd,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { isPlayableTrack, useMusic, type MusicTrack } from "../utils/musicContext";
import { useLauncherTranslation, type TranslationKey } from "../utils/languageContext";
import {
  importSpotifyPlaylist,
  importYouTubePlaylist,
  getLastSpotifyImportStats,
  searchYouTubeMusic,
  searchYouTubeTrending,
  toTrack,
  type MusicProvider,
  type MusicSearchResult,
} from "../utils/musicProviders";
import { MusicExpandedBar } from "../components/MusicMiniPlayer";
import HomeSidebar from "../components/HomeSidebar";

type MusicSection = "home" | "library" | "playlists" | "import";
type ImportProvider = "youtube" | "spotify";

function isRemoteImage(src?: string) {
  return !!src && /^https?:\/\//i.test(src);
}

function youtubeThumbnailFallbacks(src?: string) {
  if (!src) return [];
  const match = src.match(/(?:vi\/|vi_webp\/|[?&]v=)([A-Za-z0-9_-]{6,})/);
  const videoId = match?.[1];
  if (!videoId) return [];
  return [
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/default.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ].filter((url, index, list) => url !== src && list.indexOf(url) === index);
}

function MusicImage({
  src,
  alt,
  className,
  onFailed,
}: {
  src?: string;
  alt: string;
  className?: string;
  onFailed?: () => void;
}) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [triedProxy, setTriedProxy] = useState(false);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolvedSrc(src);
    setTriedProxy(false);
    setFallbackIndex(0);
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={async () => {
        const fallbacks = youtubeThumbnailFallbacks(src);
        if (fallbackIndex < fallbacks.length) {
          setResolvedSrc(fallbacks[fallbackIndex]);
          setFallbackIndex((index) => index + 1);
          return;
        }
        if (isRemoteImage(src) && !triedProxy) {
          setTriedProxy(true);
          try {
            const dataUrl = await invoke<string>("fetch_image_as_base64", { url: src });
            setResolvedSrc(dataUrl);
            return;
          } catch {
          }
        }
        setFailed(true);
        onFailed?.();
      }}
    />
  );
}

type MixConfig = {
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  accent: string;
  isAI?: boolean;
  region?: string;
  query?: string;
};

const MIX_CONFIGS: MixConfig[] = [
  {
    titleKey: "music.mix.daily",
    subtitleKey: "music.mix.dailySubtitle",
    accent: "var(--color-accent)",
    region: "US",
  },
  {
    titleKey: "music.mix.topSongs",
    subtitleKey: "music.mix.topSongsSubtitle",
    accent: "#7c3aed",
    query: "top hits 2024 music",
  },
  {
    titleKey: "music.mix.trends",
    subtitleKey: "music.mix.trendsSubtitle",
    accent: "#dc2626",
    region: "MX",
  },
  {
    titleKey: "music.mix.discover",
    subtitleKey: "music.mix.discoverSubtitle",
    accent: "#059669",
    isAI: true,
  },
];

function ProviderPill({ provider }: { provider?: MusicProvider }) {
  if (!provider) return null;
  return null;
}

function Cover({
  track,
  className = "size-12",
}: {
  track?: Pick<MusicTrack, "thumbnail" | "title" | "provider">;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (track?.thumbnail && !imgError) {
    return (
      <MusicImage
        src={track.thumbnail}
        alt={track.title}
        className={`${className} rounded-lg object-cover`}
        onFailed={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={`${className} rounded-lg bg-surface-tertiary border border-white/10 flex items-center justify-center`}>
      {track?.provider === "youtube" ? (
        <IconBrandYoutubeFilled className="size-5 text-danger" />
      ) : track?.provider === "spotify" ? (
        <IconBrandSpotify className="size-5 text-success" />
      ) : (
        <IconMusic className="size-5 text-accent" />
      )}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-surface-secondary p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function LogoPicker({
  value,
  onChange,
  inputId,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  inputId: string;
  t: (key: TranslationKey) => string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">Logo</span>
      <div className="flex items-center gap-3">
        <div
          className="size-16 rounded-xl border border-white/10 bg-surface-tertiary flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => fileRef.current?.click()}
        >
      {value ? (
            <MusicImage src={value} alt="Logo" className="size-full object-cover" />
          ) : (
            <IconPhoto className="size-6 text-muted" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            id={inputId}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white/70 hover:bg-white/10"
          >
            <IconPhoto className="size-3.5" />
            {value ? t("music.changeLogo") : t("music.uploadLogo")}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-danger hover:bg-white/10"
            >
              <IconX className="size-3.5" />
              {t("music.removeLogo")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditPlaylistModal({
  name,
  description,
  logoUrl,
  onSave,
  onClose,
  t,
}: {
  name: string;
  description: string;
  logoUrl: string;
  onSave: (name: string, description: string, logoUrl: string) => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [editLogo, setEditLogo] = useState(logoUrl);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface-secondary p-6 shadow-2xl pointer-events-auto flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-foreground">{t("music.editPlaylist")}</h3>
            <button
              type="button"
              onClick={onClose}
              className="size-8 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-white/10 transition-colors"
            >
              <IconX className="size-4" />
            </button>
          </div>
          <LogoPicker value={editLogo} onChange={setEditLogo} inputId="modal-logo" t={t} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">{t("music.playlistNameLabel")}</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t("music.playlistNameLabel")}
              className="h-10 rounded-xl border border-white/10 bg-surface px-3 text-sm text-foreground placeholder:text-muted outline-none focus:border-white/30"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">{t("music.descriptionLabel")}</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder={t("music.noDescriptionPlaceholder")}
              rows={3}
              className="rounded-xl border border-white/10 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted outline-none focus:border-white/30 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onPress={onClose}>{t("music.cancel")}</Button>
            <Button onPress={() => onSave(editName.trim() || name, editDesc, editLogo)}>{t("music.save")}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function PlaylistQuickActions({ track }: { track: MusicTrack }) {
  const playlists = useMusic((state) => state.playlists);
  const addTrackToPlaylist = useMusic((state) => state.addTrackToPlaylist);
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);

  if (playlists.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <Button size="sm" variant="tertiary" isIconOnly onPress={() => setOpen((v) => !v)}>
        <IconPlaylistAdd className="size-4" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("music.close")}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-10 z-50 w-56 rounded-2xl border border-white/10 bg-surface-secondary p-1 shadow-2xl">
            <div className="px-2 py-1.5 text-xs font-semibold uppercase text-muted">
              {t("music.addToPlaylist")}
            </div>
            {playlists.map((playlist) => {
              const alreadyAdded = playlist.trackIds.includes(track.id);
              return (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => {
                    addTrackToPlaylist(playlist.id, track.id);
                    setOpen(false);
                    toast(t("music.addedToPlaylist"), { description: `${track.title} -> ${playlist.name}` });
                  }}
                  className="flex h-9 w-full min-w-0 items-center gap-2 rounded-2xl px-2 text-left text-sm text-foreground hover:bg-surface-hover disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                >
                  <IconPlaylist className="size-4 shrink-0 text-accent" />
                  <span className="truncate">{playlist.name}</span>
                  {alreadyAdded && <span className="ml-auto text-xs text-muted">{t("music.added")}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TrackRow({
  track,
  showPlaylistActions = true,
  trailing,
}: {
  track: MusicTrack;
  showPlaylistActions?: boolean;
  trailing?: React.ReactNode;
}) {
  const playTrack = useMusic((state) => state.playTrack);
  const t = useLauncherTranslation();
  const playable = isPlayableTrack(track);

  return (
    <div className="group relative min-h-14 min-w-0 rounded-2xl border border-white/5 bg-surface-secondary hover:bg-surface-hover flex items-center gap-3 pr-3 text-left transition-colors">
      <button
        type="button"
        aria-disabled={!playable}
        onClick={() => {
          if (!playable) {
            toast(t("music.noPreviewAvailable"), { description: `${track.title} ${t("music.noPreviewDescription")}` });
            return;
          }
          playTrack(track.id);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left aria-disabled:cursor-not-allowed"
      >
        <Cover track={track} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{track.title}</p>
          <p className="truncate text-xs text-muted">
            {playable ? track.artist || "Modstack Music" : t("music.noPreviewAvailable")}
          </p>
        </div>
        {playable && (
          <IconPlayerPlayFilled className="size-4 shrink-0 text-accent opacity-0 group-hover:opacity-100" />
        )}
      </button>
      <ProviderPill provider={track.provider} />
      {showPlaylistActions && <PlaylistQuickActions track={track} />}
      {trailing}
    </div>
  );
}

function SearchResultRow({ result, onAdd }: { result: MusicSearchResult; onAdd: (r: MusicSearchResult) => void }) {
  const t = useLauncherTranslation();
  const playlists = useMusic((state) => state.playlists);
  const tracks = useMusic((state) => state.tracks);
  const addTrack = useMusic((state) => state.addTrack);
  const addTrackToPlaylist = useMusic((state) => state.addTrackToPlaylist);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const existingTrack = tracks.find((tr) => tr.id === result.id);
  const asTrack = existingTrack ?? toTrack(result);

  function handleAddToPlaylist(playlistId: string) {
    if (!existingTrack) addTrack(asTrack);
    addTrackToPlaylist(playlistId, asTrack.id);
    setPlaylistOpen(false);
    toast(t("music.addedToPlaylist"), { description: `${asTrack.title}` });
  }

  return (
    <div className="h-16 rounded-2xl border border-white/5 bg-surface-secondary hover:bg-surface-hover flex items-center gap-3 pr-3 transition-colors">
      <Cover track={result} className="size-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{result.title}</p>
        <p className="truncate text-xs text-muted">{result.artist}</p>
      </div>
      <ProviderPill provider={result.provider} />
      {result.externalUrl && (
        <a href={result.externalUrl} target="_blank" rel="noreferrer"
          className="size-9 rounded-2xl bg-surface-tertiary hover:bg-white/10 flex items-center justify-center">
          <IconExternalLink className="size-4" />
        </a>
      )}
      {playlists.length > 0 && (
        <div className="relative shrink-0">
          <Button size="sm" variant="tertiary" isIconOnly onPress={() => setPlaylistOpen((v) => !v)}>
            <IconPlaylistAdd className="size-4" />
          </Button>
          {playlistOpen && (
            <>
              <button
                type="button"
                aria-label={t("music.close")}
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setPlaylistOpen(false)}
              />
              <div className="absolute right-0 top-10 z-50 w-56 rounded-2xl border border-white/10 bg-surface-secondary p-1 shadow-2xl">
                <div className="px-2 py-1.5 text-xs font-semibold uppercase text-muted">
                  {t("music.addToPlaylist")}
                </div>
                {playlists.map((playlist) => {
                  const alreadyAdded = playlist.trackIds.includes(asTrack.id);
                  return (
                    <button
                      key={playlist.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddToPlaylist(playlist.id)}
                      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-2xl px-2 text-left text-sm text-foreground hover:bg-surface-hover disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                    >
                      <IconPlaylist className="size-4 shrink-0 text-accent" />
                      <span className="truncate">{playlist.name}</span>
                      {alreadyAdded && <span className="ml-auto text-xs text-muted">{t("music.added")}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      <Button size="sm" onPress={() => onAdd(result)}>{t("music.add")}</Button>
    </div>
  );
}

function MusicNavItem({ active, icon, label, badge, onPress }: {
  active: boolean; icon: React.ReactNode; label: string; badge?: string; onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      data-active={active}
      className="h-10 rounded-2xl px-3 flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground hover:bg-white/5 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground transition-colors"
    >
      <span className="size-5 shrink-0 flex items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
      {badge && (
        <span className="ml-auto rounded-2xl bg-warning px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}

function PlaylistArtwork({
  name,
  logoUrl,
  trackThumbnails = [],
  className = "h-40 w-40",
}: {
  name: string;
  logoUrl?: string;
  trackThumbnails?: string[];
  className?: string;
}) {
  const thumbs = trackThumbnails.slice(0, 4);
  return (
    <div className={`${className} relative overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shrink-0`}>
      {logoUrl ? (
        <MusicImage src={logoUrl} alt={name} className="size-full object-cover" />
      ) : thumbs.length > 0 ? (
        <div className="grid grid-cols-2 size-full">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="overflow-hidden bg-[#2a2a2a]">
              {thumbs[i] ? (
                <MusicImage src={thumbs[i]} alt="" className="size-full object-cover" />
              ) : (
                <div className="size-full bg-[#1e1e1e]" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="size-full flex items-center justify-center">
          <IconPlaylist className="size-10 text-accent" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2 pt-6 pb-1.5 bg-gradient-to-t from-black/90 to-transparent">
        <p className="truncate text-xs font-bold text-white">{name}</p>
      </div>
    </div>
  );
}

function RecommendedMixCard({
  config,
  index,
  onClick,
  loading,
  t,
}: {
  config: MixConfig;
  index: number;
  onClick: (index: number) => void;
  loading: boolean;
  t: (key: TranslationKey) => string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(index)}
      disabled={loading}
      className="rounded-2xl border border-white/10 bg-surface-secondary overflow-hidden text-left hover:bg-surface-hover transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      <div className="h-28 bg-surface-tertiary border-b border-white/10 flex items-center justify-center">
        {loading ? (
          <div className="size-8 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        ) : config.isAI ? (
          <IconSparkles className="size-10 text-emerald-400" />
        ) : (
          <IconPlaylist className="size-10 text-accent" />
        )}
      </div>
      <div className="px-3 py-1.5" style={{ backgroundColor: config.accent }}>
        <p className="truncate text-xs font-bold text-white">{t(config.titleKey)}</p>
        <p className="mt-0.5 line-clamp-1 text-[10px] text-white/70">{t(config.subtitleKey)}</p>
      </div>
    </button>
  );
}

function MixModal({
  title,
  subtitle,
  accent,
  tracks,
  isAI,
  onClose,
  onAdd,
  onAddAll,
  t,
}: {
  title: string;
  subtitle: string;
  accent: string;
  tracks: MusicSearchResult[];
  isAI?: boolean;
  onClose: () => void;
  onAdd: (r: MusicSearchResult) => void;
  onAddAll: (results: MusicSearchResult[]) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-surface-secondary shadow-2xl pointer-events-auto flex flex-col max-h-[80vh]">
          <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0" style={{ backgroundColor: `${accent}22` }}>
            <div
              className="size-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: accent }}
            >
              {isAI ? <IconSparkles className="size-5 text-white" /> : <IconPlaylist className="size-5 text-white" />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-foreground truncate">{title}</h3>
              <p className="text-xs text-muted truncate">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="secondary" onPress={() => onAddAll(tracks)}>
                {t("music.addToQueue") ?? "Add all"}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="size-8 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <IconX className="size-4" />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
            {tracks.length === 0 ? (
              <EmptyPanel>{t("music.noResults")}</EmptyPanel>
            ) : (
              tracks.map((r) => (
                <SearchResultRow key={`${r.provider}-${r.id}`} result={r} onAdd={onAdd} />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Music() {
  const t = useLauncherTranslation();

  const tracks = useMusic((state) => state.tracks);
  const playlists = useMusic((state) => state.playlists);
  const addTrack = useMusic((state) => state.addTrack);
  const addTracks = useMusic((state) => state.addTracks);
  const createPlaylist = useMusic((state) => state.createPlaylist);
  const removePlaylist = useMusic((state) => state.removePlaylist);
  const updatePlaylist = useMusic((state) => state.updatePlaylist);
  const addTracksToPlaylist = useMusic((state) => state.addTracksToPlaylist);
  const removeTrackFromPlaylist = useMusic((state) => state.removeTrackFromPlaylist);
  const reorderTrackInPlaylist = useMusic((state) => state.reorderTrackInPlaylist);
  const removeTrack = useMusic((state) => state.removeTrack);
  const clearLibrary = useMusic((state) => state.clearLibrary);
  const playTrack = useMusic((state) => state.playTrack);
  const playPlaylist = useMusic((state) => state.playPlaylist);

  const [section, setSection] = useState<MusicSection>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MusicSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importProvider, setImportProvider] = useState<ImportProvider>("youtube");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [playlistLogoUrl, setPlaylistLogoUrl] = useState("");
  const [importTargetPlaylistId, setImportTargetPlaylistId] = useState("new");
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [editingPlaylist, setEditingPlaylist] = useState<{ id: string; name: string; description: string; logoUrl: string } | null>(null);
  const [loadingMixIndex, setLoadingMixIndex] = useState<number | null>(null);
  const [openMix, setOpenMix] = useState<{ index: number; results: MusicSearchResult[] } | null>(null);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const dragTargetRef = useRef<typeof dragTarget>(null);

  const tracksById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);

  const homeTracks = tracks.slice(0, 8);
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);
  const selectedPlaylistTracks = useMemo(
    () =>
      selectedPlaylist?.trackIds
        .map((id) => tracksById.get(id))
        .filter((t): t is MusicTrack => Boolean(t)) || [],
    [selectedPlaylist, tracksById],
  );

  const openMixConfig = openMix !== null ? MIX_CONFIGS[openMix.index] : null;

  useEffect(() => {
    dragTargetRef.current = dragTarget;
  }, [dragTarget]);

  function startPlaylistPointerDrag(trackId: string, event: ReactPointerEvent<HTMLElement>) {
    if (!selectedPlaylistId) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingTrackId(trackId);
    setDragTarget(null);

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const updateTarget = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const row = element?.closest<HTMLElement>("[data-playlist-track-id]");
      const targetId = row?.dataset.playlistTrackId;
      if (!row || !targetId || targetId === trackId) {
        setDragTarget(null);
        return;
      }
      const rect = row.getBoundingClientRect();
      const position = clientY > rect.top + rect.height / 2 ? "after" : "before";
      setDragTarget((current) =>
        current?.id === targetId && current.position === position ? current : { id: targetId, position },
      );
    };

    const handleMove = (moveEvent: PointerEvent) => {
      updateTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = () => {
      const target = dragTargetRef.current;
      if (target && target.id !== trackId) {
        reorderTrackInPlaylist(selectedPlaylistId, trackId, target.id, target.position);
      }
      document.body.style.userSelect = previousUserSelect;
      setDraggingTrackId(null);
      setDragTarget(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  function tryRemoveTrack(id: string) {
    const inPlaylist = playlists.some((p) => p.trackIds.includes(id));
    if (inPlaylist) {
      toast.danger(t("music.cannotRemove"), { description: t("music.trackInPlaylist") });
      return;
    }
    removeTrack(id);
  }

  function handleClearLibrary() {
    if (tracks.length === 0) return;
    clearLibrary();
    toast(t("music.libraryCleared"), { description: `${tracks.length} ${t("music.songs")}` });
  }


  async function handleMixClick(index: number) {
    if (loadingMixIndex !== null) return;
    setLoadingMixIndex(index);
    try {
      const config = MIX_CONFIGS[index];
      let mixResults: MusicSearchResult[] = [];

      if (config.isAI) {
        const res = await fetch("https://itunes.apple.com/us/rss/topsongs/limit=20/json");
        const data = await res.json();
        const entries: any[] = data?.feed?.entry ?? [];
        const picks = entries.sort(() => Math.random() - 0.5).slice(0, 8);
        const settled = await Promise.allSettled(
          picks.map((entry) => {
            const title = entry["im:name"]?.label ?? "";
            const artist = entry["im:artist"]?.label ?? "";
            return searchYouTubeMusic(`${title} ${artist}`);
          })
        );
        mixResults = settled
          .filter((r): r is PromiseFulfilledResult<MusicSearchResult[]> => r.status === "fulfilled")
          .flatMap((r) => r.value.slice(0, 1));
      } else if (config.region) {
        mixResults = await searchYouTubeTrending(config.region, 10);
      } else if (config.query) {
        mixResults = await searchYouTubeMusic(config.query);
      }

      setOpenMix({ index, results: mixResults });
    } catch (err) {
      toast.danger("Error", { description: "No se pudo cargar el mix" });
      console.error(err);
    } finally {
      setLoadingMixIndex(null);
    }
  }

  function addResult(result: MusicSearchResult) {
    const track = toTrack(result);
    addTrack(track);
    playTrack(track.id);
    toast(t("music.addedToQueue"), { description: result.title });
  }

  function addAllResults(results: MusicSearchResult[]) {
    const newTracks = results.map(toTrack);
    addTracks(newTracks);
    if (newTracks[0]) playTrack(newTracks[0].id);
    toast(t("music.addedToQueue"), { description: `${results.length} canciones agregadas` });
    setOpenMix(null);
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSection("home");
    try {
      const nextResults = await searchYouTubeMusic(query);
      setResults(nextResults);
      if (nextResults.length === 0) {
        toast(t("music.noResults"), { description: t("music.tryAnotherTitle") });
      }
    } catch (error) {
      toast.danger(t("music.searchFailed"), {
        description: error instanceof Error ? error.message : t("music.tryAnotherTitle"),
      });
      console.error(error);
    } finally {
      setSearching(false);
    }
  }

  async function handleImportPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importingPlaylist) return;
    setImportingPlaylist(true);
    try {
      const imported =
        importProvider === "youtube"
          ? await importYouTubePlaylist(playlistUrl)
          : await importSpotifyPlaylist(playlistUrl);
      if (imported.length === 0) {
        throw new Error("No se encontraron canciones reproducibles en YouTube");
      }
      const importedTracks = imported.map(toTrack);
      addTracks(importedTracks);
      const importedTrackIds = importedTracks.map((track) => track.id);
      const autoLogoUrl = playlistLogoUrl || importedTracks[0]?.thumbnail || "";
      if (importTargetPlaylistId === "new") {
        const playlist = createPlaylist(playlistName.trim() || t("music.importedPlaylist"), importedTrackIds);
        if (autoLogoUrl) updatePlaylist(playlist.id, { logoUrl: autoLogoUrl });
        setSelectedPlaylistId(playlist.id);
      } else {
        addTracksToPlaylist(importTargetPlaylistId, importedTrackIds);
        if (autoLogoUrl) updatePlaylist(importTargetPlaylistId, { logoUrl: autoLogoUrl });
        setSelectedPlaylistId(importTargetPlaylistId);
      }
      setPlaylistName("");
      setPlaylistLogoUrl("");
      setPlaylistUrl("");
      setSection("playlists");
      const spotifyStats = importProvider === "spotify" ? getLastSpotifyImportStats() : null;
      const importedCount = spotifyStats ? `${spotifyStats.found}/${spotifyStats.total}` : String(imported.length);
      toast(`${t("music.playlistImported")}: ${importedCount} ${t("music.songs")}`);
    } catch (error) {
      toast.danger(
        importProvider === "spotify" ? "No se pudo importar la playlist de Spotify" : t("music.importFailed"),
        {
          description:
            importProvider === "spotify"
              ? "No se pudo leer esta playlist. Prueba con una playlist pública o pega otro link."
              : t("music.importYoutubeFailed"),
        },
      );
      console.error(error);
    } finally {
      setImportingPlaylist(false);
    }
  }

  function handleCreatePlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!playlistName.trim()) return;
    createPlaylist(playlistName.trim(), []);
    setPlaylistName("");
    setPlaylistLogoUrl("");
    toast(t("music.playlistSaved"));
  }

  return (
    <div className="w-auto h-full flex min-h-0 bg-background">
      <aside className="w-44 shrink-0 bg-surface-secondary border-r border-white/10 p-3 flex flex-col gap-4 min-h-0">
        <div className="px-1 py-2">
          <div className="flex items-center gap-2">
            <IconMusic className="size-5 text-accent" />
            <h2 className="min-w-0 text-sm font-bold leading-tight bg-gradient-to-r from-[var(--color-accent)] to-[color-mix(in_srgb,var(--color-accent)_70%,white)] bg-clip-text text-transparent">
              Modstack Music
            </h2>
          </div>
        </div>
      
        <div className="flex flex-col gap-1 shrink-0">
          <MusicNavItem active={section === "home"} icon={<IconHomeFilled />} label={t("music.home")} onPress={() => setSection("home")} />
          <MusicNavItem active={section === "library"} icon={<IconMusic />} label={t("music.library")} onPress={() => setSection("library")} />
          <MusicNavItem active={section === "playlists"} icon={<IconPlaylist />} label={t("music.playlists")} onPress={() => { setSection("playlists"); setSelectedPlaylistId(null); }} />
        </div>
      
        <div className="border-t border-white/10 shrink-0" />
      
        <div className="flex flex-col gap-1 shrink-0">
          <MusicNavItem
            active={section === "import"}
            icon={<IconBrandYoutubeFilled className="text-danger" />}
            label={t("music.import")}
            onPress={() => setSection("import")}
          />
        </div>
      
        {playlists.length > 0 && (
          <>
            <div className="border-t border-white/10 shrink-0" />
            <div className="flex flex-col gap-1 min-h-0 flex-1 overflow-y-auto scrollbar-hide">
              <p className="px-3 py-1 text-xs font-semibold uppercase text-muted shrink-0">
                {t("music.playlists")}
              </p>
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => {
                    setSection("playlists");
                    setSelectedPlaylistId(playlist.id);
                  }}
                  data-active={section === "playlists" && selectedPlaylistId === playlist.id}
                  className="h-9 rounded-2xl px-3 flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground hover:bg-white/5 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground transition-colors shrink-0"
                >
                  <IconPlaylist className="size-4 shrink-0" />
                  <span className="truncate">{playlist.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      <main className="min-w-0 flex-1 flex flex-col min-h-0" style={{ backgroundColor: "var(--color-page-background)" }}>
        <form
          onSubmit={runSearch}
          className="h-16 shrink-0 bg-surface-secondary border-b border-white/10 px-4 flex items-center gap-3"
        >
          <div className="h-10 w-full max-w-xl rounded-2xl bg-surface border border-white/10 flex items-center px-3 gap-2">
            <IconSearch className="size-5 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("music.searchPlaceholder")}
              className="w-full bg-transparent outline-none text-sm text-foreground placeholder:text-muted"
            />
          </div>
          <Button type="submit" isIconOnly isDisabled={searching}>
            <IconSearch className="size-5" />
          </Button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">

          {section === "home" && (
            <div className="flex flex-col gap-5">
              <Surface className="rounded-2xl p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-foreground">{t("music.home")}</h3>
                    <p className="mt-1 text-sm text-muted">{t("music.homeDescription")}</p>
                  </div>
                  <div className="hidden md:flex items-center gap-2 text-xs text-muted">
                    <span className="rounded-2xl bg-surface-tertiary px-2 py-1">{tracks.length} {t("music.saved")}</span>
                    <span className="rounded-2xl bg-surface-tertiary px-2 py-1">{results.length} {t("music.results")}</span>
                  </div>
                </div>
              </Surface>

              {results.length > 0 && (
                <section>
                  <h4 className="mb-3 text-base font-semibold text-foreground">{t("music.resultsTitle")}</h4>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                    {results.map((result) => (
                      <SearchResultRow key={`${result.provider}-${result.id}`} result={result} onAdd={addResult} />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h4 className="mb-3 text-base font-semibold text-foreground">{t("music.recent")}</h4>
                {homeTracks.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                    {homeTracks.map((track) => <TrackRow key={track.id} track={track} />)}
                  </div>
                ) : (
                  <EmptyPanel>{t("music.emptyRecent")}</EmptyPanel>
                )}
              </section>

              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="text-base font-semibold text-foreground">{t("music.recommendations")}</h4>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {MIX_CONFIGS.map((config, i) => (
                    <RecommendedMixCard
                      key={config.titleKey}
                      config={config}
                      index={i}
                      onClick={handleMixClick}
                      loading={loadingMixIndex === i}
                      t={t}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {section === "library" && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold text-foreground">{t("music.library")}</h3>
                {tracks.length > 0 && (
                  <Button size="sm" variant="danger-soft" onPress={handleClearLibrary}>
                    <IconTrash className="size-4" />
                    {t("music.clearAll")}
                  </Button>
                )}
              </div>
              {tracks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {tracks.map((track) => {
                    const inPlaylist = playlists.some((p) => p.trackIds.includes(track.id));
                    return (
                      <TrackRow
                        key={track.id}
                        track={track}
                        trailing={
                          <Button
                            variant={inPlaylist ? "tertiary" : "danger-soft"}
                            size="sm"
                            isIconOnly
                            onPress={() => tryRemoveTrack(track.id)}
                            aria-label={inPlaylist ? t("music.trackInPlaylist") : t("music.removeTrack")}
                          >
                            <IconTrash className={`size-4 ${inPlaylist ? "opacity-30" : ""}`} />
                          </Button>
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyPanel>{t("music.noSavedMusic")}</EmptyPanel>
              )}
            </section>
          )}

          {section === "playlists" && (
            <section>
              {selectedPlaylist ? (
                <div>
                  <div className="flex justify-end mb-4">
                    <button
                      type="button"
                      onClick={() => setSelectedPlaylistId(null)}
                      className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
                    >
                      ← {t("music.playlists")}
                    </button>
                  </div>
                  <div className="flex gap-5 mb-8">
                    <PlaylistArtwork
                      name={selectedPlaylist.name}
                      logoUrl={selectedPlaylist.logoUrl}
                      trackThumbnails={selectedPlaylistTracks.slice(0, 4).map((t) => t.thumbnail).filter(Boolean) as string[]}
                      className="h-40 w-40 shrink-0"
                    />
                    <div className="flex flex-col justify-center gap-1 min-w-0">
                      <h3 className="text-3xl font-bold text-foreground truncate">{selectedPlaylist.name}</h3>
                      <p className="text-sm text-muted mb-2">
                        {selectedPlaylist.description || t("music.noDescription")}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onPress={() => {
                            playPlaylist(selectedPlaylist.id);
                            toast(t("music.addedToQueue"), { description: selectedPlaylist.name });
                          }}
                        >
                          <IconPlayerPlayFilled className="size-4" />
                          {t("music.play") ?? "Reproducir"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() =>
                            setEditingPlaylist({
                              id: selectedPlaylist.id,
                              name: selectedPlaylist.name,
                              description: selectedPlaylist.description || "",
                              logoUrl: selectedPlaylist.logoUrl || "",
                            })
                          }
                        >
                          <IconEdit className="size-4" />
                          {t("music.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          onPress={() => {
                            removePlaylist(selectedPlaylist.id);
                            setSelectedPlaylistId(null);
                          }}
                        >
                          <IconTrash className="size-4" />
                          {t("music.delete")}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <h4 className="text-xl font-bold text-foreground mb-3">{t("music.songs")}</h4>
                  <div className="flex flex-col gap-2">
                    {selectedPlaylistTracks.map((track) => {
                      const isDragging = draggingTrackId === track.id;
                      const showDropLine = dragTarget?.id === track.id && draggingTrackId !== track.id;
                      return (
                        <div
                          key={track.id}
                          data-playlist-track-id={track.id}
                          className={`relative transition-[opacity,transform,filter] duration-200 ease-out ${
                            isDragging ? "scale-[0.985] opacity-45 saturate-75" : "scale-100 opacity-100"
                          }`}
                        >
                          {showDropLine && (
                            <span
                              className={`pointer-events-none absolute left-3 right-3 z-20 h-0.5 rounded-full bg-accent shadow-[0_0_16px_rgba(82,126,255,0.75)] ${
                                dragTarget.position === "before" ? "-top-1" : "-bottom-1"
                              }`}
                            />
                          )}
                          <div className="rounded-lg transition-transform duration-200 ease-out hover:scale-[1.003]">
                            <TrackRow
                              track={track}
                              showPlaylistActions={false}
                              trailing={
                                <div className="flex shrink-0 items-center gap-1">
                                  <div
                                    onPointerDown={(event) => startPlaylistPointerDrag(track.id, event)}
                                    className="flex size-8 touch-none cursor-grab items-center justify-center rounded-xl text-white/25 transition-colors hover:bg-white/8 hover:text-white/70 active:cursor-grabbing"
                                    aria-label="Mover cancion"
                                    role="button"
                                  >
                                    <IconGripVertical className="size-4" />
                                  </div>
                                  <Button
                                    variant="danger-soft"
                                    size="sm"
                                    isIconOnly
                                    onPress={() => {
                                      removeTrackFromPlaylist(selectedPlaylist.id, track.id);
                                      toast(t("music.removedFromPlaylist"), { description: `${track.title} -> ${selectedPlaylist.name}` });
                                    }}
                                  >
                                    <IconMinus className="size-4" />
                                  </Button>
                                </div>
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                    {selectedPlaylistTracks.length === 0 && <EmptyPanel>{t("music.emptyPlaylist")}</EmptyPanel>}
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-2xl font-bold text-foreground mb-5">{t("music.playlists")}</h3>
                  <Surface className="mb-6 rounded-2xl p-4">
                    <form autoComplete="off" onSubmit={handleCreatePlaylist} className="flex flex-col gap-3">
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                        <TextField value={playlistName} onChange={setPlaylistName} variant="secondary">
                          <Label>{t("music.playlistName")}</Label>
                          <Input placeholder={t("music.playlistPlaceholder")} />
                        </TextField>
                        <Button type="submit" className="self-end" isDisabled={!playlistName.trim()}>
                          {t("music.createPlaylist")}
                        </Button>
                      </div>
                    </form>
                  </Surface>
                  {playlists.length > 0 ? (
                    <div className="flex flex-wrap gap-5">
                      {playlists.map((playlist) => {
                        const thumbs = playlist.trackIds
                          .slice(0, 4)
                          .map((id) => tracksById.get(id)?.thumbnail)
                          .filter(Boolean) as string[];
                        return (
                          <button
                            key={playlist.id}
                            type="button"
                            onClick={() => setSelectedPlaylistId(playlist.id)}
                            className="flex flex-col items-start gap-1 hover:opacity-80 transition-opacity"
                          >
                            <PlaylistArtwork
                              name={playlist.name}
                              logoUrl={playlist.logoUrl}
                              trackThumbnails={thumbs}
                              className="h-40 w-40"
                            />
                            <p className="text-xs text-muted mt-1">
                              {playlist.description || t("music.noDescription")}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyPanel>{t("music.noPlaylists")}</EmptyPanel>
                  )}
                </div>
              )}
            </section>
          )}

          {section === "import" && (
            <section className="max-w-2xl">
              <div className="mb-6">
                <h3 className="text-2xl font-bold text-foreground">{t("music.importPlaylist")}</h3>
                <p className="text-sm text-muted mt-1">{t("music.importDescription")}</p>
              </div>
              <form onSubmit={handleImportPlaylist} className="flex flex-col gap-4">
                <div className="flex gap-2 p-1 rounded-2xl bg-surface-secondary border border-white/10 w-fit">
                  <button
                    type="button"
                    onClick={() => setImportProvider("youtube")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      importProvider === "youtube"
                        ? "bg-danger text-white shadow-lg shadow-danger/20"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <IconBrandYoutubeFilled className="size-4" />
                    YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportProvider("spotify")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      importProvider === "spotify"
                        ? "bg-[#1db954] text-white shadow-lg shadow-[#1db954]/20"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <IconBrandSpotify className="size-4" />
                    Spotify
                  </button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-surface-secondary overflow-hidden">
                  <div className="p-4 border-b border-white/10 bg-surface-tertiary/30">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted mb-2 block">
                      {importProvider === "youtube" ? t("music.youtubeLink") : t("music.spotifyLink")}
                    </label>
                    <div className="flex items-center gap-2 h-11 rounded-xl border border-white/10 bg-surface px-3 focus-within:border-accent transition-colors">
                      {importProvider === "youtube"
                        ? <IconBrandYoutubeFilled className="size-4 text-danger shrink-0" />
                        : <IconBrandSpotify className="size-4 text-[#1db954] shrink-0" />
                      }
                      <input
                        value={playlistUrl}
                        onChange={(e) => setPlaylistUrl(e.target.value)}
                        placeholder={importProvider === "youtube"
                          ? "https://www.youtube.com/playlist?list=..."
                          : "https://open.spotify.com/playlist/..."}
                        className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted"
                      />
                    </div>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex flex-col items-center gap-1.5 shrink-0">
                        <div
                          className="size-16 rounded-xl border border-white/10 bg-surface flex items-center justify-center overflow-hidden cursor-pointer hover:border-white/30 transition-colors"
                          onClick={() => document.getElementById("import-logo")?.click()}
                        >
                          {playlistLogoUrl
                            ? <MusicImage src={playlistLogoUrl} alt="Logo" className="size-full object-cover" />
                            : <IconPhoto className="size-5 text-muted" />
                          }
                        </div>
                        <span className="text-[10px] text-muted">Logo</span>
                        <input
                          type="file"
                          accept="image/*"
                          id="import-logo"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => setPlaylistLogoUrl(String(reader.result));
                            reader.readAsDataURL(file);
                          }}
                        />
                      </div>
                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {t("music.playlistNameLabel")}
                        </label>
                        <input
                          value={playlistName}
                          onChange={(e) => setPlaylistName(e.target.value)}
                          placeholder={importTargetPlaylistId === "new" ? t("music.myPlaylist") : t("music.onlyNeededNewPlaylist")}
                          className="h-10 rounded-xl border border-white/10 bg-surface px-3 text-sm text-foreground placeholder:text-muted outline-none focus:border-white/30 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-4">
                      <div className="flex flex-col gap-2 flex-1">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {t("music.importInto")}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setImportTargetPlaylistId("new")}
                            className={`flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium border transition-all ${
                              importTargetPlaylistId === "new"
                                ? "bg-accent border-accent text-accent-foreground"
                                : "border-white/10 text-muted hover:text-foreground hover:border-white/20"
                            }`}
                          >
                            <IconPlaylistAdd className="size-3.5" />
                            {t("music.newPlaylist")}
                          </button>
                          {playlists.map((playlist) => (
                            <button
                              key={playlist.id}
                              type="button"
                              onClick={() => setImportTargetPlaylistId(playlist.id)}
                              className={`flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium border transition-all max-w-40 ${
                                importTargetPlaylistId === playlist.id
                                  ? "bg-accent border-accent text-accent-foreground"
                                  : "border-white/10 text-muted hover:text-foreground hover:border-white/20"
                              }`}
                            >
                              <IconPlaylist className="size-3.5 shrink-0" />
                              <span className="truncate">{playlist.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <Button type="submit" isDisabled={!playlistUrl.trim() || importingPlaylist} className="shrink-0">
                        {importProvider === "youtube"
                          ? <IconBrandYoutubeFilled className="size-4" />
                          : <IconBrandSpotify className="size-4" />
                        }
                        {importingPlaylist ? t("music.importing") : t("music.importSubmit")}
                      </Button>
                    </div>
                  </div>
                </div>
              </form>
            </section>
          )}

        </div>
        <MusicExpandedBar />
      </main>

      {openMix && openMixConfig && (
        <MixModal
          title={t(openMixConfig.titleKey)}
          subtitle={t(openMixConfig.subtitleKey)}
          accent={openMixConfig.accent}
          tracks={openMix.results}
          isAI={openMixConfig.isAI}
          onClose={() => setOpenMix(null)}
          onAdd={addResult}
          onAddAll={addAllResults}
          t={t}
        />
      )}

      {editingPlaylist && (
        <EditPlaylistModal
          name={editingPlaylist.name}
          description={editingPlaylist.description}
          logoUrl={editingPlaylist.logoUrl}
          onClose={() => setEditingPlaylist(null)}
          t={t}
          onSave={(name, description, logoUrl) => {
            updatePlaylist(editingPlaylist.id, { name, description, logoUrl });
            setEditingPlaylist(null);
            toast(t("music.playlistUpdated"));
          }}
        />
      )}

      <HomeSidebar />
    </div>
  );
}
