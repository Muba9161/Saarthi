import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ErrorCode,
  deviceTelemetryBatchSchema,
  gatewayEnvelopeSchema,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ok, parseBody } from '../../lib/http';
import {
  authenticateDeviceRequest,
  deviceRateLimitKey,
  requireDeviceContext,
} from '../devices/device-auth';
import type { AuthenticatedDevice } from '../devices/device.service';
import { ingest } from './gateway.service';

/**
 * Device gateway routes.
 *
 * Mounted apart from the rest of the API because the caller is a *device*, not
 * a person: there is no session and no cookie, and no identity from the user
 * auth system is accepted. A unit presents its own credentials and gets back a
 * small JSON acknowledgement it can log.
 *
 * Security posture:
 *
 *  * `app.authenticate` is deliberately **not** registered on this plugin.
 *    Device credentials are the only accepted identity here.
 *  * Its own rate limit, keyed on the device rather than the address — a fleet
 *    behind one 4G APN shares an IP, and one noisy unit must not throttle every
 *    other truck on that network.
 *  * Failures are uniform. Unknown device, wrong secret and suspended device all
 *    return the same 401, so the endpoint cannot be used to discover which
 *    device identifiers exist.
 */

const gatewayLogger = logger.child({ module: 'device-gateway-http' });

interface Submission {
  /** Whatever the adapter for this device should parse. */
  payload: unknown;
  /** Monotonic counter for replay rejection, when the caller supplied one. */
  sequence: number | null;
}

/**
 * Read a telemetry submission in either accepted shape.
 *
 * Two clients post here and they carry different baggage. Embedded firmware
 * sends the envelope — `{ deviceId, sequence, payload }` — because it has to
 * repeat its own identifier for a transport that may not preserve headers, and
 * its `payload` is whatever that vendor's adapter understands. The Saarthi
 * Device app sends `{ frames: [...] }` directly, because it already
 * authenticated with a bearer token and repeating its identity in the body
 * would be ceremony with no purpose.
 *
 * Both land in the same gateway, the same adapter registry and the same rule
 * engine. Giving the app its own endpoint would have meant two ingestion paths
 * that drift apart, and the second one always drifts.
 */
function readSubmission(body: unknown, authenticatedIdentifier: string): Submission {
  const hasDeviceId =
    body !== null &&
    typeof body === 'object' &&
    'deviceId' in (body as Record<string, unknown>);

  if (!hasDeviceId) {
    const batch = parseBody(deviceTelemetryBatchSchema, body);
    return { payload: { frames: batch.frames }, sequence: null };
  }

  const envelope = parseBody(gatewayEnvelopeSchema, body);

  // The credential decides which device this is, never the body. A unit that
  // authenticates as A cannot submit telemetry as B.
  if (envelope.deviceId !== authenticatedIdentifier) {
    gatewayLogger.warn(
      { authenticated: authenticatedIdentifier, claimed: envelope.deviceId },
      'Device attempted to submit telemetry for a different identifier',
    );
    throw errors.forbidden('A device may only submit telemetry for itself.');
  }

  return { payload: envelope.payload, sequence: envelope.sequence ?? null };
}

/**
 * Authenticate the caller as a device.
 *
 * Delegates to the shared device authenticator, which accepts the printed
 * identifier and secret — as dedicated headers or HTTP Basic, which is all
 * embedded firmware can manage — as well as a short-lived bearer token, which
 * is what an app on a phone should be using instead of putting a long-lived
 * secret on the wire sixty times a minute.
 *
 * A device that has enrolled but never paired is refused here, because there is
 * no device record to attribute anything to. A device that *is* registered but
 * has no current vehicle is deliberately let through, so `ingest` records the
 * refusal against it — a unit still reporting after it was removed from a truck
 * is worth seeing on its event log rather than losing to a bare 4xx.
 */
async function requireDevice(request: FastifyRequest): Promise<AuthenticatedDevice> {
  return requireDeviceContext(await authenticateDeviceRequest(request));
}

export async function deviceGatewayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Submit telemetry.
   *
   * Accepts one reading or a batch collected while the unit was out of
   * coverage. The response is intentionally terse — embedded firmware has to
   * parse it on a microcontroller.
   */
  app.post(
    '/telemetry',
    {
      config: {
        rateLimit: {
          // A device reporting once a second needs 60/min; this allows headroom
          // for batch catch-up after a signal outage without letting one unit
          // saturate ingestion.
          max: 240,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) => deviceRateLimitKey(request),
        },
      },
    },
    async (request, reply) => {
      const device = await requireDevice(request);
      const submission = readSubmission(request.body, device.deviceIdentifier);

      const outcome = await ingest(device, submission.payload, {
        sequence: submission.sequence,
        // Only the simulator sets this, and only in demo mode. Physical
        // hardware and app-based devices are never recorded as simulated —
        // partially-simulated readings are marked per metric instead.
        simulated: false,
      });

      return ok(reply, {
        accepted: outcome.accepted,
        rejected: outcome.rejected,
        // Distinct from `rejected` so a device replaying a buffer can tell
        // "Saarthi already had this" from "Saarthi refused this", and stop
        // retrying the former.
        duplicates: outcome.duplicates,
        alerts: outcome.alertsRaised,
        // Returned so a field engineer reading device logs can see why a
        // reading was refused without needing access to Saarthi.
        reasons: outcome.reasons.slice(0, 5),
      });
    },
  );

  /**
   * Credential check.
   *
   * Lets an installer confirm a unit is provisioned correctly before driving
   * away, without submitting a fabricated reading to do it.
   */
  app.post('/verify', async (request, reply) => {
    const device = await requireDevice(request);
    return ok(reply, {
      deviceIdentifier: device.deviceIdentifier,
      status: device.status,
      assigned: device.vehicleId !== null,
      provider: device.provider,
      /** Where to send telemetry, echoed for firmware configuration. */
      telemetryEndpoint: `${config.server.apiUrl}/api/v1/device-gateway/telemetry`,
    });
  });

  // A device that gets the path wrong should be told plainly rather than
  // receiving the SPA's 404 page.
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Unknown device gateway endpoint. Telemetry is posted to /telemetry.',
      },
    }),
  );
}
