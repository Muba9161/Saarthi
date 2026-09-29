import type { OutgoingEmail } from './smtp-email';
import { brandedEmailHtml, escapeHtml } from './email-layout';

/**
 * A branded email that asks the reader to do one thing — follow a link.
 *
 * Password resets and salesperson signups are both this shape.
 */

export function actionEmail(input: {
  to: string;
  subject: string;
  greeting: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  /** Shown under the button: expiry, and what to do if it was not them. */
  footnote: string;
}): OutgoingEmail {
  const text = [
    input.greeting,
    '',
    input.intro,
    '',
    `${input.actionLabel}: ${input.actionUrl}`,
    '',
    input.footnote,
    '',
    'VorldX Saarthi',
  ].join('\n');

  const html = brandedEmailHtml(`            <tr><td style="font-size:16px;padding-bottom:12px;">${escapeHtml(input.greeting)}</td></tr>
            <tr><td style="font-size:15px;line-height:22px;color:#4a5068;padding-bottom:24px;">${escapeHtml(input.intro)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#3b47c9;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:10px;">${escapeHtml(input.actionLabel)}</a>
              </td>
            </tr>
            <tr><td style="font-size:13px;line-height:20px;color:#7a8099;">${escapeHtml(input.footnote)}</td></tr>
            <tr><td style="font-size:12px;line-height:18px;color:#9aa0b5;padding-top:24px;">If the button does not work, open this link: ${escapeHtml(input.actionUrl)}</td></tr>`);

  return { to: input.to, subject: input.subject, text, html };
}
