import {
  ContextType,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useAuth } from "./authContext";
import { useSettings } from "./settingsContext";
import { toast } from "@heroui/react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getInstances, getInstance } from "../api/instances";

const InstanceContext = createContext({
  instanceReady: false,
  instances: [] as Instance[],
  setInstances: (_instances: Instance[]) => {},
  installedInstances: [] as Instance[],
  selectedInstance: {} as Instance,
  setSelectedInstance: (_instance: Instance) => {},
  uninstallInstance: (_instance: Instance) => {},
  launchInstance: (_instance: Instance) => {},
  selectInstanceByCode: (_code: string) => {},
  fetchInstances: () => {},
  isRunning: false,
  launchedInstanceId: null as string | null, 
  installProgress: 0,
  installStatus: "",
});

function localToInstance(l: {
  id: string;
  title: string;
  minecraft_version: string;
  loader: string;
  icon_path?: string | null;
  background_path?: string | null;
  created_at: number;
}): Instance {
  const iconUrl = l.icon_path ? convertFileSrc(l.icon_path) : undefined;
  const bgUrl = l.background_path
    ? convertFileSrc(l.background_path)
    : undefined;

  return {
    id: l.id,
    title: l.title,
    minecraft_version: l.minecraft_version,
    loader: l.loader,
    icon: iconUrl,
    landscape: bgUrl,
    _isLocal: true,
  } as any;
}

