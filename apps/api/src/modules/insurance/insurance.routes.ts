import type { FastifyInstance } from 'fastify';
import { ok, parseParams } from '../../lib/http';
import { requireAuth } from '../../server/guards';
import { idParamSchema } from '@saarthi/shared';
import * as insuranceService from './insurance.service';

export async function insuranceRoutes(app: FastifyInstance): Promise<void> {
  // Public directory of Indian insurance providers
  app.get('/providers', async (_request, reply) => {
    const providers = await insuranceService.listProviders();
    return ok(reply, providers);
  });

  // Public insurance policy comparison matrix
  app.get('/compare', async (_request, reply) => {
    const comparisons = await insuranceService.comparePolicies();
    return ok(reply, comparisons);
  });

  // Vehicle-specific insurance details, physical RC status, and policy summary (authenticated)
  app.get('/vehicle/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const data = await insuranceService.getVehicleInsurance(auth, id);
    return ok(reply, data);
  });
}
