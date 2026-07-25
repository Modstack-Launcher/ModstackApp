import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Input, Tabs, Tab, Chip } from "@heroui/react";
import {
  IconServer, IconPlug, IconPlayerPlay, IconPlayerStop,
  IconSettings, IconUsers, IconTerminal2, IconCopy, IconCheck,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

function StatusChip({ status }: { status: ServerStatus }) {
  const colors: Record<ServerStatus, "default" | "success" | "warning" | "danger"> = {
    stopped: "default", starting: "warning", running: "success", stopping: "warning", error: "danger",
  };
  const labels: Record<ServerStatus, string> = {
    stopped: "Detenido", starting: "Iniciando...", running: "En línea", stopping: "Deteniendo...", error: "Error",
  };
  return <Chip color={colors[status]} variant="secondary" size="sm">{labels[status]}</Chip>;
}

function SetupProgressBar({ value, message }: { value: number; message: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-white/50">{message}</span>
    </div>
  );
}

function ServerConsole({ logs }: { logs: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  return (
    <div className="flex flex-col h-full bg-black/40 rounded-xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-black/20">
        <IconTerminal2 className="size-4 text-white/50" />
        <span className="text-xs text-white/50 font-mono">Consola del servidor</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-green-400/90 space-y-0.5">
        {logs.length === 0
          ? <p className="text-white/20 italic">El servidor no ha iniciado todavía...</p>
          : logs.map((line, i) => <div key={i} className="leading-relaxed break-all">{line}</div>)
        }
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function CreateServerTab() {
  const { serverConfig, setServerConfig, status, setStatus, logs, addLog, clearLogs, setConnectedPlayers } = useMultiplayer();
  const [copied, setCopied] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);
  const [setupMessage, setSetupMessage] = useState("");
  const [isSettingUp, setIsSettingUp] = useState(false);

  useEffect(() => {
    const a = listen<string>("multiplayer-log", (e) => addLog(e.payload));
    const b = listen<ServerStatus>("multiplayer-status", (e) => setStatus(e.payload));
    const c = listen<number>("multiplayer-players", (e) => setConnectedPlayers(e.payload));
    const d = listen<[number, string]>("multiplayer-setup-progress", (e) => {
      setSetupProgress(e.payload[0]);
      setSetupMessage(e.payload[1]);
    });
    return () => { a.then(f => f()); b.then(f => f()); c.then(f => f()); d.then(f => f()); };
  }, []);

  const handleStart = async () => {
    if (status === "running" || status === "starting") return;
    clearLogs();
    setIsSettingUp(true);
    setSetupProgress(0);
    setSetupMessage("Preparando archivos...");
    try {
      await invoke("multiplayer_setup_server", {
        version: serverConfig.minecraftVersion,
        maxPlayers: serverConfig.maxPlayers,
        port: serverConfig.port,
        serverName: serverConfig.serverName,
        difficulty: serverConfig.difficulty,
        gamemode: serverConfig.gamemode,
        viewDistance: serverConfig.viewDistance,
        simulationDistance: serverConfig.simulationDistance,
      });
      await invoke("multiplayer_start_server");
    } catch (e) {
      setStatus("error");
      addLog(`[ERROR] ${String(e)}`);
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleStop = async () => {
    if (status !== "running") return;
    try { await invoke("multiplayer_stop_server"); }
    catch (e) { addLog(`[ERROR] ${String(e)}`); }
  };

  const copyIp = () => {
    navigator.clipboard.writeText(`127.0.0.1:${serverConfig.port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const disabled = status !== "stopped" && status !== "error";

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="grid grid-cols-2 gap-4 shrink-0">
        <div className="bg-surface-secondary rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Estado del Servidor</span>
            <StatusChip status={status} />
          </div>
          {status === "running" && (
            <>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
                <span className="text-xs text-white/50 font-mono flex-1">127.0.0.1:{serverConfig.port}</span>
                <Button variant="ghost" isIconOnly onPress={copyIp}>
                  {copied ? <IconCheck className="size-3.5 text-green-400" /> : <IconCopy className="size-3.5" />}
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-white/70">
                <IconUsers className="size-4" />
                <span>0 / {serverConfig.maxPlayers} jugadores</span>
              </div>
            </>
          )}
          {isSettingUp && (
            <SetupProgressBar value={setupProgress} message={setupMessage} />
          )}
          <div className="flex gap-2 mt-auto">
            {status !== "running"
              ? (
                <Button
                  color="primary"
                  className="flex-1"
                  onPress={handleStart}
                  isLoading={status === "starting" || isSettingUp}
                  startContent={<IconPlayerPlay className="size-4" />}
                >
                  Iniciar Servidor
                </Button>
              ) : (
                <Button
                  color="danger"
                  variant="outline"
                  className="flex-1"
                  onPress={handleStop}
                  isLoading={status === "stopping"}
                  startContent={<IconPlayerStop className="size-4" />}
                >
                  Detener
                </Button>
              )
            }
          </div>
        </div>
        <div className="bg-surface-secondary rounded-xl p-4 flex flex-col gap-3">
          <span className="text-sm font-semibold text-white">Configuración Rápida</span>
          <Input
            placeholder="Nombre del servidor"
            value={serverConfig.serverName}
            onValueChange={(v: string) => setServerConfig({ ...serverConfig, serverName: v })}
            isDisabled={disabled}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Puerto"
              type="number"
              value={String(serverConfig.port)}
              onValueChange={(v: string) => setServerConfig({ ...serverConfig, port: parseInt(v) || 25565 })}
              isDisabled={disabled}
            />
            <Input
              placeholder="Max jugadores"
              type="number"
              value={String(serverConfig.maxPlayers)}
              onValueChange={(v: string) => setServerConfig({ ...serverConfig, maxPlayers: parseInt(v) || 20 })}
              isDisabled={disabled}
            />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ServerConsole logs={logs} />
      </div>
    </div>
  );
}

function JoinServerTab() {
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("25565");
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (!ip) return;
    navigator.clipboard.writeText(`${ip}:${port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 max-w-md">
      <div className="bg-surface-secondary rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-accent/10 rounded-lg">
            <IconPlug className="size-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Unirse a un servidor de amigo</p>
            <p className="text-xs text-white/50 mt-0.5">Pide a tu amigo la IP y el puerto de su servidor</p>
          </div>
        </div>
        <Input
          placeholder="IP del servidor (ej: 192.168.1.x)"
          value={ip}
          onValueChange={(v: string) => setIp(v)}
        />
        <Input
          placeholder="Puerto (ej: 25565)"
          value={port}
          onValueChange={(v: string) => setPort(v)}
          type="number"
        />
        {ip && (
          <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
            <span className="text-xs text-white/60 font-mono flex-1">{ip}:{port}</span>
            <Button variant="ghost" isIconOnly onPress={copyAddress}>
              {copied ? <IconCheck className="size-3.5 text-green-400" /> : <IconCopy className="size-3.5" />}
            </Button>
          </div>
        )}
        <p className="text-xs text-white/40">Copia esta dirección y pégala en Minecraft → Multijugador → Añadir servidor</p>
      </div>
    </div>
  );
}

function AdvancedTab() {
  const { serverConfig, setServerConfig, status } = useMultiplayer();
  const disabled = status !== "stopped" && status !== "error";
  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div className="bg-surface-secondary rounded-xl p-5 flex flex-col gap-4">
        <span className="text-sm font-semibold text-white">Versión de Minecraft</span>
        <Input
          placeholder="Versión (ej: 1.21.1)"
          value={serverConfig.minecraftVersion}
          onValueChange={(v: string) => setServerConfig({ ...serverConfig, minecraftVersion: v })}
          isDisabled={disabled}
        />
      </div>
      <div className="bg-surface-secondary rounded-xl p-5 flex flex-col gap-4">
        <span className="text-sm font-semibold text-white">Ajustes del servidor</span>
        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="Dificultad"
            value={serverConfig.difficulty}
            onValueChange={(v: string) => setServerConfig({ ...serverConfig, difficulty: v })}
            isDisabled={disabled}
          />
          <Input
            placeholder="Modo de juego"
            value={serverConfig.gamemode}
            onValueChange={(v: string) => setServerConfig({ ...serverConfig, gamemode: v })}
            isDisabled={disabled}
          />
          <Input
            placeholder="View distance"
            type="number"
            value={String(serverConfig.viewDistance)}
            onValueChange={(v: string) => setServerConfig({ ...serverConfig, viewDistance: parseInt(v) || 10 })}
            isDisabled={disabled}
          />
          <Input
            placeholder="Simulation distance"
            type="number"
            value={String(serverConfig.simulationDistance)}
            onValueChange={(v: string) => setServerConfig({ ...serverConfig, simulationDistance: parseInt(v) || 10 })}
            isDisabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export default function Multiplayer() {
  const { status } = useMultiplayer();
  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <div className="p-2 bg-accent/10 rounded-xl">
          <IconServer className="size-6 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">ModStack Multiplayer</h1>
          <p className="text-xs text-white/50">Juega con amigos desde tu PC, sin abrir puertos</p>
        </div>
        {status !== "stopped" && <div className="ml-auto"><StatusChip status={status} /></div>}
      </div>
      <Tabs aria-label="multiplayer tabs" variant="primary" classNames={{ base: "shrink-0", tabList: "gap-4" }}>
        <Tab key="host">
          <div className="flex items-center gap-2"><IconServer className="size-4" /><span>Crear servidor</span></div>
          <div className="flex flex-col h-full pt-4"><CreateServerTab /></div>
        </Tab>
        <Tab key="join">
          <div className="flex items-center gap-2"><IconPlug className="size-4" /><span>Unirse</span></div>
          <div className="pt-4"><JoinServerTab /></div>
        </Tab>
        <Tab key="advanced">
          <div className="flex items-center gap-2"><IconSettings className="size-4" /><span>Avanzado</span></div>
          <div className="pt-4"><AdvancedTab /></div>
        </Tab>
      </Tabs>
    </div>
  );
}
