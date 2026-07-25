import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Surface } from "@heroui/react";
import {
  IconServer, IconPlug, IconPlayerPlay, IconPlayerStop, IconRefresh,
  IconSettings, IconUsers, IconTerminal2, IconCopy, IconCheck,
  IconLoader2, IconFolder, IconFolderOpen, IconBox, IconNetwork,
  IconSend, IconTrash, IconAlertTriangle,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type TabKey = "panel" | "config" | "console";

function StatusDot({ status }: { status: ServerStatus }) {
  const color: Record<ServerStatus, string> = {
    stopped: "bg-white/30",
    starting: "bg-yellow-400 animate-pulse",
    running: "bg-emerald-400 animate-pulse",
    stopping: "bg-yellow-400 animate-pulse",
    error: "bg-red-400",
  };
  return <span className={`inline-block size-2 rounded-full ${color[status]}`} />;
}

function StatusBadge({ status }: { status: ServerStatus }) {
  const styles: Record<ServerStatus, string> = {
    stopped: "bg-white/10 text-white/50",
    starting: "bg-yellow-500/20 text-yellow-300",
    running: "bg-emerald-500/20 text-emerald-300",
    stopping: "bg-yellow-500/20 text-yellow-300",
    error: "bg-red-500/20 text-red-300",
  };
  const labels: Record<ServerStatus, string> = {
    stopped: "Detenido", starting: "Iniciando...",
    running: "En linea", stopping: "Deteniendo...", error: "Error",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}>
      <StatusDot status={status} />
      {labels[status]}
    </span>
  );
}

function FieldInput({ label, value, onChange, type = "text", disabled = false, placeholder = "", hint = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; disabled?: boolean; placeholder?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        disabled={disabled} placeholder={placeholder}
        className="h-9 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />
      {hint && <span className="text-xs text-muted/70">{hint}</span>}
    </div>
  );
}

