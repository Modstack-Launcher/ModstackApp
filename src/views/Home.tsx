import { useRef, useState, useCallback } from "react";
import { useInstance } from "../stores/instanceContext";
import { useSettings } from "../stores/settingsContext";
import { useAuth } from "../stores/authContext";
import { createPortal } from "react-dom";
import {
  Autocomplete,
  Button,
  EmptyState,
  Input,
  Label,
  ListBox,
  SearchField,
  TextField,
  toast,
  useFilter,
  useOverlayState,
} from "@heroui/react";
import NewsCarousel from "../components/NewsCarousel";
import { IconPlus, IconBox } from "@tabler/icons-react";
import { LoaderIcon } from "../components/icons/LoaderIcon";
import { useLauncherTranslation } from "../utils/languageContext";

function InstanceIcon({
  src,
  alt,
  className,
  loader,
}: {
  src: string;
  alt: string;
  className: string;
  loader?: string;
}) {
  const [error, setError] = useState(false);
  if (error || !src) {
    return loader
      ? <LoaderIcon loader={loader} size={32} />
      : <IconBox className={className} />;
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  );
}

export default function Home() {
  const { contains } = useFilter({ sensitivity: "base" });
  const codeModalState = useOverlayState();
  const openModalBtnRef = useRef<HTMLButtonElement>(null);

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockCode, setLockCode] = useState("");
  const [pendingLockedInstance, setPendingLockedInstance] =
    useState<Instance | null>(null);

  const { animatedBackground } = useSettings();
  const { user } = useAuth();
  const t = useLauncherTranslation();
  const {
    instances,
    selectedInstance,
    setSelectedInstance,
    launchInstance,
    selectInstanceByCode,
    isRunning,
    launchedInstanceId,
    installProgress,
    installStatus,
  } = useInstance();

  const instanceImage = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState("");

  const [collapse, setCollapse] = useState(0);
  const COLLAPSE_RANGE = 80; 

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    const progress = Math.min(1, Math.max(0, top / COLLAPSE_RANGE));
    setCollapse(progress);
  }, []);

  const confirmLockCode = useCallback(async () => {
    if (!pendingLockedInstance || !lockCode) return;

    try {
      const { getInstance } = await import("../api/instances");
      const verified: Instance = await getInstance({ code: lockCode });

      if (!verified || verified.id !== pendingLockedInstance.id) {
        toast.danger(t("home.incorrectCode"), {
          description: t("home.noInstanceWithCode"),
        });
        return;
      }

      localStorage.setItem(pendingLockedInstance.id, lockCode);

      const savedCodeInstances: Instance[] = JSON.parse(
        localStorage.getItem("codeInstances") || "[]",
      );
      if (!savedCodeInstances.find((i) => i.id === pendingLockedInstance.id)) {
        savedCodeInstances.push(pendingLockedInstance);
        localStorage.setItem(
          "codeInstances",
          JSON.stringify(savedCodeInstances),
        );
      }

      setSelectedInstance(pendingLockedInstance);
      setPendingLockedInstance(null);
      setLockCode("");
      setLockModalOpen(false);

      toast(
        <span>
          Instance{" "}
          <strong>
            {pendingLockedInstance.title || pendingLockedInstance.id}
          </strong>{" "}
          {t("home.unlocked")}
        </span>,
      );
    } catch (err: any) {
      const errStr = String(err).toLowerCase();
      if (
        errStr.includes("404") ||
        errStr.includes("not found") ||
        errStr.includes("no encontr")
      ) {
        toast.danger(t("home.incorrectCode"), {
          description: t("home.noInstanceWithCode"),
        });
      } else {
        toast.danger(t("home.verifyCodeError"), {
          description: t("home.tryAgain"),
        });
      }
    }
  }, [pendingLockedInstance, lockCode, t]);

  const handlePlay = () => {
    if (!user) {
      return toast.danger(t("home.signIn"), {
        description: t("home.signInDescription"),
      });
    }
    if (selectedInstance) launchInstance(selectedInstance);
  };

  const playWidth = 256 - collapse * 116;
  const playHeight = 56 - collapse * 16; 
  const playFontSize = 30 - collapse * 12;
  const RIGHT_MARGIN = 16;
  const leftPercent = 50 + collapse * 50; 
  const leftPxOffset =
    -playWidth / 2 + collapse * (-playWidth / 2 - RIGHT_MARGIN); 
  const playLeft = `calc(${leftPercent}% + ${leftPxOffset}px)`;
  const pokeUp = (1 - collapse) * 20;
  const playTop = `calc(50% - ${playHeight / 2 + pokeUp}px)`;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
        <div className="w-full h-[50vh] overflow-hidden flex-shrink-0">
          <video
            key={selectedInstance?.id}
            ref={instanceImage}
            src={animatedBackground ? selectedInstance?.animation : undefined}
            poster={
              !selectedInstance?.animation || !animatedBackground
                ? selectedInstance?.landscape
                : undefined
            }
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        <div className="h-14 grid grid-cols-3 bg-surface-secondary shadow flex-shrink-0 sticky top-0 z-10 relative">
          <Autocomplete
            allowsEmptyCollection
            placeholder={t("home.selectInstance")}
            value={selectedInstance?.id ?? ""}
            onChange={(value) => {
              const instance = instances.find((i) => i.id === value);
              if (!instance) return;

              const alreadyUnlocked = !!localStorage.getItem(instance.id);

              if (instance.locked && !alreadyUnlocked) {
                setPendingLockedInstance(instance);
                setLockCode("");
                setLockModalOpen(true);
                return;
              }

              setSelectedInstance(instance);
            }}
            className="w-3xs"
          >
            <Autocomplete.Trigger className="h-14 pl-2 py-2 bg-surface-secondary hover:bg-surface-hover">
              <Autocomplete.Value>
                {({ isPlaceholder }) => {
                  if (isPlaceholder || !selectedInstance) {
                    return (
                      <span className="text-foreground/50">
                        {t("home.selectInstance")}
                      </span>
                    );
                  }
                  return (
                    <div className="h-full flex items-center gap-2">
                      <InstanceIcon
                        src={selectedInstance.icon}
                        alt={selectedInstance.title}
                        className="size-10 rounded"
                        loader={(selectedInstance as any).loader}
                      />
                      <span>{selectedInstance.title}</span>
                    </div>
                  );
                }}
              </Autocomplete.Value>
              <Autocomplete.Indicator />
            </Autocomplete.Trigger>
            <Autocomplete.Popover
              offset={0}
              placement="top start"
              isOpen={codeModalState.isOpen ? false : undefined}
              className="rounded-b-none"
            >
              <Autocomplete.Filter filter={contains}>
                <div className="px-3 flex items-center gap-2">
                  <SearchField
                    autoFocus
                    name="search"
                    variant="secondary"
                    className="px-0"
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder={t("home.search")} />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <Button
                    ref={openModalBtnRef}
                    variant="secondary"
                    isIconOnly
                    onPress={() => {
                      openModalBtnRef.current?.blur();
                      codeModalState.open();
                    }}
                  >
                    <IconPlus />
                  </Button>
                </div>
                <ListBox
                  renderEmptyState={() => (
                    <EmptyState>{t("home.noInstances")}</EmptyState>
                  )}
                >
                  {instances.map((instance) => (
                    <ListBox.Item
                      key={instance.id}
                      id={instance.id}
                      textValue={instance.title}
                    >
                      <InstanceIcon
                        src={instance.icon}
                        alt={instance.title}
                        className="size-8 rounded"
                        loader={(instance as any).loader}
                      />
                      <span>{instance.title}</span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Filter>
            </Autocomplete.Popover>
          </Autocomplete>

          <Button
            isDisabled={
              !selectedInstance ||
              launchedInstanceId === selectedInstance.id ||
              installProgress > 0 ||
              installStatus !== ""
            }
            onPress={handlePlay}
            className="absolute font-minecraft text-shadow-[0_3px_#0000005e] text-foreground bg-transparent hover:saturate-80 disabled:opacity-100 disabled:hover:saturate-30 transition-[width,height,left,top,font-size] duration-150 ease-out"
            style={{
              width: `${playWidth}px`,
              height: `${playHeight}px`,
              left: playLeft,
              top: playTop,
              fontSize: `${playFontSize}px`,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={496}
              height={108}
              viewBox="0 0 496 108"
              fill="none"
              className="absolute -z-10 w-full h-full"
              preserveAspectRatio="none"
            >
              <path
                d="M2 10v88h8v8h476v-8h8V10h-8V2H10v8H2z"
                fill="color-mix(in srgb, var(--color-accent) 50%, black 50%)"
                stroke="#000"
                strokeWidth={4}
              />
              <path d="M12 10v88h472V10H12z" fill="var(--color-accent)" />
              <path
                d="M12 11h472V4H12v6z"
                fill="color-mix(in srgb, var(--color-accent) 80%, white 20%)"
              />
            </svg>
            {installStatus !== "" || installProgress > 0
              ? t("home.downloading")
              : isRunning
                ? launchedInstanceId === selectedInstance?.id
                  ? t("home.playing")
                  : t("home.starting")
                : t("home.play")}
          </Button>
          <div></div>
        </div>

        <div className="p-4">
          <NewsCarousel />
        </div>
      </div>

      {codeModalState.isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) codeModalState.close();
            }}
          >
            <div
              className="rounded-xl p-6 w-[420px] flex flex-col gap-4 shadow-2xl border border-white/10"
              style={{ backgroundColor: "var(--color-surface-secondary)" }}
            >
              <h2 className="text-base font-semibold text-foreground">
                {t("home.addInstanceTitle")}
              </h2>
              <TextField
                variant="secondary"
                type="password"
                value={code}
                onChange={setCode}
              >
                <Label className="text-sm text-foreground/70 mb-1">
                  {t("home.addInstanceLabel")}
                </Label>
                <Input
                  autoFocus
                  placeholder={t("home.instanceCode")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      selectInstanceByCode(code);
                      setCode("");
                      codeModalState.close();
                    }
                  }}
                />
              </TextField>
              <div className="flex gap-2 justify-end mt-1">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setCode("");
                    codeModalState.close();
                  }}
                >
                  {t("settings.cancel")}
                </Button>
                <Button
                  onPress={() => {
                    selectInstanceByCode(code);
                    setCode("");
                    codeModalState.close();
                  }}
                >
                  {t("home.addInstance")}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {lockModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setLockModalOpen(false);
                setPendingLockedInstance(null);
                setLockCode("");
              }
            }}
          >
            <div
              className="rounded-xl p-6 w-[420px] flex flex-col gap-4 shadow-2xl border border-white/10"
              style={{ backgroundColor: "var(--color-surface-secondary)" }}
            >
              <h2 className="text-base font-semibold text-foreground">
                {t("home.lockedInstance")}
              </h2>
              <p className="text-sm text-foreground/70">
                <strong>
                  {pendingLockedInstance?.title || pendingLockedInstance?.id}
                </strong>{" "}
                {t("home.lockedDescription")}
              </p>
              <TextField
                variant="secondary"
                type="password"
                value={lockCode}
                onChange={setLockCode}
              >
                <Label className="text-sm text-foreground/70 mb-1">
                  {t("home.accessCode")}
                </Label>
                <Input
                  autoFocus
                  placeholder={t("home.instanceCode")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      confirmLockCode();
                    }
                  }}
                />
              </TextField>
              <div className="flex gap-2 justify-end mt-1">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setLockModalOpen(false);
                    setPendingLockedInstance(null);
                    setLockCode("");
                  }}
                >
                  {t("settings.cancel")}
                </Button>
                <Button onPress={confirmLockCode}>{t("home.unlock")}</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}