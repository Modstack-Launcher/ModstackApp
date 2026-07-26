import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  apiDeleteServer,
  apiHeartbeat,
  apiRegisterServer,
  ServerResponseDto,
} from "../lib/modstackApi";
import { useModstackAuth } from "./modstackAuthContext";
import { useInstance } from "./instanceContext";

export interface ServerConfig {
  server_name: string;
  max_players: number;
  port: number;
  game_mode: string;
  difficulty: string;
  online_mode: boolean;
  view_distance: number;
  java_path: string;
  max_ram_mb: number;
  instance_id: string | null;
}

type Status = "stopped" | "starting" | "running" | "stopping" | "error";

interface MultiplayerCtx {
  status: Status;
  config: ServerConfig;
  logs: string[];
  players: string[];
  localIp: string;
  remoteServer: ServerResponseDto | null;
  setConfig: (c: Partial<ServerConfig>) => void;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
}

const defaultConfig: ServerConfig = {
  server_name: "Mi Servidor Modstack",
  max_players: 10,
  port: 25565,
  game_mode: "survival",
  difficulty: "normal",
  online_mode: true,
  view_distance: 10,
  java_path: "",
  max_ram_mb: 2048,
  instance_id: null,
};

const Ctx = createContext<MultiplayerCtx>({
  status: "stopped",
  config: defaultConfig,
  logs: [],
  players: [],
  localIp: "",
  remoteServer: null,
  setConfig: () => {},
  startServer: async () => {},
  stopServer: async () => {},
  sendCommand: async () => {},
});

export function MultiplayerProvider({ children }: { children: React.ReactNode }) {
  const { token } = useModstackAuth();
  const { instances } = useInstance();
  const [status, setStatus] = useState<Status>("stopped");
  const [config, setConfigState] = useState<ServerConfig>(defaultConfig);
  const [logs, setLogs] = useState<string[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [localIp, setLocalIp] = useState("");
  const [remoteServer, setRemoteServer] = useState<ServerResponseDto | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playersRef = useRef<string[]>([]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    const unsubLog = listen<string>("multiplayer-log", (e) => {
      const line = e.payload;
      setLogs((prev) => [...prev.slice(-499), line]);

      const joinMatch = line.match(/:\s+(\S+) joined the game/);
      const leaveMatch = line.match(/:\s+(\S+) left the game/);
      if (joinMatch) {
        setPlayers((prev) => Array.from(new Set([...prev, joinMatch[1]])));
      }
      if (leaveMatch) {
        setPlayers((prev) => prev.filter((p) => p !== leaveMatch[1]));
      }
      if (line.includes("Done (") && line.includes("For help")) {
        setStatus("running");
      }
    });

    const unsubStop = listen("multiplayer-stopped", () => {
      setStatus("stopped");
      setPlayers([]);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    });

    return () => {
      unsubLog.then((f) => f());
      unsubStop.then((f) => f());
    };
  }, []);

  function setConfig(partial: Partial<ServerConfig>) {
    setConfigState((prev) => ({ ...prev, ...partial }));
  }

  async function startServer() {
    setStatus("starting");
    setLogs([]);
    setPlayers([]);
    try {
      const ip: string = await invoke("multiplayer_start", { config });
      setLocalIp(ip);

      const selectedInstance = instances?.find((i: any) => i.id === config.instance_id);
      const mcVersion = selectedInstance?.minecraft_version ?? "1.21";
      const loader = typeof selectedInstance?.loader === "string"
        ? selectedInstance.loader
        : selectedInstance?.loader?.type ?? "vanilla";
      const software = loader === "vanilla" || !loader ? "vanilla" : loader;

      if (token) {
        try {
          const remote = await apiRegisterServer(token, {
            name: config.server_name,
            mcVersion,
            software,
            host: ip,
            port: config.port,
            maxPlayers: config.max_players,
            isPublic: false,
            motd: config.server_name,
          });
          setRemoteServer(remote);
          heartbeatRef.current = setInterval(async () => {
            try {
              await apiHeartbeat(token, remote.id, playersRef.current.length);
            } catch (_) {}
          }, 30_000);
        } catch (_) {}
      }
    } catch (err: any) {
      setStatus("error");
      setLogs((prev) => [...prev, `[ERROR] ${err}`]);
    }
  }

  async function stopServer() {
    setStatus("stopping");
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (token && remoteServer) {
      try {
        await apiDeleteServer(token, remoteServer.id);
      } catch (_) {}
      setRemoteServer(null);
    }
    await invoke("multiplayer_stop");
  }

  async function sendCommand(cmd: string) {
    await invoke("multiplayer_send_command", { command: cmd });
  }

  return (
    <Ctx.Provider
      value={{ status, config, logs, players, localIp, remoteServer, setConfig, startServer, stopServer, sendCommand }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useMultiplayer() {
  return useContext(Ctx);
}