function RamSlider({ label, value, onChange, disabled, min = 256, max = 8192, step = 256 }: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <label className="text-xs font-semibold text-muted">{label}</label>
        <span className="text-xs font-mono text-accent">{value >= 1024 ? `${(value/1024).toFixed(1)}GB` : `${value}MB`}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        disabled={disabled}
        className="w-full accent-accent disabled:opacity-40"
      />
      <div className="flex justify-between text-[10px] text-muted/60">
        <span>{min}MB</span><span>{max >= 1024 ? `${max/1024}GB` : `${max}MB`}</span>
      </div>
    </div>
  );
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono text-muted hover:text-foreground hover:bg-white/10 transition-colors ${className}`}
    >
      {copied ? <IconCheck className="size-3 text-emerald-400" /> : <IconCopy className="size-3" />}
      {text}
    </button>
  );
}

function ServerConsole({ logs, onSendCommand, isRunning }: {
  logs: string[]; onSendCommand: (cmd: string) => void; isRunning: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = useState("");
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    onSendCommand(cmd.trim());
    setCmd("");
  };

  const getLineColor = (line: string) => {
    if (line.includes("[ERR]") || line.includes("ERROR")) return "text-red-400/90";
    if (line.includes("WARN")) return "text-yellow-400/90";
    if (line.includes("Done (")) return "text-emerald-400";
    if (line.startsWith("[")) return "text-white/60";
    return "text-emerald-400/80";
  };

  return (
    <div className="flex flex-col h-full bg-black/50 rounded-xl border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-black/30">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500/60" />
          <span className="size-2.5 rounded-full bg-yellow-500/60" />
          <span className="size-2.5 rounded-full bg-emerald-500/60" />
        </div>
        <span className="text-xs text-muted font-mono ml-2">Consola del servidor</span>
        {logs.length > 0 && (
          <button onClick={() => {}} className="ml-auto text-muted hover:text-foreground transition-colors">
            <IconTrash className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {logs.length === 0
          ? <p className="text-muted/50 italic py-4 text-center">El servidor no ha iniciado todavia...</p>
          : logs.map((line, i) => (
            <div key={i} className={`leading-relaxed break-all ${getLineColor(line)}`}>
              {line}
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 px-3 py-2 bg-black/20">
        <span className="text-muted/60 font-mono text-xs">&gt;</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          disabled={!isRunning}
          placeholder={isRunning ? "Ejecutar comando..." : "Inicia el servidor para usar la consola"}
          className="flex-1 bg-transparent text-xs font-mono text-foreground outline-none disabled:opacity-40 placeholder:text-muted/40"
        />
        <button type="submit" disabled={!isRunning || !cmd.trim()}
          className="text-muted hover:text-accent disabled:opacity-30 transition-colors">
          <IconSend className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

function NetworkInfo({ port, localIp }: { port: number; localIp: string }) {
  return (
    <Surface className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconNetwork className="size-4 text-accent" />
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Red</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] text-muted mb-1">LAN (misma red WiFi)</p>
          <CopyButton text={`${localIp}:${port}`} className="w-full justify-between bg-black/30 border border-white/5" />
        </div>
        <div>
          <p className="text-[10px] text-muted mb-1">Local (mismo PC)</p>
          <CopyButton text={`127.0.0.1:${port}`} className="w-full justify-between bg-black/30 border border-white/5" />
        </div>
      </div>
      <p className="text-[10px] text-muted/60 leading-relaxed">
        Comparte la IP LAN con amigos en tu misma red. Para conexiones externas necesitas abrir el puerto {port} en tu router.
      </p>
    </Surface>
  );
}

export default function Multiplayer() {
  const { serverConfig, setServerConfig } = useMultiplayer();
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("panel");
  const [localIp, setLocalIp] = useState("...");
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupProgress, setSetupProgress] = useState(0);
  const [setupMessage, setSetupMessage] = useState("");
  const [onlinePlayers, setOnlinePlayers] = useState(0);

  useEffect(() => {
    invoke<string>("multiplayer_get_local_ip").then(setLocalIp).catch(() => {});
    invoke<ServerStatus>("multiplayer_get_status").then(setStatus).catch(() => {});

    const unsubs = [
      listen<string>("multiplayer-log", (e) => {
        setLogs((prev) => [...prev.slice(-500), e.payload]);
        if (e.payload.includes("logged in")) setOnlinePlayers(n => n + 1);
        if (e.payload.includes("left the game")) setOnlinePlayers(n => Math.max(0, n - 1));
      }),
      listen<ServerStatus>("multiplayer-status", (e) => {
        setStatus(e.payload);
        if (e.payload === "stopped") setOnlinePlayers(0);
      }),
      listen<[number, string]>("multiplayer-setup-progress", (e) => {
        setSetupProgress(e.payload[0]);
        setSetupMessage(e.payload[1]);
      }),
    ];
    return () => { unsubs.forEach(p => p.then(f => f())); };
  }, []);

  const handleStart = async () => {
    setIsSettingUp(true);
    setSetupProgress(0);
    setSetupMessage("Preparando...");
    setLogs([]);
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
      await invoke("multiplayer_start_server", {
        minRam: serverConfig.minRam,
        maxRam: serverConfig.maxRam,
      });
    } catch (e) {
      setStatus("error");
      setLogs(prev => [...prev, `[ERROR] ${String(e)}`]);
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleStop = () => invoke("multiplayer_stop_server").catch(console.error);
  const handleRestart = () => invoke("multiplayer_restart_server", { minRam: serverConfig.minRam, maxRam: serverConfig.maxRam }).catch(console.error);
  const handleSendCommand = (cmd: string) => invoke("multiplayer_send_command", { command: cmd }).catch(console.error);
  const openFolder = () => invoke("multiplayer_open_folder").catch(console.error);
  const openModsFolder = () => invoke("multiplayer_open_mods_folder").catch(console.error);

  const isBusy = status === "starting" || status === "stopping" || isSettingUp;
  const isRunning = status === "running";
  const canStart = status === "stopped" || status === "error";

  const TABS = [
    { key: "panel" as TabKey, label: "Panel", icon: <IconServer className="size-3.5" /> },
    { key: "config" as TabKey, label: "Configuracion", icon: <IconSettings className="size-3.5" /> },
    { key: "console" as TabKey, label: "Consola", icon: <IconTerminal2 className="size-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="p-2 bg-accent/10 rounded-xl">
          <IconServer className="size-5 text-accent" />
        </div>
        <div>
          <h1 className="text-base font-bold leading-tight">ModStack Multiplayer</h1>
          <p className="text-xs text-muted">Host local para jugar con amigos</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {isRunning && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <IconUsers className="size-3.5" />
              <span>{onlinePlayers}/{serverConfig.maxPlayers}</span>
            </div>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-6 pt-3 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              "flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-accent text-accent bg-accent/5"
                : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>
      <div className="h-px bg-border w-full shrink-0" />

      <div className="flex-1 min-h-0 overflow-y-auto p-5">

        {activeTab === "panel" && (
          <div className="grid grid-cols-2 gap-4 h-full">
            <div className="flex flex-col gap-3">
              <Surface className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{serverConfig.serverName || "Mi Servidor"}</span>
                  <span className="text-xs text-muted font-mono">{serverConfig.minecraftVersion}</span>
                </div>

                {isSettingUp && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">{setupMessage}</span>
                      <span className="text-accent font-mono">{setupProgress}%</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${setupProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {canStart ? (
                    <Button className="flex-1" onPress={handleStart} isDisabled={isBusy}>
                      {isBusy ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerPlay className="size-4" />}
                      {isBusy ? setupMessage || "Iniciando..." : "Iniciar Servidor"}
                    </Button>
                  ) : (
                    <>
                      <Button variant="danger-soft" onPress={handleStop} isDisabled={isBusy}>
                        {isBusy ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconPlayerStop className="size-3.5" />}
                        Detener
                      </Button>
                      <Button variant="secondary" onPress={handleRestart} isDisabled={isBusy}>
                        <IconRefresh className="size-3.5" />
                        Reiniciar
                      </Button>
                    </>
                  )}
                </div>
              </Surface>

              {isRunning && <NetworkInfo port={serverConfig.port} localIp={localIp} />}

              <Surface className="p-4 flex flex-col gap-2">
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Carpetas</span>
                <button
                  onClick={openFolder}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors text-left"
                >
                  <IconFolderOpen className="size-4 text-accent shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Carpeta del servidor</p>
                    <p className="text-xs text-muted">worlds, configs, logs</p>
                  </div>
                </button>
                <button
                  onClick={openModsFolder}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors text-left"
                >
                  <IconBox className="size-4 text-purple-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Carpeta de mods</p>
                    <p className="text-xs text-muted">arrastra tus .jar aqui</p>
                  </div>
                </button>
              </Surface>

              <Surface className="p-4">
                <div className="flex items-start gap-2.5">
                  <IconAlertTriangle className="size-4 text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-yellow-300">Conexiones externas</p>
                    <p className="text-xs text-muted mt-0.5 leading-relaxed">
                      Para que amigos fuera de tu red entren, abre el puerto {serverConfig.port} TCP en tu router.
                      Usa tu IP publica en lugar de la LAN.
                    </p>
                  </div>
                </div>
              </Surface>
            </div>

            <div className="flex flex-col min-h-0" style={{ height: "calc(100vh - 220px)" }}>
              <ServerConsole logs={logs} onSendCommand={handleSendCommand} isRunning={isRunning} />
            </div>
          </div>
        )}

        {activeTab === "config" && (
          <div className="max-w-xl flex flex-col gap-4">
            <Surface className="p-5 flex flex-col gap-4">
              <span className="text-sm font-semibold">Servidor</span>
              <FieldInput label="Nombre del servidor (MOTD)" value={serverConfig.serverName}
                onChange={(v) => setServerConfig({ ...serverConfig, serverName: v })} disabled={isRunning} />
              <FieldInput label="Version de Minecraft" value={serverConfig.minecraftVersion}
                onChange={(v) => setServerConfig({ ...serverConfig, minecraftVersion: v })}
                disabled={isRunning} placeholder="1.21.1"
                hint="Cambia la version antes de iniciar. Requiere re-descarga del server.jar." />
              <div className="grid grid-cols-2 gap-3">
                <FieldInput label="Puerto" type="number" value={String(serverConfig.port)}
                  onChange={(v) => setServerConfig({ ...serverConfig, port: parseInt(v) || 25565 })} disabled={isRunning} />
                <FieldInput label="Max jugadores" type="number" value={String(serverConfig.maxPlayers)}
                  onChange={(v) => setServerConfig({ ...serverConfig, maxPlayers: parseInt(v) || 20 })} disabled={isRunning} />
              </div>
            </Surface>

            <Surface className="p-5 flex flex-col gap-4">
              <span className="text-sm font-semibold">Memoria RAM</span>
              <RamSlider label="RAM minima" value={serverConfig.minRam}
                onChange={(v) => setServerConfig({ ...serverConfig, minRam: v })}
                disabled={isRunning} max={serverConfig.maxRam} />
              <RamSlider label="RAM maxima" value={serverConfig.maxRam}
                onChange={(v) => setServerConfig({ ...serverConfig, maxRam: v })}
                disabled={isRunning} min={serverConfig.minRam} max={8192} />
              <p className="text-xs text-muted">Se recomienda al menos 1GB por cada 5-8 jugadores con mods.</p>
            </Surface>

            <Surface className="p-5 flex flex-col gap-4">
              <span className="text-sm font-semibold">Gameplay</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted">Dificultad</label>
                  <select value={serverConfig.difficulty}
                    onChange={(e) => setServerConfig({ ...serverConfig, difficulty: e.target.value })}
                    disabled={isRunning}
                    className="h-9 rounded-[10px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent disabled:opacity-40">
                    <option value="peaceful">Pacifico</option>
                    <option value="easy">Facil</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Dificil</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-muted">Modo de juego</label>
                  <select value={serverConfig.gamemode}
                    onChange={(e) => setServerConfig({ ...serverConfig, gamemode: e.target.value })}
                    disabled={isRunning}
                    className="h-9 rounded-[10px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent disabled:opacity-40">
                    <option value="survival">Supervivencia</option>
                    <option value="creative">Creativo</option>
                    <option value="adventure">Aventura</option>
                    <option value="spectator">Espectador</option>
                  </select>
                </div>
                <FieldInput label="View distance" type="number" value={String(serverConfig.viewDistance)}
                  onChange={(v) => setServerConfig({ ...serverConfig, viewDistance: parseInt(v) || 10 })} disabled={isRunning} />
                <FieldInput label="Simulation distance" type="number" value={String(serverConfig.simulationDistance)}
                  onChange={(v) => setServerConfig({ ...serverConfig, simulationDistance: parseInt(v) || 10 })} disabled={isRunning} />
              </div>
            </Surface>
          </div>
        )}

        {activeTab === "console" && (
          <div className="h-full min-h-0" style={{ height: "calc(100vh - 200px)" }}>
            <ServerConsole logs={logs} onSendCommand={handleSendCommand} isRunning={isRunning} />
          </div>
        )}
      </div>
    </div>
  );
}
