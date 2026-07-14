import { useState, useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../stores/settingsContext";
import { useInstance } from "../stores/instanceContext";
import {
  languageOptions,
  useLauncherTranslation,
  useLanguage,
  type LauncherLanguage,
} from "../utils/languageContext";
import {
  Button,
  Description,
  Key,
  Label,
  NumberField,
  Slider,
  Surface,
  Switch,
  Tabs,
  toast,
} from "@heroui/react";
import {
  IconBox,
  IconCheck,
  IconChevronDown,
  IconCoffee,
  IconDeviceGamepad2Filled,
  IconDownload,
  IconFolder,
  IconFolderOpen,
  IconFolderSearch,
  IconLoader2,
  IconRotate,
  IconSearch,
  IconSettingsFilled,
  IconTrash,
} from "@tabler/icons-react";
import { Pickaxe, } from "lucide-react";
import HomeSidebar from "../components/HomeSidebar";

interface BedrockStatus {
  installed: boolean;
  version?: string;
  install_path?: string;
  platform: string;
  store_installed: boolean;
}

interface JavaRuntimeStatus {
  version: number;
  path: string;
  installed: boolean;
  detected_version: number;
  custom: boolean;
}

// Sections that have a matching tab, in document order (used by the scroll-spy).
const TAB_IDS = ["launcher", "game", "resources", "storage"];

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToHsl(hex: string) {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 270, s: 55, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return {
    h: Math.round((h * 60 + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToHex(h: number, s: number, l: number) {
  const hp = clamp(h, 0, 360);
  const sp = clamp(s, 0, 100) / 100;
  const lp = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * lp - 1)) * sp;
  const x = c * (1 - Math.abs(((hp / 60) % 2) - 1));
  const m = lp - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 60) [r, g, b] = [c, x, 0];
  else if (hp < 120) [r, g, b] = [x, c, 0];
  else if (hp < 180) [r, g, b] = [0, c, x];
  else if (hp < 240) [r, g, b] = [0, x, c];
  else if (hp < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r, g, b]
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

function TabIndicator() {
  return <Tabs.Indicator className="translate-x-0! bg-accent" />;
}

function SwitchThumb() {
  return <Switch.Thumb className="size-5 group-data-[selected=true]:ml-6.5" />;
}

function ThemedSwitchControl() {
  return (
    <Switch.Control className="bg-surface-tertiary transition-colors group-data-[selected=true]:bg-accent group-data-[hover=true]:bg-surface-secondary group-data-[selected=true]:group-data-[hover=true]:bg-accent">
      <SwitchThumb />
    </Switch.Control>
  );
}

export default function Settings() {
  const {
    animations, setAnimations,
    animatedBackground, setAnimatedBackground,
    hideLauncher, setHideLauncher,
    discordRPC, setDiscordRPC,
    windowWidth, setWindowWidth,
    windowHeight, setWindowHeight,
    fullscreen, setFullscreen,
    minRAM, setMinRAM,
    maxRAM, setMaxRAM,
    downloadConcurrency, setDownloadConcurrency,
    forceIpv4, setForceIpv4,
    dnsOverHttps, setDnsOverHttps,
    hideMusic, setHideMusic,
    accentColor, setAccentColor,
    sidebarLayout, setSidebarLayout,
    dashboardMode, setDashboardMode,
  } = useSettings();
  const { installedInstances, uninstallInstance } = useInstance();
  const language = useLanguage((state) => state.language);
  const setLanguage = useLanguage((state) => state.setLanguage);
  const t = useLauncherTranslation();

  const [version, setVersion] = useState("");
  const [systemRAM, setSystemRAM] = useState<number>(0);
  const [inViewTab, setInViewTab] = useState<Key>("launcher");
  const settingsContentRef = useRef<HTMLDivElement>(null);

  const [installDir, setInstallDir] = useState<string>("");
  const [defaultDir, setDefaultDir] = useState<string>("");
  const [loadingDir, setLoadingDir] = useState(false);

  const [bedrockStatus, setBedrockStatus] = useState<BedrockStatus | null>(null);
  const [uninstallingBedrock, setUninstallingBedrock] = useState(false);
  const [confirmUninstallBedrock, setConfirmUninstallBedrock] = useState(false);
  const [javaPanelOpen, setJavaPanelOpen] = useState(false);
  const [javaStatuses, setJavaStatuses] = useState<JavaRuntimeStatus[]>([]);
  const [javaBusy, setJavaBusy] = useState<string | null>(null);

  const handleScroll = () => {
    const container = settingsContentRef.current;
    if (!container) return;
    // Detection line a bit below the top edge of the scroll container.
    const line = container.getBoundingClientRect().top + 140;
    // Highlight the last tabbed section whose top has scrolled past the line.
    let current = TAB_IDS[0];
    for (const id of TAB_IDS) {
      const el = container.querySelector<HTMLElement>(`#${id}`);
      if (el && el.getBoundingClientRect().top <= line) current = id;
    }
    // The trailing sections can be shorter than the viewport, so they never
    // reach the detection line. When scrolled to the bottom, highlight the
    // last tab so it doesn't stay stuck on a previous section.
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      current = TAB_IDS[TAB_IDS.length - 1];
    }
    setInViewTab(current);
  };

  useEffect(() => { getVersion().then(setVersion); }, []);

  useEffect(() => {
    handleScroll();
    settingsContentRef.current?.addEventListener("scroll", handleScroll);
    return () => settingsContentRef.current?.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    invoke<number>("get_system_ram").then((mem) => {
      if (mem) setSystemRAM(mem / 1024 / 1024);
      else setSystemRAM(8192);
    });
  }, []);

  useEffect(() => {
    invoke<string>("get_install_dir").then((dir) => {
      setInstallDir(dir);
      setDefaultDir(dir);
    });
  }, []);

  useEffect(() => {
    invoke<BedrockStatus>("bedrock_get_status").then(setBedrockStatus).catch(() => {});
  }, []);

  const refreshJavaStatuses = async () => {
    const statuses = await invoke<JavaRuntimeStatus[]>("get_java_runtimes_status");
    setJavaStatuses(statuses);
  };

  useEffect(() => {
    refreshJavaStatuses().catch(() => {});
  }, []);

  async function handlePickDir() {
    setLoadingDir(true);
    try {
      const newPath = await invoke<string>("pick_install_dir");
      setInstallDir(newPath);
      toast("Directory updated", { description: "New installations will use this folder." });
    } catch (e: any) {
      if (!String(e).includes("Cancelled")) toast.danger("Error", { description: String(e) });
    } finally { setLoadingDir(false); }
  }

  async function handleResetDir() {
    setLoadingDir(true);
    try {
      const defaultPath = await invoke<string>("reset_install_dir");
      setInstallDir(defaultPath);
      toast("Directory reset", { description: "The default folder will be used." });
    } catch (e: any) {
      toast.danger("Error", { description: String(e) });
    } finally { setLoadingDir(false); }
  }

  async function handleUninstallBedrock() {
    setUninstallingBedrock(true);
    try {
      await invoke("bedrock_uninstall");
      setBedrockStatus(prev => prev ? { ...prev, installed: false, version: undefined } : null);
      setConfirmUninstallBedrock(false);
      toast("Bedrock uninstalled successfully");
    } catch (e) {
      toast.danger("Error uninstalling Bedrock", { description: String(e) });
    } finally { setUninstallingBedrock(false); }
  }

  async function handleInstallJava(version: number) {
    setJavaBusy(`install-${version}`);
    try {
      const status = await invoke<JavaRuntimeStatus>("install_java_runtime", { version });
      setJavaStatuses((items) => items.map((item) => item.version === version ? status : item));
      toast(t("settings.java.installSuccess"), { description: `Java ${version}` });
    } catch (e) {
      toast.danger("Java", { description: String(e) });
    } finally {
      setJavaBusy(null);
    }
  }

  async function handleDetectJava(version: number) {
    setJavaBusy(`detect-${version}`);
    try {
      const status = await invoke<JavaRuntimeStatus>("detect_java_runtime", { version });
      setJavaStatuses((items) => items.map((item) => item.version === version ? status : item));
      toast(t("settings.java.detectComplete"), { description: `Java ${version}` });
    } catch (e) {
      toast.danger("Java", { description: String(e) });
    } finally {
      setJavaBusy(null);
    }
  }

  async function handleBrowseJava(version: number) {
    setJavaBusy(`browse-${version}`);
    try {
      const status = await invoke<JavaRuntimeStatus>("pick_java_runtime", { version });
      setJavaStatuses((items) => items.map((item) => item.version === version ? status : item));
      toast(t("settings.java.browseSuccess"), { description: `Java ${version}` });
    } catch (e: any) {
      if (!String(e).includes("Cancelled")) toast.danger("Java", { description: String(e) });
    } finally {
      setJavaBusy(null);
    }
  }

  const isCustomDir = installDir !== defaultDir && installDir !== "";
  const accentOptions = [
    { key: "blue", labelKey: "settings.color.blue", color: "#4b77e7" },
    { key: "green", labelKey: "settings.color.green", color: "#39d98a" },
    { key: "cyan", labelKey: "settings.color.cyan", color: "#4fc3e8" },
    { key: "amber", labelKey: "settings.color.amber", color: "#d8a536" },
    { key: "red", labelKey: "settings.color.red", color: "#df4b4b" },
    { key: "pink", labelKey: "settings.color.pink", color: "#e75aa0" },
    { key: "purple", labelKey: "settings.color.purple", color: "#a970ff" },
  ] as const;
  const sidebarOptions = [
    { key: "right", labelKey: "settings.sidebarLayout.right" },
    { key: "left", labelKey: "settings.sidebarLayout.left" },
    { key: "bottom", labelKey: "settings.sidebarLayout.bottom" },
    { key: "compact", labelKey: "settings.sidebarLayout.compact" },
  ] as const;
  const dashboardOptions = [
    { key: "new", labelKey: "settings.dashboardMode.new" },
    { key: "classic", labelKey: "settings.dashboardMode.classic" },
  ] as const;
  const customAccent = isHexColor(accentColor) ? accentColor : "#5b2a86";
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customAccentDraft, setCustomAccentDraft] = useState(customAccent);
  const [customHsl, setCustomHsl] = useState(() => hexToHsl(customAccent));
  useEffect(() => {
    setCustomAccentDraft(customAccent);
    setCustomHsl(hexToHsl(customAccent));
  }, [customAccent]);
  const saveAccentColor = (value: string) => {
    setAccentColor(value);
    invoke("set_config", { key: "app.accent-color", value });
  };
  const setDraftFromHsl = (next: { h: number; s: number; l: number }) => {
    const normalized = {
      h: clamp(Math.round(next.h), 0, 360),
      s: clamp(Math.round(next.s), 0, 100),
      l: clamp(Math.round(next.l), 0, 100),
    };
    setCustomHsl(normalized);
    setCustomAccentDraft(hslToHex(normalized.h, normalized.s, normalized.l));
  };
  const openCustomPicker = () => {
    setCustomAccentDraft(customAccent);
    setCustomHsl(hexToHsl(customAccent));
    setCustomPickerOpen((value) => !value);
  };

  return (
    <div className="w-full h-full flex">
      <Tabs
        orientation="vertical"
        selectedKey={inViewTab}
        onSelectionChange={(key) => {
          setInViewTab(key);
          document.querySelector(`#${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className="h-full"
      >
        <Tabs.ListContainer className="py-4 px-2 flex flex-col bg-surface-secondary">
          <Tabs.List aria-label="Settings tabs" className="w-36 h-full rounded-none bg-transparent">
            <Tabs.Tab id="launcher" className="justify-start">{t("settings.tabs.launcher")}<TabIndicator /></Tabs.Tab>
            <Tabs.Tab id="game" className="justify-start">{t("settings.tabs.game")}<TabIndicator /></Tabs.Tab>
            <Tabs.Tab id="resources" className="justify-start">{t("settings.tabs.resources")}<TabIndicator /></Tabs.Tab>
            <Tabs.Tab id="storage" className="justify-start">{t("settings.tabs.storage")}<TabIndicator /></Tabs.Tab>
          </Tabs.List>
          <div className="px-1 flex items-center gap-2">
            <img src="./icon.png" className="size-6 grayscale opacity-50" />
            <span className="text-sm text-muted">Modstack v{version}</span>
          </div>
        </Tabs.ListContainer>
      </Tabs>

      <div ref={settingsContentRef} className="relative w-full h-full overflow-y-auto">

        <section id="launcher" className="p-4">
          <div className="max-w-2xl mb-6 mx-auto flex items-center gap-x-2">
            <IconSettingsFilled className="text-accent" />
            <h3 className="font-semibold">{t("settings.launcher.title")}</h3>
          </div>
          <div className="max-w-xl mx-auto flex flex-col gap-y-4">
            <Switch name="animations" size="lg" isSelected={animations}
              onChange={(value) => { setAnimations(value); invoke("set_config", { key: "app.animations", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.animations.label")}</Label><Description>{t("settings.animations.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Switch name="animated_background" size="lg" isSelected={animatedBackground}
              onChange={(value) => { setAnimatedBackground(value); invoke("set_config", { key: "app.animated-background", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.animatedBackground.label")}</Label><Description>{t("settings.animatedBackground.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Switch name="hide_launcher" size="lg" isSelected={hideLauncher}
              onChange={(value) => { setHideLauncher(value); invoke("set_config", { key: "app.hide-launcher", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.hideLauncher.label")}</Label><Description>{t("settings.hideLauncher.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Switch name="discord_rpc" size="lg" isSelected={discordRPC}
              onChange={(value) => { setDiscordRPC(value); invoke("set_config", { key: "app.discord-rpc", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.discordRpc.label")}</Label><Description>{t("settings.discordRpc.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Switch name="hide_music" size="lg" isSelected={hideMusic}
              onChange={(value) => { setHideMusic(value); invoke("set_config", { key: "app.hide-music", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.hideMusic.label")}</Label><Description>{t("settings.hideMusic.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Surface className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex flex-col gap-0.5">
                <Label>{t("settings.accentColor.label")}</Label>
                <Description>{t("settings.accentColor.description")}</Description>
              </div>
              <div className="relative flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-surface p-1 shadow-inner">
                {accentOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => {
                      saveAccentColor(option.key);
                      setCustomPickerOpen(false);
                    }}
                    className={[
                      "size-8 rounded-[8px] border flex items-center justify-center transition-all",
                      accentColor === option.key ? "border-foreground" : "border-transparent hover:border-border",
                    ].join(" ")}
                    title={t(option.labelKey)}
                    aria-label={t(option.labelKey)}
                    style={{ backgroundColor: option.color }}
                  >
                    {accentColor === option.key && <IconCheck size={15} className="text-black" strokeWidth={3} />}
                  </button>
                ))}
                <button
                  onClick={openCustomPicker}
                  className={[
                    "ml-1 flex h-8 items-center gap-2 rounded-[8px] border px-2.5 text-xs font-semibold transition-colors",
                    isHexColor(accentColor) ? "border-foreground text-foreground" : "border-transparent text-muted hover:border-border hover:text-foreground",
                  ].join(" ")}
                  aria-label={t("settings.color.custom")}
                  title={t("settings.color.custom")}
                >
                  <span
                    className="size-4 rounded-[5px] border border-white/20"
                    style={{ backgroundColor: customAccentDraft }}
                  />
                  {t("settings.color.custom")}
                </button>

                {customPickerOpen && (
                  <div
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-[292px] rounded-[14px] border border-border bg-overlay p-4 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mb-4 flex items-center gap-3">
                      <div
                        className="size-12 rounded-[12px] border border-border shadow-inner"
                        style={{ backgroundColor: customAccentDraft }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{t("settings.color.custom")}</p>
                        <p className="text-xs font-mono text-muted">{customAccentDraft.toUpperCase()}</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{t("settings.color.hue")}</span>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          value={customHsl.h}
                          onChange={(event) => setDraftFromHsl({ ...customHsl, h: Number(event.target.value) })}
                          className="h-3 cursor-pointer appearance-none rounded-full border border-border bg-[linear-gradient(90deg,#ff3b3b,#ffd43b,#39d98a,#4fc3e8,#7c4dff,#e75aa0,#ff3b3b)]"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{t("settings.color.saturation")}</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={customHsl.s}
                          onChange={(event) => setDraftFromHsl({ ...customHsl, s: Number(event.target.value) })}
                          className="h-3 cursor-pointer appearance-none rounded-full border border-border"
                          style={{ background: `linear-gradient(90deg, hsl(${customHsl.h} 0% ${customHsl.l}%), hsl(${customHsl.h} 100% ${customHsl.l}%))` }}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{t("settings.color.lightness")}</span>
                        <input
                          type="range"
                          min={15}
                          max={85}
                          value={customHsl.l}
                          onChange={(event) => setDraftFromHsl({ ...customHsl, l: Number(event.target.value) })}
                          className="h-3 cursor-pointer appearance-none rounded-full border border-border"
                          style={{ background: `linear-gradient(90deg, hsl(${customHsl.h} ${customHsl.s}% 12%), hsl(${customHsl.h} ${customHsl.s}% 50%), hsl(${customHsl.h} ${customHsl.s}% 88%))` }}
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <input
                        value={customAccentDraft}
                        onChange={(event) => {
                          const next = event.target.value.trim();
                          setCustomAccentDraft(next);
                          if (isHexColor(next)) setCustomHsl(hexToHsl(next));
                        }}
                        onBlur={() => {
                          if (!isHexColor(customAccentDraft)) setCustomAccentDraft(hslToHex(customHsl.h, customHsl.s, customHsl.l));
                        }}
                        className="h-9 min-w-0 flex-1 rounded-[9px] border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-colors focus:border-accent"
                      />
                      <button
                        onClick={() => {
                          saveAccentColor(customAccentDraft);
                          setCustomPickerOpen(false);
                        }}
                        disabled={!isHexColor(customAccentDraft)}
                        className="h-9 rounded-[9px] bg-accent px-3 text-xs font-bold text-accent-foreground transition-opacity disabled:opacity-40"
                      >
                        {t("settings.color.apply")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Surface>
            <Surface className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex flex-col gap-0.5">
                <Label>{t("settings.sidebarLayout.label")}</Label>
                <Description>{t("settings.sidebarLayout.description")}</Description>
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-surface p-1 shadow-inner">
                {sidebarOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => {
                      setSidebarLayout(option.key);
                      invoke("set_config", { key: "app.sidebar-layout", value: option.key });
                    }}
                    className={["h-8 rounded-[8px] px-3 text-sm font-semibold transition-colors", sidebarLayout === option.key ? "bg-accent text-accent-foreground" : "text-muted hover:bg-white/5 hover:text-foreground"].join(" ")}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </Surface>
            <Surface className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex flex-col gap-0.5">
                <Label>{t("settings.dashboardMode.label")}</Label>
                <Description>{t("settings.dashboardMode.description")}</Description>
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-surface p-1 shadow-inner">
                {dashboardOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => {
                      setDashboardMode(option.key);
                      invoke("set_config", { key: "app.dashboard-mode", value: option.key });
                    }}
                    className={["h-8 rounded-[8px] px-3 text-sm font-semibold transition-colors", dashboardMode === option.key ? "bg-accent text-accent-foreground" : "text-muted hover:bg-white/5 hover:text-foreground"].join(" ")}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </Surface>
            <Surface className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex flex-col gap-0.5">
                <Label>{t("settings.language.label")}</Label>
                <Description>{t("settings.language.description")}</Description>
              </div>
              <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-surface p-1 shadow-inner">
                {languageOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setLanguage(option.value as LauncherLanguage)}
                    className={["flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition-colors", language === option.value ? "bg-accent text-accent-foreground" : "text-muted hover:bg-white/5 hover:text-foreground"].join(" ")}
                  >
                    {language === option.value && <IconCheck size={14} />}
                    {option.label}
                  </button>
                ))}
              </div>
            </Surface>
          </div>
        </section>

        <section id="game" className="p-4">
          <div className="max-w-2xl mb-6 mx-auto flex items-center gap-x-2">
            <IconDeviceGamepad2Filled className="text-accent" />
            <h3 className="font-semibold">{t("settings.game.title")}</h3>
          </div>
          <div className="max-w-xl mx-auto flex flex-col gap-y-4">
            <Switch name="fullscreen" size="lg" isSelected={fullscreen}
              onChange={(value) => { setFullscreen(value); invoke("set_config", { key: "game.fullscreen", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.fullscreen.label")}</Label><Description>{t("settings.fullscreen.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <NumberField name="window_width" minValue={0} value={windowWidth}
              onChange={(value) => { setWindowWidth(value); invoke("set_config", { key: "game.width", value }); }}
              className="flex-row justify-between">
              <Label>{t("settings.windowWidth")}</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <NumberField name="window_height" minValue={0} value={windowHeight}
              onChange={(value) => { setWindowHeight(value); invoke("set_config", { key: "game.height", value }); }}
              className="flex-row justify-between">
              <Label>{t("settings.windowHeight")}</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <Slider
              formatOptions={{ style: "unit", unit: "megabyte" }}
              minValue={512} maxValue={systemRAM} step={64}
              value={[minRAM, maxRAM]}
              onChange={(value) => {
                if (typeof value === "number") {
                  setMinRAM(value); setMaxRAM(value);
                } else {
                  const [min, max] = value;
                  setMinRAM(min); setMaxRAM(max);
                }
              }}
              onChangeEnd={(value) => {
                if (typeof value === "number") {
                  invoke("set_config", { key: "game.minRAM", value: `${value}M` });
                  invoke("set_config", { key: "game.maxRAM", value: `${value}M` });
                } else {
                  const [min, max] = value;
                  invoke("set_config", { key: "game.minRAM", value: `${min}M` });
                  invoke("set_config", { key: "game.maxRAM", value: `${max}M` });
                }
              }}
              className="flex-col">
              <Label>{t("settings.memoryAllocation")}</Label>
              <Slider.Output />
              <Slider.Track>
                {({ state }) => (
                  <>
                    <Slider.Fill />
                    {state.values.map((_, i) => <Slider.Thumb key={i} index={i} />)}
                  </>
                )}
              </Slider.Track>
            </Slider>
          </div>
        </section>

        <section id="resources" className="p-4">
          <div className="max-w-2xl mb-6 mx-auto flex items-center gap-x-2">
            <IconDownload className="text-accent" />
            <h3 className="font-semibold">{t("settings.resources.title")}</h3>
          </div>
          <div className="max-w-xl mx-auto flex flex-col gap-y-4">
            <Slider
              minValue={1} maxValue={64} step={1}
              value={downloadConcurrency}
              onChange={(value) => {
                const v = typeof value === "number" ? value : value[0];
                setDownloadConcurrency(v);
              }}
              onChangeEnd={(value) => {
                const v = typeof value === "number" ? value : value[0];
                invoke("set_config", { key: "resources.download-concurrency", value: v });
              }}
              className="flex-col">
              <div className="flex flex-col gap-0.5">
                <Label>{t("settings.downloadConcurrency.label")}</Label>
                <Description>{t("settings.downloadConcurrency.description")}</Description>
              </div>
              <Slider.Output />
              <Slider.Track>
                {({ state }) => (
                  <>
                    <Slider.Fill />
                    {state.values.map((_, i) => <Slider.Thumb key={i} index={i} />)}
                  </>
                )}
              </Slider.Track>
            </Slider>
            <Switch name="force_ipv4" size="lg" isSelected={forceIpv4}
              onChange={(value) => { setForceIpv4(value); invoke("set_config", { key: "resources.force-ipv4", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.forceIpv4.label")}</Label><Description>{t("settings.forceIpv4.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
            <Switch name="dns_over_https" size="lg" isSelected={dnsOverHttps}
              onChange={(value) => { setDnsOverHttps(value); invoke("set_config", { key: "resources.dns-over-https", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.dnsOverHttps.label")}</Label><Description>{t("settings.dnsOverHttps.description")}</Description></Switch.Content>
              <ThemedSwitchControl />
            </Switch>
          </div>
        </section>

        <section id="storage" className="p-4">
          <div className="max-w-2xl mb-6 mx-auto flex items-center gap-x-2">
            <IconFolder className="text-accent" />
            <h3 className="font-semibold">{t("settings.storage.title")}</h3>
          </div>
          <div className="max-w-xl mx-auto flex flex-col gap-y-4">
            <Surface className="p-4 flex flex-col gap-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t("settings.installLocation")}</p>
                <p className="text-xs text-muted mt-0.5">{t("settings.installLocation.description")}</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface text-sm font-mono text-foreground/70 border border-white/5 min-h-9 overflow-hidden">
                <IconFolder className="size-4 shrink-0 text-accent" />
                <span className="truncate flex-1" title={installDir}>{installDir || t("settings.loading")}</span>
                {isCustomDir && <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">{t("settings.custom")}</span>}
              </div>
              <div className="flex gap-2">
                <Button onPress={handlePickDir} isDisabled={loadingDir} className="flex-1">
                  <IconFolderOpen className="size-4" /> {t("settings.chooseFolder")}
                </Button>
                {isCustomDir && (
                  <Button variant="secondary" onPress={handleResetDir} isDisabled={loadingDir}>
                    <IconRotate className="size-4" /> {t("settings.resetDefault")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">{t("settings.migrationNote")}</p>
            </Surface>

            <Surface className="overflow-hidden">
              <button
                type="button"
                onClick={() => setJavaPanelOpen((value) => !value)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/5"
              >
                <div className="size-10 rounded-[10px] flex items-center justify-center bg-accent/10 text-accent shrink-0">
                  <IconCoffee className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{t("settings.java.title")}</p>
                  <p className="text-xs text-muted mt-0.5">{t("settings.java.description")}</p>
                </div>
                <IconChevronDown className={`size-5 text-muted transition-transform ${javaPanelOpen ? "rotate-180" : ""}`} />
              </button>

              {javaPanelOpen && (
                <div className="border-t border-border p-4 pt-3 flex flex-col gap-5">
                  {javaStatuses.map((java) => (
                    <div key={java.version} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-foreground">
                          {t("settings.java.location").replace("{version}", String(java.version))}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${
                            java.installed ? "text-emerald-300 bg-emerald-500/10" : "text-muted bg-surface-tertiary"
                          }`}
                        >
                          {java.installed ? <IconCheck className="size-3.5" /> : <IconSearch className="size-3.5" />}
                          {java.installed ? t("settings.java.installed") : t("settings.java.missing")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 font-mono text-xs text-muted">
                          <p className="truncate" title={java.path}>{java.path}</p>
                        </div>
                        {java.custom && (
                          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-1 text-[10px] font-bold text-accent">
                            {t("settings.java.customPath")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={javaBusy !== null}
                          onPress={() => handleInstallJava(java.version)}
                        >
                          {javaBusy === `install-${java.version}` ? <IconLoader2 className="size-4 animate-spin" /> : <IconDownload className="size-4" />}
                          {t("settings.java.installRecommended")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={javaBusy !== null}
                          onPress={() => handleDetectJava(java.version)}
                        >
                          {javaBusy === `detect-${java.version}` ? <IconLoader2 className="size-4 animate-spin" /> : <IconSearch className="size-4" />}
                          {t("settings.java.detect")}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={javaBusy !== null}
                          onPress={() => handleBrowseJava(java.version)}
                        >
                          {javaBusy === `browse-${java.version}` ? <IconLoader2 className="size-4 animate-spin" /> : <IconFolderSearch className="size-4" />}
                          {t("settings.java.browse")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Surface>
          </div>
        </section>

        <section id="installedInstances" className="p-4">
          <div className="max-w-2xl mb-6 mx-auto flex items-center gap-x-2">
            <IconBox className="text-accent" />
            <h3 className="font-semibold">{t("settings.installedInstances")}</h3>
          </div>
          <div className="max-w-xl mx-auto flex flex-col gap-y-4">
            <Surface className="p-4">
              {installedInstances.length === 0 ? (
                <p className="text-sm text-center text-muted">{t("settings.noInstancesInstalled")}</p>
              ) : (
                <div className="flex flex-col gap-y-2">
                  {installedInstances.map((instance) => (
                    <div key={instance.id} className="flex items-center gap-x-2">
                      {instance.icon && <img src={instance.icon} alt={instance.title} className="size-10 rounded" />}
                      <span className="flex-1">{instance.title || instance.id}</span>
                      <Button variant="danger-soft" onPress={() => uninstallInstance(instance)}>{t("settings.uninstall")}</Button>
                    </div>
                  ))}
                </div>
              )}
            </Surface>

            {bedrockStatus?.installed && (
              <Surface className="p-4 flex flex-col gap-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: "var(--color-surface-secondary)" }}>
                    <Pickaxe className="size-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Minecraft Bedrock</p>
                    <p className="text-xs text-muted mt-0.5">
                      {bedrockStatus.version ? `v${bedrockStatus.version}` : t("settings.installed")}
                      {bedrockStatus.store_installed ? "" : ` · ${t("settings.manualInstall")}`}
                    </p>
                  </div>
                  {confirmUninstallBedrock ? (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setConfirmUninstallBedrock(false)}
                        className="text-xs text-muted border border-border px-2.5 py-1.5 rounded-[10px] hover:bg-white/5 transition-colors">
                        {t("settings.cancel")}
                      </button>
                      <button
                        onClick={handleUninstallBedrock}
                        disabled={uninstallingBedrock}
                        className="text-xs text-danger border border-danger/30 px-2.5 py-1.5 rounded-[10px] hover:bg-danger/10 transition-colors disabled:opacity-50">
                        {uninstallingBedrock ? t("settings.uninstalling") : t("settings.confirm")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmUninstallBedrock(true)}
                      className="flex items-center gap-1.5 text-xs text-danger border border-danger/30 px-2.5 py-1.5 rounded-[10px] hover:bg-danger/10 transition-colors">
                      <IconTrash size={12} /> {t("settings.uninstall")}
                    </button>
                  )}
                </div>
              </Surface>
            )}
          </div>
        </section>

      </div>
      <HomeSidebar />
    </div>
  );
}
