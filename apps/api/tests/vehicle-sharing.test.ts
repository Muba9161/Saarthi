import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  PlanTier,
  RoleName,
  VehicleOwnershipStatus,
  type SharedFuelView,
  type SharedTripView,
  type SharedVehicleView,
  type SharedWithMe,
  type VehicleShareView,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Vehicle sharing: the brother whose name is on the RC shares the car, the
 * other brother tracks it and logs its trips, fuel and servicing — on the
 * owner's account and the owner's bill, and never through the owner's screens.
 */

const PLATE = 'UP32SH1234';
const ORIGIN = { addressLine: 'Hazratganj, Lucknow', latitude: 26.85, longitude: 80.95 };
const DESTINATION = { addressLine: 'Kanpur Central', latitude: 26.45, longitude: 80.35 };

async function confirmedVehicle(organizationId: string, registrationNumber = PLATE) {
  return prisma.truck.create({
    data: {
      organizationId,
      registrationNumber,
      capacityTons: 0,
      vehicleType: 'CAR',
      ownershipStatus: VehicleOwnershipStatus.VERIFIED,
    },
  });
}

const share = (owner: TestUser, vehicleId: string, email: string) =>
  request<VehicleShareView>({
    method: 'POST',
    url: `/api/v1/fleet/sharing/vehicles/${vehicleId}/shares`,
    user: owner,
    payload: { email },
  });

const inbox = (user: TestUser) =>
  request<SharedWithMe>({ method: 'GET', url: '/api/v1/fleet/sharing/shared-with-me', user });

const accept = (user: TestUser, shareId: string) =>
  request({ method: 'POST', url: `/api/v1/fleet/sharing/shares/${shareId}/accept`, user });

