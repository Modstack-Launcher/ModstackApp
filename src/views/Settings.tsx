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
  IconDeviceGamepad2Filled,
  IconDownload,
  IconFolder,
  IconFolderOpen,
  IconRotate,
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

// Sections that have a matching tab, in document order (used by the scroll-spy).
const TAB_IDS = ["launcher", "game", "resources", "storage"];

function TabIndicator() {
  return <Tabs.Indicator className="translate-x-0!" />;
}

function SwitchThumb() {
  return <Switch.Thumb className="size-5 group-data-[selected=true]:ml-6.5" />;
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

  const isCustomDir = installDir !== defaultDir && installDir !== "";

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
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
            <Switch name="animated_background" size="lg" isSelected={animatedBackground}
              onChange={(value) => { setAnimatedBackground(value); invoke("set_config", { key: "app.animated-background", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.animatedBackground.label")}</Label><Description>{t("settings.animatedBackground.description")}</Description></Switch.Content>
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
            <Switch name="hide_launcher" size="lg" isSelected={hideLauncher}
              onChange={(value) => { setHideLauncher(value); invoke("set_config", { key: "app.hide-launcher", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.hideLauncher.label")}</Label><Description>{t("settings.hideLauncher.description")}</Description></Switch.Content>
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
            <Switch name="discord_rpc" size="lg" isSelected={discordRPC}
              onChange={(value) => { setDiscordRPC(value); invoke("set_config", { key: "app.discord-rpc", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.discordRpc.label")}</Label><Description>{t("settings.discordRpc.description")}</Description></Switch.Content>
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
            <Switch name="hide_music" size="lg" isSelected={hideMusic}
              onChange={(value) => { setHideMusic(value); invoke("set_config", { key: "app.hide-music", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.hideMusic.label")}</Label><Description>{t("settings.hideMusic.description")}</Description></Switch.Content>
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
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
                    className={["flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition-colors", language === option.value ? "bg-[#4b77e7] text-black" : "text-muted hover:bg-white/5 hover:text-foreground"].join(" ")}
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
              <Switch.Control><SwitchThumb /></Switch.Control>
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
              <Switch.Control><SwitchThumb /></Switch.Control>
            </Switch>
            <Switch name="dns_over_https" size="lg" isSelected={dnsOverHttps}
              onChange={(value) => { setDnsOverHttps(value); invoke("set_config", { key: "resources.dns-over-https", value }); }}
              className="group justify-between">
              <Switch.Content><Label>{t("settings.dnsOverHttps.label")}</Label><Description>{t("settings.dnsOverHttps.description")}</Description></Switch.Content>
              <Switch.Control><SwitchThumb /></Switch.Control>
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