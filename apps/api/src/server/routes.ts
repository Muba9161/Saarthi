import type { FastifyInstance } from 'fastify';
import { ok } from '../lib/http';
import { config } from '../config/env';
import { authRoutes } from '../auth/auth.routes';
import { organizationRoutes } from '../modules/organizations/organization.routes';
import { truckRoutes } from '../modules/trucks/truck.routes';
import { driverRoutes } from '../modules/drivers/driver.routes';
import { documentRoutes } from '../modules/documents/document.routes';
import { verificationRoutes } from '../modules/verification/verification.routes';
import { notificationRoutes } from '../modules/notifications/notification.routes';
import { marketplaceRoutes } from '../modules/marketplace/marketplace.routes';
import { orderRoutes } from '../modules/orders/order.routes';
import { tripRoutes } from '../modules/trips/trip.routes';
import { trackingRoutes } from '../modules/tracking/tracking.routes';
import { nearbyRoutes } from '../modules/nearby/nearby.routes';
import { sosRoutes } from '../modules/sos/sos.routes';
import { simulationRoutes } from '../modules/simulation/simulation.routes';
import {
  analyticsRoutes,
  fuelRoutes,
  maintenanceRoutes,
} from '../modules/analytics/analytics.routes';
import { adminRoutes } from '../modules/admin/admin.routes';
import { aiRoutes } from '../modules/ai/ai.routes';

/**
 * Versioned API surface. Every feature module registers its own route file
 * here; nothing is mounted implicitly, so the routing table is always
 * auditable from a single place.
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) =>
    ok(reply, {
      name: 'Saarthi API',
      version: 'v1',
      environment: config.env,
      demoMode: config.demo.enabled,
      documentation: '/docs/API.md',
    }),
  );

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(organizationRoutes, { prefix: '/organizations' });
  await app.register(truckRoutes, { prefix: '/trucks' });
  await app.register(driverRoutes, { prefix: '/drivers' });
  await app.register(documentRoutes, { prefix: '/documents' });
  await app.register(verificationRoutes, { prefix: '/verification' });
  await app.register(marketplaceRoutes, { prefix: '/marketplace' });
  await app.register(orderRoutes, { prefix: '/orders' });
  await app.register(tripRoutes, { prefix: '/trips' });
  await app.register(trackingRoutes, { prefix: '/tracking' });
  await app.register(nearbyRoutes, { prefix: '/nearby' });
  await app.register(sosRoutes, { prefix: '/sos' });
  await app.register(maintenanceRoutes, { prefix: '/maintenance' });
  await app.register(fuelRoutes, { prefix: '/fuel' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(simulationRoutes, { prefix: '/simulation' });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(adminRoutes, { prefix: '/admin' });
}
