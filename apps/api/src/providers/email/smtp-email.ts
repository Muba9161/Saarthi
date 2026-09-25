import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * Outgoing email over SMTP — Google (Gmail / Workspace) by default.
 *
 * One transport for the whole process, created on first use so a deployment
 * that never sends mail never opens a connection. The password is an app
 * password held in configuration; it is never logged.
 */

const emailLogger = logger.child({ module: 'email' });

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: Transporter | null = null;

function transporter(): Transporter {
  transport ??= nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: { user: config.email.user, pass: config.email.password },
  });
  return transport;
}

/** True when this deployment has SMTP credentials and can send email. */
export function emailConfigured(): boolean {
  return config.email.configured;
}

/**
 * Send one email. Throws when email is not configured or the SMTP server
 * refuses it — callers decide whether that is fatal for what they are doing.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  if (!config.email.configured) {
    throw errors.providerNotConfigured('smtp', 'Email is not set up on this server yet.');
  }
  try {
    await transporter().sendMail({ from: config.email.from, ...message });
    emailLogger.info({ to: message.to, subject: message.subject }, 'Email sent');
  } catch (error) {
    emailLogger.error({ err: error, subject: message.subject }, 'Email could not be sent');
    throw errors.provider('smtp', 'The email could not be sent. Please try again shortly.', error);
  }
}
