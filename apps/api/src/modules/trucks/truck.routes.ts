import type { FastifyInstance } from 'fastify';
import {
  Permission,
  assignDriverSchema,
  createTruckSchema,
  idParamSchema,
  truckListQuerySchema,
  updateTruckSchema,
  updateTruckStatusSchema,
} from '@saarthi/shared';
import { created, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as truckService from './truck.service';

/**
 * Truck routes. Authentication is applied to the whole plugin; each route then
 * declares the specific permission it needs, so adding an endpoint without
 * authorising it is not possible by omission.
 */
export async function truckRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { preHandler: requirePermission(Permission.TRUCKS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(truckListQuerySchema, request.query);
      const result = await truckService.listTrucks(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.TRUCKS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.getTruck(auth, id));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.TRUCKS_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createTruckSchema, request.body);
      const truck = await truckService.createTruck(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_CREATED,
        entityType: 'Truck',
        entityId: truck.id,
        after: { registrationNumber: truck.registrationNumber, truckType: truck.truckType },
      });

      return created(reply, truck);
    },
  );

  app.patch(
    '/:id',
    { preHandler: requirePermission(Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTruckSchema, request.body);
      const before = await truckService.getTruck(auth, id);
      const truck = await truckService.updateTruck(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_UPDATED,
        entityType: 'Truck',
        entityId: id,
        before: { status: before.status, registrationNumber: before.registrationNumber },
        after: { status: truck.status, registrationNumber: truck.registrationNumber },
      });

      return ok(reply, truck);
    },
  );

  app.post(
    '/:id/status',
    { preHandler: requirePermission(Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTruckStatusSchema, request.body);
      const truck = await truckService.setTruckStatus(auth, id, input.status, input.reason);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_UPDATED,
        entityType: 'Truck',
        entityId: id,
        after: { status: input.status, reason: input.reason ?? null },
      });

      return ok(reply, truck);
    },
  );

  app.delete(
    '/:id',
    { preHandler: requirePermission(Permission.TRUCKS_DELETE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await truckService.archiveTruck(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_ARCHIVED,
        entityType: 'Truck',
        entityId: id,
      });

      return noContent(reply);
    },
  );

  app.post(
    '/:id/restore',
    { preHandler: requirePermission(Permission.TRUCKS_DELETE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.restoreTruck(auth, id));
    },
  );

  app.post(
    '/:id/assign-driver',
    { preHandler: requirePermission(Permission.TRUCKS_ASSIGN) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(assignDriverSchema, request.body);
      const truck = await truckService.assignDriver(auth, id, input.driverId, input.note);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_DRIVER_ASSIGNED,
        entityType: 'Truck',
        entityId: id,
        after: { driverId: input.driverId },
      });

      return ok(reply, truck);
    },
  );

  app.post(
    '/:id/unassign-driver',
    { preHandler: requirePermission(Permission.TRUCKS_ASSIGN) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const truck = await truckService.unassignDriver(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.TRUCK_DRIVER_UNASSIGNED,
        entityType: 'Truck',
        entityId: id,
      });

      return ok(reply, truck);
    },
  );

  app.get(
    '/:id/assignments',
    { preHandler: requirePermission(Permission.TRUCKS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.truckAssignmentHistory(auth, id));
    },
  );

  app.get(
    '/:id/events',
    { preHandler: requirePermission(Permission.TRUCKS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await truckService.truckEvents(auth, id));
    },
  );
}
