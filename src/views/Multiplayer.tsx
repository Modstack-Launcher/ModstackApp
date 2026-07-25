import { useState, useEffect, useRef, useCallback } from "react";
import {
  IconServer, IconPlayerPlay, IconPlayerStop, IconRefresh,
  IconSettings, IconUsers, IconTerminal2, IconCopy, IconCheck,
  IconLoader2, IconFolderOpen, IconBox, IconNetwork,
  IconSend, IconTrash, IconChartBar, IconDatabase,
  IconShield, IconAlertTriangle, IconCircleCheck,
  IconWorldWww, IconAdjustments, IconPlus, IconPlugConnected,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";
import type { ServerSoftware } from "../stores/multiplayerContext";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

type SidebarKey =
  | "dashboard"
  | "console"
  | "versions"
  | "mods"
  | "players"
  | "properties"
  | "gamerules"
  | "network";

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

function ConsoleLine({ raw, level }: { raw: string; level: string }) {
  const color: Record<string, string> = {
    info: "text-white/60",
    warn: "text-yellow-300/80",
    error: "text-red-400/90",
    success: "text-emerald-400",
    debug: "text-blue-300/60",
  };
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  return (
    <div className={`flex gap-2 font-mono text-xs leading-relaxed break-all ${color[level] ?? "text-white/60"}`}>
      <span className="shrink-0 text-white/20">{ts}</span>
      <span>{raw}</span>
    </div>
  );
}

function SetupWizard() {
  const { config, setConfig, setupServer, startServer, setupProgress, setActiveSoftware } = useMultiplayer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const softwareOptions: { id: ServerSoftware; label: string; desc: string }[] = [
    { id: "vanilla", label: "Vanilla", desc: "Servidor oficial de Mojang" },
    { id: "fabric", label: "Fabric", desc: "Para mods Fabric" },
    { id: "paper", label: "Paper", desc: "Optimizado para plugins" },
    { id: "forge", label: "Forge", desc: "Para mods Forge" },
  ];

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      setActiveSoftware(config.software);
      await setupServer();
      await startServer();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-8 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400 mx-auto mb-4">
          <IconServer className="size-8" />
        </div>
        <h1 className="text-xl font-bold text-white mb-1">ModStack Multiplayer</h1>
        <p className="text-sm text-white/40">Crea tu servidor local y juega con amigos sin abrir puertos</p>
      </div>

      <div className="w-full flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">Nombre del servidor</label>
          <input
            value={config.server_name}
            onChange={(e) => setConfig({ server_name: e.target.value })}
            placeholder="Mi Servidor Modstack"
            className="h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">Version</label>
            <input
              value={config.version}
              onChange={(e) => setConfig({ version: e.target.value })}
              placeholder="1.21.1"
              className="h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white font-mono outline-none focus:border-amber-500/50"
            />
          </div>
          <NumberInput
            label="Max jugadores"
            value={config.max_players}
            onChange={(v) => setConfig({ max_players: v })}
            min={1} max={100}
          />
        </div>

        <div>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Software</p>
          <div className="grid grid-cols-2 gap-2">
            {softwareOptions.map((s) => (
              <button
                key={s.id}
                onClick={() => setConfig({ software: s.id })}
                className={`flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-all ${config.software === s.id ? "border-amber-500/40 bg-amber-500/10" : "border-white/8 bg-white/4 hover:bg-white/8"}`}
              >
                <span className="text-sm font-bold text-white">{s.label}</span>
                <span className="text-xs text-white/40">{s.desc}</span>
              </button>
            ))}
          </div>
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
            onChange={(v) => setConfig({ difficulty: v })}
          />
          <SelectRow
            label="Modo de juego"
            value={config.gamemode}
            options={[
              { value: "survival", label: "Supervivencia" },
              { value: "creative", label: "Creativo" },
              { value: "adventure", label: "Aventura" },
            ]}
            onChange={(v) => setConfig({ gamemode: v })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <RamSlider label="RAM maxima" value={config.max_ram} onChange={(v) => setConfig({ max_ram: v })} min={512} max={8192} />
        </div>

        {setupProgress && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-white/50">{setupProgress.msg}</span>
              <span className="text-amber-400 font-mono">{setupProgress.pct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${setupProgress.pct}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/8 p-3">
            <IconAlertTriangle className="size-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 text-black font-bold text-sm py-3 hover:bg-amber-400 transition-colors disabled:opacity-50"
        >
          {busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlus className="size-4" />}
          {busy ? (setupProgress?.msg || "Configurando...") : "Crear Servidor"}
        </button>
      </div>
    </div>
  );
}

function JoinPanel({ localIp, port }: { localIp: string; port: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 max-w-lg mx-auto w-full">
      <div className="text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 mx-auto mb-3">
          <IconPlugConnected className="size-7" />
        </div>
        <h2 className="text-base font-bold text-white mb-1">Unirse a un servidor</h2>
        <p className="text-xs text-white/40">Pide a tu amigo que inicie su servidor y comparte la IP</p>
      </div>
      <div className="w-full flex flex-col gap-3">
        <CopyField label="LAN (misma red WiFi)" value={`${localIp}:${port}`} />
        <CopyField label="Mismo equipo" value={`127.0.0.1:${port}`} />
        <div className="rounded-xl border border-white/8 bg-white/4 p-4 text-xs text-white/40 leading-relaxed">
          Para conectarte desde Minecraft: <span className="font-mono text-white/70">Multijugador → Agregar servidor → pegar IP</span>
        </div>
      </div>
    </div>
  );
}

const SIDEBAR_ITEMS: { key: SidebarKey; label: string; icon: React.ReactNode; section: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: <IconChartBar className="size-4" />, section: "GENERAL" },
  { key: "console", label: "Consola", icon: <IconTerminal2 className="size-4" />, section: "GENERAL" },
  { key: "versions", label: "Versiones", icon: <IconDatabase className="size-4" />, section: "GESTION" },
  { key: "mods", label: "Mods", icon: <IconBox className="size-4" />, section: "GESTION" },
  { key: "players", label: "Jugadores", icon: <IconUsers className="size-4" />, section: "GESTION" },
  { key: "properties", label: "Properties", icon: <IconSettings className="size-4" />, section: "CONFIG" },
  { key: "gamerules", label: "Gamerules", icon: <IconAdjustments className="size-4" />, section: "CONFIG" },
  { key: "network", label: "Red", icon: <IconNetwork className="size-4" />, section: "CONFIG" },
];

export default function Multiplayer() {
  const {
    status, stats, logs, config, setConfig, setupProgress, localIp, setups,
    activeSoftware, setActiveSoftware,
    setupServer, startServer, stopServer, restartServer,
    sendCommand, openFolder, openModsFolder, clearLogs,
  } = useMultiplayer();

  const [activePage, setActivePage] = useState<SidebarKey>("dashboard");
  const [view, setView] = useState<"panel" | "setup" | "join">("panel");
  const [busyAction, setBusyAction] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const isRunning = status === "running";
  const isBusy = status === "starting" || status === "stopping" || busyAction;
  const hasServer = setups.length > 0;

  const handleStart = useCallback(async () => {
    setBusyAction(true);
    try {
      if (!hasServer) {
        await setupServer();
      }
      await startServer();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyAction(false);
    }
  }, [hasServer, setupServer, startServer]);

  const handleStop = useCallback(() => stopServer().catch(console.error), [stopServer]);
  const handleRestart = useCallback(() => restartServer().catch(console.error), [restartServer]);

  const submitCmd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmdInput.trim()) return;
    sendCommand(cmdInput.trim()).catch(console.error);
    setCmdInput("");
  };

  if (!hasServer && view === "panel") {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex flex-col items-center justify-center w-full gap-6">
          <div className="text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white/8 text-white/30 mx-auto mb-4">
              <IconServer className="size-8" />
            </div>
            <h1 className="text-lg font-bold text-white mb-1">ModStack Multiplayer</h1>
            <p className="text-sm text-white/40 max-w-xs mx-auto">Juega con amigos en tu red local sin abrir puertos ni configurar nada</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setView("setup")}
              className="flex items-center gap-2 rounded-xl bg-amber-500 text-black font-bold text-sm px-5 py-2.5 hover:bg-amber-400 transition-colors"
            >
              <IconPlus className="size-4" />
              Crear servidor
            </button>
            <button
              onClick={() => setView("join")}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 text-white/70 font-semibold text-sm px-5 py-2.5 hover:bg-white/10 transition-colors"
            >
              <IconPlugConnected className="size-4" />
              Unirse
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "setup") {
    return (
      <div className="flex h-full overflow-hidden">
        <button
          onClick={() => setView("panel")}
          className="absolute top-4 left-56 text-xs text-white/30 hover:text-white/60 transition-colors z-10"
        >
          ← Volver
        </button>
        <SetupWizard />
      </div>
    );
  }

  if (view === "join") {
    return (
      <div className="flex h-full overflow-hidden">
        <button
          onClick={() => setView("panel")}
          className="absolute top-4 left-4 text-xs text-white/30 hover:text-white/60 transition-colors z-10"
        >
          ← Volver
        </button>
        <JoinPanel localIp={localIp} port={config.port} />
      </div>
    );
  }

  const sections = [...new Set(SIDEBAR_ITEMS.map((i) => i.section))];

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex flex-col w-48 shrink-0 border-r border-white/8 bg-black/20">
        <div className="px-4 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className={`size-2.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{config.server_name || "Mi Servidor"}</p>
              <p className="text-[10px] text-white/30 font-mono">{config.version} · {activeSoftware}</p>
            </div>
          </div>

          <div className="flex gap-1.5 mt-3">
            {isRunning ? (
              <>
                <button
                  onClick={handleStop}
                  disabled={isBusy}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-500/20 border border-red-500/20 text-red-300 text-[10px] font-semibold py-1.5 hover:bg-red-500/30 transition-colors disabled:opacity-40"
                >
                  <IconPlayerStop className="size-3" /> Stop
                </button>
                <button
                  onClick={handleRestart}
                  disabled={isBusy}
                  className="flex items-center justify-center rounded-lg bg-white/8 border border-white/10 text-white/50 p-1.5 hover:bg-white/12 transition-colors disabled:opacity-40"
                >
                  <IconRefresh className="size-3" />
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                disabled={isBusy}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 text-[10px] font-semibold py-1.5 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
              >
                {isBusy ? <IconLoader2 className="size-3 animate-spin" /> : <IconPlayerPlay className="size-3" />}
                {isBusy ? "..." : "Start"}
              </button>
            )}
          </div>

          {setupProgress && (
            <div className="mt-2">
              <div className="flex justify-between text-[9px] text-white/30 mb-0.5">
                <span>{setupProgress.msg}</span>
                <span className="font-mono text-amber-400">{setupProgress.pct}%</span>
              </div>
              <div className="h-0.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${setupProgress.pct}%` }} />
              </div>
            </div>
          )}
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
              <span className="font-mono text-white/50">{stats.online_players}/{stats.max_players}</span>
            </div>
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${Math.min(100, (stats.online_players / Math.max(1, stats.max_players)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="px-3 py-2 border-t border-white/8">
          <button
            onClick={() => setView("setup")}
            className="flex w-full items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[10px] font-semibold text-white/40 hover:bg-white/8 hover:text-white/70 transition-colors"
          >
            <IconPlus className="size-3" /> Nuevo servidor
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto p-5">
        {activePage === "dashboard" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Estado" value={isRunning ? "Online" : "Offline"} sub={isRunning ? "Activo" : "Detenido"} icon={<IconServer className="size-4" />} />
              <StatCard label="Jugadores" value={`${stats.online_players}/${stats.max_players}`} sub={isRunning ? "conectados" : "---"} icon={<IconUsers className="size-4" />} />
              <StatCard label="RAM asignada" value={config.max_ram >= 1024 ? `${(config.max_ram / 1024).toFixed(1)}GB` : `${config.max_ram}MB`} sub={`Min: ${config.min_ram}MB`} icon={<IconDatabase className="size-4" />} />
            </div>

            <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{config.server_name || "Mi Servidor"}</p>
                  <p className="text-xs text-white/40 font-mono">{config.version} · {activeSoftware} · Puerto {config.port}</p>
                </div>
                <StatusPill status={status} />
              </div>
              <div className="flex gap-2">
                {isRunning ? (
                  <>
                    <button onClick={handleStop} disabled={isBusy} className="flex items-center gap-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold px-3 py-2 hover:bg-red-500/30 transition-colors disabled:opacity-40">
                      {isBusy ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconPlayerStop className="size-3.5" />} Detener
                    </button>
                    <button onClick={handleRestart} disabled={isBusy} className="flex items-center gap-1.5 rounded-lg bg-white/8 border border-white/10 text-white/70 text-xs font-semibold px-3 py-2 hover:bg-white/12 transition-colors disabled:opacity-40">
                      <IconRefresh className="size-3.5" /> Reiniciar
                    </button>
                  </>
                ) : (
                  <button onClick={handleStart} disabled={isBusy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold py-2 hover:bg-emerald-500/30 transition-colors disabled:opacity-40">
                    {isBusy ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerPlay className="size-4" />}
                    {isBusy ? (setupProgress?.msg || "Iniciando...") : "Iniciar Servidor"}
                  </button>
                )}
              </div>
            </div>

            {isRunning && (
              <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/40 uppercase tracking-wider">
                  <IconNetwork className="size-3.5" /> Acceso a la red
                </div>
                <CopyField label="LAN (misma red WiFi)" value={`${localIp}:${config.port}`} />
                <CopyField label="Local (mismo PC)" value={`127.0.0.1:${config.port}`} />
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 border border-amber-500/15 p-3">
                  <IconAlertTriangle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/50 leading-relaxed">Para amigos fuera de tu red, abre el puerto {config.port} TCP en tu router.</p>
                </div>
              </div>
            )}

            <div className="flex flex-col rounded-xl border border-white/8 bg-black/40 overflow-hidden" style={{ minHeight: 200 }}>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-black/30">
                <div className="flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-red-500/50" />
                  <span className="size-2.5 rounded-full bg-yellow-500/50" />
                  <span className="size-2.5 rounded-full bg-emerald-500/50" />
                </div>
                <span className="text-xs text-white/30 font-mono ml-1">Consola</span>
                <span className="ml-auto text-[10px] text-white/20 font-mono">{logs.length} lineas</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-0.5 max-h-40">
                {logs.length === 0
                  ? <p className="text-white/20 text-xs font-mono italic py-4 text-center">El servidor no ha iniciado todavia...</p>
                  : logs.map((e) => <ConsoleLine key={e.id} raw={e.raw} level={e.level} />)
                }
                <div ref={bottomRef} />
              </div>
              <form onSubmit={submitCmd} className="flex items-center gap-2 border-t border-white/8 px-3 py-2 bg-black/20">
                <span className="text-white/25 font-mono text-xs">{'>'}</span>
                <input
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  disabled={!isRunning}
                  placeholder={isRunning ? "Ejecutar comando..." : "Inicia el servidor para usar la consola"}
                  className="flex-1 bg-transparent text-xs font-mono text-white/80 outline-none placeholder:text-white/20 disabled:opacity-30"
                />
                <button type="submit" disabled={!isRunning || !cmdInput.trim()} className="text-white/30 hover:text-amber-400 disabled:opacity-20 transition-colors">
                  <IconSend className="size-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {activePage === "console" && (
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
                  <button onClick={clearLogs} className="text-white/20 hover:text-white/50 transition-colors ml-2">
                    <IconTrash className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {logs.length === 0
                  ? <p className="text-white/20 text-xs font-mono italic py-10 text-center">Sin logs todavia. Inicia el servidor.</p>
                  : logs.map((e) => <ConsoleLine key={e.id} raw={e.raw} level={e.level} />)
                }
                <div ref={bottomRef} />
              </div>
              <form onSubmit={submitCmd} className="flex items-center gap-2 border-t border-white/8 px-4 py-3 bg-black/20">
                <span className="text-white/25 font-mono text-sm">{'>'}</span>
                <input
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  disabled={!isRunning}
                  placeholder={isRunning ? "Ejecutar comando en el servidor..." : "Inicia el servidor para usar la consola"}
                  className="flex-1 bg-transparent text-xs font-mono text-white/80 outline-none placeholder:text-white/25 disabled:opacity-30"
                />
                <button type="submit" disabled={!isRunning || !cmdInput.trim()} className="text-white/30 hover:text-amber-400 disabled:opacity-20 transition-colors">
                  <IconSend className="size-4" />
                </button>
              </form>
            </div>
          </div>
        )}

        {activePage === "versions" && (
          <div className="flex flex-col gap-5">
            <SectionHeader icon={<IconDatabase className="size-4" />} title="Versiones" subtitle="Software y version de Minecraft" />
            <div className="grid grid-cols-2 gap-3">
              {(["vanilla", "fabric", "paper", "forge"] as ServerSoftware[]).map((s) => (
                <button
                  key={s}
                  onClick={() => !isRunning && setActiveSoftware(s)}
                  disabled={isRunning}
                  className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-all disabled:opacity-40 ${activeSoftware === s ? "border-amber-500/40 bg-amber-500/10" : "border-white/8 bg-white/4 hover:bg-white/8"}`}
                >
                  <span className="text-sm font-bold text-white capitalize">{s}</span>
                  <span className="text-xs text-white/40">
                    {s === "vanilla" ? "Oficial de Mojang" : s === "fabric" ? "Mods Fabric" : s === "paper" ? "Plugins optimizados" : "Mods Forge"}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider">Version de Minecraft</label>
              <div className="flex gap-2">
                <input
                  value={config.version}
                  onChange={(e) => setConfig({ version: e.target.value })}
                  disabled={isRunning}
                  placeholder="ej. 1.21.1"
                  className="flex-1 h-10 rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50 disabled:opacity-40 font-mono"
                />
              </div>
              <p className="text-xs text-white/30">Cambiar la version re-descarga el server.jar.</p>
            </div>
          </div>
        )}

        {activePage === "mods" && (
          <div className="flex flex-col gap-5">
            <SectionHeader icon={<IconBox className="size-4" />} title="Mods" subtitle="Gestiona los mods del servidor" />
            <div className="flex flex-col gap-3">
              <button onClick={() => openModsFolder().catch(console.error)} className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors text-left">
                <div className="size-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
                  <IconBox className="size-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Carpeta de mods</p>
                  <p className="text-xs text-white/40">Arrastra tus archivos .jar aqui</p>
                </div>
                <IconFolderOpen className="size-4 text-white/20 ml-auto" />
              </button>
              <button onClick={() => openFolder().catch(console.error)} className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors text-left">
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
        )}

        {activePage === "players" && (
          <div className="flex flex-col gap-5">
            <SectionHeader icon={<IconUsers className="size-4" />} title="Jugadores" subtitle="Gestion de jugadores en el servidor" />
            <PlayerQuickActions isRunning={isRunning} onSendCommand={(cmd) => sendCommand(cmd).catch(console.error)} />
          </div>
        )}

        {activePage === "properties" && (
          <div className="flex flex-col gap-5">
            <SectionHeader icon={<IconSettings className="size-4" />} title="Properties" subtitle="Configuracion del servidor" />
            <div className="flex flex-col gap-3">
              <ToggleRow label="Modo online" description="Verificar cuentas con Mojang" value={config.online_mode} onChange={(v) => setConfig({ online_mode: v })} disabled={isRunning} />
              <ToggleRow label="Nether habilitado" description="Permitir dimension del Nether" value={config.allow_nether} onChange={(v) => setConfig({ allow_nether: v })} disabled={isRunning} />
              <ToggleRow label="Permitir vuelo" description="Habilitar vuelo sin anti-cheat" value={config.allow_flight} onChange={(v) => setConfig({ allow_flight: v })} disabled={isRunning} />
              <ToggleRow label="PVP" description="Combate entre jugadores" value={config.pvp} onChange={(v) => setConfig({ pvp: v })} disabled={isRunning} />
              <ToggleRow label="Spawn de monstruos" description="Mobs hostiles" value={config.spawn_monsters} onChange={(v) => setConfig({ spawn_monsters: v })} disabled={isRunning} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectRow label="Dificultad" value={config.difficulty} options={[
                { value: "peaceful", label: "Pacifico" },
                { value: "easy", label: "Facil" },
                { value: "normal", label: "Normal" },
                { value: "hard", label: "Dificil" },
              ]} onChange={(v) => setConfig({ difficulty: v })} disabled={isRunning} />
              <SelectRow label="Modo de juego" value={config.gamemode} options={[
                { value: "survival", label: "Supervivencia" },
                { value: "creative", label: "Creativo" },
                { value: "adventure", label: "Aventura" },
              ]} onChange={(v) => setConfig({ gamemode: v })} disabled={isRunning} />
              <NumberInput label="Max jugadores" value={config.max_players} onChange={(v) => setConfig({ max_players: v })} disabled={isRunning} min={1} max={100} />
              <NumberInput label="Puerto" value={config.port} onChange={(v) => setConfig({ port: v })} disabled={isRunning} min={1024} max={65535} />
              <NumberInput label="View distance" value={config.view_distance} onChange={(v) => setConfig({ view_distance: v })} disabled={isRunning} min={2} max={32} />
              <NumberInput label="Simulation distance" value={config.simulation_distance} onChange={(v) => setConfig({ simulation_distance: v })} disabled={isRunning} min={2} max={32} />
            </div>
            <div className="border-t border-white/8 pt-4 flex flex-col gap-3">
              <RamSlider label="RAM minima" value={config.min_ram} onChange={(v) => setConfig({ min_ram: v })} disabled={isRunning} max={config.max_ram} />
              <RamSlider label="RAM maxima" value={config.max_ram} onChange={(v) => setConfig({ max_ram: v })} disabled={isRunning} min={config.min_ram} max={8192} />
            </div>
          </div>
        )}

        {activePage === "gamerules" && (
          <GamerulesPanel isRunning={isRunning} onSendCommand={(cmd) => sendCommand(cmd).catch(console.error)} />
        )}

        {activePage === "network" && (
          <div className="flex flex-col gap-5">
            <SectionHeader icon={<IconWorldWww className="size-4" />} title="Red" subtitle="Como conectarse al servidor" />
            {isRunning ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3">
                  <IconCircleCheck className="size-4 text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-300">El servidor esta activo y aceptando conexiones</p>
                </div>
                <CopyField label="Misma red WiFi / LAN" value={`${localIp}:${config.port}`} />
                <CopyField label="Mismo equipo (localhost)" value={`127.0.0.1:${config.port}`} />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <IconServer className="size-10 text-white/10" />
                <p className="text-sm text-white/30">Inicia el servidor para ver la informacion de red</p>
              </div>
            )}
            <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-2.5">
              {[
                { label: "Puerto TCP", value: String(config.port) },
                { label: "IP local detectada", value: localIp },
                { label: "Protocolo", value: "TCP / IPv4" },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-xs">
                  <span className="text-white/40">{row.label}</span>
                  <span className="font-mono text-white/70">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-white/8 bg-white/4 p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <IconShield className="size-4 text-amber-400" />
                <p className="text-xs font-semibold text-white/60">Conexiones externas</p>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">Para amigos fuera de tu red necesitas abrir el puerto {config.port} TCP en tu router (port forwarding) y compartir tu IP publica.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PlayerQuickActions({ isRunning, onSendCommand }: { isRunning: boolean; onSendCommand: (cmd: string) => void }) {
  const [player, setPlayer] = useState("");
  return (
    <>
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
      <input
        value={player}
        onChange={(e) => setPlayer(e.target.value)}
        placeholder="Nombre del jugador..."
        className="h-10 w-full rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-white outline-none focus:border-amber-500/50"
      />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Comandos rapidos</p>
        {[
          { label: "Listar jugadores", cmd: "list" },
          { label: "Guardar mundo", cmd: "save-all" },
          { label: "Hora del servidor", cmd: "time query daytime" },
          { label: "Limpiar drops", cmd: "kill @e[type=item]" },
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
    </>
  );
}

function GamerulesPanel({ isRunning, onSendCommand }: { isRunning: boolean; onSendCommand: (cmd: string) => void }) {
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

  const rulesMeta: Record<string, { label: string; desc: string; cat: string }> = {
    doDaylightCycle: { label: "Ciclo dia/noche", desc: "El tiempo avanza normalmente", cat: "Mundo" },
    doWeatherCycle: { label: "Ciclo de clima", desc: "El clima cambia naturalmente", cat: "Mundo" },
    doFireTick: { label: "Propagacion de fuego", desc: "El fuego se extiende", cat: "Mundo" },
    doMobSpawning: { label: "Spawn de mobs", desc: "Aparecen mobs de forma natural", cat: "Mobs" },
    mobGriefing: { label: "Griefing de mobs", desc: "Los mobs pueden destruir bloques", cat: "Mobs" },
    keepInventory: { label: "Conservar inventario", desc: "No perder items al morir", cat: "Jugadores" },
    doImmediateRespawn: { label: "Respawn inmediato", desc: "Sin pantalla de muerte", cat: "Jugadores" },
    announceAdvancements: { label: "Anunciar logros", desc: "Chat cuando alguien obtiene un logro", cat: "Chat" },
  };

  const cats = [...new Set(Object.values(rulesMeta).map((r) => r.cat))];

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader icon={<IconAdjustments className="size-4" />} title="Gamerules" subtitle="Reglas del juego del servidor" />
      {!isRunning && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
          <IconAlertTriangle className="size-4 text-amber-400 shrink-0" />
          <p className="text-xs text-white/50">Los gamerules se aplican en tiempo real. El servidor debe estar corriendo.</p>
        </div>
      )}
      {cats.map((cat) => (
        <div key={cat}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">{cat}</p>
          <div className="flex flex-col gap-2">
            {Object.entries(rulesMeta).filter(([, v]) => v.cat === cat).map(([key, meta]) => (
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
