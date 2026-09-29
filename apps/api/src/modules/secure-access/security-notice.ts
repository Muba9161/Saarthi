import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { actionEmail } from '../../providers/email/action-email';
import { emailConfigured, sendEmail } from '../../providers/email/smtp-email';

const noticeLogger = logger.child({ module: 'security-notice' });

/**
 * Email somebody that a security-sensitive thing just happened on their
 * account — their PIN set or locked, a passkey added, RC details switched on
 * for QR scans — so that if it was not them, they hear about it.
 *
 * Fire and forget: the action has already happened, and failing it because the
 * mail server is slow would protect nobody. A deployment without SMTP logs the
 * skip rather than pretending to have sent it.
 */
export function sendSecurityNotice(
  user: { email: string; firstName: string },
  notice: { subject: string; intro: string },
): void {
  if (!emailConfigured()) {
    noticeLogger.info(
      { subject: notice.subject },
      'Email not configured; security notice not sent',
    );
    return;
  }

  void sendEmail(
    actionEmail({
      to: user.email,
      subject: notice.subject,
      greeting: `Hello ${user.firstName},`,
      intro: notice.intro,
      actionLabel: 'Review your security settings',
      actionUrl: `${config.server.frontendUrl.replace(/\/$/, '')}/settings/security`,
      footnote:
        'If this was not you, change your password and your secure PIN straight away.',
    }),
  ).catch((error: unknown) =>
    noticeLogger.warn({ err: error, subject: notice.subject }, 'Security notice could not be sent'),
  );
}