export function InstanceProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [instanceReady, setInstanceReady] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [installedInstances, setInstalledInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance>();
  const { user } = useAuth();
  const { maxRAM, windowWidth, windowHeight, fullscreen } = useSettings();
  const [isRunning, setIsRunning] = useState(false);
  const [launchedInstanceId, setLaunchedInstanceId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [installStatus, setInstallStatus] = useState("");

  const init = async () => {
    const storedInstalledInstances = JSON.parse(
      window.localStorage.getItem("installedInstances") || "[]",
    );
    if (storedInstalledInstances)
      setInstalledInstances(storedInstalledInstances);

    setInstanceReady(true);
  };

  useEffect(() => {
    init();
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      const localInstances: Instance[] = await invoke("list_instances");
      let publicInstances: Instance[] = [];
      try {
        publicInstances = await getInstances();
      } catch (e) {
        console.error("Error fetching public instances", e);
      }

      const savedCodeInstances: Instance[] = JSON.parse(
        localStorage.getItem("codeInstances") || "[]",
      );

      let userLocalInstances: Instance[] = [];
      try {
        const raw = await invoke<any[]>("load_local_instances");
        userLocalInstances = raw.map(localToInstance);
      } catch (e) {
        console.warn("Error loading local instances", e);
      }

      const combined = [...publicInstances];

      for (const saved of savedCodeInstances) {
        if (!combined.find((i) => i.id === saved.id)) combined.push(saved);
      }

      for (const local of localInstances) {
        if (!combined.find((i) => i.id === local.id)) {
          const isKnown = savedCodeInstances.find((i) => i.id === local.id);
          if (isKnown) combined.push(local);
        }
      }

      for (const local of userLocalInstances) {
        if (!combined.find((i) => i.id === local.id)) combined.push(local);
      }

      setInstances(combined);

      setSelectedInstance((prev) => {
        if (prev) {
          const updated = combined.find((i) => i.id === prev.id);
          if (updated) return updated;
        }
        return combined.length > 0 ? combined[0] : undefined;
      });
    } catch (e) {
      console.error("Error fetching instances", e);
    }
  }, []);

  useEffect(() => {
    if (instanceReady) fetchInstances();
  }, [instanceReady]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenProgress = await listen<string>("install-progress", (event) => {
        const [current, total] = event.payload.split("/").map(Number);
        const percent = Math.floor((current / total) * 100);
        setInstallProgress(percent);
      });

      unlistenStatus = await listen<string>("install-status", (event) => {
        setInstallStatus(event.payload);
      });

      unlistenDone = await listen<string>("install-done", () => {
        setInstallProgress(0);
        setInstallStatus("");
      });

      unlistenClosed = await listen("minecraft-closed", () => {
        setIsRunning(false);
        setLaunchedInstanceId(null);
        setInstallProgress(0);
        setInstallStatus("");
        invoke("discord_set_idle");
      });
    };

    setupListeners();

    return () => {
      unlistenProgress?.();
      unlistenStatus?.();
      unlistenDone?.();
      unlistenClosed?.();
    };
  }, []);

  const onSetInstalledInstances = (instances: Instance[]) => {
    window.localStorage.setItem(
      "installedInstances",
      JSON.stringify(instances),
    );
  };
  useEffect(() => {
    onSetInstalledInstances(installedInstances);
  }, [installedInstances]);

  const uninstallInstance = useCallback(async (instance: Instance) => {
    try {
      await invoke("uninstall_instance", { instanceId: instance.id });
    } catch (e) {
      console.error("Error uninstalling instance", e);
    }

    if ((instance as any)._isLocal) {
      try {
        await invoke("remove_local_instance", { id: instance.id });
      } catch (e) {
        console.error("Error removing local instance files", e);
      }
    }

    setInstalledInstances((prev) => prev.filter((i) => i.id !== instance.id));
    
    setInstances((prev) => prev.filter((i) => i.id !== instance.id));

    const isCodeInstance = !!localStorage.getItem(instance.id);
    if (isCodeInstance) {
      setInstances((prev) => prev.filter((i) => i.id !== instance.id));
    }

    setSelectedInstance((prev) =>
      prev?.id === instance.id ? undefined : prev,
    );

    localStorage.removeItem(instance.id);
    const savedCodeInstances: Instance[] = JSON.parse(
      localStorage.getItem("codeInstances") || "[]",
    );
    localStorage.setItem(
      "codeInstances",
      JSON.stringify(savedCodeInstances.filter((i) => i.id !== instance.id)),
    );

    toast.success("Instance uninstalled", {
      description: `${instance.title || instance.id} has been removed.`,
    });
  }, []);

  const selectInstanceByCode = useCallback(async (code: string) => {
    if (!code) return;

    try {
      const instance: Instance = await getInstance({ code });

      if (!instance || !instance.id) {
        return toast.danger("Invalid instance code", {
          description: "No instance was found with that code.",
        });
      }

      localStorage.setItem(instance.id, code);

      const savedCodeInstances: Instance[] = JSON.parse(
        localStorage.getItem("codeInstances") || "[]",
      );
      if (!savedCodeInstances.find((i) => i.id === instance.id)) {
        savedCodeInstances.push(instance);
        localStorage.setItem(
          "codeInstances",
          JSON.stringify(savedCodeInstances),
        );
      }

      setInstances((prev) => {
        if (prev.find((i) => i.id === instance.id)) return prev;
        return [...prev, instance];
      });
      setSelectedInstance(instance);

      toast(
        <span>
          Instance <strong>{instance.title || instance.id}</strong> selected
        </span>,
      );
    } catch (err: any) {
      console.log("Error fetching instance by code", err);
      const errStr = String(err).toLowerCase();
      if (
        errStr.includes("404") ||
        errStr.includes("not found") ||
        errStr.includes("no encontr")
      ) {
        toast.danger("Invalid instance code", {
          description: "No instance was found with that code.",
        });
      } else {
        toast.danger("Error fetching instance", {
          description: "See the log file for more details.",
        });
      }
    }
  }, []);

  const launchInstance = useCallback(
    async (instance: Instance) => {
      if (!navigator.onLine) {
        toast.danger("Could not launch instance", {
          description: "It seems you have no internet connection.",
        });
        return;
      }

      const isLocal = !!(instance as any)._isLocal;
      const noPremiumAllowed = isLocal || instance.users?.noPremium === true;

      const accessToken = user?.minecraft?.access_token;
      const hasValidToken =
        accessToken && accessToken !== "none" && accessToken !== "";

      if (!noPremiumAllowed && !hasValidToken) {
        toast.danger("Sign in with Mojang", {
          description: "This instance requires a premium Minecraft account.",
        });
        return;
      }

      const isOffline = !hasValidToken;
      const token = isOffline ? "none" : accessToken!;

      setIsRunning(true);

      try {
        const loaderType: string =
          typeof instance.loader === "object"
            ? ((instance.loader as any).type ?? "vanilla")
            : String(instance.loader ?? "vanilla");

        const loaderEnabled: boolean =
          typeof instance.loader === "object"
            ? ((instance.loader as any).enable ?? true)
            : true;

        const effectiveLoader = loaderEnabled ? loaderType : "vanilla";

        const installDir = await invoke<string>("get_install_dir");
        const instancesDir = `${installDir.replace(/[\\/]$/, "")}/instances`;

        console.log(
          `[Launch] id=${instance.id} version=${instance.minecraft_version} loader=${effectiveLoader} offline=${isOffline} noPremium=${noPremiumAllowed}`,
        );

        const gallery = (instance as any).gallery as
          | { url: string; featured?: boolean }[]
          | undefined;
        const featuredLandscape =
          gallery?.find((img) => img.featured)?.url ??
          gallery?.[0]?.url ??
          instance.landscape ??
          null;

        if (isLocal) {
          await invoke("create_instance", {
            name: instance.id,
            id: instance.id,
            basePath: instancesDir,
            loader: effectiveLoader,
            version: instance.minecraft_version,
            slug: instance.slug ?? null,
            landscape: featuredLandscape,
          });
        } else {
          await invoke("create_instance", {
            name: instance.id,
            id: instance.id,
            basePath: instancesDir,
            loader: effectiveLoader,
            version: instance.minecraft_version,
            slug: instance.slug ?? null,
            landscape: featuredLandscape,
          });
        
          setInstalledInstances((prev) => {
            if (prev.find((i) => i.id === instance.id)) return prev;
            return [...prev, instance];
          });
        
          setInstallStatus("Downloading mods...");
          setInstallProgress(0);
        
          try {
            await invoke("install_instance_files", {
              instanceId: instance.id,
              instanceCode: localStorage.getItem(instance.id) ?? null,
            });
          } catch (installErr) {
            console.warn("[Install] Error downloading files, continuing anyway:", installErr);
          }
        }

        setInstallProgress(0);
        setInstallStatus("");

        setLaunchedInstanceId(instance.id);

        await invoke("discord_set_playing", {
          name: instance.title || instance.id,
        });

        let offlineSkinDataUrl = "";
        let offlineArmStyle = "wide";
        if (isOffline) {
          try {
            const { getActiveId, loadSkinDataUrl, loadIndex } = await import(
              "../utils/skinsStore"
            );
            const activeId = getActiveId();
            if (activeId) {
              const [dataUrl, metas] = await Promise.all([
                loadSkinDataUrl(activeId),
                loadIndex(),
              ]);
              if (dataUrl) offlineSkinDataUrl = dataUrl;
              const meta = metas.find((m) => m.id === activeId);
              if (meta) offlineArmStyle = meta.armStyle === "slim" ? "slim" : "wide";
            }
          } catch (skinErr) {
            console.warn("[Skin] No se pudo cargar skin activa:", skinErr);
          }
        }

        await invoke("launch_instance_cmd", {
          instanceId: instance.id,
          username: user?.minecraft?.name || "Player",
          uuid: user?.minecraft?.uuid || "00000000-0000-0000-0000-000000000000",
          token: token,
          ram: maxRAM,
          width: windowWidth,
          height: windowHeight,
          fullscreen: fullscreen,
          skinDataUrl: offlineSkinDataUrl || null,
          armStyle: offlineSkinDataUrl ? offlineArmStyle : null,
        });

        setIsRunning(false);
        setLaunchedInstanceId(null);
        
      } catch (err) {
        setIsRunning(false);
        setLaunchedInstanceId(null);
        setInstallProgress(0);
        setInstallStatus("");
        console.error("Error launching instance:", err);
        toast.danger("Error launching instance", {
          description: String(err),
        });
      }
    },
    [user, maxRAM, windowWidth, windowHeight, fullscreen],
  );

  return (
    <InstanceContext.Provider
      value={
        {
          instanceReady,
          instances,
          setInstances,
          installedInstances,
          selectedInstance,
          setSelectedInstance,
          uninstallInstance,
          launchInstance,
          selectInstanceByCode,
          fetchInstances,
          isRunning,
          launchedInstanceId,
          installProgress,
          installStatus,
        } as any
      }
    >
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstance(): ContextType<typeof InstanceContext> {
  return useContext(InstanceContext);
}