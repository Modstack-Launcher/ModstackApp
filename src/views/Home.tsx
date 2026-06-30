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
import { IconPlus, IconBox, IconChevronRight, IconX } from "@tabler/icons-react";
import { LoaderIcon } from "../components/icons/LoaderIcon";
import { useLauncherTranslation } from "../utils/languageContext";
import NewsCarousel from "../components/NewsCarousel";

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
    return loader ? <LoaderIcon loader={loader} size={32} /> : <IconBox className={className} />;
  }
  return <img src={src} alt={alt} className={className} onError={() => setError(true)} />;
}

export default function Home() {
  const { contains } = useFilter({ sensitivity: "base" });
  const codeModalState = useOverlayState();
  const openModalBtnRef = useRef<HTMLButtonElement>(null);

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockCode, setLockCode] = useState("");
  const [pendingLockedInstance, setPendingLockedInstance] = useState<Instance | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);

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
  
  const confirmLockCode = useCallback(async () => {
    if (!pendingLockedInstance || !lockCode) return;
    try {
      const { getInstance } = await import("../api/instances");
      const verified: Instance = await getInstance({ code: lockCode });
      if (!verified || verified.id !== pendingLockedInstance.id) {
        toast.danger(t("home.incorrectCode"), { description: t("home.noInstanceWithCode") });
        return;
      }
      localStorage.setItem(pendingLockedInstance.id, lockCode);
      const savedCodeInstances: Instance[] = JSON.parse(localStorage.getItem("codeInstances") || "[]");
      if (!savedCodeInstances.find((i) => i.id === pendingLockedInstance.id)) {
        savedCodeInstances.push(pendingLockedInstance);
        localStorage.setItem("codeInstances", JSON.stringify(savedCodeInstances));
      }
      setSelectedInstance(pendingLockedInstance);
      setPendingLockedInstance(null);
      setLockCode("");
      setLockModalOpen(false);
      toast(<span>Instance <strong>{pendingLockedInstance.title || pendingLockedInstance.id}</strong> {t("home.unlocked")}</span>);
    } catch (err: any) {
      const errStr = String(err).toLowerCase();
      if (errStr.includes("404") || errStr.includes("not found") || errStr.includes("no encontr")) {
        toast.danger(t("home.incorrectCode"), { description: t("home.noInstanceWithCode") });
      } else {
        toast.danger(t("home.verifyCodeError"), { description: t("home.tryAgain") });
      }
    }
  }, [pendingLockedInstance, lockCode, t]);

  const handlePlay = () => {
    if (!user) {
      return toast.danger(t("home.signIn"), { description: t("home.signInDescription") });
    }
    if (selectedInstance) launchInstance(selectedInstance);
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 relative overflow-hidden">
      <video
        key={selectedInstance?.id}
        ref={instanceImage}
        src={animatedBackground ? selectedInstance?.animation : undefined}
        poster={!selectedInstance?.animation || !animatedBackground ? selectedInstance?.landscape : undefined}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent pointer-events-none" />

      <div
        className="relative z-10 h-14 flex items-center px-2"
      >
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
          <Autocomplete.Trigger className="h-10 pl-2 py-2 hover:bg-white/10 border border-white/10 rounded-[10px]" style={{ backgroundColor: "#0f182b" }}>
            <Autocomplete.Value>
              {({ isPlaceholder }) => {
                if (isPlaceholder || !selectedInstance) {
                  return <span className="text-foreground/50">{t("home.selectInstance")}</span>;
                }
                return (
                  <div className="h-full flex items-center gap-2">
                    <InstanceIcon src={selectedInstance.icon} alt={selectedInstance.title} className="size-8 rounded" loader={(selectedInstance as any).loader} />
                    <span className="text-white">{selectedInstance.title}</span>
                  </div>
                );
              }}
            </Autocomplete.Value>
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover offset={4} placement="bottom start" isOpen={codeModalState.isOpen ? false : undefined}>
            <Autocomplete.Filter filter={contains}>
              <div className="px-3 flex items-center gap-2">
                <SearchField autoFocus name="search" variant="secondary" className="px-0">
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
                  onPress={() => { openModalBtnRef.current?.blur(); codeModalState.open(); }}
                >
                  <IconPlus />
                </Button>
              </div>
              <ListBox renderEmptyState={() => <EmptyState>{t("home.noInstances")}</EmptyState>}>
                {instances.map((instance) => (
                  <ListBox.Item key={instance.id} id={instance.id} textValue={instance.title}>
                    <InstanceIcon src={instance.icon} alt={instance.title} className="size-8 rounded" loader={(instance as any).loader} />
                    <span>{instance.title}</span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Filter>
          </Autocomplete.Popover>
        </Autocomplete>
      </div>

      <div className="relative z-10 flex-1 flex flex-col justify-end min-h-0 pointer-events-none">
        <div className="flex items-end justify-between px-6 pb-6 pointer-events-auto">
          <div className="flex flex-col gap-2">
            {selectedInstance && (
              <>
                <p className="text-white/60 text-xs font-medium uppercase tracking-widest">
                  {(selectedInstance as any).loader ?? "Vanilla"}
                </p>
                <h1 className="text-white text-2xl font-bold drop-shadow-lg">{selectedInstance.title}</h1>
                <p className="text-white/50 text-xs">{(selectedInstance as any).minecraft_version}</p>
              </>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <button
              onClick={() => setNewsOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] text-sm text-white/80 hover:text-white border border-white/15 hover:border-white/30 transition-all"
              style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)" }}
            >
              <span className="w-2 h-2 rounded-full bg-[#4b77e7] animate-pulse" />
              {t("home.news") ?? "Noticias"}
              <IconChevronRight size={13} className="text-white/50" />
            </button>

            <button
              onClick={handlePlay}
              disabled={!selectedInstance || launchedInstanceId === selectedInstance?.id || installProgress > 0 || installStatus !== ""}
              className="relative flex items-center justify-center font-minecraft text-shadow-[0_3px_#0000005e] text-foreground bg-transparent hover:saturate-80 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              style={{ width: '256px', height: '56px', fontSize: '30px' }}
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
                <path d="M2 10v88h8v8h476v-8h8V10h-8V2H10v8H2z" fill="color-mix(in srgb, var(--color-accent) 50%, black 50%)" stroke="#000" strokeWidth={4} />
                <path d="M12 10v88h472V10H12z" fill="var(--color-accent)" />
                <path d="M12 11h472V4H12v6z" fill="color-mix(in srgb, var(--color-accent) 80%, white 20%)" />
              </svg>
              {installStatus !== "" || installProgress > 0
                ? t("home.downloading")
                : isRunning
                  ? launchedInstanceId === selectedInstance?.id
                    ? t("home.playing")
                    : t("home.starting")
                  : t("home.play")}
            </button>
          </div>
        </div>
      </div>

      {newsOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setNewsOpen(false); }}
        >
          <div
            className="relative rounded-[16px] shadow-2xl border border-white/10 overflow-hidden flex flex-col"
            style={{ width: 720, maxHeight: "80vh", backgroundColor: "var(--color-overlay)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-sm font-bold text-white">{t("home.news") ?? "Noticias"}</span>
              <button
                onClick={() => setNewsOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-[8px] text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconX size={15} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <NewsCarousel />
            </div>
          </div>
        </div>,
        document.body
      )}

      {codeModalState.isOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) codeModalState.close(); }}
        >
          <div className="rounded-xl p-6 w-[420px] flex flex-col gap-4 shadow-2xl border border-white/10" style={{ backgroundColor: "var(--color-surface-secondary)" }}>
            <h2 className="text-base font-semibold text-foreground">{t("home.addInstanceTitle")}</h2>
            <TextField variant="secondary" type="password" value={code} onChange={setCode}>
              <Label className="text-sm text-foreground/70 mb-1">{t("home.addInstanceLabel")}</Label>
              <Input
                autoFocus
                placeholder={t("home.instanceCode")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { selectInstanceByCode(code); setCode(""); codeModalState.close(); }
                }}
              />
            </TextField>
            <div className="flex gap-2 justify-end mt-1">
              <Button variant="secondary" onPress={() => { setCode(""); codeModalState.close(); }}>{t("settings.cancel")}</Button>
              <Button onPress={() => { selectInstanceByCode(code); setCode(""); codeModalState.close(); }}>{t("home.addInstance")}</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {lockModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) { setLockModalOpen(false); setPendingLockedInstance(null); setLockCode(""); }
          }}
        >
          <div className="rounded-xl p-6 w-[420px] flex flex-col gap-4 shadow-2xl border border-white/10" style={{ backgroundColor: "var(--color-surface-secondary)" }}>
            <h2 className="text-base font-semibold text-foreground">{t("home.lockedInstance")}</h2>
            <p className="text-sm text-foreground/70">
              <strong>{pendingLockedInstance?.title || pendingLockedInstance?.id}</strong> {t("home.lockedDescription")}
            </p>
            <TextField variant="secondary" type="password" value={lockCode} onChange={setLockCode}>
              <Label className="text-sm text-foreground/70 mb-1">{t("home.accessCode")}</Label>
              <Input autoFocus placeholder={t("home.instanceCode")} onKeyDown={(e) => { if (e.key === "Enter") confirmLockCode(); }} />
            </TextField>
            <div className="flex gap-2 justify-end mt-1">
              <Button variant="secondary" onPress={() => { setLockModalOpen(false); setPendingLockedInstance(null); setLockCode(""); }}>{t("settings.cancel")}</Button>
              <Button onPress={confirmLockCode}>{t("home.unlock")}</Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}