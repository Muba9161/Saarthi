import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BookingStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestUser,
} from './helpers';

/**
 * Who may start a ride without the passenger's pickup code.
 *
 * The override belongs to whoever owns the operating business. A taxi or tour
 * owner holds MOBILITY_PROVIDER rather than FLEET_OWNER, and was once refused
 * it, leaving a ride with no way to start when the passenger could not give the
 * code. Anybody below owner level is still refused, even holding TRIPS_MANAGE.
 */
describe('Pickup code override', () => {
  let owner: TestUser;
  let dispatcher: TestUser;
  let customer: TestUser;
  let packageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    const operator = await createOrganization(OrganizationType.MOBILITY_PROVIDER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.MOBILITY_PROVIDER, organizationId: operator.id });
    dispatcher = await createUser({ role: RoleName.DISPATCHER, organizationId: operator.id });
    const customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BUSINESS);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });

    const profile = await request({
      method: 'PUT',
      url: '/api/v1/travel/me/profile',
      user: owner,
      payload: {
        displayName: 'Override Tours',
        serviceTypes: ['TOUR', 'TRAVEL'],
        contactPhone: '+919220000102',
        serviceAreas: [
          { city: 'Lucknow', state: 'Uttar Pradesh', latitude: 26.8467, longitude: 80.9462, radiusKm: 200 },
        ],
      },
    });
    expect(profile.status).toBe(200);

    const vehicle = await prisma.truck.create({
      data: {
        organizationId: operator.id,
        registrationNumber: unique('UP32OV').toUpperCase().slice(0, 12),
        vehicleType: VehicleType.SUV,
        truckType: TruckType.OTHER,
        capacityTons: 0,
        passengerCapacity: 6,
        verificationStatus: VerificationStatus.VERIFIED,
      },
    });
    vehicleId = vehicle.id;

    const pkg = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/travel/me/packages',
      user: owner,
      payload: {
        title: 'Lucknow Heritage Day',
        summary: 'A day across the old city by private SUV.',
        serviceKind: 'PILGRIMAGE',
        destinations: ['Lucknow'],
        startLocation: 'Lucknow',
        startLatitude: 26.8467,
        startLongitude: 80.9462,
        endLocation: 'Lucknow',
        durationDays: 1,
        vehicleType: VehicleType.SUV,
        vehicleId,
        minPassengers: 1,
        maxPassengers: 6,
        pricingModel: 'FIXED_PACKAGE',
        basePrice: 4500,
        status: 'PUBLISHED',
      },
    });
    expect(pkg.status).toBe(201);
    packageId = pkg.body.data.id;
  });

  /** A paid booking the owner has confirmed: its trip exists and the pickup code is out. */
  async function confirmedRide(): Promise<{ bookingId: string; tripId: string }> {
    const booked = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/travel/bookings',
      user: customer,
      payload: {
        packageId,
        startDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        passengers: 3,
        contactName: 'Priya Nair',
        contactPhone: '+919845000001',
      },
    });
    expect(booked.status).toBe(201);
    const bookingId = booked.body.data.id;

    const paid = await request({
      method: 'POST',
      url: `/api/v1/travel/bookings/${bookingId}/pay`,
      user: customer,
      payload: { method: 'MOCK' },
    });
    expect(paid.status).toBe(200);

    const confirmed = await request<{ tripId: string | null }>({
      method: 'POST',
      url: `/api/v1/travel/bookings/${bookingId}/confirm`,
      user: owner,
      payload: { vehicleId },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.tripId).toBeTruthy();
    return { bookingId, tripId: confirmed.body.data.tripId! };
  }

  it('lets a travel owner start the ride without the code, with the reason on record', async () => {
    const { bookingId, tripId } = await confirmedRide();
    const reason = 'Passenger phone switched off at the hotel; identity checked at the desk.';

    const cleared = await request<{ status: string; overrideReason: string | null }>({
      method: 'POST',
      url: `/api/v1/handover/trips/${tripId}/override`,
      user: owner,
      payload: { purpose: 'PICKUP', reason },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.status).toBe('OVERRIDDEN');
    expect(cleared.body.data.overrideReason).toBe(reason);

    // With the handover cleared the ride starts with no code at all.
    const started = await request<{ status: string }>({
      method: 'POST',
      url: `/api/v1/travel/bookings/${bookingId}/start`,
      user: owner,
    });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe(BookingStatus.IN_PROGRESS);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'trip.handover_overridden', entityId: tripId },
    });
    expect(audit?.actorUserId).toBe(owner.id);
  });

  it('refuses the override to a member below owner level', async () => {
    const { bookingId, tripId } = await confirmedRide();

    const byDispatcher = await request({
      method: 'POST',
      url: `/api/v1/handover/trips/${tripId}/override`,
      user: dispatcher,
      payload: { purpose: 'PICKUP', reason: 'Passenger phone switched off at the hotel.' },
    });
    // The dispatcher holds TRIPS_MANAGE, so this is the owner rule refusing, not the route guard.
    expect(byDispatcher.status).toBe(403);
    expect(byDispatcher.body.error?.message).toMatch(/owner of the business/i);

    const handover = await prisma.handoverCode.findFirstOrThrow({ where: { bookingId, purpose: 'PICKUP' } });
    expect(handover.overriddenAt).toBeNull();

    const started = await request({
      method: 'POST',
      url: `/api/v1/travel/bookings/${bookingId}/start`,
      user: owner,
    });
    expect(started.status).toBe(422);
    expect(started.body.error?.code).toBe('HANDOVER_CODE_REQUIRED');
  });
});
