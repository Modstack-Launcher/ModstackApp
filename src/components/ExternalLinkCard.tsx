import { uiText, useUiLanguage } from "../utils/uiTranslation";
import { useState } from "react";
import { Button } from "@heroui/react";
import { open } from "@tauri-apps/plugin-shell";
import { IconExternalLink } from "@tabler/icons-react";
import LauncherModal from "./LauncherModal";

export function normalizeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return ["https:", "http:"].includes(url.protocol) && url.hostname.includes(".") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function ExternalLinkCard({ label, value, emptyLabel }: { label: string; value: string; emptyLabel: string }) {
  useUiLanguage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = normalizeExternalUrl(value);
  async function continueToSite() {
    if (!url || busy) return;
    setBusy(true); setError("");
    try { await open(url); setConfirm(false); }
    catch { setError(uiText("ui.noSePudoAbrirElNavegadorInténtalo")); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" disabled={!url} onClick={() => { setError(""); setConfirm(true); }} className="block w-full rounded-xl bg-black/20 p-3 text-left transition-colors enabled:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default">
      <span className="flex items-center gap-2"><span className="flex-1 text-sm font-bold">{label}</span>{url && <IconExternalLink className="size-3.5 text-white/50" />}</span>
      <span className="mt-1 block truncate text-xs text-white/35">{value || emptyLabel}</span>
    </button>
    <LauncherModal open={confirm} onClose={() => { if (!busy) setConfirm(false); }} title={uiText("ui.estásAPuntoDeSalirDeModstack")}>
      <p className="text-sm text-muted">{uiText("ui.seAbriráEsteEnlaceEnTuNavegador")}</p>
      <p className="break-all rounded-xl bg-background p-3 text-sm">{url}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="ghost" isDisabled={busy} onPress={() => setConfirm(false)}>{uiText("ui.cancelar")}</Button><Button isDisabled={busy} onPress={continueToSite}>{busy ? uiText("ui.abriendo") : uiText("ui.continuar")}<IconExternalLink size={16} /></Button></div>
    </LauncherModal>
  </>;
}
