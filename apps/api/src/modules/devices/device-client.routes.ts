import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  acknowledgeDeviceCommandSchema,
  deviceHeartbeatSchema,
  deviceLocationBatchSchema,
  devicePublishTicketSchema,
  deviceSosSchema,
  deviceTokenRequestSchema,
  enrolDeviceSchema,
  idParamSchema,
  pairDeviceSchema,
  unpairDeviceFromDeviceSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import { ingest } from '../telemetry/gateway.service';
import { triggerSosFromDevice } from '../sos/sos.service';
import {
  authenticateDeviceRequest,
  deviceRateLimitKey,
  requireAssignedDevice,
  requireDeviceContext,
} from './device-auth';
import { acknowledgeCommand, collectCommands } from './device-command.service';
import { keepStreamSessionAlive, startPublishing, stopPublishing } from './camera.service';
import { recordHeartbeat } from './device-status.service';
import { enrolDevice, issueDeviceToken } from './enrolment.service';
import {
  deviceConfig,
  deviceIdentity,
  redeemPairingToken,
  unpairSelf,
} from './pairing.service';

/**
 * The Saarthi Device client surface.
 *
 * Mounted alongside the telemetry gateway under `/device-gateway`, and for the
 * same reason: the caller is a *device*, not a person. `app.authenticate` is
 * deliberately never registered on this plugin — a user session is not an
 * accepted identity here, and a device credential is not accepted anywhere
 * else.
 *
 * Every route is rate limited on the presented device identifier rather than on
 * the address, because a fleet behind one 4G APN shares an IP and a single
 * misbehaving unit must not throttle every other truck on that network. The one
 * exception is enrolment, which has no identifier yet and is therefore limited
 * by address — the only unauthenticated endpoint in the file, and the tightest.
 */

/**
 * Credentials presented in the request body rather than in headers.
 *
 * Returns `undefined` rather than throwing on a malformed body: this is a
 * fallback, and a bad body should end in the same uniform 401 as a bad secret,
 * not in a validation error that tells the caller which field it got wrong.
 */
function readBodyCredentials(body: unknown): { id: string; secret: string } | undefined {
  const parsed = deviceTokenRequestSchema.safeParse(body);
  if (!parsed.success) return undefined;
  return { id: parsed.data.deviceIdentifier, secret: parsed.data.secret };
}

/** Rate-limit configuration for an authenticated device route. */
function deviceLimit(max: number, timeWindow = '1 minute') {
  return {
    rateLimit: {
      max,
      timeWindow,
      keyGenerator: (request: FastifyRequest) => deviceRateLimitKey(request),
    },
  };
}

