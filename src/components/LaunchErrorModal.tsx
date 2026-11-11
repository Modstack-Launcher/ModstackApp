import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "@heroui/react";
import { uiText, useUiLanguage } from "../utils/uiTranslation";
import type { TranslationKey } from "../utils/languageContext";

/** Mirrors `LaunchDiagnosis` in src-tauri/src/commands/crash_doctor.rs. */
export interface LaunchDiagnosis {
  instanceId: string;
  kind: string;
  mods: string[];
  details: string[];
  folder?: string | null;
  report?: string | null;
  extra?: string | null;
  exitCode?: number | null;
}

export const LAUNCH_DIAGNOSIS_EVENT = "modstack-launch-diagnosis";

const KNOWN_KINDS = new Set([
  "incompatible_mods", "missing_dependency", "duplicate_mod", "wrong_loader", "mixin", "mod_crash",
  "java_version", "graphics_driver", "out_of_memory", "heap_reservation", "corrupt_files",
  "access_denied", "disk_full", "network", "unknown",
]);

/** Called when launch_instance_cmd rejects: turns the raw error into a diagnosis. */
export async function showLaunchErrorDiagnosis(instanceId: string, error: unknown) {
  const message = String(error ?? "");
  try {
    const diagnosis = await invoke<LaunchDiagnosis>("diagnose_launch_error", { instanceId, error: message });
    window.dispatchEvent(new CustomEvent<LaunchDiagnosis>(LAUNCH_DIAGNOSIS_EVENT, { detail: diagnosis }));
  } catch {
    toast.danger("Error launching instance", { description: message });
  }
}

const ICONS: Record<string, string> = {
  incompatible_mods: "🧩", missing_dependency: "🧩", duplicate_mod: "🧩", wrong_loader: "🧩", mixin: "🧩", mod_crash: "🧩",
  java_version: "☕", graphics_driver: "🖥️", out_of_memory: "🧠", heap_reservation: "🧠",
  corrupt_files: "📦", access_denied: "🔒", disk_full: "💾", network: "🌐", unknown: "⚠️",
};

export default function LaunchErrorModal() {
  useUiLanguage();
  const [diagnosis, setDiagnosis] = useState<LaunchDiagnosis | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<LaunchDiagnosis>("minecraft-crash", ({ payload }) => setDiagnosis(payload))
      .then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(console.error);
    const onLocal = (event: Event) => setDiagnosis((event as CustomEvent<LaunchDiagnosis>).detail);
    window.addEventListener(LAUNCH_DIAGNOSIS_EVENT, onLocal);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(LAUNCH_DIAGNOSIS_EVENT, onLocal);
    };
  }, []);

  if (!diagnosis) return null;

  const kind = KNOWN_KINDS.has(diagnosis.kind) ? diagnosis.kind : "unknown";
  const extra = diagnosis.extra || (kind === "java_version" ? "17+" : "");
  const title = uiText(`crash.title.${kind}` as TranslationKey);
  const hint = uiText(`crash.hint.${kind}` as TranslationKey, { 0: extra });
  const close = () => setDiagnosis(null);

  const openPath = (path: string) =>
    invoke("open_diagnosis_path", { path }).catch(error => toast.danger(String(error)));

  const copyDetails = async () => {
    const text = [
      `Modstack — ${title}`,
      `Instance: ${diagnosis.instanceId}`,
      diagnosis.exitCode != null ? `Exit code: ${diagnosis.exitCode}` : "",
      diagnosis.mods.length ? `Mods: ${diagnosis.mods.join(", ")}` : "",
      "",
      ...diagnosis.details,
    ].filter(line => line !== null).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(uiText("crash.copied"));
    } catch {
      toast.danger(uiText("crash.copyFailed"));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-border p-5 shadow-2xl" style={{ backgroundColor: "var(--color-background)" }}>
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden>{ICONS[kind]}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{hint}</p>
          </div>
        </div>

        {diagnosis.mods.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{uiText("crash.modsInvolved")}</p>
            <div className="flex flex-wrap gap-1.5">
              {diagnosis.mods.map(mod => (
                <span key={mod} className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-1 text-xs text-foreground">{mod}</span>
              ))}
            </div>
          </div>
        )}

        {diagnosis.details.length > 0 && (
          <details className="mt-4 rounded-xl border border-border" open={kind === "unknown" || kind === "incompatible_mods" || kind === "missing_dependency"}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted">{uiText("crash.technicalDetails")}</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted">{diagnosis.details.join("\n")}</pre>
          </details>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => void copyDetails()} className="mr-auto rounded-xl px-3 py-2 text-xs text-muted hover:text-foreground">{uiText("crash.copyDetails")}</button>
          {diagnosis.report && (
            <button onClick={() => void openPath(diagnosis.report!)} className="rounded-xl border border-border px-3 py-2 text-sm text-foreground">{uiText("crash.openReport")}</button>
          )}
          {diagnosis.folder && (
            <button onClick={() => void openPath(diagnosis.folder!)} className="rounded-xl border border-border px-3 py-2 text-sm text-foreground">{uiText("crash.openFolder")}</button>
          )}
          <button onClick={close} className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black">{uiText("crash.close")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
