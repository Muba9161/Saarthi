import type { FastifyInstance } from 'fastify';
import { ok } from '../lib/http';
import { config } from '../config/env';
import { authRoutes } from '../auth/auth.routes';
import { organizationRoutes } from '../modules/organizations/organization.routes';
import { truckRoutes } from '../modules/trucks/truck.routes';
import { driverRoutes } from '../modules/drivers/driver.routes';
import { documentRoutes } from '../modules/documents/document.routes';
import { mediaRoutes } from '../modules/media/media.routes';
import { resaleRoutes } from '../modules/resale/listing.routes';
import { profileRoutes } from '../modules/profiles/profile.routes';
import { qrRoutes } from '../modules/qr/qr.routes';
import {
  orderReturnCandidateRoutes,
  returnLoadRoutes,
} from '../modules/return-loads/return-load.routes';
import { verificationRoutes } from '../modules/verification/verification.routes';
import { notificationRoutes } from '../modules/notifications/notification.routes';
import { marketplaceRoutes } from '../modules/marketplace/marketplace.routes';
import { orderRoutes } from '../modules/orders/order.routes';
import { tripRoutes } from '../modules/trips/trip.routes';
import { trackingRoutes } from '../modules/tracking/tracking.routes';
import { nearbyRoutes } from '../modules/nearby/nearby.routes';
import { petrolStationRoutes } from '../modules/petrol-stations/petrol-station.routes';
import { fuelRateRoutes } from '../modules/fuel-rates/fuel-rate.routes';
import { licenceLookupRoutes } from '../modules/licence-lookup/licence-lookup.routes';
import { vehicleLookupRoutes } from '../modules/vehicle-lookup/vehicle-lookup.routes';
import { sosRoutes } from '../modules/sos/sos.routes';
import { simulationRoutes } from '../modules/simulation/simulation.routes';
import {
  analyticsRoutes,
  fuelRoutes,
  maintenanceRoutes,
} from '../modules/analytics/analytics.routes';
import { adminRoutes } from '../modules/admin/admin.routes';
import { vehicleRoutes } from '../modules/vehicles/vehicle.routes';
import { associationRoutes } from '../modules/associations/association.routes';
import { travelRoutes } from '../modules/travel/travel.routes';
import { deviceRoutes } from '../modules/devices/device.routes';
import { vehiclePairingRoutes } from '../modules/devices/pairing.routes';
import { deviceClientRoutes } from '../modules/devices/device-client.routes';
import { videoGatewayRoutes } from '../modules/devices/video-gateway.routes';
import { telemetryRoutes } from '../modules/telemetry/telemetry.routes';
import {
  terminalRoutes,
  vehicleTerminalRoutes,
} from '../modules/terminal/terminal.routes';
import { terminalClientRoutes } from '../modules/terminal/terminal-client.routes';
import { deviceGatewayRoutes } from '../modules/telemetry/gateway.routes';
import { aiRoutes } from '../modules/ai/ai.routes';
import { loanRoutes, vehicleLoanRoutes } from '../modules/loans/loan.routes';
import { subscriptionRoutes } from '../modules/subscriptions/subscription.routes';
import { viewPreferenceRoutes } from '../modules/preferences/view-preference.routes';
import {
  cameraRoutes,
  cameraStreamRoutes,
  vehicleCameraRoutes,
} from '../modules/devices/camera.routes';
import {
  tollRoutes,
  tripTollRoutes,
  vehicleTollRoutes,
} from '../modules/toll/toll.routes';
import {
  serviceHistoryRoutes,
  vehicleServiceRoutes,
} from '../modules/maintenance/service-history.routes';

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
  // Images. Mounted apart from /documents because a photograph is not a
  // compliance artefact: different lifecycle, different access rules, and a
  // public-visibility asset must be servable without a session.
  await app.register(mediaRoutes, { prefix: '/media' });
  await app.register(resaleRoutes, { prefix: '/resale' });
  await app.register(profileRoutes, { prefix: '/profile' });
  // QR identity. Its /resolve/:token route is intentionally reachable without a
  // session for codes that opt into public resolution.
  await app.register(qrRoutes, { prefix: '/qr' });
  await app.register(returnLoadRoutes, { prefix: '/return-loads' });
  // Return-load candidates for a specific order, mounted next to the order it
  // asks about rather than under /return-loads.
  await app.register(orderReturnCandidateRoutes, { prefix: '/orders' });
  await app.register(verificationRoutes, { prefix: '/verification' });
  await app.register(marketplaceRoutes, { prefix: '/marketplace' });
  await app.register(orderRoutes, { prefix: '/orders' });
  await app.register(tripRoutes, { prefix: '/trips' });
  await app.register(trackingRoutes, { prefix: '/tracking' });
  await app.register(nearbyRoutes, { prefix: '/nearby' });
  await app.register(petrolStationRoutes, { prefix: '/petrol-stations' });
  await app.register(fuelRateRoutes, { prefix: '/fuel-rates' });
  await app.register(vehicleLookupRoutes, { prefix: '/vehicles' });
  await app.register(licenceLookupRoutes, { prefix: '/drivers' });
  await app.register(sosRoutes, { prefix: '/sos' });
  await app.register(maintenanceRoutes, { prefix: '/maintenance' });
  // What a vehicle has already had done to it, as distinct from what is
  // scheduled — different lifecycle, different provenance rules.
  await app.register(serviceHistoryRoutes, { prefix: '/service-history' });
  await app.register(fuelRoutes, { prefix: '/fuel' });
  // FASTag and toll. Mounted under /fleet alongside fuel: both are running
  // costs a dispatcher works with, not owner-only financial data.
  await app.register(tollRoutes, { prefix: '/fleet/toll' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(subscriptionRoutes, { prefix: '/subscriptions' });
  // A person's own settings about their own screens — authentication is the
  // only guard, because the queries are scoped to their user id.
  await app.register(viewPreferenceRoutes, { prefix: '/me/view-preferences' });
  await app.register(simulationRoutes, { prefix: '/simulation' });
  await app.register(aiRoutes, { prefix: '/ai' });
  // The generalized vehicle surface sits under /fleet/vehicles because
  // /vehicles is the RC-lookup surface for arbitrary registration numbers.
  // Different resource, different trust level, so different path.
  await app.register(vehicleRoutes, { prefix: '/fleet/vehicles' });
  // Vehicle finance. Mounted under /fleet because it is fleet-owner data, and
  // the per-vehicle panel sits alongside the vehicle it belongs to.
  await app.register(loanRoutes, { prefix: '/fleet/loans' });
  await app.register(vehicleLoanRoutes, { prefix: '/fleet/vehicles' });
  await app.register(vehicleServiceRoutes, { prefix: '/fleet/vehicles' });
  await app.register(vehicleCameraRoutes, { prefix: '/fleet/vehicles' });
  // Vehicle → Hardware → Add Device. Issuing the QR belongs beside the vehicle
  // it connects something to, not under /devices.
  await app.register(vehiclePairingRoutes, { prefix: '/fleet/vehicles' });
  // Connecting a Saarthi Terminal, beside the device pairing it sits next to on
  // the same Hardware screen.
  await app.register(vehicleTerminalRoutes, { prefix: '/fleet/vehicles' });
  await app.register(vehicleTollRoutes, { prefix: '/fleet/vehicles' });
  // Trip cost and toll variance, mounted where the question is asked.
  await app.register(tripTollRoutes, { prefix: '/trips' });
  await app.register(associationRoutes, { prefix: '/associations' });
  await app.register(travelRoutes, { prefix: '/travel' });
  await app.register(deviceRoutes, { prefix: '/devices' });
  // Saarthi Terminal, people-facing half: the driver asking to be assigned to a
  // vehicle, and the owner or provider deciding. The terminal's own half is
  // mounted under /device-gateway below, because its caller is a device.
  await app.register(terminalRoutes, { prefix: '/terminal' });
  await app.register(telemetryRoutes, { prefix: '/telemetry' });
  // Multi-camera devices (YC06). Registration hangs off the device; watching a
  // camera is its own surface, because that is how a person thinks about it.
  await app.register(cameraRoutes, { prefix: '/devices' });
  await app.register(cameraStreamRoutes, { prefix: '/cameras' });
  // Device-authenticated ingestion. Mounted apart from the user-facing API
  // because it does not use the session guard at all.
  //
  // Two plugins share the prefix: the original firmware-facing gateway, and the
  // client surface an app-based device needs on top of it (enrolment, pairing,
  // heartbeat, its own identity). They are separate files because their callers
  // differ — a Freematics never enrols and a phone never speaks Freematics —
  // but they are one endpoint from the device's point of view, and splitting
  // the base URL would mean configuring two.
  await app.register(deviceClientRoutes, { prefix: '/device-gateway' });
  await app.register(deviceGatewayRoutes, { prefix: '/device-gateway' });
  // The Saarthi Terminal client surface. A third plugin on the same prefix, so
  // a tablet in a truck configures one base URL and no more. It re-declares
  // nothing: heartbeat, telemetry, location, SOS, commands and camera are the
  // endpoints above, used unchanged.
  await app.register(terminalClientRoutes, { prefix: '/device-gateway/terminal' });
  // The video gateway's authorisation callback. Its caller is an SFU, not a
  // person and not a device — the signed ticket it presents is the whole
  // credential, and it is verified inside the route.
  await app.register(videoGatewayRoutes, { prefix: '/video-gateway' });
  await app.register(adminRoutes, { prefix: '/admin' });
}