export async function deviceClientRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tolerate an empty JSON body.
   *
   * Several routes here carry their whole request in headers, and an HTTP
   * client that sends `Content-Type: application/json` with no body is
   * completely ordinary — OkHttp does it for a POST with an empty request body,
   * and so does curl. Fastify's default parser treats that as malformed, which
   * would turn a correct device into a 400 nobody could diagnose from the
   * device side.
   *
   * Encapsulated to this plugin, so the rest of the API keeps the strict
   * behaviour a browser client should be held to.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string | Buffer, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      if (text.trim() === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(errors.validation('The request body is not valid JSON.'), undefined);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Enrolment and credentials
  // -------------------------------------------------------------------------

  /**
   * Claim a device identity.
   *
   * The only unauthenticated route on the device surface. It creates no tenant
   * data — see `enrolment.service.ts` for why that matters — and is limited
   * hard by address, because an open endpoint without a ceiling is a storage
   * exhaustion vector regardless of how little each call writes.
   *
   * Idempotent on `installationId`: an app that reinstalls keeps its identity
   * rather than accumulating a new one on every launch.
   */
  app.post(
    '/enroll',
    {
      config: {
        rateLimit: {
          max: config.device.enrolmentRateLimitMax,
          timeWindow: config.device.enrolmentRateLimitWindow,
          keyGenerator: (request: FastifyRequest) =>
            `device-enrol:${request.clientIp ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(enrolDeviceSchema, request.body);
      const result = await enrolDevice(input, { ipAddress: request.clientIp ?? null });
      return created(reply, result);
    },
  );

  /**
   * Exchange the device secret for a short-lived access token.
   *
   * The secret then stays in secure storage instead of travelling on every
   * request, and the WebSocket handshake — which cannot carry headers — has
   * something to present.
   */
  app.post('/token', { config: deviceLimit(20) }, async (request, reply) => {
    const caller = await authenticateDeviceRequest(request, {
      // Credentials in the body as well as in headers. Some embedded HTTP
      // stacks cannot set custom headers at all, and refusing them here would
      // exclude hardware for no security benefit — the pair is the same secret
      // either way, over the same TLS.
      fallbackCredentials: readBodyCredentials(request.body),
    });
    const token = await issueDeviceToken(
      caller.kind === 'DEVICE'
        ? {
            kind: 'DEVICE',
            id: caller.id,
            deviceIdentifier: caller.deviceIdentifier,
            credentialVersion: caller.credentialVersion,
          }
        : {
            kind: 'PENDING_ENROLMENT',
            id: caller.id,
            deviceIdentifier: caller.deviceIdentifier,
          },
    );
    return ok(reply, token);
  });

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * What this device is, and what it is fitted to.
   *
   * Answers for a pending enrolment too — the app's first screen needs to show
   * an identity and an "unpaired" state before there is anything to pair to.
   */
  app.get('/me', { config: deviceLimit(60) }, async (request, reply) => {
    const caller = await authenticateDeviceRequest(request);

    if (caller.kind === 'PENDING_ENROLMENT') {
      return ok(reply, {
        deviceId: null,
        deviceIdentifier: caller.deviceIdentifier,
        provider: null,
        deviceType: caller.deviceType,
        role: null,
        status: 'PENDING',
        paired: false,
        organizationId: null,
        vehicle: null,
        cameras: [],
        lastSeenAt: null,
        lastTelemetryAt: null,
      });
    }

    return ok(reply, await deviceIdentity(caller.id));
  });

  /**
   * The settings this device must obey.
   *
   * Server-owned. A phone that chose its own reporting interval would be one a
   * fleet cannot slow down when the data bill arrives.
   */
  app.get('/config', { config: deviceLimit(60) }, async (request, reply) => {
    const device = requireAssignedDevice(await authenticateDeviceRequest(request));
    return ok(reply, await deviceConfig(device.id));
  });

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /**
   * Redeem a pairing QR.
   *
   * Accepts a pending enrolment as well as an established device, which is what
   * makes both the first pairing and a later reassignment the same operation
   * from the phone's point of view.
   *
   * Limited tightly: a pairing token is a bearer capability, and an unbounded
   * redemption endpoint is a way to brute-force one.
   */
  app.post('/pair', { config: deviceLimit(10) }, async (request, reply) => {
    const caller = await authenticateDeviceRequest(request);
    const input = parseBody(pairDeviceSchema, request.body);
    return created(reply, await redeemPairingToken(caller, input));
  });

  /**
   * Release this device's own assignment.
   *
   * Available to the device so that handing a phone back does not require
   * somebody at a desk. The assignment row is closed rather than deleted, so
   * the telemetry it produced stays attached to the vehicle that produced it.
   */
  app.post('/unpair', { config: deviceLimit(10) }, async (request, reply) => {
    const device = requireAssignedDevice(await authenticateDeviceRequest(request));
    const input = parseBody(unpairDeviceFromDeviceSchema, request.body ?? {});
    return ok(reply, await unpairSelf(device.id, input.reason ?? null));
  });

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  /**
   * Report that the device is alive, and how it is doing.
   *
   * Separate from telemetry because it answers a different question. Telemetry
   * silence means the vehicle is not moving, which for a truck parked overnight
   * is correct. Heartbeat silence means Saarthi has lost the unit. Only the
   * second needs anybody to know.
   */
  app.post(
    '/heartbeat',
    // Twice the nominal cadence, so a device catching up after a reconnect is
    // not throttled for doing the right thing.
    { config: deviceLimit(4) },
    async (request, reply) => {
      const device = requireAssignedDevice(await authenticateDeviceRequest(request));
      const input = parseBody(deviceHeartbeatSchema, request.body ?? {});
      return ok(reply, await recordHeartbeat(device, input));
    },
  );

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  /**
   * Submit GPS fixes.
   *
   * A convenience over `/telemetry` for the common case, and the only endpoint
   * a location-only client needs. It goes through exactly the same gateway,
   * adapter, validation and rule engine — the shape is narrower, the path is
   * not — so nothing downstream can tell the difference, and a device that
   * later starts sending engine data needs no new plumbing.
   *
   * Note what the payload does *not* contain: a vehicle id. The gateway
   * resolves that from the device's active assignment, so a compromised phone
   * cannot write into another truck's history by editing a field.
   */
  app.post(
    '/location',
    {
      config: deviceLimit(240),
    },
    async (request, reply) => {
      // Not `requireAssignedDevice`: an unpaired or suspended unit is passed
      // through to the gateway on purpose, so its refusal is recorded against
      // the device record instead of vanishing as a bare 4xx. A unit that keeps
      // trying to report after being removed is worth seeing.
      const device = requireDeviceContext(await authenticateDeviceRequest(request));
      const input = parseBody(deviceLocationBatchSchema, request.body);

      const outcome = await ingest(
        device,
        {
          frames: input.points.map((point) => ({
            eventId: point.eventId,
            recordedAt: point.recordedAt,
            location: {
              latitude: point.latitude,
              longitude: point.longitude,
              speedKph: point.speedKph,
              heading: point.heading,
              altitude: point.altitude,
              accuracy: point.accuracy,
              satellites: point.satellites,
            },
          })),
        },
        // A phone's GPS is a real measurement of a real vehicle. Only the engine
        // block it may also send is simulated, and that is recorded per metric.
        { simulated: false },
      );

      return ok(reply, summariseIngest(outcome));
    },
  );

  // Full frames — location, motion, health and simulated engine data — are
  // submitted to `POST /device-gateway/telemetry`, which is declared in
  // `gateway.routes.ts` and shared with fitted hardware. It accepts this
  // client's `{ frames: [...] }` batch as well as the firmware envelope, so
  // there is one ingestion endpoint rather than two that drift apart.

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * Collect outstanding instructions.
   *
   * The fallback for a device not holding a realtime socket, which on a mobile
   * network is most of them most of the time. Collecting marks the commands
   * delivered — from Saarthi's side that is what delivery means — and whether
   * the unit acted on them is reported separately, because the two fail
   * separately.
   */
  app.get('/commands', { config: deviceLimit(60) }, async (request, reply) => {
    const device = requireAssignedDevice(await authenticateDeviceRequest(request));
    return ok(reply, await collectCommands(device));
  });

  /**
   * Report what happened to one command.
   *
   * Idempotent: a device whose acknowledgement timed out on the way back will
   * send it again, and must not produce two audit entries or a contradictory
   * status.
   */
  app.post('/commands/:id/ack', { config: deviceLimit(60) }, async (request, reply) => {
    const device = requireAssignedDevice(await authenticateDeviceRequest(request));
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(acknowledgeDeviceCommandSchema, request.body);
    return ok(reply, await acknowledgeCommand(device, id, input));
  });

  // -------------------------------------------------------------------------
  // SOS
  // -------------------------------------------------------------------------

  /**
   * Raise an emergency.
   *
   * The most permissive write on the device surface, deliberately. Saarthi's
   * existing rule is that raising an alarm is never gated behind a plan, and the
   * same applies here: a device in trouble must not be refused because of an
   * entitlement. The rate limit is set to absorb a driver pressing the button
   * repeatedly — which is exactly what a frightened person does — rather than to
   * discourage it, and the service collapses repeats into the open incident
   * instead of opening six.
   *
   * The payload carries no vehicle, no driver and no recipient. All three are
   * resolved from the device's assignment, because recipient selection is a
   * decision about people's safety and does not belong on a handset.
   */
  app.post(
    '/sos',
    { config: deviceLimit(30) },
    async (request, reply) => {
      const device = requireAssignedDevice(await authenticateDeviceRequest(request));
      const input = parseBody(deviceSosSchema, request.body);
      return created(reply, await triggerSosFromDevice(device, input));
    },
  );

  // -------------------------------------------------------------------------
  // Live video
  // -------------------------------------------------------------------------

  /**
   * Get a credential to publish one camera.
   *
   * Video never passes through Saarthi — this returns a ticket the device
   * presents to a video gateway, and frames go device → gateway → browser. What
   * Saarthi keeps is the record that the camera was on, in the same access log
   * that records every time a person watched one. A lens pointed at a driver is
   * a surveillance capability, and the only thing that keeps it accountable is
   * a complete record, which has to include the times the device started it.
   *
   * Rate limited hard: a ticket is a camera credential, and a loop requesting
   * them would fill the access log with noise that hides a real pattern.
   */
  app.post(
    '/camera/publish-ticket',
    { config: deviceLimit(10) },
    async (request, reply) => {
      const device = requireAssignedDevice(await authenticateDeviceRequest(request));
      const input = parseBody(devicePublishTicketSchema, request.body);
      return created(reply, await startPublishing(device, input.channel));
    },
  );

  /**
   * Still publishing.
   *
   * The device's half of the same keep-alive the dashboard player sends. Without
   * it the sweep would close a session while the phone was still streaming, and
   * the camera's access log would record every stream as one ticket long
   * regardless of how long the camera was actually on — which, for a lens
   * pointed at a driver, is the number that matters most.
   */
  app.post(
    '/camera/sessions/:id/keepalive',
    { config: deviceLimit(120) },
    async (request, reply) => {
      const device = requireAssignedDevice(await authenticateDeviceRequest(request));
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await keepStreamSessionAlive(id, { deviceId: device.id }));
    },
  );

  /** Close a publishing session cleanly, so the access log has a real end time. */
  app.post(
    '/camera/sessions/:id/end',
    { config: deviceLimit(20) },
    async (request, reply) => {
      const device = requireAssignedDevice(await authenticateDeviceRequest(request));
      const { id } = parseParams(idParamSchema, request.params);
      await stopPublishing(device, id);
      return ok(reply, { ended: true });
    },
  );
}

/**
 * What the device is told about its own submission.
 *
 * Deliberately terse and deliberately complete: a client has to decide from
 * this whether to drop the events from its buffer or keep retrying them, and
 * that decision is wrong if `duplicates` is folded into either of the others.
 */
function summariseIngest(outcome: {
  accepted: number;
  rejected: number;
  duplicates: number;
  reasons: string[];
  alertsRaised: number;
}) {
  return {
    accepted: outcome.accepted,
    rejected: outcome.rejected,
    duplicates: outcome.duplicates,
    alerts: outcome.alertsRaised,
    // Returned so an engineer reading the device's own log can see why a frame
    // was refused without needing access to Saarthi.
    reasons: outcome.reasons.slice(0, 5),
  };
}
