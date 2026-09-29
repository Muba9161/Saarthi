import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  hasPermission,
  idParamSchema,
  shareVehicleSchema,
  sharedFuelSchema,
  sharedMaintenanceSchema,
  sharedTripSchema,
} from '@saarthi/shared';
import { created, noContent, ok, parseBody, parseParams } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as shareService from './vehicle-share.service';
import * as sharedVehicleService from './shared-vehicle.service';

/**
 * Vehicle sharing, mounted at `/fleet/sharing`.
 *
 * Only for Personal and Business plans — on both sides, since a Free account
 * receiving a shared vehicle would be running one for nothing. The owner's
 * endpoints also need the right to edit vehicles; the shared person's need
 * nothing beyond an accepted share, which `requireActiveShare` checks.
 */
export async function vehicleSharingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireFeature(Feature.VEHICLE_SHARING));

  // --- The owner --------------------------------------------------------------

  app.get(
    '/vehicles/:id/shares',
    { preHandler: requirePermission(Permission.VEHICLES_UPDATE) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await shareService.listShares(requireAuth(request), id));
    },
  );

  app.post(
    '/vehicles/:id/shares',
    {
      preHandler: requirePermission(Permission.VEHICLES_UPDATE),
      // Each invite names an email, so it is kept slow enough not to be a way
      // of checking which addresses have Saarthi accounts.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const { email } = parseBody(shareVehicleSchema, request.body);
      const share = await shareService.shareVehicle(auth, id, email);
      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_SHARED,
        entityType: 'Vehicle',
        entityId: id,
        after: { shareId: share.id },
      });
      return created(reply, share);
    },
  );

  /** Stop sharing — the owner's account, or the person leaving it. */
  app.delete('/shares/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await shareService.endShare(
      auth,
      id,
      hasPermission(auth.permissions, Permission.VEHICLES_UPDATE),
    );
    await auditFromRequest(request, {
      action: AuditAction.VEHICLE_SHARE_ENDED,
      entityType: 'VehicleShare',
      entityId: id,
    });
    return noContent(reply);
  });

  // --- The person it is shared with -----------------------------------------------

  app.get('/shared-with-me', async (request, reply) =>
    ok(reply, await shareService.sharedWithMe(requireAuth(request))),
  );

  for (const [path, accept] of [
    ['accept', true],
    ['decline', false],
  ] as const) {
    app.post(`/shares/:id/${path}`, async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await shareService.respondToShare(auth, id, accept);
      await auditFromRequest(request, {
        action: accept ? AuditAction.VEHICLE_SHARE_ACCEPTED : AuditAction.VEHICLE_SHARE_DECLINED,
        entityType: 'VehicleShare',
        entityId: id,
      });
      return noContent(reply);
    });
  }

  app.get('/shares/:id/vehicle', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await sharedVehicleService.getSharedVehicle(requireAuth(request), id));
  });

  app.get('/shares/:id/trips', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await sharedVehicleService.listSharedTrips(requireAuth(request), id));
  });

  app.post('/shares/:id/trips', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(sharedTripSchema, request.body);
    const trip = await sharedVehicleService.createSharedTrip(auth, id, input);
    await auditFromRequest(request, {
      action: AuditAction.TRIP_CREATED,
      entityType: 'Trip',
      entityId: trip.id,
      after: { reference: trip.reference, viaShareId: id },
    });
    return created(reply, trip);
  });

  app.get('/shares/:id/fuel', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await sharedVehicleService.listSharedFuel(requireAuth(request), id));
  });

  app.post('/shares/:id/fuel', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(sharedFuelSchema, request.body);
    return created(
      reply,
      await sharedVehicleService.createSharedFuel(requireAuth(request), id, input),
    );
  });

  app.get('/shares/:id/maintenance', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await sharedVehicleService.listSharedMaintenance(requireAuth(request), id));
  });

  app.post('/shares/:id/maintenance', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(sharedMaintenanceSchema, request.body);
    return created(
      reply,
      await sharedVehicleService.createSharedMaintenance(requireAuth(request), id, input),
    );
  });
}
