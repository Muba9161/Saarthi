import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DeviceType,
  Feature,
  Permission,
  createPairingTokenSchema,
  hasPermission,
  idParamSchema,
  unpairDeviceFromDeviceSchema,
  uuidSchema,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { publicApiUrl } from '../../lib/public-url';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as pairingService from './pairing.service';

/** Both ids in the path: the vehicle being looked at, and the device on it. */
const vehicleDeviceParamsSchema = z.object({ id: uuidSchema, deviceId: uuidSchema });

/**
 * Vehicle → Hardware → Add Device.
 *
 * Mounted under `/fleet/vehicles` because that is where the question is asked:
 * a person looking at a truck decides to connect something to *that truck*, and
 * the pairing code exists only in relation to it.
 *
 * Two grants meet here, and the split matters.
 *
 * `devices.assign` is Saarthi-side: a Freematics or a YC06 is a physical asset
 * Saarthi ships, tracks and supports, so fitting one stays central. That rule
 * is unchanged.
 *
 * `devices.pair` is the fleet's own: connecting a phone somebody already owns,
 * running the Saarthi Device app, to a truck in their own yard. Requiring a
 * support ticket for that would defeat the entire purpose of a test device. The
 * boundary between the two is the device *type* — a caller holding only
 * `devices.pair` can issue codes for app-based units and nothing else, so the
 * permission cannot be used to claim provisioned hardware.
 *
 * It is deliberately not `devices.read`: a pairing code is a bearer capability,
 * and anyone who can produce one can attach a device to a vehicle.
 */

/** Device types a fleet may pair on its own authority. */
const SELF_PAIRABLE_TYPES: DeviceType[] = [DeviceType.MOBILE_TEST_DEVICE];

export async function vehiclePairingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * Issue a pairing code for this vehicle.
   *
   * The raw token comes back exactly once, for the QR. Re-opening the screen
   * issues a fresh code and cancels the previous one, so there is never more
   * than one live code per vehicle — two live QRs for one truck is how the
   * wrong phone ends up fitted to it.
   */
  app.post(
    '/:id/pairing-token',
    {
      preHandler: [
        requirePermission(Permission.DEVICES_PAIR, Permission.DEVICES_ASSIGN),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
      // A pairing code is a credential. Ten a minute is far more than fitting
      // hardware ever needs, and low enough that a loop cannot mint hundreds.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(createPairingTokenSchema, request.body ?? {});

      // The type boundary, enforced here rather than in the service because it
      // is a question about the caller, not about the vehicle. A fleet may pair
      // its own phones; fitting provisioned hardware still needs the central
      // grant.
      if (
        !SELF_PAIRABLE_TYPES.includes(input.deviceType) &&
        !hasPermission(auth.permissions, Permission.DEVICES_ASSIGN)
      ) {
        throw errors.forbidden(
          `Pairing a ${input.deviceType.toLowerCase().replace(/_/g, ' ')} is done by Saarthi when the unit is installed. ` +
            'You can pair a mobile test device to this vehicle yourself.',
        );
      }

      const issued = await pairingService.createPairingToken(
        auth,
        id,
        input,
        publicApiUrl(request),
      );

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_ASSIGNED,
        entityType: 'DevicePairingToken',
        entityId: issued.id,
        // The token itself is never audited — it is the credential.
        after: {
          vehicleId: id,
          deviceType: issued.deviceType,
          expiresAt: issued.expiresAt,
        },
      });

      return created(reply, issued);
    },
  );

  /** Pairing history for this vehicle. Raw tokens never appear here. */
  /**
   * Disconnect an app-based device from this vehicle.
   *
   * Guarded by `devices.pair` — the same grant that issues the code in the
   * first place. Gating this on `devices.assign` instead meant a fleet could
   * pair a phone and then never remove it, which permanently occupied the
   * vehicle's single telemetry slot and made the feature a one-way door.
   */
  app.post(
    '/:id/devices/:deviceId/unpair',
    {
      preHandler: [
        requirePermission(Permission.DEVICES_PAIR, Permission.DEVICES_ASSIGN),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { deviceId } = parseParams(vehicleDeviceParamsSchema, request.params);
      const input = parseBody(unpairDeviceFromDeviceSchema, request.body ?? {});

      const identity = await pairingService.unpairDeviceFromDashboard(
        auth,
        deviceId,
        input.reason ?? null,
      );

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_UNASSIGNED,
        entityType: 'HardwareDevice',
        entityId: deviceId,
        after: { reason: input.reason ?? null, via: 'dashboard' },
      });

      return ok(reply, identity);
    },
  );

  app.get(
    '/:id/pairing-tokens',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await pairingService.listPairingTokens(auth, id));
    },
  );
}
