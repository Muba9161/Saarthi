import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  Feature,
  Permission,
  idParamSchema,
  telemetryAlertListQuerySchema,
  telemetryHistoryQuerySchema,
  updateTelemetryAlertSchema,
  upsertAlertRuleSchema,
  upsertGeofenceSchema,
} from '@saarthi/shared';
import { created, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireFeature, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as telemetryService from './telemetry.service';
import { vehicleDeviceHistory } from '../devices/device.service';

/**
 * Telemetry routes.
 *
 * Live telemetry is a Pro entitlement; history and the intelligence layer sit
 * higher. Read authorisation is per vehicle rather than per organization, so a
 * driver can see the telemetry of the vehicle they are driving — they need it to
 * understand their own score — without seeing the rest of the fleet.
 */
export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // Live & history
  // -------------------------------------------------------------------------

  /** What this vehicle can actually report. Ungated: it is metadata, not data. */
  app.get(
    '/vehicles/:id/capabilities',
    { preHandler: requirePermission(Permission.TELEMETRY_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await telemetryService.vehicleCapabilities(auth, id));
    },
  );

  app.get(
    '/vehicles/:id/latest',
    {
      preHandler: [
        requirePermission(Permission.TELEMETRY_READ),
        requireFeature(Feature.TELEMETRY_LIVE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await telemetryService.latestReading(auth, id));
    },
  );

  app.get(
    '/history',
    {
      preHandler: [
        requirePermission(Permission.TELEMETRY_READ),
        requireFeature(Feature.TELEMETRY_HISTORY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(telemetryHistoryQuerySchema, request.query);
      const result = await telemetryService.telemetryHistory(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  /** Devices ever fitted to a vehicle — the vehicle's hardware history. */
  app.get(
    '/vehicles/:id/devices',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await vehicleDeviceHistory(auth, id));
    },
  );

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  app.get(
    '/alerts',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(telemetryAlertListQuerySchema, request.query);
      const result = await telemetryService.listAlerts(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.patch(
    '/alerts/:id',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTelemetryAlertSchema, request.body);
      const alert = await telemetryService.updateAlert(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TELEMETRY_ALERT_UPDATED,
        entityType: 'TelemetryAlert',
        entityId: id,
        after: { status: input.status, note: input.note ?? null },
      });

      return ok(reply, alert);
    },
  );

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  app.get(
    '/rules',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_READ) },
    async (request, reply) => ok(reply, await telemetryService.listRules(requireAuth(request))),
  );

  app.put(
    '/rules',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(upsertAlertRuleSchema, request.body);
      const rule = await telemetryService.upsertRule(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.TELEMETRY_RULE_UPDATED,
        entityType: 'TelemetryAlertRule',
        entityId: input.vehicleId ?? null,
        after: { type: input.type, enabled: input.enabled, threshold: input.threshold ?? null },
      });

      return ok(reply, rule);
    },
  );

  // -------------------------------------------------------------------------
  // Geofences
  // -------------------------------------------------------------------------

  app.get(
    '/geofences',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_READ) },
    async (request, reply) => ok(reply, await telemetryService.listGeofences(requireAuth(request))),
  );

  app.post(
    '/geofences',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(upsertGeofenceSchema, request.body);
      const fence = await telemetryService.createGeofence(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.GEOFENCE_UPDATED,
        entityType: 'Geofence',
        entityId: fence.id,
        after: { name: fence.name, kind: input.kind, radiusMeters: input.radiusMeters },
      });

      return created(reply, fence);
    },
  );

  app.delete(
    '/geofences/:id',
    { preHandler: requirePermission(Permission.TELEMETRY_ALERTS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await telemetryService.deleteGeofence(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.GEOFENCE_UPDATED,
        entityType: 'Geofence',
        entityId: id,
        after: { deleted: true },
      });

      return noContent(reply);
    },
  );

  // -------------------------------------------------------------------------
  // Maintenance recommendations
  // -------------------------------------------------------------------------

  /**
   * Deterministic rule-based recommendations. Not predictive maintenance — see
   * the note in `telemetry.service.ts`.
   */
  app.get(
    '/maintenance',
    {
      preHandler: [
        requirePermission(Permission.MAINTENANCE_READ),
        requireFeature(Feature.TELEMETRY_HISTORY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(
        z.object({ vehicleId: idParamSchema.shape.id.optional() }),
        request.query,
      );
      return ok(reply, await telemetryService.maintenanceRecommendations(auth, query.vehicleId));
    },
  );

  app.post(
    '/maintenance/accept',
    { preHandler: requirePermission(Permission.MAINTENANCE_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(
        z.object({ vehicleId: idParamSchema.shape.id, code: z.string().min(3).max(60) }),
        request.body,
      );
      const result = await telemetryService.acceptRecommendation(auth, input.vehicleId, input.code);

      await auditFromRequest(request, {
        action: AuditAction.MAINTENANCE_CREATED,
        entityType: 'MaintenanceRecord',
        entityId: result.maintenanceId,
        after: { source: 'telemetry-recommendation', code: input.code },
      });

      return created(reply, result);
    },
  );
}
