import { createContext, useContext, useState, type ReactNode } from "react";

export interface ServerConfig {
  serverName: string;
  minecraftVersion: string;
  maxPlayers: number;
  port: number;
  difficulty: string;
  gamemode: string;
  viewDistance: number;
  simulationDistance: number;
}

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

interface MultiplayerState {
  status: ServerStatus;
  setStatus: (s: ServerStatus) => void;
  logs: string[];
  addLog: (line: string) => void;
  clearLogs: () => void;
  connectedPlayers: number;
  setConnectedPlayers: (n: number) => void;
  serverConfig: ServerConfig;
  setServerConfig: (c: ServerConfig) => void;
}

const DEFAULT_CONFIG: ServerConfig = {
  serverName: "Mi Servidor Modstack",
  minecraftVersion: "1.21.1",
  maxPlayers: 20,
  port: 25565,
  difficulty: "normal",
  gamemode: "survival",
  viewDistance: 10,
  simulationDistance: 10,
};

const MultiplayerContext = createContext<MultiplayerState | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [logs, setLogs] = useState<string[]>([]);
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_CONFIG);

  const addLog = (line: string) => {
    setLogs((prev) => [...prev.slice(-500), line]);
  };

  const clearLogs = () => setLogs([]);

  return (
    <MultiplayerContext.Provider
      value={{
        status, setStatus, logs, addLog, clearLogs,
        connectedPlayers, setConnectedPlayers,
        serverConfig, setServerConfig,
      }}
    >
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error("useMultiplayer must be used within MultiplayerProvider");
  return ctx;
}