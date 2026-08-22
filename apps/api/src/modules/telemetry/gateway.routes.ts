import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ErrorCode, gatewayEnvelopeSchema } from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ok, parseBody } from '../../lib/http';
import { authenticateDevice, type AuthenticatedDevice } from '../devices/device.service';
import { ingest } from './gateway.service';

/**
 * Device gateway routes.
 *
 * Mounted apart from the rest of the API because the caller is a *device*, not a
 * person: there is no session, no cookie and no bearer token from the auth
 * system. A unit presents its printed identifier and its secret, and gets back
 * a small JSON acknowledgement it can log.
 *
 * Security posture:
 *
 *  * `app.authenticate` is deliberately **not** registered on this plugin.
 *    Device credentials are the only accepted identity here.
 *  * Its own rate limit, well above a sane reporting interval but low enough to
 *    stop one unit flooding the ingestion path.
 *  * Failures are uniform. Unknown device, wrong secret and suspended device all
 *    return the same 401, so the endpoint cannot be used to discover which
 *    device identifiers exist.
 */

const gatewayLogger = logger.child({ module: 'device-gateway-http' });

/**
 * Read device credentials.
 *
 * Two forms are accepted because embedded firmware varies in what it can send:
 * dedicated headers, or HTTP Basic. Both carry the same pair.
 */
function readCredentials(request: FastifyRequest): { id: string; secret: string } | null {
  const headers = request.headers;

  const headerId = headers['x-device-id'];
  const headerSecret = headers['x-device-secret'];
  if (typeof headerId === 'string' && typeof headerSecret === 'string') {
    return { id: headerId.trim(), secret: headerSecret };
  }

  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > 0) {
        return { id: decoded.slice(0, separator).trim(), secret: decoded.slice(separator + 1) };
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function requireDevice(request: FastifyRequest): Promise<AuthenticatedDevice> {
  const credentials = readCredentials(request);
  if (!credentials || !credentials.id || !credentials.secret) {
    throw errors.unauthenticated('Device credentials are required.');
  }

  const device = await authenticateDevice(credentials.id, credentials.secret);
  if (!device) {
    // Uniform failure: never reveal whether the identifier exists.
    throw errors.unauthenticated('Device credentials were not recognised.');
  }
  return device;
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
          keyGenerator: (request: FastifyRequest) => {
            const id = request.headers['x-device-id'];
            return typeof id === 'string' ? `device:${id}` : (request.ip ?? 'unknown');
          },
        },
      },
    },
    async (request, reply) => {
      const device = await requireDevice(request);
      const envelope = parseBody(gatewayEnvelopeSchema, request.body);

      // The credential decides which device this is, never the body. A unit
      // that authenticates as A cannot submit telemetry as B.
      if (envelope.deviceId !== device.deviceIdentifier) {
        gatewayLogger.warn(
          { authenticated: device.deviceIdentifier, claimed: envelope.deviceId },
          'Device attempted to submit telemetry for a different identifier',
        );
        throw errors.forbidden('A device may only submit telemetry for itself.');
      }

      const outcome = await ingest(device, envelope.payload, {
        sequence: envelope.sequence ?? null,
        // Only the simulator sets this, and only in demo mode. Physical
        // hardware is never recorded as simulated.
        simulated: false,
      });

      return ok(reply, {
        accepted: outcome.accepted,
        rejected: outcome.rejected,
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
