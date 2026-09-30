import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MediaOwnerType,
  MediaPurpose,
  OrganizationType,
  RoleName,
  SosType,
  VehicleListingStatus,
  VehicleListingVisibility,
  listingListQuerySchema,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { buildAuthContext } from '../src/auth/session.service';
import { browseListings } from '../src/modules/resale/listing.service';
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

/**
 * One account reaching into another's data by id — each case here was a real
 * gap found in review, and each must stay closed: fleet A names fleet B's
 * vehicle, trip or incident and gets nothing back and changes nothing.
 */

const ROUTE = {
  originAddress: 'Lucknow',
  originLatitude: 26.85,
  originLongitude: 80.95,
  destinationAddress: 'Kanpur',
  destinationLatitude: 26.45,
  destinationLongitude: 80.35,
};

describe('tenant isolation', () => {
  let fleetA: TestOrganization;
  let fleetB: TestOrganization;
  let ownerA: TestUser;
  let ownerB: TestUser;
  let truckB: { id: string };
  let tripB: { id: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    fleetA = await createOrganization(OrganizationType.FLEET_OWNER);
    fleetB = await createOrganization(OrganizationType.FLEET_OWNER);
    ownerA = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetA.id });
    ownerB = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetB.id });
    truckB = await prisma.truck.create({
      data: { organizationId: fleetB.id, registrationNumber: unique('UP32B').slice(0, 10), capacityTons: 10 },
    });
    tripB = await prisma.trip.create({
      data: {
        organizationId: fleetB.id,
        truckId: truckB.id,
        reference: unique('TRP'),
        status: 'STARTED',
        createdById: ownerB.id,
        ...ROUTE,
      },
    });
  });

  async function truckOfA() {
    return prisma.truck.create({
      data: { organizationId: fleetA.id, registrationNumber: unique('UP32A').slice(0, 10), capacityTons: 10 },
    });
  }

  it('refuses a photo on another fleet’s vehicle', async () => {
    const body = multipart(
      { ownerType: MediaOwnerType.VEHICLE, ownerId: truckB.id, purpose: MediaPurpose.VEHICLE_EXTERIOR },
      { fieldName: 'file', fileName: 'x.jpg', contentType: 'image/jpeg', content: sampleJpeg(2_048) },
    );
    const upload = await request({
      method: 'POST',
      url: '/api/v1/media',
      user: ownerA,
      payload: body.payload,
      headers: body.headers,
    });
    expect(upload.status).toBe(404);
    expect(await prisma.mediaAsset.count({ where: { ownerId: truckB.id } })).toBe(0);
  });

  it('refuses a position that names another fleet’s trip', async () => {
    const truckA = await truckOfA();
    const posted = await request({
      method: 'POST',
      url: '/api/v1/tracking/locations',
      user: ownerA,
      payload: { truckId: truckA.id, tripId: tripB.id, latitude: 26.8, longitude: 80.9 },
    });
    expect(posted.status).toBe(404);
  });

  it('refuses a fill-up filed against another fleet’s trip', async () => {
    const truckA = await truckOfA();
    const fuel = await request({
      method: 'POST',
      url: '/api/v1/fuel',
      user: ownerA,
      payload: { truckId: truckA.id, tripId: tripB.id, quantityLitres: 40, pricePerUnit: 95 },
    });
    expect(fuel.status).toBe(404);
    expect(await prisma.fuelRecord.count({ where: { tripId: tripB.id } })).toBe(0);
  });

  it('keeps another fleet’s safety checks private', async () => {
    const history = await request({
      method: 'GET',
      url: `/api/v1/terminal/vehicles/${truckB.id}/checklists`,
      user: ownerA,
    });
    expect(history.status).toBe(404);
  });

  it('refuses an SOS that names another fleet’s truck, and leaves it untouched', async () => {
    // Raising an SOS is a driver's action.
    const driverA = await createUser({ role: RoleName.DRIVER, organizationId: fleetA.id, driver: true });
    const sos = await request({
      method: 'POST',
      url: '/api/v1/sos',
      user: driverA,
      payload: { type: SosType.BREAKDOWN, latitude: 26.8, longitude: 80.9, truckId: truckB.id },
    });
    expect(sos.status).toBe(404);
    const untouched = await prisma.truck.findUniqueOrThrow({ where: { id: truckB.id } });
    expect(untouched.status).not.toBe('EMERGENCY');
  });

  /*
   * The resale market is a deferred feature — no plan reaches it over HTTP yet
   * — so the browse rule is exercised on the service itself, ready for launch.
   */
  describe('the resale market', () => {
    const browseAs = async (user: TestUser, query: Record<string, unknown>) => {
      const auth = await buildAuthContext(user.id, 'test-session', user.organizationId);
      return browseListings(auth, listingListQuerySchema.parse(query));
    };

    async function listing(status: string, visibility: string) {
      const vehicle = await prisma.truck.create({
        data: { organizationId: fleetB.id, registrationNumber: unique('UP32L').slice(0, 10), capacityTons: 10 },
      });
      return prisma.vehicleListing.create({
        data: {
          reference: unique('LST'),
          organizationId: fleetB.id,
          vehicleId: vehicle.id,
          status: status as never,
          visibility: visibility as never,
          title: 'Tata Signa for sale',
          askingPrice: 900_000,
          condition: 'GOOD' as never,
          odometerKm: 120_000,
          createdById: ownerB.id,
        },
      });
    }

    it('never shows another seller’s drafts, whatever status is asked for', async () => {
      await listing(VehicleListingStatus.DRAFT, VehicleListingVisibility.PLATFORM);
      const browse = await browseAs(ownerA, { status: 'DRAFT' });
      expect(browse.total).toBe(0);
    });

    it('keeps an organization-only listing private when a search term is used', async () => {
      await listing(VehicleListingStatus.PUBLISHED, VehicleListingVisibility.ORGANIZATION);
      expect((await browseAs(ownerA, { search: 'Tata' })).total).toBe(0);
      // …while the seller still finds their own.
      expect((await browseAs(ownerB, { search: 'Tata' })).total).toBe(1);
    });
  });
});
