import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigation } from "../hooks/useNavigation";
import { useLaunch } from "../stores/launchContext";
import { useUpdate } from "../stores/updateContext";
import { Button, ProgressBar, Tooltip } from "@heroui/react";
import { RunningInstances } from "./RunningInstances";
import { getCurrentTrack, isPlayableTrack, useMusic } from "../utils/musicContext";
import { useLauncherTranslation } from "../utils/languageContext";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconMinus,
  IconMusic,
  IconRefresh,
  IconSquare,
  IconSquares,
  IconUsers,
  IconX,
} from "@tabler/icons-react";

interface DownloadItem {
  id: string;
  name: string;
  title?: string;
  instanceId?: string;
  progress: number;
  status: string;
  indeterminate?: boolean;
}

function DownloadsPopup() {
  const { progressMap, pendingInstances } = useLaunch();
  const t = useLauncherTranslation();
  const [open, setOpen] = useState(false);
  const [userClosed, setUserClosed] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const downloads: DownloadItem[] = [
    ...[...pendingInstances.entries()]
      .filter(([id]) => ![...progressMap.keys()].some((k) => k.startsWith(`${id}:`)))
      .map(([id, name]) => ({
        id: `${id}:pending`,
        name,
        instanceId: id,
        progress: 0,
        status: `Launching ${name}...`,
        indeterminate: true,
      })),
    ...[...progressMap.values()].map((p) => ({
      id: `${p.instanceId}:${p.name.toLowerCase()}`,
      name: p.name,
      instanceId: p.instanceId,
      progress: p.progress,
      status: p.status,
      indeterminate: p.indeterminate,
    })),
  ];

  const hasActivity = downloads.length > 0 || pendingInstances.size > 0;

  useEffect(() => {
    if (hasActivity && !userClosed) {
      setOpen(true);
    }
    if (!hasActivity) {
      setOpen(false);
      setUserClosed(false);
    }
  }, [hasActivity, userClosed]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          setOpen(false);
          setUserClosed(true);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!hasActivity) return null;

  return (
    <div className="relative flex items-center" ref={popupRef}>
      <Button
        variant="ghost"
        size="lg"
        isIconOnly
        onPress={() => {
          setOpen((v) => !v);
          setUserClosed(false);
        }}
        className="relative rounded-none ring-inset"
        aria-label={t("frame.downloads")}
      >
        <IconDownload size={16} />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-success" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[316px] max-w-sm w-max z-50 rounded-lg border border-white/10 bg-surface shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <IconDownload size={14} className="text-success" />
              {t("frame.downloads")}
            </div>
            <Button
              variant="ghost"
              isIconOnly
              onPress={() => {
                setOpen(false);
                setUserClosed(true);
              }}
              className="size-5 rounded"
            >
              <IconX size={12} />
            </Button>
          </div>

          <div className="flex flex-col gap-3 px-3 py-3">
            {downloads.map((item) => (
              <div key={item.id} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">
                  {item.title ?? item.name}
                </span>

                <ProgressBar value={item.progress} isIndeterminate={item.indeterminate}>
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>

                <div className="flex items-center justify-start gap-1.5 text-xs text-muted w-full">
                  <span className="shrink-0">{item.progress}%</span>
                  <span>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default () => {
  const back = useNavigation((state) => state.back);
  const forward = useNavigation((state) => state.forward);
  const canGoBack = useNavigation((state) => state.canGoBack);
  const canGoForward = useNavigation((state) => state.canGoForward);
  const push = useNavigation((state) => state.push);
  const currentPath = useNavigation((state) => state.currentPath);
  const { status, applyUpdate, closeWithInstall } = useUpdate();
  const tracks = useMusic((state) => state.tracks);
  const currentIndex = useMusic((state) => state.currentIndex);
  const miniPlayerHidden = useMusic((state) => state.miniPlayerHidden);
  const currentTrack = getCurrentTrack({ tracks, currentIndex });
  const hasMiniPlayer = isPlayableTrack(currentTrack) && !miniPlayerHidden;
  const t = useLauncherTranslation();

  const [isMaximized, setIsMaximized] = useState(false);

  const closeApp = () => status === 'downloaded' ? closeWithInstall() : getCurrentWindow().close();
  const minimizeApp = () =>
    getCurrentWindow()
      .minimize()
      .then(() => setIsMaximized(false));
  const maximizeApp = () =>
    getCurrentWindow()
      .toggleMaximize()
      .then(() => setIsMaximized(true));

  const checkIsMaximized = async () => {
    setIsMaximized(await getCurrentWindow().isMaximized());
  };

  useEffect(() => {
    checkIsMaximized();
    getCurrentWindow().onResized(checkIsMaximized);
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="w-full flex justify-between bg-surface"
    >
      <div data-tauri-drag-region className="px-4 flex items-center gap-x-2">
        <img
          data-tauri-drag-region
          src="./icon.png"
          alt="Logo"
          className="w-6 h-6"
        />
        <img
          data-tauri-drag-region
          src="./modstack-title.png"
          alt="Logo"
          className="h-4 w-auto"
        />
        <div className="flex items-center gap-x-1">
          <Button
            variant="tertiary"
            isIconOnly
            onPress={() => back()}
            isDisabled={!canGoBack}
            className="size-6 rounded-full"
          >
            <IconChevronLeft />
          </Button>
          <Button
            variant="tertiary"
            isIconOnly
            onPress={() => forward()}
            isDisabled={!canGoForward}
            className="size-6 rounded-full"
          >
            <IconChevronRight />
          </Button>
        </div>
      </div>

      <div className="flex items-center">
        <RunningInstances />
        <Tooltip delay={0}>
          <Button
            variant="ghost"
            size="lg"
            isIconOnly
            onPress={() => push("music")}
            className="rounded-none ring-inset data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            data-active={currentPath === "music"}
            aria-label={t("nav.music")}
          >
            <IconMusic size={18} />
          </Button>
          <Tooltip.Content placement="bottom" className="text-sm font-semibold">
            <p>{t("nav.music")}</p>
          </Tooltip.Content>
        </Tooltip>
        <Tooltip delay={0}>
          <Button
            variant="ghost"
            size="lg"
            isIconOnly
            onPress={() => push("friends")}
            className="rounded-none ring-inset data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
            data-active={currentPath === "friends"}
            aria-label={t("nav.friends")}
          >
            <IconUsers size={18} />
          </Button>
          <Tooltip.Content placement="bottom" className="text-sm font-semibold">
            <p>{t("nav.friends")}</p>
          </Tooltip.Content>
        </Tooltip>
        {hasMiniPlayer && (
          <Tooltip delay={0}>
            <Button
              variant="ghost"
              size="lg"
              isIconOnly
              onPress={() => window.dispatchEvent(new CustomEvent("modstack:toggle-mini-player"))}
              className="rounded-none ring-inset text-accent"
              aria-label={t("music.openMiniPlayer")}
            >
              <IconMusic size={18} />
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-success" />
            </Button>
            <Tooltip.Content placement="bottom" className="text-sm font-semibold">
              <p>{t("music.openMiniPlayer")}</p>
            </Tooltip.Content>
          </Tooltip>
        )}
        <DownloadsPopup />
        {status === 'downloaded' && (
          <Button
            variant="ghost"
            size="lg"
            isIconOnly
            onPress={applyUpdate}
            className="rounded-none ring-inset text-[#4b77e7]"
            aria-label={t("frame.updateReady")}
          >
            <IconRefresh size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          isIconOnly
          onPress={minimizeApp}
          className="rounded-none ring-inset"
        >
          <IconMinus />
        </Button>
        <Button
          variant="ghost"
          size="lg"
          isIconOnly
          onPress={maximizeApp}
          className="rounded-none ring-inset"
        >
          {isMaximized ? (
            <IconSquares className="-rotate-90" />
          ) : (
            <IconSquare />
          )}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          isIconOnly
          onPress={closeApp}
          className="rounded-none ring-inset hover:bg-danger-soft-hover hover:text-danger-soft-foreground"
        >
          <IconX />
        </Button>
      </div>
    </div>
  );
};
