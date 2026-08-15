import crypto from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { AccessTokenClaims, RoleName } from '@saarthi/shared';
import { config } from '../config/env';
import { errors } from '../lib/errors';

/**
 * Token strategy:
 *  - short-lived signed JWT access token carried in the Authorization header;
 *  - long-lived opaque refresh token stored only as a SHA-256 hash in
 *    `sessions`, delivered to the browser in an httpOnly cookie.
 * An attacker who reads the database still cannot mint a usable refresh token.
 */

const ISSUER = 'saarthi';
const AUDIENCE = 'saarthi-api';

export interface AccessTokenInput {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  roles: RoleName[];
}

export function signAccessToken(input: AccessTokenInput): { token: string; expiresIn: number } {
  const options: SignOptions = {
    expiresIn: config.auth.accessTtl as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: input.userId,
  };

  const token = jwt.sign(
    {
      sid: input.sessionId,
      org: input.organizationId,
      roles: input.roles,
    },
    config.auth.accessSecret,
    options,
  );

  const decoded = jwt.decode(token) as JwtPayload | null;
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, config.auth.accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;

    if (!payload.sub || typeof payload.sid !== 'string') {
      throw errors.tokenInvalid();
    }

    return {
      sub: payload.sub,
      sid: payload.sid,
      org: typeof payload.org === 'string' ? payload.org : null,
      roles: Array.isArray(payload.roles) ? (payload.roles as RoleName[]) : [],
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw errors.tokenExpired();
    if (error instanceof jwt.JsonWebTokenError) throw errors.tokenInvalid();
    throw error;
  }
}

/** Opaque refresh token: 48 random bytes, returned once, stored hashed. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Parse "30d" / "12h" / "15m" / "900s" into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhdw])$/i.exec(value.trim());
  if (!match?.[1] || !match?.[2]) {
    const seconds = Number.parseInt(value, 10);
    if (Number.isFinite(seconds)) return seconds * 1000;
    throw new Error(`Invalid duration: "${value}"`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return amount * (multipliers[unit] ?? 1000);
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + parseDuration(config.auth.refreshTtl));
}

/** Single-use, time-boxed token for password reset links. */
export function generateOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = crypto.randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Human-friendly fleet invite code, e.g. "SR-7KQ2XD". */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[bytes[index]! % alphabet.length];
  }
  return `SR-${code}`;
}
