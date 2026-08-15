import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  analyticsQuerySchema,
  createFuelRecordSchema,
  createMaintenanceSchema,
  fuelListQuerySchema,
  idParamSchema,
  maintenanceListQuerySchema,
  updateMaintenanceSchema,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as analyticsService from './analytics.service';
import * as maintenanceService from '../maintenance/maintenance.service';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // Headline dashboard metrics — available on every plan.
  app.get(
    '/dashboard',
    { preHandler: requirePermission(Permission.ANALYTICS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await analyticsService.dashboardMetrics(organizationId));
    },
  );

  app.get(
    '/performance',
    {
      preHandler: [
        requirePermission(Permission.ANALYTICS_READ),
        requireFeature(Feature.FLEET_ANALYTICS),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(analyticsQuerySchema, request.query);
      return ok(reply, await analyticsService.performanceSeries(organizationId, query));
    },
  );

  app.get(
    '/trucks',
    {
      preHandler: [
        requirePermission(Permission.ANALYTICS_READ),
        requireFeature(Feature.FLEET_ANALYTICS),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(analyticsQuerySchema, request.query);
      return ok(reply, await analyticsService.truckPerformance(organizationId, query));
    },
  );

  app.get(
    '/drivers',
    {
      preHandler: [
        requirePermission(Permission.ANALYTICS_READ),
        requireFeature(Feature.FLEET_ANALYTICS),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(analyticsQuerySchema, request.query);
      return ok(reply, await analyticsService.driverPerformance(organizationId, query));
    },
  );

  app.get(
    '/routes',
    {
      preHandler: [
        requirePermission(Permission.ANALYTICS_READ),
        requireFeature(Feature.REPORTS_ADVANCED),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(analyticsQuerySchema, request.query);
      return ok(reply, await analyticsService.routePerformance(organizationId, query));
    },
  );

  // Digital truck passport.
  app.get(
    '/trucks/:id/passport',
    { preHandler: requirePermission(Permission.TRUCKS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      const passport = await analyticsService.truckPassport(organizationId, id);
      if (!passport) throw errors.notFound('Truck');
      return ok(reply, passport);
    },
  );
}

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(maintenanceListQuerySchema, request.query);
      const result = await maintenanceService.listMaintenance(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/risk',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await maintenanceService.maintenanceRisk(organizationId));
    },
  );

  app.post(
    '/',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createMaintenanceSchema, request.body);
      const record = await maintenanceService.createMaintenance(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.MAINTENANCE_CREATED,
        entityType: 'MaintenanceRecord',
        entityId: record.id,
        after: { truckId: input.truckId, type: input.type, title: input.title },
      });

      return created(reply, record);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_MANAGE),
        requireFeature(Feature.MAINTENANCE_BASIC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateMaintenanceSchema, request.body);
      const record = await maintenanceService.updateMaintenance(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.MAINTENANCE_UPDATED,
        entityType: 'MaintenanceRecord',
        entityId: id,
        after: input,
      });

      return ok(reply, record);
    },
  );

  app.get(
    '/trucks/:id',
    { preHandler: requirePermission(Permission.MAINTENANCE_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await maintenanceService.truckMaintenanceHistory(auth, id));
    },
  );
}

export async function fuelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: requirePermission(Permission.FUEL_READ) }, async (request, reply) => {
    const auth = requireAuth(request);
    const organizationId = requireOrganizationId(request);
    const query = parseQuery(fuelListQuerySchema, request.query);
    const result = await maintenanceService.listFuelRecords(auth, organizationId, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.truckId ? { truckId: query.truckId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    });
    return reply
      .code(200)
      .send({ success: true, data: result, meta: { totals: result.totals } });
  });

  app.post('/', { preHandler: requirePermission(Permission.FUEL_MANAGE) }, async (request, reply) => {
    const auth = requireAuth(request);
    const organizationId = requireOrganizationId(request);
    const input = parseBody(createFuelRecordSchema, request.body);
    const record = await maintenanceService.recordFuel(auth, organizationId, input);

    await auditFromRequest(request, {
      action: AuditAction.FUEL_RECORDED,
      entityType: 'FuelRecord',
      entityId: record.id,
      after: { truckId: input.truckId, litres: input.quantityLitres, cost: record.totalCost },
    });

    return created(reply, record);
  });

  void paginated;
}
