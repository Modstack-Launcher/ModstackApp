import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";

const ENDPOINT = "https://modstack-api.vercel.app/api/launcher-telemetry";
const INGEST_KEY = import.meta.env.VITE_TELEMETRY_INGEST_TOKEN?.trim() || "";
const INSTALLATION_KEY = "modstack.telemetry.installation-id";
const INSTALL_RECORDED_KEY = "modstack.telemetry.install-recorded";
const HEARTBEAT_INTERVAL_MS = 60_000;

type TelemetryEvent = "install" | "heartbeat" | "session_start" | "session_end";

function persistentId(key: string) {
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

function platform() {
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const value = userAgentData?.platform || navigator.platform || "unknown";
  return value.slice(0, 32);
}

function architecture() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("arm64") || agent.includes("aarch64")) return "arm64";
  if (agent.includes("x86_64") || agent.includes("win64") || agent.includes("x64")) return "x64";
  if (agent.includes("i686") || agent.includes("x86")) return "x86";
  return "unknown";
}

async function postEvent(
  event: TelemetryEvent,
  installationId: string,
  sessionId: string,
  startedAt: number,
  keepalive = false,
) {
  if (!INGEST_KEY) return;
  const version = await getVersion().catch(() => "unknown");
  const body = {
    event,
    installationId,
    sessionId,
    version,
    os: platform(),
    arch: architecture(),
    ...(event === "session_end"
      ? { durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) }
      : {}),
  };

  await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Modstack-Telemetry-Key": INGEST_KEY,
    },
    body: JSON.stringify(body),
    keepalive,
  }).catch(() => undefined);
}

export function startLauncherTelemetry() {
  if (!INGEST_KEY) {
    // Without the token every event is dropped and the admin dashboard stays at 0.
    console.warn("[telemetry] VITE_TELEMETRY_INGEST_TOKEN is not set: launcher analytics are disabled in this build.");
    return () => {};
  }
  const installationId = persistentId(INSTALLATION_KEY);
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();
  let ended = false;
  const endSession = (keepalive: boolean) => {
    if (ended) return Promise.resolve();
    ended = true;
    return postEvent("session_end", installationId, sessionId, startedAt, keepalive);
  };

  if (!localStorage.getItem(INSTALL_RECORDED_KEY)) {
    localStorage.setItem(INSTALL_RECORDED_KEY, "1");
    void postEvent("install", installationId, sessionId, startedAt);
  }
  void postEvent("session_start", installationId, sessionId, startedAt);
  void postEvent("heartbeat", installationId, sessionId, startedAt);

  const interval = window.setInterval(() => {
    void postEvent("heartbeat", installationId, sessionId, startedAt);
  }, HEARTBEAT_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void postEvent("heartbeat", installationId, sessionId, startedAt);
    }
  };
  const onPageHide = () => {
    void endSession(true);
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide, { once: true });

  // "pagehide" is not reliable when the Tauri window closes, so the session end
  // (used for the average session length) is sent before the window goes away.
  let unlistenClose: (() => void) | null = null;
  let disposed = false;
  getCurrentWindow()
    .onCloseRequested(async () => {
      await Promise.race([endSession(false), new Promise(resolve => setTimeout(resolve, 2000))]);
    })
    .then(unlisten => { if (disposed) unlisten(); else unlistenClose = unlisten; })
    .catch(() => undefined);

  return () => {
    disposed = true;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onPageHide);
    unlistenClose?.();
    void endSession(true);
  };
}
