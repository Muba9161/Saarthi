/**
 * The branded frame every Saarthi email sits in.
 *
 * Inline styles and a single table layout, because that is what email clients
 * render reliably. Callers pass pre-built `<tr>` rows and must escape every
 * value they interpolate with `escapeHtml`.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function brandedEmailHtml(rows: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#1f2433;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;">
            <tr><td style="font-size:18px;font-weight:bold;color:#3b47c9;padding-bottom:24px;">VorldX Saarthi</td></tr>
${rows}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
