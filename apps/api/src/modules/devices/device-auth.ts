import { randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import {
  DeviceAssignmentStatus,
  DeviceProvider,
  DeviceRole,
  DeviceStatus,
  type DeviceType,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { passwordHasher, verifyWithTimingGuard } from '../../auth/password';

/**
 * Device authentication.
 *
 * A device is not a person, and Saarthi treats the two as separate credential
 * populations with separate signing keys. Three things authenticate here, and
 * the differences between them are deliberate:
 *
 *  * **The device secret** — a bcrypt-hashed credential shown once. Embedded
 *    firmware sends it on every request, because a Freematics cannot run a
 *    token exchange. It is the credential of record.
 *  * **A device access token** — a short-lived JWT the secret buys. An app on a
 *    phone uses this instead, so the long-lived secret sits in secure storage
 *    and is not on the wire sixty times a minute. It is also the only thing a
 *    WebSocket handshake can carry, since a client cannot set headers there.
 *  * **A pending enrolment** — an identity that exists before it belongs to
 *    anyone. It can do exactly two things: read itself, and redeem a pairing
 *    token. Everything else refuses it, because it has no tenant to act in.
 *
 * Failures are uniform 401s throughout. Unknown identifier, wrong secret,
 * expired token and suspended device all read identically from outside, so this
 * surface cannot be used to discover which devices exist.
 */

const authLogger = logger.child({ module: 'device-auth' });

const ISSUER = 'saarthi';
const AUDIENCE = 'saarthi-device';

/**
 * What the caller is.
 *
 * `PENDING` carries no organization and no vehicle — the type makes that
 * unrepresentable rather than relying on every caller to remember it.
 */
export type DeviceAuthKind = 'DEVICE' | 'PENDING_ENROLMENT';

export interface AuthenticatedDeviceContext {
  kind: 'DEVICE';
  id: string;
  organizationId: string;
  deviceIdentifier: string;
  provider: DeviceProvider;
  deviceType: DeviceType;
  role: DeviceRole;
  status: DeviceStatus;
  credentialVersion: number;
  vehicleId: string | null;
  lastSequence: number | null;
  observedMetrics: string[];
  reportingIntervalSeconds: number | null;
}

export interface PendingEnrolmentContext {
  kind: 'PENDING_ENROLMENT';
  id: string;
  deviceIdentifier: string;
  installationId: string;
  deviceType: DeviceType;
}

export type DeviceCaller = AuthenticatedDeviceContext | PendingEnrolmentContext;

/**
 * Narrow a caller to a real, tenant-owning device.
 *
 * Says nothing about whether it is currently fitted to a vehicle — a device
 * that has been unpaired is still a device, and endpoints that want to record
 * why they refused it need the device record to record it against. Use
 * `requireAssignedDevice` when a vehicle is genuinely required.
 */
export function requireDeviceContext(caller: DeviceCaller): AuthenticatedDeviceContext {
  if (caller.kind !== 'DEVICE') {
    throw errors.businessRule(
      'This device has not been paired to a vehicle yet. Scan a pairing QR from the Saarthi dashboard first.',
    );
  }
  return caller;
}

/**
 * Require a device that is currently fitted to a vehicle.
 *
 * The distinction matters. A phone that has been unpaired still authenticates
 * perfectly well — it has to, or it could never pair again — but it has no
 * vehicle to configure for, no assignment to release and nothing for a
 * heartbeat to be about. Refusing it here, by name, is more useful than letting
 * it through to fail on a null further down.
 */
export function requireAssignedDevice(caller: DeviceCaller): AuthenticatedDeviceContext {
  const device = requireDeviceContext(caller);
  if (!device.vehicleId) {
    throw errors.businessRule(
      'This device is not paired to a vehicle. Scan a pairing QR from Vehicle → Hardware in the Saarthi dashboard.',
    );
  }
  return device;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** Cryptographically strong device secret, shown to the operator exactly once. */
export function generateDeviceSecret(): string {
  return randomBytes(24).toString('base64url');
}

export function hashDeviceSecret(secret: string): Promise<string> {
  return passwordHasher.hash(secret);
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export interface DeviceTokenClaims {
  /** Device or enrolment id. */
  sub: string;
  kind: DeviceAuthKind;
  /** Printed identifier, so logs are readable without another lookup. */
  did: string;
  /** Credential version the token was minted under. */
  cv: number;
  iat: number;
  exp: number;
}

export interface IssuedDeviceToken {
  accessToken: string;
  /** Seconds until expiry, so the client can schedule its own refresh. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export function signDeviceToken(input: {
  subject: string;
  kind: DeviceAuthKind;
  deviceIdentifier: string;
  credentialVersion: number;
}): IssuedDeviceToken {
  const options: SignOptions = {
    expiresIn: config.device.tokenTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: input.subject,
  };

  const accessToken = jwt.sign(
    { kind: input.kind, did: input.deviceIdentifier, cv: input.credentialVersion },
    config.device.jwtSecret,
    options,
  );

  return {
    accessToken,
    expiresIn: config.device.tokenTtlSeconds,
    tokenType: 'Bearer',
  };
}

export function verifyDeviceToken(token: string): DeviceTokenClaims {
  try {
    const payload = jwt.verify(token, config.device.jwtSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;

    if (
      !payload.sub ||
      typeof payload.did !== 'string' ||
      (payload.kind !== 'DEVICE' && payload.kind !== 'PENDING_ENROLMENT')
    ) {
      throw errors.tokenInvalid('This device token is not valid.');
    }

    return {
      sub: payload.sub,
      kind: payload.kind,
      did: payload.did,
      cv: typeof payload.cv === 'number' ? payload.cv : 0,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw errors.tokenExpired('This device token has expired. Exchange the device secret for a new one.');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw errors.tokenInvalid('This device token is not valid.');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const deviceSelection = {
  id: true,
  organizationId: true,
  deviceIdentifier: true,
  provider: true,
  deviceType: true,
  role: true,
  status: true,
  credentialVersion: true,
  lastSequence: true,
  observedMetrics: true,
  reportingIntervalSeconds: true,
  archivedAt: true,
  secretHash: true,
  assignments: {
    where: { status: DeviceAssignmentStatus.ACTIVE },
    select: { vehicleId: true },
    take: 1,
  },
} as const;

type DeviceRow = {
  id: string;
  organizationId: string;
  deviceIdentifier: string;
  provider: string;
  deviceType: string;
  role: string;
  status: string;
  credentialVersion: number;
  lastSequence: number | null;
  observedMetrics: string[];
  reportingIntervalSeconds: number | null;
  archivedAt: Date | null;
  secretHash: string;
  assignments: { vehicleId: string }[];
};

function toDeviceContext(device: DeviceRow): AuthenticatedDeviceContext {
  return {
    kind: 'DEVICE',
    id: device.id,
    organizationId: device.organizationId,
    deviceIdentifier: device.deviceIdentifier,
    provider: device.provider as DeviceProvider,
    deviceType: device.deviceType as DeviceType,
    role: device.role as DeviceRole,
    status: device.status as DeviceStatus,
    credentialVersion: device.credentialVersion,
    vehicleId: device.assignments[0]?.vehicleId ?? null,
    lastSequence: device.lastSequence,
    observedMetrics: device.observedMetrics,
    reportingIntervalSeconds: device.reportingIntervalSeconds,
  };
}

/**
 * Authenticate an identifier and secret pair.
 *
 * Tries the device registry first — the overwhelmingly common case — and falls
 * back to a pending enrolment. Returns `null` for every failure without
 * distinguishing them.
 */
export async function authenticateDeviceCredentials(
  deviceIdentifier: string,
  secret: string,
): Promise<DeviceCaller | null> {
  const device = await prisma.hardwareDevice.findUnique({
    where: { deviceIdentifier },
    select: deviceSelection,
  });

  if (device && !device.archivedAt) {
    const valid = await verifyWithTimingGuard(secret, device.secretHash);
    if (!valid) {
      authLogger.warn({ deviceIdentifier }, 'Device authentication failed');
      return null;
    }
    return toDeviceContext(device as DeviceRow);
  }

  const enrolment = await prisma.deviceEnrolment.findUnique({
    where: { deviceIdentifier },
    select: {
      id: true,
      deviceIdentifier: true,
      installationId: true,
      deviceType: true,
      secretHash: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!enrolment) {
    // Still spend the time a real comparison would, so a missing identifier and
    // a wrong secret cannot be told apart by how long the answer took.
    await verifyWithTimingGuard(secret, null);
    return null;
  }

  if (enrolment.status !== 'PENDING' || enrolment.expiresAt.getTime() < Date.now()) {
    await verifyWithTimingGuard(secret, null);
    authLogger.warn(
      { deviceIdentifier, status: enrolment.status },
      'Enrolment credential used after it stopped being valid',
    );
    return null;
  }

  const valid = await verifyWithTimingGuard(secret, enrolment.secretHash);
  if (!valid) {
    authLogger.warn({ deviceIdentifier }, 'Enrolment authentication failed');
    return null;
  }

  return {
    kind: 'PENDING_ENROLMENT',
    id: enrolment.id,
    deviceIdentifier: enrolment.deviceIdentifier,
    installationId: enrolment.installationId,
    deviceType: enrolment.deviceType as DeviceType,
  };
}

/**
 * Resolve a bearer device token to its caller.
 *
 * The credential version in the token is compared against the stored one, which
 * is what makes revocation immediate: rotating a secret, suspending a unit or
 * unpairing it raises the version, and every token minted before that stops
 * working on its next request rather than at its next expiry.
 */
export async function resolveDeviceToken(token: string): Promise<DeviceCaller | null> {
  const claims = verifyDeviceToken(token);

  if (claims.kind === 'PENDING_ENROLMENT') {
    const enrolment = await prisma.deviceEnrolment.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        deviceIdentifier: true,
        installationId: true,
        deviceType: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!enrolment || enrolment.status !== 'PENDING' || enrolment.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return {
      kind: 'PENDING_ENROLMENT',
      id: enrolment.id,
      deviceIdentifier: enrolment.deviceIdentifier,
      installationId: enrolment.installationId,
      deviceType: enrolment.deviceType as DeviceType,
    };
  }

  const device = await prisma.hardwareDevice.findUnique({
    where: { id: claims.sub },
    select: deviceSelection,
  });
  if (!device || device.archivedAt) return null;

  if (device.credentialVersion !== claims.cv) {
    authLogger.warn(
      { deviceIdentifier: device.deviceIdentifier, tokenVersion: claims.cv, current: device.credentialVersion },
      'Device token rejected: credentials have been rotated since it was issued',
    );
    return null;
  }

  return toDeviceContext(device as DeviceRow);
}

// ---------------------------------------------------------------------------
// Request-level extraction
// ---------------------------------------------------------------------------

interface PresentedCredentials {
  bearer?: string;
  pair?: { id: string; secret: string };
}

/**
 * Read whatever the caller presented.
 *
 * Three forms are accepted because the clients genuinely differ. A phone sends
 * a bearer token; a Freematics sends dedicated headers; something behind a
 * proxy that strips custom headers sends HTTP Basic. All three carry the same
 * two facts.
 */
export function readDeviceCredentials(request: FastifyRequest): PresentedCredentials {
  const headers = request.headers;
  const presented: PresentedCredentials = {};

  const authorization = headers.authorization;
  if (typeof authorization === 'string') {
    if (authorization.startsWith('Bearer ')) {
      presented.bearer = authorization.slice(7).trim();
    } else if (authorization.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator > 0) {
          presented.pair = {
            id: decoded.slice(0, separator).trim(),
            secret: decoded.slice(separator + 1),
          };
        }
      } catch {
        // A malformed header is simply no credential.
      }
    }
  }

  const headerId = headers['x-device-id'];
  const headerSecret = headers['x-device-secret'];
  if (typeof headerId === 'string' && typeof headerSecret === 'string') {
    presented.pair = { id: headerId.trim(), secret: headerSecret };
  }

  return presented;
}

/**
 * Authenticate the request as a device, or throw a uniform 401.
 *
 * Callers that need a *paired* device pass the result through
 * `requirePairedContext`; keeping the two steps separate is what lets the
 * pairing endpoint accept an identity that has no vehicle yet without every
 * other endpoint having to special-case it.
 */
export async function authenticateDeviceRequest(
  request: FastifyRequest,
  options: {
    /**
     * Credentials read from somewhere other than the headers.
     *
     * Used only by the token-exchange route, where some embedded HTTP stacks
     * cannot set custom headers at all. Never consulted when headers are
     * present, so a body cannot override a bearer token.
     */
    fallbackCredentials?: { id: string; secret: string } | undefined;
  } = {},
): Promise<DeviceCaller> {
  const presented = readDeviceCredentials(request);

  if (presented.bearer) {
    const caller = await resolveDeviceToken(presented.bearer);
    if (!caller) throw errors.unauthenticated('Device credentials were not recognised.');
    return caller;
  }

  const pair = presented.pair ?? options.fallbackCredentials;
  if (pair && pair.id && pair.secret) {
    const caller = await authenticateDeviceCredentials(pair.id, pair.secret);
    if (!caller) throw errors.unauthenticated('Device credentials were not recognised.');
    return caller;
  }

  throw errors.unauthenticated('Device credentials are required.');
}

/** Authenticate and require that the device is fitted to a vehicle. */
export async function authenticateAssignedDevice(
  request: FastifyRequest,
): Promise<AuthenticatedDeviceContext> {
  return requireAssignedDevice(await authenticateDeviceRequest(request));
}

/**
 * Rate-limit key for a device endpoint.
 *
 * Keyed on the presented identifier rather than the IP, because a fleet behind
 * one 4G APN shares an address and one noisy unit would otherwise throttle
 * every other truck on the same network.
 */
export function deviceRateLimitKey(request: FastifyRequest): string {
  const presented = readDeviceCredentials(request);
  if (presented.pair?.id) return `device:${presented.pair.id}`;
  if (presented.bearer) {
    try {
      const decoded = jwt.decode(presented.bearer) as JwtPayload | null;
      if (decoded && typeof decoded.did === 'string') return `device:${decoded.did}`;
    } catch {
      // Fall through to the address.
    }
  }
  return request.clientIp ?? request.ip ?? 'unknown';
}
