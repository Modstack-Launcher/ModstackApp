import { createContext, useContext, useState, ReactNode } from "react";

interface ServerConfig {
  serverName: string;
  minecraftVersion: string;
  port: number;
  maxPlayers: number;
  difficulty: string;
  gamemode: string;
  viewDistance: number;
  simulationDistance: number;
  minRam: number;
  maxRam: number;
}

interface MultiplayerCtx {
  serverConfig: ServerConfig;
  setServerConfig: (c: ServerConfig) => void;
}

const defaultConfig: ServerConfig = {
  serverName: "Mi Servidor Modstack",
  minecraftVersion: "1.21.1",
  port: 25565,
  maxPlayers: 20,
  difficulty: "normal",
  gamemode: "survival",
  viewDistance: 10,
  simulationDistance: 10,
  minRam: 512,
  maxRam: 2048,
};

const MultiplayerContext = createContext<MultiplayerCtx>({
  serverConfig: defaultConfig,
  setServerConfig: () => {},
});

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const [serverConfig, setServerConfig] = useState<ServerConfig>(defaultConfig);
  return (
    <MultiplayerContext.Provider value={{ serverConfig, setServerConfig }}>
      {children}
    </MultiplayerContext.Provider>
  );
}

export function useMultiplayer() {
  return useContext(MultiplayerContext);
}
