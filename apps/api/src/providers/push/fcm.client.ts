import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { logger } from '../../lib/logger';

/**
 * Firebase Cloud Messaging, HTTP v1, with no SDK: a service-account JWT is
 * exchanged for an access token (cached until shortly before it expires), and
 * each message is one POST. Node's own crypto signs the JWT.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Refresh this long before Google's hour-long token runs out. */
const EARLY_REFRESH_MS = 5 * 60 * 1000;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** How one send went: delivered, the token is dead and should be forgotten, or it failed for now. */
export type PushOutcome = 'sent' | 'unregistered' | 'failed';

export interface PushPayload {
  /** FCM data values are strings only. */
  data: Record<string, string>;
}

/** A sender, so tests can stand in for Firebase. */
export interface PushSender {
  send(token: string, payload: PushPayload): Promise<PushOutcome>;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export class FcmClient implements PushSender {
  private readonly account: ServiceAccount;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(serviceAccountPath: string) {
    const parsed = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('FCM_SERVICE_ACCOUNT_PATH is not a Firebase service-account key file.');
    }
    this.account = parsed as ServiceAccount;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + EARLY_REFRESH_MS) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({ iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    const signature = base64url(createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.account.private_key));

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
    });
    if (!response.ok) throw new Error(`Firebase sign-in failed (${response.status}).`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async send(token: string, payload: PushPayload): Promise<PushOutcome> {
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
          // Data only, at high priority: the app draws the notification itself,
          // so it looks the same and opens the same screen whether it was running or not.
          body: JSON.stringify({ message: { token, data: payload.data, android: { priority: 'HIGH' } } }),
        },
      );
      if (response.ok) return 'sent';
      // 404 UNREGISTERED: the app was uninstalled or the token rotated.
      if (response.status === 404) return 'unregistered';
      const detail = await response.text();
      if (detail.includes('UNREGISTERED')) return 'unregistered';
      logger.warn({ status: response.status }, 'Push not delivered');
      return 'failed';
    } catch (error) {
      logger.warn({ err: error }, 'Push not delivered');
      return 'failed';
    }
  }
}
