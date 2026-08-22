import type { FastifyInstance } from 'fastify';
import {
  Permission,
  createVehicleSchema,
  idParamSchema,
  updateVehicleSchema,
  vehicleListQuerySchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
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
}
