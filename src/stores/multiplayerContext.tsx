import { createContext, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";
export type ServerSoftware = "vanilla" | "fabric" | "forge" | "paper" | "quilt";

export interface ServerStats {
  online_players: number;
  max_players: number;
  tps: number;
  uptime_secs: number;
}

export interface LogEntry {
  raw: string;
  level: "info" | "warn" | "error";
  ts: number;
  id: string;
}

export interface SetupConfig {
  version: string;
  software: ServerSoftware;
  server_name: string;
  port: number;
  max_players: number;
  difficulty: string;
  gamemode: string;
  view_distance: number;
  simulation_distance: number;
  online_mode: boolean;
  pvp: boolean;
  spawn_monsters: boolean;
  allow_flight: boolean;
  allow_nether: boolean;
  min_ram: number;
  max_ram: number;
}

export interface SetupProgress {
  pct: number;
  msg: string;
}

export interface ServerSetup {
  software: ServerSoftware;
  name: string;
  path: string;
}

const DEFAULT_CONFIG: SetupConfig = {
  version: "1.21.1",
  software: "vanilla",
  server_name: "Mi Servidor Modstack",
  port: 25565,
  max_players: 10,
  difficulty: "normal",
  gamemode: "survival",
  view_distance: 10,
  simulation_distance: 8,
  online_mode: false,
  pvp: true,
  spawn_monsters: true,
  allow_flight: false,
  allow_nether: true,
  min_ram: 512,
  max_ram: 2048,
};

interface MultiplayerContextType {
  status: ServerStatus;
  stats: ServerStats;
  logs: LogEntry[];
  config: SetupConfig;
  setupProgress: SetupProgress | null;
  localIp: string;
  setups: ServerSetup[];
  activeSoftware: ServerSoftware;
  setConfig: (c: Partial<SetupConfig>) => void;
  setupServer: () => Promise<void>;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  restartServer: () => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
  openFolder: () => Promise<void>;
  openModsFolder: () => Promise<void>;
  clearLogs: () => void;
  refreshSetups: () => Promise<void>;
  deleteSetup: (sw: ServerSoftware) => Promise<void>;
  setActiveSoftware: (sw: ServerSoftware) => void;
}

const MultiplayerContext = createContext<MultiplayerContextType | null>(null);

let logCounter = 0;
function mkId() { return `log-${Date.now()}-${logCounter++}`; }

export function MultiplayerProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [stats, setStats] = useState<ServerStats>({ online_players: 0, max_players: 20, tps: 20, uptime_secs: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfigState] = useState<SetupConfig>(DEFAULT_CONFIG);
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null);
  const [localIp, setLocalIp] = useState("127.0.0.1");
  const [setups, setSetups] = useState<ServerSetup[]>([]);
  const [activeSoftware, setActiveSoftware] = useState<ServerSoftware>("vanilla");

  const unlisteners = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    invoke<string>("multiplayer_get_local_ip").then(setLocalIp).catch(() => {});
    invoke<ServerStatus>("multiplayer_get_status").then(setStatus).catch(() => {});
    invoke<ServerStats>("multiplayer_get_stats").then(setStats).catch(() => {});
    refreshSetups();

    const setupListeners = async () => {
      const u1 = await listen<ServerStatus>("multiplayer-status", (e) => setStatus(e.payload));
      const u2 = await listen<ServerStats>("multiplayer-stats", (e) => setStats(e.payload));
      const u3 = await listen<{ pct: number; msg: string }>("multiplayer-setup-progress", (e) => {
        setSetupProgress(e.payload);
        if (e.payload.pct >= 100) setTimeout(() => setSetupProgress(null), 2000);
      });
      const u4 = await listen<{ raw: string; level: string; ts: number }>("multiplayer-log", (e) => {
        const entry: LogEntry = {
          raw: e.payload.raw,
          level: (e.payload.level as LogEntry["level"]) || "info",
          ts: e.payload.ts,
          id: mkId(),
        };
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 2000 ? next.slice(next.length - 2000) : next;
        });
      });
      unlisteners.current = [u1, u2, u3, u4];
    };

    setupListeners();
    return () => { unlisteners.current.forEach((u) => u()); };
  }, []);

  const setConfig = (partial: Partial<SetupConfig>) =>
    setConfigState((prev) => ({ ...prev, ...partial }));

  const setupServer = async () => {
    await invoke("multiplayer_setup_server", {
      version: config.version,
      software: config.software,
      maxPlayers: config.max_players,
      port: config.port,
      serverName: config.server_name,
      difficulty: config.difficulty,
      gamemode: config.gamemode,
      viewDistance: config.view_distance,
      simulationDistance: config.simulation_distance,
      onlineMode: config.online_mode,
      pvp: config.pvp,
      spawnMonsters: config.spawn_monsters,
      allowFlight: config.allow_flight,
      allowNether: config.allow_nether,
    });
    await refreshSetups();
  };

  const startServer = async () => {
    await invoke("multiplayer_start_server", {
      software: activeSoftware,
      minRam: config.min_ram,
      maxRam: config.max_ram,
    });
  };

  const stopServer = async () => { await invoke("multiplayer_stop_server"); };

  const restartServer = async () => {
    await invoke("multiplayer_restart_server", {
      software: activeSoftware,
      minRam: config.min_ram,
      maxRam: config.max_ram,
    });
  };

  const sendCommand = async (cmd: string) => {
    await invoke("multiplayer_send_command", { command: cmd });
  };

  const openFolder = async () => {
    await invoke("multiplayer_open_folder", { software: activeSoftware });
  };

  const openModsFolder = async () => {
    await invoke("multiplayer_open_mods_folder", { software: activeSoftware });
  };

  const clearLogs = () => setLogs([]);

  const refreshSetups = async () => {
    const list = await invoke<ServerSetup[]>("multiplayer_list_setups").catch(() => []);
    setSetups(list);
  };

  const deleteSetup = async (sw: ServerSoftware) => {
    await invoke("multiplayer_delete_setup", { software: sw });
    await refreshSetups();
  };

  return (
    <MultiplayerContext.Provider value={{
      status, stats, logs, config, setupProgress, localIp, setups, activeSoftware,
      setConfig, setupServer, startServer, stopServer, restartServer,
      sendCommand, openFolder, openModsFolder, clearLogs, refreshSetups, deleteSetup,
      setActiveSoftware,
    }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error("useMultiplayer must be used inside MultiplayerProvider");
  return ctx;
}
