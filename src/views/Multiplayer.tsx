import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  IconServer, IconPlayerPlay, IconPlayerStop, IconRefresh,
  IconSettings, IconUsers, IconTerminal2, IconCopy, IconCheck,
  IconLoader2, IconFolderOpen, IconBox, IconNetwork,
  IconSend, IconTrash, IconChartBar, IconDatabase,
  IconShield, IconAlertTriangle, IconCircleCheck,
  IconWorldWww, IconAdjustments,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

type SidebarKey =
  | "dashboard"
  | "console"
  | "versions"
  | "mods"
  | "datapacks"
  | "players"
  | "properties"
  | "gamerules"
  | "network";

interface LogEntry {
  id: number;
  raw: string;
  level: "info" | "warn" | "error" | "success" | "debug";
  timestamp: string;
}

let logIdCounter = 0;

function parseLogEntry(raw: string): LogEntry {
  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-US", { hour12: false });
  let level: LogEntry["level"] = "info";
  if (raw.includes("[ERR]") || raw.toLowerCase().includes("error") || raw.includes("SEVERE")) level = "error";
  else if (raw.toLowerCase().includes("warn")) level = "warn";
  else if (raw.includes("Done (") || raw.includes("For help, type")) level = "success";
  else if (raw.includes("[DEBUG]")) level = "debug";
  return { id: logIdCounter++, raw, level, timestamp };
}

