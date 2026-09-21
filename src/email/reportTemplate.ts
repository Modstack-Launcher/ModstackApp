export const REPORT_EMAIL_HTML_TEMPLATE = `
<div style="margin:0;background:#070b14;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e7edff">
  <div style="max-width:680px;margin:0 auto;border:1px solid #263553;border-radius:18px;overflow:hidden;background:#0f172a;box-shadow:0 18px 48px rgba(0,0,0,.28)">
    <div style="padding:24px 28px;background:linear-gradient(135deg,#172554,#111827);border-bottom:1px solid #2d4b85">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#79a5ff;font-weight:700">MODSTACK SUPPORT</div>
      <h1 style="margin:10px 0 0;font-size:24px;line-height:1.2;color:#fff">{{report_subject}}</h1>
    </div>
    <div style="padding:28px">
      <div style="padding:18px;border-radius:12px;background:#080d18;border:1px solid #253657;white-space:pre-wrap;font-size:15px;line-height:1.6">{{report_message}}</div>
      <table role="presentation" style="width:100%;margin-top:22px;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:9px 0;color:#91a3c7;width:145px">Fecha</td><td style="padding:9px 0;color:#e7edff">{{report_date}}</td></tr>
        <tr><td style="padding:9px 0;color:#91a3c7">Idioma</td><td style="padding:9px 0;color:#e7edff">{{report_language}}</td></tr>
        <tr><td style="padding:9px 0;color:#91a3c7">Ventana</td><td style="padding:9px 0;color:#e7edff">{{report_viewport}}</td></tr>
        <tr><td style="padding:9px 0;color:#91a3c7;vertical-align:top">Entorno</td><td style="padding:9px 0;color:#e7edff;word-break:break-word">{{report_environment}}</td></tr>
      </table>
    </div>
    <div style="padding:16px 28px;background:#0b1222;color:#7183a8;font-size:12px">Enviado desde Modstack · {{to_email}}</div>
  </div>
</div>`;