describe('vehicle sharing', () => {
  let ownerAccount: TestOrganization;
  let owner: TestUser;
  let brother: TestUser;
  let brotherAccount: TestOrganization;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    ownerAccount = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: ownerAccount.id });
    brotherAccount = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    brother = await createUser({ role: RoleName.FLEET_OWNER, organizationId: brotherAccount.id });
  });

  /** Owner shares, brother accepts; returns the share id. */
  async function sharedWithBrother(vehicleId: string): Promise<string> {
    const invited = await share(owner, vehicleId, brother.email);
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    expect((await accept(brother, invited.body.data.id)).status).toBe(200);
    return invited.body.data.id;
  }

  it('shares a vehicle once the other person accepts, and shows them only the safe view', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const invited = await share(owner, vehicle.id, brother.email);
    expect(invited.body.data.status).toBe('PENDING');

    const before = await inbox(brother);
    expect(before.body.data.invitations).toHaveLength(1);
    expect(before.body.data.vehicles).toHaveLength(0);

    await accept(brother, invited.body.data.id);
    const after = await inbox(brother);
    expect(after.body.data.invitations).toHaveLength(0);
    expect(after.body.data.vehicles[0]?.registrationNumber).toBe(PLATE);

    const view = await request<SharedVehicleView>({
      method: 'GET',
      url: `/api/v1/fleet/sharing/shares/${invited.body.data.id}/vehicle`,
      user: brother,
    });
    expect(view.status).toBe(200);
    // An allowlist, not the owner's summary: no tenant id, no documents, no finance.
    expect(Object.keys(view.body.data).sort()).toEqual(
      [
        'currentDriverName',
        'lastLocation',
        'manufacturer',
        'model',
        'odometerKm',
        'ownerName',
        'registrationNumber',
        'shareId',
        'sharedSince',
        'status',
        'typeLabel',
        'vehicleId',
        'vehicleType',
      ].sort(),
    );
  });

  it('never opens the owner’s own screens to the person it is shared with', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    await sharedWithBrother(vehicle.id);

    const ownerScreen = await request({
      method: 'GET',
      url: `/api/v1/fleet/vehicles/${vehicle.id}`,
      user: brother,
    });
    expect(ownerScreen.status).toBe(404);
  });

  it('files the shared person’s fuel and servicing on the owner’s account, as theirs', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const shareId = await sharedWithBrother(vehicle.id);

    const fuel = await request<SharedFuelView>({
      method: 'POST',
      url: `/api/v1/fleet/sharing/shares/${shareId}/fuel`,
      user: brother,
      payload: { quantityLitres: 30, pricePerUnit: 96.5, odometerKm: 12000 },
    });
    expect(fuel.status, JSON.stringify(fuel.body)).toBe(201);
    expect(fuel.body.data.totalCost).toBe(2895);

    const service = await request({
      method: 'POST',
      url: `/api/v1/fleet/sharing/shares/${shareId}/maintenance`,
      user: brother,
      payload: {
        type: 'PREVENTIVE',
        title: 'General service',
        performedAt: new Date().toISOString(),
      },
    });
    expect(service.status, JSON.stringify(service.body)).toBe(201);

    const [fuelRow, serviceRow] = await Promise.all([
      prisma.fuelRecord.findUniqueOrThrow({ where: { id: fuel.body.data.id } }),
      prisma.maintenanceRecord.findFirstOrThrow({ where: { truckId: vehicle.id } }),
    ]);
    expect(fuelRow.organizationId).toBe(ownerAccount.id);
    expect(fuelRow.createdById).toBe(brother.id);
    expect(serviceRow.organizationId).toBe(ownerAccount.id);
    expect(serviceRow.status).toBe('COMPLETED');

    const log = await request<SharedFuelView[]>({
      method: 'GET',
      url: `/api/v1/fleet/sharing/shares/${shareId}/fuel`,
      user: brother,
    });
    expect(log.body.data).toHaveLength(1);
  });

  it('adds a trip with the driver the owner assigned', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: ownerAccount.id,
      driver: true,
    });
    await prisma.truck.update({
      where: { id: vehicle.id },
      data: { currentDriverId: driver.driverId!, status: 'ASSIGNED' },
    });
    const shareId = await sharedWithBrother(vehicle.id);

    const trip = await request<SharedTripView>({
      method: 'POST',
      url: `/api/v1/fleet/sharing/shares/${shareId}/trips`,
      user: brother,
      payload: { origin: ORIGIN, destination: DESTINATION },
    });
    expect(trip.status, JSON.stringify(trip.body)).toBe(201);

    const row = await prisma.trip.findUniqueOrThrow({ where: { id: trip.body.data.id } });
    expect(row.organizationId).toBe(ownerAccount.id);
    expect(row.driverId).toBe(driver.driverId);
  });

  it('bills only the owner: nothing lands on the shared person’s account', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    await sharedWithBrother(vehicle.id);

    expect(await prisma.truck.count({ where: { organizationId: brotherAccount.id } })).toBe(0);
  });

  it('shares with at most three people', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    for (let index = 0; index < 3; index += 1) {
      const other = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: (await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL))
          .id,
      });
      expect((await share(owner, vehicle.id, other.email)).status).toBe(201);
    }

    const fourth = await share(owner, vehicle.id, brother.email);
    expect(fourth.status).toBe(422);
  });

  it('only shares a vehicle whose ownership is confirmed', async () => {
    const vehicle = await prisma.truck.create({
      data: { organizationId: ownerAccount.id, registrationNumber: PLATE, capacityTons: 0 },
    });

    const attempt = await share(owner, vehicle.id, brother.email);
    expect(attempt.status).toBe(422);
  });

  it('is for Personal and Business plans only', async () => {
    const freeAccount = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.FREE);
    const freeUser = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: freeAccount.id,
    });
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const invited = await share(owner, vehicle.id, freeUser.email);
    expect(invited.status).toBe(201);

    const refused = await accept(freeUser, invited.body.data.id);
    expect(refused.status).toBe(403);
  });

  it('stops working when the owner’s subscription lapses, and returns on renewal', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const shareId = await sharedWithBrother(vehicle.id);
    const open = () =>
      request({ method: 'GET', url: `/api/v1/fleet/sharing/shares/${shareId}/vehicle`, user: brother });

    await prisma.subscription.updateMany({
      where: { organizationId: ownerAccount.id },
      data: { status: 'EXPIRED', endsAt: new Date(Date.now() - 86_400_000) },
    });
    invalidateEntitlements(ownerAccount.id);

    expect((await open()).status).toBe(404);
    expect((await inbox(brother)).body.data.vehicles).toHaveLength(0);

    await prisma.subscription.updateMany({
      where: { organizationId: ownerAccount.id },
      data: { status: 'ACTIVE', endsAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    invalidateEntitlements(ownerAccount.id);

    expect((await open()).status).toBe(200);
  });

  it('keeps strangers out of a share and ends it when the owner stops sharing', async () => {
    const vehicle = await confirmedVehicle(ownerAccount.id);
    const shareId = await sharedWithBrother(vehicle.id);
    const stranger = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: (await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL))
        .id,
    });

    const peek = await request({
      method: 'GET',
      url: `/api/v1/fleet/sharing/shares/${shareId}/vehicle`,
      user: stranger,
    });
    expect(peek.status).toBe(404);

    const revoke = await request({
      method: 'DELETE',
      url: `/api/v1/fleet/sharing/shares/${shareId}`,
      user: owner,
    });
    expect(revoke.status).toBe(200);

    const after = await request({
      method: 'GET',
      url: `/api/v1/fleet/sharing/shares/${shareId}/vehicle`,
      user: brother,
    });
    expect(after.status).toBe(404);
  });
});
