import type { FastifyInstance } from 'fastify';
import {
  OrganizationType,
  Feature,
  Permission,
  bookingListQuerySchema,
  cancelBookingSchema,
  confirmBookingSchema,
  createBookingSchema,
  createTravelPackageSchema,
  declineBookingSchema,
  idParamSchema,
  payBookingSchema,
  providerListQuerySchema,
  quoteQuerySchema,
  rateBookingSchema,
  travelSearchQuerySchema,
  updateTravelPackageSchema,
  upsertProviderProfileSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationType,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as providerService from './provider.service';
import * as packageService from './package.service';
import * as bookingService from './booking.service';

/**
 * Travel, tour and mobility routes.
 *
 * Grouped by audience rather than by entity, because the same package looks
 * different to each:
 *
 *   /travel/providers, /travel/packages, /travel/bookings   — customers
 *   /travel/me/*                                           — providers
 *
 * Travel entitlements sit in the Basic tier deliberately (see
 * `Feature.TRAVEL_SERVICES`): a two-car taxi operator monetises through the
 * booking fee, not a fleet plan.
 */
/**
 * Selling passenger travel is the business of a dedicated travel/tour
 * operator, not of any organization that happens to own vehicles. Every
 * provider-side write therefore carries this gate in addition to its
 * permission — a freight fleet cannot list a tour package.
 */
const requireTravelOperator = () =>
  requireOrganizationType(OrganizationType.MOBILITY_PROVIDER);

export async function travelRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // Provider profile — the mobility capability of an organization
  // -------------------------------------------------------------------------

  app.get(
    '/me/profile',
    { preHandler: requirePermission(Permission.PROVIDER_READ) },
    async (request, reply) =>
      ok(reply, await providerService.getOwnProviderProfile(requireAuth(request))),
  );

  app.put(
    '/me/profile',
    {
      preHandler: [
        requirePermission(Permission.PROVIDER_MANAGE),
        requireTravelOperator(),
        requireFeature(Feature.TRAVEL_SERVICES),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(upsertProviderProfileSchema, request.body);
      const profile = await providerService.upsertProviderProfile(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.PROVIDER_PROFILE_UPDATED,
        entityType: 'ServiceProviderProfile',
        entityId: profile.id,
        after: { serviceTypes: profile.serviceTypes, status: profile.status },
      });

      return ok(reply, profile);
    },
  );

  // -------------------------------------------------------------------------
  // Packages — provider side
  // -------------------------------------------------------------------------

  app.get(
    '/me/packages',
    { preHandler: requirePermission(Permission.TRAVEL_PACKAGES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(travelSearchQuerySchema, request.query);
      const result = await packageService.listOwnPackages(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/me/packages',
    {
      preHandler: [
        requirePermission(Permission.TRAVEL_PACKAGES_MANAGE),
        requireTravelOperator(),
        requireFeature(Feature.TRAVEL_SERVICES),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(createTravelPackageSchema, request.body);
      const pkg = await packageService.createPackage(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.TRAVEL_PACKAGE_CREATED,
        entityType: 'TravelPackage',
        entityId: pkg.id,
        after: { title: pkg.title, status: pkg.status, basePrice: pkg.basePrice },
      });

      return created(reply, pkg);
    },
  );

  app.patch(
    '/me/packages/:id',
    {
      preHandler: [
        requirePermission(Permission.TRAVEL_PACKAGES_MANAGE),
        requireTravelOperator(),
        requireFeature(Feature.TRAVEL_SERVICES),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTravelPackageSchema, request.body);
      const pkg = await packageService.updatePackage(auth, id, input);

      await auditFromRequest(request, {
        action:
          input.status === 'PUBLISHED'
            ? AuditAction.TRAVEL_PACKAGE_PUBLISHED
            : input.status === 'ARCHIVED'
              ? AuditAction.TRAVEL_PACKAGE_ARCHIVED
              : AuditAction.TRAVEL_PACKAGE_UPDATED,
        entityType: 'TravelPackage',
        entityId: id,
        after: { status: pkg.status, basePrice: pkg.basePrice },
      });

      return ok(reply, pkg);
    },
  );

  // -------------------------------------------------------------------------
  // Bookings — provider side
  // -------------------------------------------------------------------------

  app.get(
    '/me/bookings',
    { preHandler: requirePermission(Permission.BOOKINGS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(bookingListQuerySchema, request.query);
      const result = await bookingService.listBookings(auth, query, 'provider');
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/bookings/:id/confirm',
    {
      preHandler: [requirePermission(Permission.BOOKINGS_MANAGE), requireTravelOperator()],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(confirmBookingSchema, request.body ?? {});
      const booking = await bookingService.confirmBooking(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_CONFIRMED,
        entityType: 'TravelBooking',
        entityId: id,
        after: {
          reference: booking.reference,
          vehicleId: booking.vehicle?.id ?? null,
          driverId: booking.driver?.id ?? null,
          tripId: booking.tripId,
        },
      });

      return ok(reply, booking);
    },
  );

  app.post(
    '/bookings/:id/decline',
    {
      preHandler: [requirePermission(Permission.BOOKINGS_MANAGE), requireTravelOperator()],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(declineBookingSchema, request.body);
      const booking = await bookingService.declineBooking(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_DECLINED,
        entityType: 'TravelBooking',
        entityId: id,
        after: { reference: booking.reference, reason: input.reason },
      });

      return ok(reply, booking);
    },
  );

  app.post(
    '/bookings/:id/start',
    { preHandler: requirePermission(Permission.BOOKINGS_MANAGE, Permission.TRIPS_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await bookingService.startBooking(auth, id));
    },
  );

  app.post(
    '/bookings/:id/complete',
    { preHandler: requirePermission(Permission.BOOKINGS_MANAGE, Permission.TRIPS_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const booking = await bookingService.completeBooking(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_COMPLETED,
        entityType: 'TravelBooking',
        entityId: id,
        after: { reference: booking.reference },
      });

      return ok(reply, booking);
    },
  );

  // -------------------------------------------------------------------------
  // Discovery — customer side
  // -------------------------------------------------------------------------

  app.get(
    '/providers',
    { preHandler: requirePermission(Permission.TRAVEL_BROWSE, Permission.PROVIDER_READ) },
    async (request, reply) => {
      const query = parseQuery(providerListQuerySchema, request.query);
      const result = await providerService.listProviders(query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/providers/:id',
    { preHandler: requirePermission(Permission.TRAVEL_BROWSE, Permission.PROVIDER_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await providerService.getProvider(id));
    },
  );

  app.get(
    '/packages',
    { preHandler: requirePermission(Permission.TRAVEL_BROWSE, Permission.TRAVEL_PACKAGES_READ) },
    async (request, reply) => {
      const query = parseQuery(travelSearchQuerySchema, request.query);
      const result = await packageService.searchPackages(query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/packages/:id',
    { preHandler: requirePermission(Permission.TRAVEL_BROWSE, Permission.TRAVEL_PACKAGES_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      const pkg = await packageService.getPackage(id);
      void packageService.recordPackageView(id);
      return ok(reply, pkg);
    },
  );

  /** Price preview before the customer commits. */
  app.get(
    '/quote',
    { preHandler: requirePermission(Permission.TRAVEL_BROWSE, Permission.TRAVEL_PACKAGES_READ) },
    async (request, reply) => {
      const query = parseQuery(quoteQuerySchema, request.query);
      return ok(reply, await packageService.quoteFor(query.packageId, query.passengers));
    },
  );

  // -------------------------------------------------------------------------
  // Bookings — customer side
  // -------------------------------------------------------------------------

  app.get(
    '/bookings',
    { preHandler: requirePermission(Permission.BOOKINGS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(bookingListQuerySchema, request.query);
      // A driver asking for "my bookings" means the jobs assigned to them, not
      // trips they purchased.
      const side = auth.driverId ? 'driver' : 'customer';
      const result = await bookingService.listBookings(auth, query, side);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/bookings/:id',
    { preHandler: requirePermission(Permission.BOOKINGS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await bookingService.getBooking(auth, id));
    },
  );

  /** Authorised simplified tracking. Never raw telemetry. */
  app.get(
    '/bookings/:id/tracking',
    { preHandler: requirePermission(Permission.BOOKINGS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await bookingService.bookingTracking(auth, id));
    },
  );

  app.post(
    '/bookings',
    {
      preHandler: [
        requirePermission(Permission.BOOKINGS_CREATE),
        requireFeature(Feature.TRAVEL_BOOKINGS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(createBookingSchema, request.body);
      const booking = await bookingService.createBooking(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_CREATED,
        entityType: 'TravelBooking',
        entityId: booking.id,
        after: {
          reference: booking.reference,
          packageId: booking.packageId,
          passengers: booking.passengers,
          totalAmount: booking.totalAmount,
        },
      });

      return created(reply, booking);
    },
  );

  app.post(
    '/bookings/:id/pay',
    {
      preHandler: [
        requirePermission(Permission.BOOKINGS_CREATE),
        requireFeature(Feature.TRAVEL_BOOKINGS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(payBookingSchema, request.body ?? {});

      await auditFromRequest(request, {
        action: AuditAction.PAYMENT_INITIATED,
        entityType: 'TravelBooking',
        entityId: id,
        after: { method: input.method },
      });

      const booking = await bookingService.payBooking(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.PAYMENT_SUCCEEDED,
        entityType: 'TravelBooking',
        entityId: id,
        after: { reference: booking.reference, amount: booking.totalAmount },
      });

      return ok(reply, booking);
    },
  );

  app.post(
    '/bookings/:id/cancel',
    { preHandler: requirePermission(Permission.BOOKINGS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(cancelBookingSchema, request.body);
      const booking = await bookingService.cancelBooking(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_CANCELLED,
        entityType: 'TravelBooking',
        entityId: id,
        after: {
          reference: booking.reference,
          cancelledBy: booking.cancelledBy,
          refundAmount: booking.refundAmount,
        },
      });

      return ok(reply, booking);
    },
  );

  app.post(
    '/bookings/:id/rate',
    { preHandler: requirePermission(Permission.BOOKINGS_RATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(rateBookingSchema, request.body);
      const booking = await bookingService.rateBooking(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.BOOKING_RATED,
        entityType: 'TravelBooking',
        entityId: id,
        after: { rating: input.rating },
      });

      return ok(reply, booking);
    },
  );
}
