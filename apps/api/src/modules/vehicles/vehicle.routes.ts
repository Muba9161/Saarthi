import type { FastifyInstance } from 'fastify';
import {
  Permission,
  assignDriverSchema,
  createVehicleSchema,
  idParamSchema,
  updateTruckStatusSchema,
  updateVehicleSchema,
  vehicleListQuerySchema,
} from '@saarthi/shared';
import {
  created,
  noContent,
  ok,
  paginated,
  parseBody,
  parseParams,
  parseQuery,
} from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
// The lifecycle half of a vehicle — status, archive, driver assignment — is
// the same code the truck surface runs, because it is the same row. Delegated
// rather than reimplemented: two copies of "put this driver in that vehicle"
// is how the two surfaces would start disagreeing about who is driving what.
import * as truckService from '../trucks/truck.service';
import * as vehicleService from './vehicle.service';

/**
 * Generalized vehicle routes, mounted at `/fleet/vehicles`.
 *
 * These operate on the same rows as `/trucks`. The truck routes remain the
 * goods-vehicle view and are untouched; this surface is type-aware, so a taxi
 * or a bus can be registered without pretending to be a truck.
 *
 * Permissions reuse `fleet.trucks.*` deliberately — both surfaces reach the
 * same record, so a separate grant would let an operator hold one and not the
 * other while still being able to edit the same vehicle.
 */
export async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /** Vehicle types and their capabilities — drives the form and the filters. */
  app.get(
    '/types',
    { preHandler: requirePermission(Permission.VEHICLES_READ) },
    async (_request, reply) => ok(reply, vehicleService.vehicleTypeCatalogue()),
  );

  app.get(
    '/',
    { preHandler: requirePermission(Permission.VEHICLES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(vehicleListQuerySchema, request.query);
      const result = await vehicleService.listVehicles(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.VEHICLES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await vehicleService.getVehicle(auth, id));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.VEHICLES_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createVehicleSchema, request.body);
      const vehicle = await vehicleService.createVehicle(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_CREATED,
        entityType: 'Vehicle',
        entityId: vehicle.id,
        after: {
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
        },
      });

      return created(reply, vehicle);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.VEHICLES_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateVehicleSchema, request.body);
      const before = await vehicleService.getVehicle(auth, id);
      const vehicle = await vehicleService.updateVehicle(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_UPDATED,
        entityType: 'Vehicle',
        entityId: id,
        before: { vehicleType: before.vehicleType, status: before.status },
        after: { vehicleType: vehicle.vehicleType, status: vehicle.status },
      });

      return ok(reply, vehicle);
    },
  );

  app.post(
    '/:id/status',
    { preHandler: requirePermission(Permission.VEHICLES_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTruckStatusSchema, request.body);
      await truckService.setTruckStatus(auth, id, input.status, input.reason);

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_UPDATED,
        entityType: 'Vehicle',
        entityId: id,
        after: { status: input.status, reason: input.reason ?? null },
      });

      // Re-read through the vehicle service so the caller gets the type-aware
      // shape it asked this surface for — seats for a bus, tonnes for a truck
      // — rather than the goods-vehicle projection.
      return ok(reply, await vehicleService.getVehicle(auth, id));
    },
  );

  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.VEHICLES_DELETE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await truckService.archiveTruck(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.VEHICLE_ARCHIVED,
        entityType: 'Vehicle',
        entityId: id,
      });

      return noContent(reply);
    },
  );

  app.post(
    '/:id/restore',
    { preHandler: requirePermission(Permission.VEHICLES_DELETE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await truckService.restoreTruck(auth, id);
      return ok(reply, await vehicleService.getVehicle(auth, id));
    },
  );

  app.post(
    '/:id/assign-driver',
    { preHandler: requirePermission(Permission.VEHICLES_ASSIGN) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(assignDriverSchema, request.body);
      await truckService.assignDriver(auth, id, input.driverId, input.note);

      // The truck action name, deliberately: whichever surface issued it, the
      // fact recorded is the same one, and an audit trail that names it twice
      // cannot answer "who has driven this vehicle" in a single query.
      await auditFromRequest(request, {
        action: AuditAction.TRUCK_DRIVER_ASSIGNED,
        entityType: 'Vehicle',
        entityId: id,
        after: { driverId: input.driverId },
      });

      return ok(reply, await vehicleService.getVehicle(auth, id));
    },
  );

  app.post(
    '/:id/unassign-driver',
    { preHandler: requirePermission(Permission.VEHICLES_ASSIGN) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await truckService.unassignDriver(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_DRIVER_UNASSIGNED,
        entityType: 'Vehicle',
        entityId: id,
      });

      return ok(reply, await vehicleService.getVehicle(auth, id));
    },
  );

  app.get(
    '/:id/assignments',
    { preHandler: requirePermission(Permission.VEHICLES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.truckAssignmentHistory(auth, id));
    },
  );

  app.get(
    '/:id/events',
    { preHandler: requirePermission(Permission.VEHICLES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.truckEvents(auth, id));
    },
  );
}
