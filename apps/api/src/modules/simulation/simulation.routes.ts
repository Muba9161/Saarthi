import type { FastifyInstance } from 'fastify';
import {
  Permission,
  idParamSchema,
  simulationControlSchema,
  simulationTuneSchema,
  startSimulationSchema,
} from '@saarthi/shared';
import { created, ok, parseBody, parseParams } from '../../lib/http';
import {
  requireAuth,
  requireDemoMode,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as simulatorService from './simulator.service';

/**
 * GPS simulator control surface.
 *
 * Every route is behind `requireDemoMode`, and the environment refuses to boot
 * with DEMO_MODE=true in production — so these endpoints cannot be exposed on
 * a live deployment by accident.
 */
export async function simulationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireDemoMode());

  app.get(
    '/',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return ok(reply, await simulatorService.listSimulations(auth, organizationId));
    },
  );

  app.post(
    '/',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(startSimulationSchema, request.body);
      const simulation = await simulatorService.startSimulation(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.SIMULATION_STARTED,
        entityType: 'Simulation',
        entityId: simulation.id,
        after: { truckId: input.truckId, tripId: simulation.tripId },
      });

      return created(reply, simulation);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await simulatorService.getSimulation(auth, id));
    },
  );

  app.post(
    '/:id/control',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(simulationControlSchema, request.body);
      const simulation = await simulatorService.controlSimulation(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.SIMULATION_CONTROLLED,
        entityType: 'Simulation',
        entityId: id,
        after: { action: input.action },
      });

      return ok(reply, simulation);
    },
  );

  app.post(
    '/:id/tune',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(simulationTuneSchema, request.body);
      return ok(reply, await simulatorService.tuneSimulation(auth, id, input));
    },
  );

  // Advance every running simulation once — used by tests and manual stepping.
  app.post(
    '/tick',
    { preHandler: requirePermission(Permission.ADMIN_SIMULATOR, Permission.TRUCKS_UPDATE) },
    async (_request, reply) => ok(reply, { advanced: await simulatorService.runSimulationTick() }),
  );
}
