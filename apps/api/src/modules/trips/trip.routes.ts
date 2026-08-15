import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  TripStatus,
  createTripSchema,
  idParamSchema,
  tripListQuerySchema,
  tripTransitionSchema,
  updateTripSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as tripService from './trip.service';
import * as trackingService from '../tracking/tracking.service';

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.TRIPS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = parseQuery(tripListQuerySchema, request.query);
    const result = await tripService.listTrips(auth, query);
    return paginated(reply, result.items, result.pagination);
  });

  app.get(
    '/active',
    { preHandler: requirePermission(Permission.TRIPS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await tripService.activeTrips(organizationId));
    },
  );

  // The driver app's home screen.
  app.get(
    '/current',
    { preHandler: requirePermission(Permission.TRIPS_DRIVE, Permission.TRIPS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      if (!auth.driverId) return ok(reply, null);
      return ok(reply, await tripService.currentTripForDriver(auth.driverId));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.TRIPS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createTripSchema, request.body);
      const trip = await tripService.createTrip(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.TRIP_CREATED,
        entityType: 'Trip',
        entityId: trip.id,
        after: { reference: trip.reference, truckId: input.truckId },
      });

      return created(reply, trip);
    },
  );

  app.get('/:id', { preHandler: requirePermission(Permission.TRIPS_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    return ok(reply, await tripService.getTrip(auth, id));
  });

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.TRIPS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTripSchema, request.body);
      const trip = await tripService.updateTrip(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TRIP_UPDATED,
        entityType: 'Trip',
        entityId: id,
        after: input,
      });

      return ok(reply, trip);
    },
  );

  // Generic transition plus explicit shortcuts the driver app uses.
  app.post(
    '/:id/transition',
    { preHandler: requirePermission(Permission.TRIPS_MANAGE, Permission.TRIPS_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(tripTransitionSchema, request.body);
      const trip = await tripService.transitionTrip(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TRIP_STATUS_CHANGED,
        entityType: 'Trip',
        entityId: id,
        organizationId: trip.organizationId,
        after: { status: input.status },
      });

      return ok(reply, trip);
    },
  );

  const shortcut = (path: string, status: TripStatus) => {
    app.post(
      path,
      { preHandler: requirePermission(Permission.TRIPS_MANAGE, Permission.TRIPS_DRIVE) },
      async (request, reply) => {
        const auth = requireAuth(request);
        const { id } = parseParams(idParamSchema, request.params);
        const body = (request.body ?? {}) as { note?: string; latitude?: number; longitude?: number };
        const trip = await tripService.transitionTrip(auth, id, {
          status,
          ...(body.note ? { note: body.note } : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
        });

        await auditFromRequest(request, {
          action: AuditAction.TRIP_STATUS_CHANGED,
          entityType: 'Trip',
          entityId: id,
          organizationId: trip.organizationId,
          after: { status },
        });

        return ok(reply, trip);
      },
    );
  };

  shortcut('/:id/loading', TripStatus.LOADING);
  shortcut('/:id/start', TripStatus.STARTED);
  shortcut('/:id/arrive', TripStatus.ARRIVED);
  shortcut('/:id/unloading', TripStatus.UNLOADING);
  shortcut('/:id/complete', TripStatus.COMPLETED);
  shortcut('/:id/cancel', TripStatus.CANCELLED);

  // Trip replay is a Pro-tier feature.
  app.get(
    '/:id/replay',
    {
      preHandler: [
        requirePermission(Permission.TRACKING_HISTORY, Permission.TRIPS_READ),
        requireFeature(Feature.TRACKING_REPLAY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await trackingService.tripReplay(auth, id));
    },
  );
}
