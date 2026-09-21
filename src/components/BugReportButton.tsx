import { uiText, useUiLanguage } from "../utils/uiTranslation";
import { useRef, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { IconAlertTriangle, IconBug, IconDeviceDesktop, IconLock, IconSend, IconMessage, IconCpu, IconPhoto, IconX, IconBrandDiscord, IconCircleCheck } from "@tabler/icons-react";
import "./BugReportButton.css";

const REPORT_EMAIL = "modstacksupport@gmail.com";
const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";
const EMAILJS_SERVICE_ID = "service_pc2l643";
const EMAILJS_TEMPLATE_ID = "template_dcgrwkc";
const EMAILJS_PUBLIC_KEY = "jLqSYfnjBWE1TMRHT";
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

type ReportScreenshot = { name: string; data: string };

function readScreenshot(file: File): Promise<ReportScreenshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve({ name: file.name, data: reader.result })
      : reject(new Error("Unable to read screenshot"));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read screenshot"));
    reader.readAsDataURL(file);
  });
}

export default function BugReportButton() {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [screenshots, setScreenshots] = useState<ReportScreenshot[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  async function addScreenshots(files: FileList | null) {
    if (!files) return;
    const available = MAX_SCREENSHOTS - screenshots.length;
    const selected = Array.from(files).slice(0, available);
    try {
      const valid = selected.filter((file) => file.type.startsWith("image/") && file.size <= MAX_SCREENSHOT_BYTES);
      const loadedScreenshots = await Promise.all(valid.map(readScreenshot));
      setScreenshots((current) => [...current, ...loadedScreenshots]);
      if (valid.length < selected.length) setError(uiText("ui.lasCapturasDebenSerImágenesPequeñas"));
    } catch {
      setError(uiText("ui.noSePudoLeerLaCaptura"));
    }
  }
  async function sendReport() {
    if (busy) return;
    setBusy(true); setError(""); setSaved(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID || EMAILJS_SERVICE_ID;
      const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || EMAILJS_TEMPLATE_ID;
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || EMAILJS_PUBLIC_KEY;
      if (!serviceId || !templateId || !publicKey) {
        throw new Error("EmailJS is not configured");
      }
      const response = await fetch(EMAILJS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: REPORT_EMAIL,
            report_subject: "Reporte de error — Modstack",
            report_message: description.trim() || "Sin descripción",
            report_date: new Date().toISOString(),
            report_language: navigator.language,
            report_environment: navigator.userAgent,
            report_viewport: `${window.innerWidth} × ${window.innerHeight}`,
            report_screenshot_1: screenshots[0]?.data || "",
            report_screenshot_1_name: screenshots[0]?.name || "",
            report_screenshot_2: screenshots[1]?.data || "",
            report_screenshot_2_name: screenshots[1]?.name || "",
            report_screenshot_3: screenshots[2]?.data || "",
            report_screenshot_3_name: screenshots[2]?.name || "",
          },
        }),
      });
      if (!response.ok) throw new Error("EmailJS request failed");
      setSaved(true);
      setSupportOpen(true);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "EmailJS is not configured"
        ? uiText("ui.configuraElServicioDeCorreo")
        : cause instanceof DOMException && cause.name === "AbortError"
          ? uiText("ui.elServicioTardóDemasiado")
          : uiText("ui.noSePudoEnviarElInforme"));
    } finally { window.clearTimeout(timeout); setBusy(false); }
  }
  return <>
    <Button variant="ghost" size="lg" isIconOnly className="rounded-none ring-inset" aria-label={uiText("ui.reportarUnBug")} onPress={() => { setSaved(false); setError(""); setOpen(true); }}><IconBug size={18} /></Button>
    <Modal.Backdrop isOpen={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setScreenshots([]); }} className="bug-report-backdrop">
      <Modal.Container>
        <Modal.Dialog className="bug-report-dialog">
          <Modal.Header className="bug-report-header">
            <div className="bug-report-emblem" aria-hidden="true"><IconAlertTriangle size={30} stroke={1.7} /></div>
            <Modal.Heading className="bug-report-title">{uiText("ui.enviarInforme")}</Modal.Heading>
            <p className="bug-report-intro">{uiText("ui.algoNoFuncionaPreparaUnInformePara")}</p>
          </Modal.Header>
          <Modal.Body className="bug-report-body">
            <ul className="bug-report-details">
              <li><IconMessage size={16} />{uiText("ui.tuDescripciónDeLoQueHaPasado")}</li>
              <li><IconDeviceDesktop size={16} />{uiText("ui.informaciónDelEntornoDelLauncher")}</li>
              <li><IconCpu size={16} />{uiText("ui.idiomaYTamañoDeLaVentana")}</li>
            </ul>
            <p className="bug-report-privacy"><IconLock size={16} /><span>{uiText("ui.elInformeSeEnviaráDirectamenteA")}</span></p>
            <label className="sr-only" htmlFor="bug-description">{uiText("ui.descripciónOpcional")}</label>
            <textarea autoFocus id="bug-description" value={description} maxLength={1500} onChange={(event) => { setDescription(event.target.value); setSaved(false); }} placeholder={uiText("ui.opcionalCuéntanosQuéHaPasado")} className="bug-report-description" />
            <div className="bug-report-attachments" hidden>
              <input ref={screenshotInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(event) => { void addScreenshots(event.target.files); event.target.value = ""; }} />
              <Button variant="secondary" className="bug-report-attach" onPress={() => screenshotInputRef.current?.click()} isDisabled={busy || screenshots.length >= MAX_SCREENSHOTS}>
                <IconPhoto size={17} /> {uiText("ui.adjuntarCapturas")} ({screenshots.length}/{MAX_SCREENSHOTS})
              </Button>
              {screenshots.length > 0 && <div className="bug-report-preview-list">
                {screenshots.map((screenshot, index) => <div className="bug-report-preview" key={`${screenshot.name}-${index}`}>
                  <img src={screenshot.data} alt={screenshot.name} />
                  <span title={screenshot.name}>{screenshot.name}</span>
                  <button type="button" aria-label={uiText("ui.quitarCaptura")} onClick={() => setScreenshots((current) => current.filter((_, itemIndex) => itemIndex !== index))}><IconX size={14} /></button>
                </div>)}
              </div>}
            </div>
            {saved && <p role="status" className="bug-report-status text-success">{uiText("ui.informeEnviadoCorrectamente")}</p>}
            {error && <p role="alert" className="bug-report-status text-danger">{error}</p>}
            <div className="bug-report-actions">
              <Button variant="ghost" className="bug-report-cancel" onPress={() => setOpen(false)}>{uiText("ui.cancelar")}</Button>
              <Button className="bug-report-submit" isDisabled={busy} onPress={sendReport}><IconSend size={19} stroke={1.8} /> {busy ? uiText("ui.enviando") : uiText("ui.enviar")}</Button>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
    <Modal.Backdrop isOpen={supportOpen} onOpenChange={setSupportOpen} className="bug-report-backdrop">
      <Modal.Container>
        <Modal.Dialog className="bug-report-dialog support-dialog">
          <Modal.Header className="bug-report-header">
            <div className="support-success" aria-hidden="true"><IconCircleCheck size={20} stroke={2.2} /></div>
            <Modal.Heading className="bug-report-title">{uiText("ui.informeEnviadoCorrectamente")}</Modal.Heading>
            <p className="bug-report-intro">{uiText("ui.mejorSoporteEnDiscord")}</p>
          </Modal.Header>
          <Modal.Body className="bug-report-body">
            <div className="support-discord-card">
              <div className="support-discord-icon" aria-hidden="true"><IconBrandDiscord size={25} /></div>
              <div><strong>Discord oficial</strong><span>{uiText("ui.úneteAlDiscordOficialParaRecibirAyuda")}</span></div>
            </div>
            <div className="bug-report-actions support-actions">
              <Button variant="ghost" className="bug-report-cancel" onPress={() => setSupportOpen(false)}>{uiText("ui.cerrar")}</Button>
              <Button className="bug-report-submit" onPress={() => window.open("https://discord.gg/PAk59V3bSR", "_blank", "noopener,noreferrer")}>{uiText("ui.unirseAlDiscord")}</Button>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </>;
}
