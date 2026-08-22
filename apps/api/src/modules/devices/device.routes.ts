import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  assignDeviceSchema,
  deviceListQuerySchema,
  idParamSchema,
  registerDeviceSchema,
  startMockDeviceSchema,
  unassignDeviceSchema,
  updateDeviceSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireDemoMode,
  requireFeature,
  requireOrganizationId,
  requirePermission,
  requirePlatformAdmin,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as deviceService from './device.service';
import * as mockDeviceService from './mock-device.service';

/**
 * Hardware device routes.
 *
 * Device management is gated on `Feature.HARDWARE_CONNECTIVITY`, so a Basic
 * plan sees the module but cannot register units — the plan limit is enforced in
 * the service as well, because a feature flag alone is not an entitlement.
 *
 * Note what is *not* here: telemetry ingestion. Devices post to
 * `/device-gateway`, which authenticates with device credentials rather than a
 * user session and therefore cannot share this router's hooks.
 */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(deviceListQuerySchema, request.query);
      const result = await deviceService.listDevices(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/overview',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => ok(reply, await deviceService.deviceOverview(requireAuth(request))),
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await deviceService.getDevice(auth, id));
    },
  );

  app.get(
    '/:id/assignments',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await deviceService.deviceAssignmentHistory(auth, id));
    },
  );

  app.get(
    '/:id/events',
    { preHandler: requirePermission(Permission.DEVICES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await deviceService.deviceEvents(auth, id));
    },
  );

  /**
   * Register a device.
   *
   * The response carries the plaintext secret exactly once — it is not stored
   * in recoverable form, so the operator must copy it into the unit now.
   */
  app.post(
    '/',
    {
      // Hardware is provisioned by Saarthi, not by tenants: a device is a
      // physical unit that must be tracked centrally across its whole life.
      preHandler: [
        requirePlatformAdmin(),
        requirePermission(Permission.DEVICES_MANAGE),
        requireFeature(Feature.HARDWARE_CONNECTIVITY),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(registerDeviceSchema, request.body);
      const result = await deviceService.registerDevice(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_REGISTERED,
        entityType: 'HardwareDevice',
        entityId: result.device.id,
        // The secret is never audited — `redactSensitive` would catch it, but
        // it is simply not passed.
        after: {
          deviceIdentifier: result.device.deviceIdentifier,
          provider: result.device.provider,
          serialNumber: result.device.serialNumber,
        },
      });

      return created(reply, result);
    },
  );

  app.patch(
    '/:id',
    { preHandler: [requirePlatformAdmin(), requirePermission(Permission.DEVICES_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateDeviceSchema, request.body);
      const device = await deviceService.updateDevice(auth, id, input);

      await auditFromRequest(request, {
        action:
          input.status === 'SUSPENDED'
            ? AuditAction.DEVICE_SUSPENDED
            : input.status === 'RETIRED'
              ? AuditAction.DEVICE_RETIRED
              : AuditAction.DEVICE_UPDATED,
        entityType: 'HardwareDevice',
        entityId: id,
        after: { status: device.status },
      });

      return ok(reply, device);
    },
  );

  app.post(
    '/:id/rotate-secret',
    { preHandler: [requirePlatformAdmin(), requirePermission(Permission.DEVICES_MANAGE)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const result = await deviceService.rotateDeviceSecret(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_SECRET_ROTATED,
        entityType: 'HardwareDevice',
        entityId: id,
      });

      return ok(reply, result);
    },
  );

  app.post(
    '/:id/assign',
    // Linking a unit to a vehicle is an inventory movement, so it stays with
    // the same people who registered the hardware.
    { preHandler: [requirePlatformAdmin(), requirePermission(Permission.DEVICES_ASSIGN)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(assignDeviceSchema, request.body);
      const device = await deviceService.assignDevice(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_ASSIGNED,
        entityType: 'HardwareDevice',
        entityId: id,
        after: {
          vehicleId: input.vehicleId,
          registrationNumber: device.assignedVehicle?.registrationNumber ?? null,
        },
      });

      return ok(reply, device);
    },
  );

  app.post(
    '/:id/unassign',
    // Linking a unit to a vehicle is an inventory movement, so it stays with
    // the same people who registered the hardware.
    { preHandler: [requirePlatformAdmin(), requirePermission(Permission.DEVICES_ASSIGN)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(unassignDeviceSchema, request.body ?? {});
      const device = await deviceService.unassignDevice(auth, id, input.reason);

      await auditFromRequest(request, {
        action: AuditAction.DEVICE_UNASSIGNED,
        entityType: 'HardwareDevice',
        entityId: id,
        after: { reason: input.reason ?? null },
      });

      return ok(reply, device);
    },
  );

  // -------------------------------------------------------------------------
  // Mock device simulator — demo mode only
  // -------------------------------------------------------------------------

  app.get(
    '/mock/runs',
    { preHandler: [requireDemoMode(), requirePermission(Permission.DEVICES_READ)] },
    async (request, reply) => ok(reply, await mockDeviceService.listMockRuns(requireAuth(request))),
  );

  app.post(
    '/mock/start',
    {
      preHandler: [
        requireDemoMode(),
        requirePlatformAdmin(),
        requirePermission(Permission.DEVICES_MANAGE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(startMockDeviceSchema, request.body);
      const run = await mockDeviceService.startMockDevice(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.MOCK_DEVICE_STARTED,
        entityType: 'MockDeviceRun',
        entityId: run.id,
        after: { deviceId: input.deviceId, scenario: input.scenario },
      });

      return created(reply, run);
    },
  );

  app.post(
    '/mock/:id/stop',
    {
      preHandler: [
        requireDemoMode(),
        requirePlatformAdmin(),
        requirePermission(Permission.DEVICES_MANAGE),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const run = await mockDeviceService.stopMockDevice(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.MOCK_DEVICE_STOPPED,
        entityType: 'MockDeviceRun',
        entityId: id,
        after: { readingsSent: run.readingsSent },
      });

      return ok(reply, run);
    },
  );
}
