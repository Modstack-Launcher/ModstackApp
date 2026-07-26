import { useState, useRef, useEffect } from "react";
import { Button, Input, Select, SelectItem, Slider, Switch, Tooltip, Chip } from "@heroui/react";
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
  IconUsers,
  IconServer,
  IconSettings,
  IconCopy,
  IconCheck,
  IconCloudCheck,
  IconCloudOff,
} from "@tabler/icons-react";
import { useMultiplayer } from "../stores/multiplayerContext";
import { useModstackAuth } from "../stores/modstackAuthContext";
import { useInstance } from "../stores/instanceContext";
import type { ServerConfig } from "../stores/multiplayerContext";

type Tab = "panel" | "config" | "console";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    stopped: "bg-white/10 text-white/50",
    starting: "bg-amber-500/20 text-amber-400",
    running: "bg-emerald-500/20 text-emerald-400",
    stopping: "bg-amber-500/20 text-amber-400",
    error: "bg-red-500/20 text-red-400",
  };
  const labels: Record<string, string> = {
    stopped: "Detenido",
    starting: "Iniciando\u2026",
    running: "En l\u00ednea",
    stopping: "Deteniendo\u2026",
    error: "Error",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? colors.stopped}`}>
      {labels[status] ?? status}
    </span>
  );
}

function ApiStatusBar() {
  const { token, profile, loading, error } = useModstackAuth();

  if (loading) return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-white/40 border-b border-white/5">
      <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
      Conectando con Modstack\u2026
    </div>
  );

  if (token && profile) return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-400 border-b border-white/5">
      <IconCloudCheck className="size-3.5" />
      Conectado como <span className="font-semibold">{profile.username}</span>
    </div>
  );

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-white/30 border-b border-white/5">
      <IconCloudOff className="size-3.5" />
      {error ?? "Sin conexi\u00f3n a Modstack \u2014 el servidor funciona igual de forma local"}
    </div>
  );
}

function PanelTab() {
  const { status, players, localIp, startServer, stopServer, config, remoteServer } = useMultiplayer();
  const [copied, setCopied] = useState(false);
  const isRunning = status === "running";
  const isBusy = status === "starting" || status === "stopping";

  const copyIp = () => {
    const addr = localIp ? `${localIp}:${config.port}` : `localhost:${config.port}`;
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-5 p-6 h-full">
      <div className="flex items-center gap-4 p-4 rounded-xl bg-surface-secondary border border-white/5">
        <div className="flex-1">
          <p className="text-sm text-white/50 mb-1">Estado del servidor</p>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-white font-semibold text-sm">{config.server_name}</span>
            {remoteServer && (
              <Chip size="sm" variant="flat" color="success" className="text-xs">Modstack Online</Chip>
            )}
          </div>
          {isRunning && (
            <div className="flex items-center gap-2 mt-2">
              <code className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded">
                {localIp ? `${localIp}:${config.port}` : `localhost:${config.port}`}
              </code>
              <Tooltip content={copied ? "Copiado" : "Copiar IP"} delay={0}>
                <button onClick={copyIp} className="text-white/40 hover:text-white transition-colors">
                  {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
                </button>
              </Tooltip>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!isRunning && status !== "stopping" && (
            <Button
              onPress={startServer}
              isLoading={status === "starting"}
              isDisabled={isBusy}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              startContent={!isBusy && <IconPlayerPlay className="size-4" />}
            >
              Iniciar
            </Button>
          )}
          {(isRunning || status === "stopping") && (
            <Button
              onPress={stopServer}
              isLoading={status === "stopping"}
              isDisabled={isBusy && status !== "running"}
              className="bg-red-600/80 hover:bg-red-600 text-white"
              startContent={status !== "stopping" && <IconPlayerStop className="size-4" />}
            >
              Detener
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-1">Jugadores</p>
          <p className="text-2xl font-bold text-white">{players.length}<span className="text-sm text-white/40">/{config.max_players}</span></p>
        </div>
        <div className="p-4 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-1">Puerto</p>
          <p className="text-2xl font-bold text-white">{config.port}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-1">RAM</p>
          <p className="text-2xl font-bold text-white">{config.max_ram_mb}<span className="text-sm text-white/40"> MB</span></p>
        </div>
      </div>

      {players.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-2 flex items-center gap-1.5"><IconUsers className="size-3.5" /> Jugadores conectados</p>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <span key={p} className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-white/80">{p}</span>
            ))}
          </div>
        </div>
      )}

      {players.length === 0 && isRunning && (
        <div className="flex-1 flex flex-col items-center justify-center text-white/30">
          <IconUsers className="size-10 mb-2" />
          <p className="text-sm">Nadie conectado a\u00fan</p>
          <p className="text-xs mt-1">Comparte la IP con tus amigos</p>
        </div>
      )}

      {!isRunning && status !== "starting" && (
        <div className="flex-1 flex flex-col items-center justify-center text-white/30">
          <IconServer className="size-10 mb-2" />
          <p className="text-sm">El servidor est\u00e1 detenido</p>
          <p className="text-xs mt-1">Pulsa Iniciar para arrancar</p>
        </div>
      )}
    </div>
  );
}

function ConfigTab() {
  const { config, setConfig, status } = useMultiplayer();
  const { instances } = useInstance();
  const disabled = status !== "stopped" && status !== "error";

  const update = <K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) =>
    setConfig({ [key]: value } as Partial<ServerConfig>);

  return (
    <div className="flex flex-col gap-4 p-6 overflow-y-auto h-full">
      {disabled && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Det\u00e9n el servidor para cambiar la configuraci\u00f3n.
        </div>
      )}

      <Select
        label="Instancia base (opcional)"
        placeholder="Vanilla \u2014 sin mods"
        selectedKeys={config.instance_id ? [config.instance_id] : []}
        onSelectionChange={(keys) => {
          const val = [...keys][0];
          update("instance_id", val ? String(val) : null);
        }}
        isDisabled={disabled}
        classNames={{ trigger: "bg-surface-secondary border-white/10" }}
        description="Si seleccionas una instancia, sus mods se usar\u00e1n en el servidor."
      >
        {(instances ?? []).map((inst: any) => (
          <SelectItem key={inst.id}>{inst.title}</SelectItem>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Nombre del servidor"
          value={config.server_name}
          onValueChange={(v) => update("server_name", v)}
          isDisabled={disabled}
          classNames={{ inputWrapper: "bg-surface-secondary border-white/10" }}
        />
        <Input
          label="Puerto"
          type="number"
          value={String(config.port)}
          onValueChange={(v) => update("port", Number(v))}
          isDisabled={disabled}
          classNames={{ inputWrapper: "bg-surface-secondary border-white/10" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Modo de juego"
          selectedKeys={[config.game_mode]}
          onSelectionChange={(keys) => update("game_mode", [...keys][0] as string)}
          isDisabled={disabled}
          classNames={{ trigger: "bg-surface-secondary border-white/10" }}
        >
          <SelectItem key="survival">Supervivencia</SelectItem>
          <SelectItem key="creative">Creativo</SelectItem>
          <SelectItem key="adventure">Aventura</SelectItem>
        </Select>
        <Select
          label="Dificultad"
          selectedKeys={[config.difficulty]}
          onSelectionChange={(keys) => update("difficulty", [...keys][0] as string)}
          isDisabled={disabled}
          classNames={{ trigger: "bg-surface-secondary border-white/10" }}
        >
          <SelectItem key="peaceful">Pac\u00edfica</SelectItem>
          <SelectItem key="easy">F\u00e1cil</SelectItem>
          <SelectItem key="normal">Normal</SelectItem>
          <SelectItem key="hard">Dif\u00edcil</SelectItem>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-2">Jugadores m\u00e1x: <span className="text-white">{config.max_players}</span></p>
          <Slider
            minValue={1} maxValue={20} step={1}
            value={config.max_players}
            onChange={(v) => update("max_players", v as number)}
            isDisabled={disabled}
            className="text-accent"
          />
        </div>
        <div className="p-3 rounded-xl bg-surface-secondary border border-white/5">
          <p className="text-xs text-white/40 mb-2">Distancia de vista: <span className="text-white">{config.view_distance}</span></p>
          <Slider
            minValue={4} maxValue={32} step={1}
            value={config.view_distance}
            onChange={(v) => update("view_distance", v as number)}
            isDisabled={disabled}
            className="text-accent"
          />
        </div>
      </div>

      <div className="p-3 rounded-xl bg-surface-secondary border border-white/5">
        <p className="text-xs text-white/40 mb-2">RAM asignada: <span className="text-white">{config.max_ram_mb} MB</span></p>
        <Slider
          minValue={512} maxValue={8192} step={256}
          value={config.max_ram_mb}
          onChange={(v) => update("max_ram_mb", v as number)}
          isDisabled={disabled}
          className="text-accent"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-surface-secondary border border-white/5">
        <div>
          <p className="text-sm text-white/80">Modo online</p>
          <p className="text-xs text-white/40">Requiere cuenta de Minecraft original. Desh\u00e1bilitalo para cuentas no premium.</p>
        </div>
        <Switch
          isSelected={config.online_mode}
          onValueChange={(v) => update("online_mode", v)}
          isDisabled={disabled}
        />
      </div>

      <Input
        label="Ruta de Java (dejar vac\u00edo para usar el del launcher)"
        value={config.java_path}
        onValueChange={(v) => update("java_path", v)}
        isDisabled={disabled}
        placeholder="/path/to/java"
        classNames={{ inputWrapper: "bg-surface-secondary border-white/10" }}
      />
    </div>
  );
}

function ConsoleTab() {
  const { logs, sendCommand, status } = useMultiplayer();
  const [cmd, setCmd] = useState("");
  const [localLogs, setLocalLogs] = useState<string[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalLogs(logs);
  }, [logs]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [localLogs]);

  const submit = async () => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    await sendCommand(trimmed);
    setCmd("");
  };

  const clearLogs = () => setLocalLogs([]);

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-white/30 flex items-center gap-1.5"><IconTerminal2 className="size-3.5" /> Consola del servidor</p>
        <button onClick={clearLogs} className="text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1">
          <IconRefresh className="size-3" /> Limpiar
        </button>
      </div>
      <div
        ref={logsRef}
        className="flex-1 overflow-y-auto font-mono text-xs leading-5 text-white/70 bg-black/30 rounded-xl p-3 border border-white/5"
      >
        {localLogs.length === 0 ? (
          <span className="text-white/20">Aqu\u00ed aparecer\u00e1n los logs del servidor\u2026</span>
        ) : (
          localLogs.map((line, i) => (
            <div key={i} className={line.includes("ERROR") || line.includes("WARN") ? "text-amber-400" : "text-white/70"}>
              {line}
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Escribe un comando\u2026"
          value={cmd}
          onValueChange={setCmd}
          isDisabled={status !== "running"}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          classNames={{ inputWrapper: "bg-surface-secondary border-white/10", input: "font-mono text-sm" }}
          startContent={<span className="text-white/30 font-mono text-sm">/</span>}
        />
        <Button onPress={submit} isDisabled={status !== "running" || !cmd.trim()} className="bg-accent text-accent-foreground">
          Enviar
        </Button>
      </div>
    </div>
  );
}

export default function Multiplayer() {
  const [tab, setTab] = useState<Tab>("panel");
  const { status } = useMultiplayer();

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "panel", label: "Panel", icon: <IconServer className="size-4" /> },
    { key: "config", label: "Configuraci\u00f3n", icon: <IconSettings className="size-4" /> },
    { key: "console", label: "Consola", icon: <IconTerminal2 className="size-4" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-2 px-6 pt-5 pb-0 border-b border-white/5">
        <div className="flex-1 flex items-center gap-3">
          <IconServer className="size-5 text-accent" />
          <span className="text-white font-semibold text-sm">Modstack Multiplayer</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex gap-1 pb-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2 ${
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <ApiStatusBar />

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "panel" && <PanelTab />}
        {tab === "config" && <ConfigTab />}
        {tab === "console" && <ConsoleTab />}
      </div>
    </div>
  );
}
