import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ServerConfig {
  serverName: string;
  maxPlayers: number;
  port: number;
  gameMode: "survival" | "creative" | "adventure";
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  onlineMode: boolean;
  viewDistance: number;
  javaPath: string;
  maxRamMb: number;
  instanceId: string | null;
}

export const defaultConfig: ServerConfig = {
  serverName: "Mi Servidor Modstack",
  maxPlayers: 10,
  port: 25565,
  gameMode: "survival",
  difficulty: "normal",
  onlineMode: false,
  viewDistance: 10,
  javaPath: "",
  maxRamMb: 2048,
  instanceId: null,
};

interface MultiplayerContextValue {
  status: ServerStatus;
  config: ServerConfig;
  logs: string[];
  players: string[];
  localIp: string;
  setConfig: (patch: Partial<ServerConfig>) => void;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
  clearLogs: () => void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [config, setConfigState] = useState<ServerConfig>(defaultConfig);
  const [logs, setLogs] = useState<string[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [localIp, setLocalIp] = useState("");
  const unlistenRef = useRef<(() => void)[]>([]);

  const addLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-499), line]);
  }, []);

  const setConfig = useCallback((patch: Partial<ServerConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  const startServer = useCallback(async () => {
    setStatus("starting");
    setLogs([]);
    try {
      const ip = await invoke<string>("multiplayer_start", { config });
      setLocalIp(ip);
      setStatus("running");

      const u1 = await listen<string>("multiplayer-log", (e) => addLog(e.payload));
      const u2 = await listen<string[]>("multiplayer-players", (e) => setPlayers(e.payload));
      const u3 = await listen<string>("multiplayer-stopped", () => {
        setStatus("stopped");
        setPlayers([]);
      });
      unlistenRef.current = [u1, u2, u3];
    } catch (err) {
      addLog(`[ERROR] ${err}`);
      setStatus("error");
    }
  }, [config, addLog]);

  const stopServer = useCallback(async () => {
    setStatus("stopping");
    try {
      await invoke("multiplayer_stop");
    } catch (err) {
      addLog(`[ERROR] ${err}`);
      setStatus("error");
    } finally {
      unlistenRef.current.forEach((u) => u());
      unlistenRef.current = [];
    }
  }, [addLog]);

  const sendCommand = useCallback(async (cmd: string) => {
    try {
      await invoke("multiplayer_send_command", { command: cmd });
    } catch (err) {
      addLog(`[ERROR] ${err}`);
    }
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return (
    <MultiplayerContext.Provider
      value={{ status, config, logs, players, localIp, setConfig, startServer, stopServer, sendCommand, clearLogs }}
    >
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error("useMultiplayer must be used inside MultiplayerProvider");
  return ctx;
}
