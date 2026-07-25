import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Surface } from "@heroui/react";
import {
  IconServer, IconPlug, IconPlayerPlay, IconPlayerStop,
  IconSettings, IconUsers, IconTerminal2, IconCopy, IconCheck,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

function StatusBadge({ status }: { status: ServerStatus }) {
  const styles: Record<ServerStatus, string> = {
    stopped: "bg-white/10 text-white/50",
    starting: "bg-yellow-500/20 text-yellow-300",
    running: "bg-emerald-500/15 text-emerald-300",
    stopping: "bg-yellow-500/20 text-yellow-300",
    error: "bg-red-500/15 text-red-300",
  };
  const labels: Record<ServerStatus, string> = {
    stopped: "Detenido", starting: "Iniciando...", running: "En línea", stopping: "Deteniendo...", error: "Error",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
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
      <span className="text-xs text-muted">{message}</span>
    </div>
  );
}

function ServerConsole({ logs }: { logs: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  return (
    <div className="flex flex-col h-full bg-black/40 rounded-xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-black/20">
        <IconTerminal2 className="size-4 text-muted" />
        <span className="text-xs text-muted font-mono">Consola del servidor</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-emerald-400/90 space-y-0.5">
        {logs.length === 0
          ? <p className="text-muted italic">El servidor no ha iniciado todavía...</p>
          : logs.map((line, i) => <div key={i} className="leading-relaxed break-all">{line}</div>)
        }
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, type = "text", disabled = false, placeholder = "" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}

type TabKey = "host" | "join" | "advanced";

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
        <Surface className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Estado del Servidor</span>
            <StatusBadge status={status} />
          </div>
          {status === "running" && (
            <>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
                <span className="text-xs text-muted font-mono flex-1">127.0.0.1:{serverConfig.port}</span>
                <Button variant="ghost" isIconOnly onPress={copyIp}>
                  {copied ? <IconCheck className="size-3.5 text-emerald-400" /> : <IconCopy className="size-3.5" />}
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted">
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
                  className="flex-1"
                  onPress={handleStart}
                  isLoading={status === "starting" || isSettingUp}
                >
                  <IconPlayerPlay className="size-4" />
                  Iniciar Servidor
                </Button>
              ) : (
                <Button
                  variant="danger-soft"
                  className="flex-1"
                  onPress={handleStop}
                  isLoading={status === "stopping"}
                >
                  <IconPlayerStop className="size-4" />
                  Detener
                </Button>
              )
            }
          </div>
        </Surface>
        <Surface className="p-4 flex flex-col gap-3">
          <span className="text-sm font-semibold">Configuración Rápida</span>
          <FieldInput
            label="Nombre del servidor"
            value={serverConfig.serverName}
            onChange={(v) => setServerConfig({ ...serverConfig, serverName: v })}
            disabled={disabled}
          />
          <div className="grid grid-cols-2 gap-2">
            <FieldInput
              label="Puerto"
              type="number"
              value={String(serverConfig.port)}
              onChange={(v) => setServerConfig({ ...serverConfig, port: parseInt(v) || 25565 })}
              disabled={disabled}
            />
            <FieldInput
              label="Max jugadores"
              type="number"
              value={String(serverConfig.maxPlayers)}
              onChange={(v) => setServerConfig({ ...serverConfig, maxPlayers: parseInt(v) || 20 })}
              disabled={disabled}
            />
          </div>
        </Surface>
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
      <Surface className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-accent/10 rounded-lg">
            <IconPlug className="size-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">Unirse a un servidor de amigo</p>
            <p className="text-xs text-muted mt-0.5">Pide a tu amigo la IP y el puerto de su servidor</p>
          </div>
        </div>
        <FieldInput label="IP del servidor" placeholder="192.168.1.x" value={ip} onChange={setIp} />
        <FieldInput label="Puerto" placeholder="25565" value={port} onChange={setPort} type="number" />
        {ip && (
          <div className="flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2">
            <span className="text-xs text-muted font-mono flex-1">{ip}:{port}</span>
            <Button variant="ghost" isIconOnly onPress={copyAddress}>
              {copied ? <IconCheck className="size-3.5 text-emerald-400" /> : <IconCopy className="size-3.5" />}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted">Copia esta dirección y pégala en Minecraft → Multijugador → Añadir servidor</p>
      </Surface>
    </div>
  );
}

function AdvancedTab() {
  const { serverConfig, setServerConfig, status } = useMultiplayer();
  const disabled = status !== "stopped" && status !== "error";
  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <Surface className="p-5 flex flex-col gap-4">
        <span className="text-sm font-semibold">Versión de Minecraft</span>
        <FieldInput
          label="Versión (ej: 1.21.1)"
          value={serverConfig.minecraftVersion}
          onChange={(v) => setServerConfig({ ...serverConfig, minecraftVersion: v })}
          disabled={disabled}
        />
      </Surface>
      <Surface className="p-5 flex flex-col gap-4">
        <span className="text-sm font-semibold">Ajustes del servidor</span>
        <div className="grid grid-cols-2 gap-3">
          <FieldInput label="Dificultad" value={serverConfig.difficulty}
            onChange={(v) => setServerConfig({ ...serverConfig, difficulty: v })} disabled={disabled} />
          <FieldInput label="Modo de juego" value={serverConfig.gamemode}
            onChange={(v) => setServerConfig({ ...serverConfig, gamemode: v })} disabled={disabled} />
          <FieldInput label="View distance" type="number" value={String(serverConfig.viewDistance)}
            onChange={(v) => setServerConfig({ ...serverConfig, viewDistance: parseInt(v) || 10 })} disabled={disabled} />
          <FieldInput label="Simulation distance" type="number" value={String(serverConfig.simulationDistance)}
            onChange={(v) => setServerConfig({ ...serverConfig, simulationDistance: parseInt(v) || 10 })} disabled={disabled} />
        </div>
      </Surface>
    </div>
  );
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "host", label: "Crear servidor", icon: <IconServer className="size-4" /> },
  { key: "join", label: "Unirse", icon: <IconPlug className="size-4" /> },
  { key: "advanced", label: "Avanzado", icon: <IconSettings className="size-4" /> },
];

export default function Multiplayer() {
  const { status } = useMultiplayer();
  const [activeTab, setActiveTab] = useState<TabKey>("host");

  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <div className="p-2 bg-accent/10 rounded-xl">
          <IconServer className="size-6 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold">ModStack Multiplayer</h1>
          <p className="text-xs text-muted">Juega con amigos desde tu PC, sin abrir puertos</p>
        </div>
        {status !== "stopped" && <div className="ml-auto"><StatusBadge status={status} /></div>}
      </div>

      <div className="flex items-center gap-1 shrink-0 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              "flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
              activeTab === tab.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "host" && <CreateServerTab />}
        {activeTab === "join" && <JoinServerTab />}
        {activeTab === "advanced" && <AdvancedTab />}
      </div>
    </div>
  );
}