function StatusPill({ status }: { status: ServerStatus }) {
  const map: Record<ServerStatus, { label: string; cls: string }> = {
    stopped: { label: "Offline", cls: "bg-white/10 text-white/40" },
    starting: { label: "Iniciando...", cls: "bg-yellow-500/20 text-yellow-300 animate-pulse" },
    running: { label: "Online", cls: "bg-emerald-500/20 text-emerald-300" },
    stopping: { label: "Deteniendo...", cls: "bg-yellow-500/20 text-yellow-300 animate-pulse" },
    error: { label: "Error", cls: "bg-red-500/20 text-red-300" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <span className={`size-1.5 rounded-full ${status === "running" ? "bg-emerald-400 animate-pulse" : status === "error" ? "bg-red-400" : "bg-white/30"}`} />
      {label}
    </span>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
      <button
        onClick={copy}
        className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs font-mono text-white/70 hover:bg-white/10 hover:text-white/90 transition-all"
      >
        <span className="truncate">{value}</span>
        {copied
          ? <IconCheck className="size-3 text-emerald-400 shrink-0" />
          : <IconCopy className="size-3 shrink-0 opacity-50" />}
      </button>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{label}</span>
        <span className="text-white/20">{icon}</span>
      </div>
      <span className="text-xl font-bold text-white">{value}</span>
      {sub && <span className="text-[10px] text-white/30">{sub}</span>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 pb-4 border-b border-white/8 mb-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {subtitle && <p className="text-xs text-white/40">{subtitle}</p>}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, value, onChange, disabled }: {
  label: string; description?: string; value: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/4 p-4">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-white/40 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition-colors duration-200 shrink-0 disabled:opacity-40 ${value ? "bg-amber-500" : "bg-white/10"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200 ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function SelectRow({ label, value, options, onChange, disabled }: {
  label: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50 disabled:opacity-40 appearance-none cursor-pointer"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function NumberInput({ label, value, onChange, disabled, min, max }: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; min?: number; max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">{label}</label>
      <input
        type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        disabled={disabled}
        className="h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50 disabled:opacity-40"
      />
    </div>
  );
}

function RamSlider({ label, value, onChange, disabled, min = 256, max = 8192, step = 256 }: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; min?: number; max?: number; step?: number;
}) {
  const display = value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value} MB`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between">
        <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">{label}</label>
        <span className="text-xs font-mono text-amber-400">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        disabled={disabled}
        className="w-full accent-amber-500 disabled:opacity-40"
      />
      <div className="flex justify-between text-[10px] text-white/25">
        <span>{min >= 1024 ? `${min / 1024}GB` : `${min}MB`}</span>
        <span>{max >= 1024 ? `${max / 1024}GB` : `${max}MB`}</span>
      </div>
    </div>
  );
}

function ConsoleLine({ entry }: { entry: LogEntry }) {
  const color: Record<LogEntry["level"], string> = {
    info: "text-white/60",
    warn: "text-yellow-300/80",
    error: "text-red-400/90",
    success: "text-emerald-400",
    debug: "text-blue-300/60",
  };
  return (
    <div className={`flex gap-2 font-mono text-xs leading-relaxed break-all ${color[entry.level]}`}>
      <span className="shrink-0 text-white/20">{entry.timestamp}</span>
      <span>{entry.raw}</span>
    </div>
  );
}

function DashboardSection({
  status, isSettingUp, setupProgress, setupMessage,
  logs, onStart, onStop, onRestart, onSendCommand,
  localIp, port, maxPlayers, onlinePlayers, minRam, maxRam, serverName, mcVersion,
}: {
  status: ServerStatus; isSettingUp: boolean; setupProgress: number; setupMessage: string;
  logs: LogEntry[]; onStart: () => void; onStop: () => void; onRestart: () => void;
  onSendCommand: (cmd: string) => void;
  localIp: string; port: number; maxPlayers: number; onlinePlayers: number;
  minRam: number; maxRam: number; serverName: string; mcVersion: string;
}) {
  const isRunning = status === "running";
  const isBusy = status === "starting" || status === "stopping" || isSettingUp;
  const canStart = status === "stopped" || status === "error";
  const bottomRef = useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = useState("");

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    onSendCommand(cmd.trim());
    setCmd("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Estado"
          value={isRunning ? "Online" : "Offline"}
          sub={isRunning ? `Uptime activo` : "Servidor detenido"}
          icon={<IconServer className="size-4" />}
        />
        <StatCard
          label="Jugadores"
          value={`${onlinePlayers}/${maxPlayers}`}
          sub={isRunning ? "conectados ahora" : "---"}
          icon={<IconUsers className="size-4" />}
        />
        <StatCard
          label="RAM asignada"
          value={maxRam >= 1024 ? `${(maxRam / 1024).toFixed(1)}GB` : `${maxRam}MB`}
          sub={`Min: ${minRam >= 1024 ? `${(minRam / 1024).toFixed(1)}GB` : `${minRam}MB`}`}
          icon={<IconDatabase className="size-4" />}
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">{serverName || "Mi Servidor"}</p>
            <p className="text-xs text-white/40 font-mono">{mcVersion} · Puerto {port}</p>
          </div>
          <StatusPill status={status} />
        </div>

        {isSettingUp && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-white/50">{setupMessage}</span>
              <span className="text-amber-400 font-mono">{setupProgress}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-300"
                style={{ width: `${setupProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {canStart ? (
            <button
              onClick={onStart}
              disabled={isBusy}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold py-2 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
            >
              {isBusy ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerPlay className="size-4" />}
              {isBusy ? (setupMessage || "Iniciando...") : "Iniciar Servidor"}
            </button>
          ) : (
            <>
              <button
                onClick={onStop}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold px-3 py-2 hover:bg-red-500/30 transition-colors disabled:opacity-40"
              >
                {isBusy ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconPlayerStop className="size-3.5" />}
                Detener
              </button>
              <button
                onClick={onRestart}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-lg bg-white/8 border border-white/10 text-white/70 text-xs font-semibold px-3 py-2 hover:bg-white/12 transition-colors disabled:opacity-40"
              >
                <IconRefresh className="size-3.5" />
                Reiniciar
              </button>
            </>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white/40 uppercase tracking-wider">
            <IconNetwork className="size-3.5" />
            Acceso a la red
          </div>
          <CopyField label="LAN (misma red WiFi)" value={`${localIp}:${port}`} />
          <CopyField label="Local (mismo PC)" value={`127.0.0.1:${port}`} />
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 border border-amber-500/15 p-3">
            <IconAlertTriangle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-white/50 leading-relaxed">
              Para amigos fuera de tu red, abre el puerto {port} TCP en tu router y comparte tu IP pública.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col rounded-xl border border-white/8 bg-black/40 overflow-hidden" style={{ minHeight: 280 }}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-black/30">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-red-500/50" />
            <span className="size-2.5 rounded-full bg-yellow-500/50" />
            <span className="size-2.5 rounded-full bg-emerald-500/50" />
          </div>
          <span className="text-xs text-white/30 font-mono ml-1">Consola</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5 max-h-52">
          {logs.length === 0
            ? <p className="text-white/20 text-xs font-mono italic py-6 text-center">El servidor no ha iniciado todavia...</p>
            : logs.map((e) => <ConsoleLine key={e.id} entry={e} />)
          }
          <div ref={bottomRef} />
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/8 px-3 py-2 bg-black/20">
          <span className="text-white/25 font-mono text-xs">{">"}</span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            disabled={!isRunning}
            placeholder={isRunning ? "Ejecutar comando..." : "Inicia el servidor para usar la consola"}
            className="flex-1 bg-transparent text-xs font-mono text-white/80 outline-none placeholder:text-white/20 disabled:opacity-30"
          />
          <button type="submit" disabled={!isRunning || !cmd.trim()} className="text-white/30 hover:text-amber-400 disabled:opacity-20 transition-colors">
            <IconSend className="size-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

function ConsoleSection({ logs, onSendCommand, isRunning, onClear }: {
  logs: LogEntry[]; onSendCommand: (cmd: string) => void; isRunning: boolean; onClear: () => void;
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

  return (
    <div className="flex flex-col h-full gap-4">
      <SectionHeader icon={<IconTerminal2 className="size-4" />} title="Consola" subtitle="Logs en tiempo real del servidor" />
      <div className="flex flex-col flex-1 rounded-xl border border-white/8 bg-black/50 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-black/30">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-red-500/50" />
            <span className="size-2.5 rounded-full bg-yellow-500/50" />
            <span className="size-2.5 rounded-full bg-emerald-500/50" />
          </div>
          <span className="text-xs text-white/30 font-mono ml-1">server log</span>
          <span className="ml-auto text-[10px] text-white/20 font-mono">{logs.length} lineas</span>
          {logs.length > 0 && (
            <button onClick={onClear} className="text-white/20 hover:text-white/50 transition-colors ml-2">
              <IconTrash className="size-3" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {logs.length === 0
            ? <p className="text-white/20 text-xs font-mono italic py-10 text-center">Sin logs todavia. Inicia el servidor.</p>
            : logs.map((e) => <ConsoleLine key={e.id} entry={e} />)
          }
          <div ref={bottomRef} />
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/8 px-4 py-3 bg-black/20">
          <span className="text-white/25 font-mono text-sm">{">"}</span>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            disabled={!isRunning}
            placeholder={isRunning ? "Ejecutar comando en el servidor..." : "Inicia el servidor para usar la consola"}
            className="flex-1 bg-transparent text-xs font-mono text-white/80 outline-none placeholder:text-white/25 disabled:opacity-30"
          />
          <button type="submit" disabled={!isRunning || !cmd.trim()} className="text-white/30 hover:text-amber-400 disabled:opacity-20 transition-colors">
            <IconSend className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function VersionsSection({ currentVersion, onChange, disabled }: {
  currentVersion: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const softwareOptions = [
    { id: "vanilla", label: "Vanilla", desc: "Servidor oficial de Mojang", count: "836+ versiones" },
    { id: "fabric", label: "Fabric", desc: "Para mods Fabric", count: "489+ versiones" },
    { id: "forge", label: "Forge", desc: "Para mods Forge/NeoForge", count: "59+ versiones" },
    { id: "paper", label: "Paper", desc: "Optimizado para plugins", count: "66 versiones" },
  ];
  const [selectedSoftware, setSelectedSoftware] = useState("vanilla");
  const [versionInput, setVersionInput] = useState(currentVersion);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconDatabase className="size-4" />} title="Versiones" subtitle="Software y version de Minecraft" />

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-4 flex items-center gap-3">
        <div className="size-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
          <IconChartBar className="size-5 text-amber-400" />
        </div>
        <div>
          <p className="text-xs text-white/40">Version actual</p>
          <p className="text-sm font-bold text-white">{currentVersion}</p>
        </div>
        <StatusPill status="running" />
      </div>

      <div>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Software recomendado</p>
        <div className="grid grid-cols-2 gap-2">
          {softwareOptions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSoftware(s.id)}
              className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-all ${selectedSoftware === s.id ? "border-amber-500/40 bg-amber-500/10" : "border-white/8 bg-white/4 hover:bg-white/8"}`}
            >
              <span className="text-sm font-bold text-white">{s.label}</span>
              <span className="text-xs text-white/40">{s.desc}</span>
              <span className="text-[10px] text-white/25 font-mono mt-1">{s.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">Version especifica</label>
        <div className="flex gap-2">
          <input
            value={versionInput}
            onChange={(e) => setVersionInput(e.target.value)}
            disabled={disabled}
            placeholder="ej. 1.21.1"
            className="flex-1 h-10 rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50 disabled:opacity-40 font-mono"
          />
          <button
            onClick={() => onChange(versionInput)}
            disabled={disabled || versionInput === currentVersion}
            className="px-4 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-sm font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
        <p className="text-xs text-white/30">Cambiar la version requiere re-descarga del server.jar y reinicio.</p>
      </div>
    </div>
  );
}

function ModsSection({ onOpenMods, onOpenServer }: { onOpenMods: () => void; onOpenServer: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconBox className="size-4" />} title="Mods" subtitle="Gestiona los mods del servidor" />
      <div className="flex flex-col gap-3">
        <button
          onClick={onOpenMods}
          className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors text-left"
        >
          <div className="size-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
            <IconBox className="size-5 text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Carpeta de mods</p>
            <p className="text-xs text-white/40">Arrastra tus archivos .jar aqui</p>
          </div>
          <IconFolderOpen className="size-4 text-white/20 ml-auto" />
        </button>
        <button
          onClick={onOpenServer}
          className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors text-left"
        >
          <div className="size-10 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
            <IconFolderOpen className="size-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Carpeta del servidor</p>
            <p className="text-xs text-white/40">worlds, configs, logs, backups</p>
          </div>
          <IconFolderOpen className="size-4 text-white/20 ml-auto" />
        </button>
      </div>
      <div className="rounded-xl border border-white/8 bg-white/4 p-4">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Como agregar mods</p>
        <ol className="text-xs text-white/50 space-y-1.5 leading-relaxed list-decimal list-inside">
          <li>Detén el servidor si está corriendo</li>
          <li>Abre la carpeta de mods</li>
          <li>Copia los archivos .jar de tus mods</li>
          <li>Los mods del cliente deben coincidir con los del servidor</li>
          <li>Reinicia el servidor</li>
        </ol>
      </div>
    </div>
  );
}

function PlayersSection({ isRunning, onSendCommand }: { isRunning: boolean; onSendCommand: (cmd: string) => void }) {
  const [player, setPlayer] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconUsers className="size-4" />} title="Jugadores" subtitle="Gestion de jugadores en el servidor" />
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Kickear jugador", cmd: (p: string) => `kick ${p} Kicked by admin` },
          { label: "Banear jugador", cmd: (p: string) => `ban ${p}` },
          { label: "Op (operador)", cmd: (p: string) => `op ${p}` },
          { label: "Deop", cmd: (p: string) => `deop ${p}` },
        ].map((action) => (
          <button
            key={action.label}
            onClick={() => { if (player.trim()) onSendCommand(action.cmd(player.trim())); }}
            disabled={!isRunning || !player.trim()}
            className="rounded-xl border border-white/8 bg-white/4 p-3 text-xs font-semibold text-white/60 hover:bg-white/8 hover:text-white transition-colors disabled:opacity-30 text-center"
          >
            {action.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={player}
          onChange={(e) => setPlayer(e.target.value)}
          placeholder="Nombre del jugador..."
          className="flex-1 h-10 rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50"
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Comandos rapidos</p>
        {[
          { label: "Listar jugadores", cmd: "list" },
          { label: "Guardar mundo", cmd: "save-all" },
          { label: "Ver hora del servidor", cmd: "time query daytime" },
          { label: "Limpiar todos los drops", cmd: "kill @e[type=item]" },
        ].map((q) => (
          <button
            key={q.cmd}
            onClick={() => onSendCommand(q.cmd)}
            disabled={!isRunning}
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-white/60 hover:bg-white/8 hover:text-white transition-colors disabled:opacity-30"
          >
            <span>{q.label}</span>
            <span className="text-xs font-mono text-white/25">{q.cmd}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PropertiesSection({ config, onChange, disabled }: {
  config: ReturnType<typeof useMultiplayer>["serverConfig"];
  onChange: (k: string, v: string | number | boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconSettings className="size-4" />} title="Properties" subtitle="Configuracion del server.properties" />
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Modo online"
          description="Verificar cuentas de Minecraft con Mojang"
          value={true}
          onChange={() => {}}
          disabled={disabled}
        />
        <ToggleRow
          label="Nether habilitado"
          description="Permitir dimension del Nether"
          value={true}
          onChange={() => {}}
          disabled={disabled}
        />
        <ToggleRow
          label="Permitir vuelo"
          description="Habilitar vuelo (sin anti-cheat de velocidad)"
          value={false}
          onChange={() => {}}
          disabled={disabled}
        />
        <ToggleRow
          label="PVP"
          description="Combate entre jugadores"
          value={true}
          onChange={() => {}}
          disabled={disabled}
        />
        <ToggleRow
          label="Spawn de monstruos"
          description="Permitir spawn de mobs hostiles"
          value={true}
          onChange={() => {}}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectRow
          label="Dificultad"
          value={config.difficulty}
          options={[
            { value: "peaceful", label: "Pacifico" },
            { value: "easy", label: "Facil" },
            { value: "normal", label: "Normal" },
            { value: "hard", label: "Dificil" },
          ]}
          onChange={(v) => onChange("difficulty", v)}
          disabled={disabled}
        />
        <SelectRow
          label="Modo de juego"
          value={config.gamemode}
          options={[
            { value: "survival", label: "Supervivencia" },
            { value: "creative", label: "Creativo" },
            { value: "adventure", label: "Aventura" },
            { value: "spectator", label: "Espectador" },
          ]}
          onChange={(v) => onChange("gamemode", v)}
          disabled={disabled}
        />
        <NumberInput label="Max jugadores" value={config.maxPlayers} onChange={(v) => onChange("maxPlayers", v)} disabled={disabled} min={1} max={100} />
        <NumberInput label="Puerto" value={config.port} onChange={(v) => onChange("port", v)} disabled={disabled} min={1024} max={65535} />
        <NumberInput label="View distance" value={config.viewDistance} onChange={(v) => onChange("viewDistance", v)} disabled={disabled} min={2} max={32} />
        <NumberInput label="Simulation distance" value={config.simulationDistance} onChange={(v) => onChange("simulationDistance", v)} disabled={disabled} min={2} max={32} />
      </div>
      <div className="border-t border-white/8 pt-4">
        <RamSlider label="RAM minima" value={config.minRam} onChange={(v) => onChange("minRam", v)} disabled={disabled} max={config.maxRam} />
        <div className="mt-3">
          <RamSlider label="RAM maxima" value={config.maxRam} onChange={(v) => onChange("maxRam", v)} disabled={disabled} min={config.minRam} max={8192} />
        </div>
      </div>
    </div>
  );
}

function GamerulesSection({ isRunning, onSendCommand }: { isRunning: boolean; onSendCommand: (cmd: string) => void }) {
  const [rules, setRules] = useState<Record<string, boolean>>({
    doDaylightCycle: true,
    doWeatherCycle: true,
    doFireTick: true,
    doMobSpawning: true,
    keepInventory: false,
    mobGriefing: true,
    doImmediateRespawn: false,
    announceAdvancements: true,
  });

  const toggle = (rule: string, value: boolean) => {
    setRules((prev) => ({ ...prev, [rule]: value }));
    onSendCommand(`gamerule ${rule} ${value}`);
  };

  const ruleLabels: Record<string, { label: string; desc: string; category: string }> = {
    doDaylightCycle: { label: "Ciclo dia/noche", desc: "El tiempo avanza normalmente", category: "Mundo" },
    doWeatherCycle: { label: "Ciclo de clima", desc: "El clima cambia naturalmente", category: "Mundo" },
    doFireTick: { label: "Propagacion de fuego", desc: "El fuego se extiende a bloques cercanos", category: "Mundo" },
    doMobSpawning: { label: "Spawn de mobs", desc: "Aparecen mobs de forma natural", category: "Mobs" },
    mobGriefing: { label: "Griefing de mobs", desc: "Los mobs pueden destruir bloques", category: "Mobs" },
    keepInventory: { label: "Conservar inventario", desc: "No perder items al morir", category: "Jugadores" },
    doImmediateRespawn: { label: "Respawn inmediato", desc: "Sin pantalla de muerte", category: "Jugadores" },
    announceAdvancements: { label: "Anunciar logros", desc: "Mostrar chat cuando alguien obtiene un logro", category: "Chat" },
  };

  const categories = [...new Set(Object.values(ruleLabels).map((r) => r.category))];

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconAdjustments className="size-4" />} title="Gamerules" subtitle="Reglas del juego del servidor" />
      {!isRunning && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
          <IconAlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-xs text-white/50">Los gamerules se aplican en tiempo real. El servidor debe estar corriendo.</p>
        </div>
      )}
      {categories.map((cat) => (
        <div key={cat}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">{cat}</p>
          <div className="flex flex-col gap-2">
            {Object.entries(ruleLabels)
              .filter(([, v]) => v.category === cat)
              .map(([key, meta]) => (
                <ToggleRow
                  key={key}
                  label={meta.label}
                  description={meta.desc}
                  value={rules[key] ?? false}
                  onChange={(v) => toggle(key, v)}
                  disabled={!isRunning}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NetworkSection({ port, localIp, isRunning }: { port: number; localIp: string; isRunning: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconWorldWww className="size-4" />} title="Red" subtitle="Como conectarse al servidor" />
      {isRunning ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
            <IconCircleCheck className="size-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">El servidor esta activo y aceptando conexiones</p>
          </div>
          <CopyField label="Misma red WiFi / LAN" value={`${localIp}:${port}`} />
          <CopyField label="Mismo equipo (localhost)" value={`127.0.0.1:${port}`} />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <IconServer className="size-10 text-white/10" />
          <p className="text-sm text-white/30">Inicia el servidor para ver la informacion de red</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Informacion de conexion</p>
        <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-2.5">
          {[
            { label: "Puerto TCP configurado", value: String(port) },
            { label: "IP local detectada", value: localIp },
            { label: "Protocolo", value: "TCP / IPv4" },
          ].map((row) => (
            <div key={row.label} className="flex justify-between text-xs">
              <span className="text-white/40">{row.label}</span>
              <span className="font-mono text-white/70">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <IconShield className="size-4 text-amber-400" />
          <p className="text-xs font-semibold text-white/60">Conexiones externas</p>
        </div>
        <p className="text-xs text-white/40 leading-relaxed">
          Para que amigos fuera de tu red local puedan conectarse, necesitas abrir el puerto {port} TCP en la
          configuracion de tu router (port forwarding) y compartir tu IP publica.
        </p>
      </div>
    </div>
  );
}

const SIDEBAR_ITEMS: { key: SidebarKey; label: string; icon: React.ReactNode; section: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: <IconChartBar className="size-4" />, section: "GENERAL" },
  { key: "console", label: "Consola", icon: <IconTerminal2 className="size-4" />, section: "GENERAL" },
  { key: "versions", label: "Versiones", icon: <IconDatabase className="size-4" />, section: "MANAGEMENT" },
  { key: "mods", label: "Mods", icon: <IconBox className="size-4" />, section: "MANAGEMENT" },
  { key: "players", label: "Jugadores", icon: <IconUsers className="size-4" />, section: "MANAGEMENT" },
  { key: "properties", label: "Properties", icon: <IconSettings className="size-4" />, section: "CONFIGURACION" },
  { key: "gamerules", label: "Gamerules", icon: <IconAdjustments className="size-4" />, section: "CONFIGURACION" },
  { key: "network", label: "Red", icon: <IconNetwork className="size-4" />, section: "CONFIGURACION" },
];

export default function Multiplayer() {
  const { serverConfig, setServerConfig } = useMultiplayer();
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activePage, setActivePage] = useState<SidebarKey>("dashboard");
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
        const entry = parseLogEntry(e.payload);
        setLogs((prev) => [...prev.slice(-1999), entry]);
        if (e.payload.includes("logged in")) setOnlinePlayers((n) => n + 1);
        if (e.payload.includes("left the game")) setOnlinePlayers((n) => Math.max(0, n - 1));
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
    return () => { unsubs.forEach((p) => p.then((f) => f())); };
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
      setLogs((prev) => [...prev, parseLogEntry(`[ERROR] ${String(e)}`)]);
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleStop = () => invoke("multiplayer_stop_server").catch(console.error);
  const handleRestart = () => invoke("multiplayer_restart_server", { minRam: serverConfig.minRam, maxRam: serverConfig.maxRam }).catch(console.error);
  const handleSendCommand = useCallback((cmd: string) => invoke("multiplayer_send_command", { command: cmd }).catch(console.error), []);
  const openFolder = () => invoke("multiplayer_open_folder").catch(console.error);
  const openModsFolder = () => invoke("multiplayer_open_mods_folder").catch(console.error);

  const isRunning = status === "running";

  const updateConfig = (key: string, value: string | number | boolean) => {
    setServerConfig({ ...serverConfig, [key]: value });
  };

  const sections = [...new Set(SIDEBAR_ITEMS.map((i) => i.section))];

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex flex-col w-48 shrink-0 border-r border-white/8 bg-black/20">
        <div className="px-4 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className={`size-2.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{serverConfig.serverName || "Mi Servidor"}</p>
              <p className="text-[10px] text-white/30 font-mono">{serverConfig.minecraftVersion}</p>
            </div>
          </div>
          <div className="flex gap-1.5 mt-3">
            {isRunning ? (
              <>
                <button
                  onClick={handleStop}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-500/20 border border-red-500/20 text-red-300 text-[10px] font-semibold py-1.5 hover:bg-red-500/30 transition-colors"
                >
                  <IconPlayerStop className="size-3" />
                  Stop
                </button>
                <button
                  onClick={handleRestart}
                  className="flex items-center justify-center rounded-lg bg-white/8 border border-white/10 text-white/50 p-1.5 hover:bg-white/12 transition-colors"
                >
                  <IconRefresh className="size-3" />
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                disabled={isSettingUp || status === "starting"}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 text-[10px] font-semibold py-1.5 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
              >
                {isSettingUp || status === "starting" ? <IconLoader2 className="size-3 animate-spin" /> : <IconPlayerPlay className="size-3" />}
                {isSettingUp || status === "starting" ? "..." : "Start"}
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((section) => (
            <div key={section} className="mb-1">
              <p className="px-4 pt-3 pb-1 text-[9px] font-bold text-white/25 uppercase tracking-widest">{section}</p>
              {SIDEBAR_ITEMS.filter((i) => i.section === section).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setActivePage(item.key)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2 text-xs font-semibold transition-colors border-r-2 ${activePage === item.key
                    ? "border-amber-500 bg-amber-500/10 text-amber-300"
                    : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/4"
                    }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {isRunning && (
          <div className="px-4 py-3 border-t border-white/8">
            <div className="flex justify-between text-[10px] text-white/30 mb-1">
              <span>Jugadores</span>
              <span className="font-mono text-white/50">{onlinePlayers}/{serverConfig.maxPlayers}</span>
            </div>
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${Math.min(100, (onlinePlayers / serverConfig.maxPlayers) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto p-5">
        {activePage === "dashboard" && (
          <DashboardSection
            status={status}
            isSettingUp={isSettingUp}
            setupProgress={setupProgress}
            setupMessage={setupMessage}
            logs={logs}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
            onSendCommand={handleSendCommand}
            localIp={localIp}
            port={serverConfig.port}
            maxPlayers={serverConfig.maxPlayers}
            onlinePlayers={onlinePlayers}
            minRam={serverConfig.minRam}
            maxRam={serverConfig.maxRam}
            serverName={serverConfig.serverName}
            mcVersion={serverConfig.minecraftVersion}
          />
        )}
        {activePage === "console" && (
          <ConsoleSection
            logs={logs}
            onSendCommand={handleSendCommand}
            isRunning={isRunning}
            onClear={() => setLogs([])}
          />
        )}
        {activePage === "versions" && (
          <VersionsSection
            currentVersion={serverConfig.minecraftVersion}
            onChange={(v) => setServerConfig({ ...serverConfig, minecraftVersion: v })}
            disabled={isRunning}
          />
        )}
        {activePage === "mods" && (
          <ModsSection onOpenMods={openModsFolder} onOpenServer={openFolder} />
        )}
        {activePage === "players" && (
          <PlayersSection isRunning={isRunning} onSendCommand={handleSendCommand} />
        )}
        {activePage === "properties" && (
          <PropertiesSection config={serverConfig} onChange={updateConfig} disabled={isRunning} />
        )}
        {activePage === "gamerules" && (
          <GamerulesSection isRunning={isRunning} onSendCommand={handleSendCommand} />
        )}
        {activePage === "network" && (
          <NetworkSection port={serverConfig.port} localIp={localIp} isRunning={isRunning} />
        )}
      </main>
    </div>
  );
}
