import type { OutgoingEmail } from './smtp-email';
import { brandedEmailHtml, escapeHtml } from './email-layout';

/**
 * A branded email carrying a one-time code the reader types back in — the
 * registration email check. The code is set large and spaced so it can be
 * read off a phone and typed on another device without mistakes.
 */
export function codeEmail(input: {
  to: string;
  subject: string;
  greeting: string;
  intro: string;
  code: string;
  /** Shown under the code: expiry, and what to do if it was not them. */
  footnote: string;
}): OutgoingEmail {
  const text = [
    input.greeting,
    '',
    input.intro,
    '',
    `Your code: ${input.code}`,
    '',
    input.footnote,
    '',
    'VorldX Saarthi',
  ].join('\n');

  const html = brandedEmailHtml(`            <tr><td style="font-size:16px;padding-bottom:12px;">${escapeHtml(input.greeting)}</td></tr>
            <tr><td style="font-size:15px;line-height:22px;color:#4a5068;padding-bottom:24px;">${escapeHtml(input.intro)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <div style="display:inline-block;background:#f4f5fb;border:1px solid #dfe2f2;border-radius:12px;padding:14px 24px;font-size:30px;font-weight:bold;letter-spacing:10px;color:#3b47c9;font-family:'Courier New',Courier,monospace;">${escapeHtml(input.code)}</div>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:20px;color:#7a8099;">${escapeHtml(input.footnote)}</td></tr>`);

  return { to: input.to, subject: input.subject, text, html };
}
