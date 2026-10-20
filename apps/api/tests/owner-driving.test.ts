import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  multipart,
  request,
  resetDatabase,
  sampleJpeg,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';
import { createFleetVehicle, signOnDriver, terminalAuth } from './terminal-fixtures';

/**
 * An owner who drives their own vehicle, from the owner app rather than a
 * paired cab phone: filing a slip paid on the road, and handing a trip's
 * navigation to Google Maps — the same records the cab's terminal writes.
 */
describe('owner who drives', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let vehicleId: string;
  let tripId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    // The owner's own driver profile, as "Assign myself" makes it.
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id, driver: true });
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP').toUpperCase().slice(0, 12),
        capacityTons: 10,
        currentDriverId: owner.driverId!,
        status: 'ON_TRIP',
      },
    });
    vehicleId = truck.id;
    const trip = await prisma.trip.create({
      data: {
        organizationId: fleet.id,
        reference: unique('TR-'),
        truckId: truck.id,
        driverId: owner.driverId!,
        status: 'IN_TRANSIT',
        originAddress: 'Lucknow',
        originLatitude: 26.85,
        originLongitude: 80.95,
        destinationAddress: 'Kanpur',
        destinationLatitude: 26.45,
        destinationLongitude: 80.35,
        actualStartAt: new Date(Date.now() - 30 * 60_000),
        createdById: owner.id,
      },
    });
    tripId = trip.id;
    await prisma.truck.update({ where: { id: truck.id }, data: { currentTripId: trip.id } });
  });

  const slip = (user: TestUser, fields: Record<string, string>, withPhoto = true) => {
    const body = multipart(
      fields,
      withPhoto ? { fieldName: 'file', fileName: 'slip.jpg', contentType: 'image/jpeg', content: sampleJpeg(2048) } : undefined,
    );
    return request<{ id: string }>({ method: 'POST', url: '/api/v1/fleet/expenses', user, payload: body.payload, headers: body.headers });
  };

  describe('filing a slip', () => {
    it('files it against the trip under way, as theirs, with its photo', async () => {
      const filed = await slip(owner, { truckId: vehicleId, category: 'TOLL', amount: '265', vendorName: 'Unnao Toll Plaza' });
      expect(filed.status, JSON.stringify(filed.body)).toBe(201);

      const record = await prisma.expense.findUniqueOrThrow({ where: { id: filed.body.data.id } });
      expect(record).toMatchObject({ truckId: vehicleId, tripId, driverId: owner.driverId, category: 'TOLL', createdById: owner.id });
      expect(Number(record.amount)).toBe(265);
      expect(await prisma.mediaAsset.count({ where: { ownerType: 'EXPENSE', ownerId: record.id } })).toBe(1);
    });

    it('keeps no slip without its photograph', async () => {
      const filed = await slip(owner, { truckId: vehicleId, category: 'PARKING', amount: '50' }, false);
      expect(filed.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.expense.count()).toBe(0);
    });

    it('files only for a vehicle in the fleet or driven by the person filing', async () => {
      const elsewhere = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
      const stranger = await createUser({ role: RoleName.FLEET_OWNER, organizationId: elsewhere.id, driver: true });
      const filed = await slip(stranger, { truckId: vehicleId, category: 'FOOD', amount: '120' });
      expect(filed.status).toBe(404);
      expect(await prisma.expense.count()).toBe(0);
    });
  });

  // The cab's own route shares the photo handling with the app's: it must still keep a slip with its photo.
  it('still files a slip from a paired cab phone, with its photo', async () => {
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    const cab = await createFleetVehicle(fleet.id);
    const terminal = await signOnDriver(owner, driver, cab.id);
    const body = multipart(
      { category: 'PARKING', amount: '40' },
      { fieldName: 'file', fileName: 'slip.jpg', contentType: 'image/jpeg', content: sampleJpeg(2048) },
    );
    const filed = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/device-gateway/terminal/expense',
      headers: { ...terminalAuth(terminal.token), ...body.headers },
      payload: body.payload,
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    expect(await prisma.mediaAsset.count({ where: { ownerType: 'EXPENSE', ownerId: filed.body.data.id } })).toBe(1);
  });

  describe('handing navigation to Google Maps', () => {
    const handOff = (user: TestUser, app: string | null) =>
      request({ method: 'POST', url: `/api/v1/trips/${tripId}/navigation`, user, payload: { app } });

    it('records it once on the trip and clears it on the way back', async () => {
      expect((await handOff(owner, 'GOOGLE_MAPS')).status).toBe(200);
      expect((await handOff(owner, 'GOOGLE_MAPS')).status).toBe(200);
      let trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(trip.externalNavigation).toBe('GOOGLE_MAPS');
      expect(await prisma.tripEvent.count({ where: { tripId, type: 'NAVIGATION_HANDOFF' } })).toBe(1);

      expect((await handOff(owner, null)).status).toBe(200);
      trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(trip.externalNavigation).toBeNull();
      expect(await prisma.tripEvent.count({ where: { tripId, type: 'NAVIGATION_HANDOFF' } })).toBe(2);
    });

    it('is the trip driver\'s alone', async () => {
      const manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });
      const refused = await handOff(manager, 'GOOGLE_MAPS');
      expect([403, 404]).toContain(refused.status);
      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(trip.externalNavigation).toBeNull();
    });
  });
});
