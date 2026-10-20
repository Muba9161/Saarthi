import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceProvider,
  OrganizationType,
  PlanTier,
  RoleName,
  TelemetryMetric,
  VehicleOwnershipStatus,
  type SharedFuelView,
  type SharedVehicleLive,
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
  multipart,
  request,
  requestRaw,
  resetDatabase,
  samplePdf,
  unique,
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
    // An allowlist, not the owner's summary: no tenant id, no finance, and papers
    // only as counts — the papers themselves are on the read-only papers view.
    expect(Object.keys(view.body.data).sort()).toEqual(
      [
        'capacityTons',
        'category',
        'categoryLabel',
        'currentDriverName',
        'documentHealth',
        'lastLocation',
        'manufacturer',
        'model',
        'odometerKm',
        'ownerName',
        'passengerCapacity',
        'registrationNumber',
        'shareId',
        'sharedSince',
        'status',
        'truckType',
        'typeLabel',
        'vehicleId',
        'vehicleType',
      ].sort(),
    );
    // The same card figures the owner's list shows.
    expect(view.body.data.documentHealth).toEqual(expect.objectContaining({ total: expect.any(Number) }));
    expect(after.body.data.vehicles[0]?.documentHealth).toEqual(view.body.data.documentHealth);
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

  describe('the shared vehicle’s papers', () => {
    /** The owner files a paper against [vehicleId]; returns its id. */
    async function ownerUploads(vehicleId: string, documentType: string, title: string): Promise<string> {
      const body = multipart(
        { ownerType: 'TRUCK', ownerId: vehicleId, documentType, expiryDate: '2030-01-31' },
        { fieldName: 'file', fileName: `${documentType.toLowerCase()}.pdf`, contentType: 'application/pdf', content: samplePdf(title) },
      );
      const uploaded = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/documents',
        user: owner,
        payload: body.payload,
        headers: body.headers,
      });
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
      return uploaded.body.data.id;
    }

    const papersOf = (user: TestUser, shareId: string) =>
      request<{ folders: Array<{ id: string; kind: string }>; documents: Array<{ id: string }>; rc: unknown }>({
        method: 'GET',
        url: `/api/v1/fleet/sharing/shares/${shareId}/papers`,
        user,
      });

    it('lets the person it is shared with see and open them, but not the QR sticker', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const insurance = await ownerUploads(vehicle.id, 'INSURANCE', 'Shared insurance');
      const shareId = await sharedWithBrother(vehicle.id);

      const papers = await papersOf(brother, shareId);
      expect(papers.status).toBe(200);
      expect(papers.body.data.documents.map((document) => document.id)).toContain(insurance);
      expect(papers.body.data.folders.some((folder) => folder.kind === 'PAPER')).toBe(true);
      // The sticker is the owner's to hand out.
      expect(papers.body.data.folders.some((folder) => folder.kind === 'QR')).toBe(false);

      const file = await requestRaw({
        method: 'GET',
        url: `/api/v1/fleet/sharing/shares/${shareId}/papers/${insurance}/download`,
        user: brother,
      });
      expect(file.status).toBe(200);
      expect(String(file.headers['content-type'])).toContain('application/pdf');
      expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('opens only the shared vehicle’s papers, and only while the share lasts', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const other = await confirmedVehicle(ownerAccount.id, 'UP32SH9999');
      const otherPaper = await ownerUploads(other.id, 'INSURANCE', 'Not shared');
      const shared = await ownerUploads(vehicle.id, 'PERMIT', 'Shared permit');
      const shareId = await sharedWithBrother(vehicle.id);

      const notShared = await requestRaw({
        method: 'GET',
        url: `/api/v1/fleet/sharing/shares/${shareId}/papers/${otherPaper}/download`,
        user: brother,
      });
      expect(notShared.status).toBe(404);

      const stranger = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: (await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL)).id,
      });
      expect((await papersOf(stranger, shareId)).status).toBe(404);

      await request({ method: 'DELETE', url: `/api/v1/fleet/sharing/shares/${shareId}`, user: owner });
      expect((await papersOf(brother, shareId)).status).toBe(404);
      const afterEnd = await requestRaw({
        method: 'GET',
        url: `/api/v1/fleet/sharing/shares/${shareId}/papers/${shared}/download`,
        user: brother,
      });
      expect(afterEnd.status).toBe(404);
    });

    it('gives no way to upload or change them', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const shareId = await sharedWithBrother(vehicle.id);

      const body = multipart(
        { ownerType: 'TRUCK', ownerId: vehicle.id, documentType: 'INSURANCE', expiryDate: '2030-01-31' },
        { fieldName: 'file', fileName: 'insurance.pdf', contentType: 'application/pdf', content: samplePdf('Sneaky') },
      );
      const upload = await request({
        method: 'POST',
        url: '/api/v1/documents',
        user: brother,
        payload: body.payload,
        headers: body.headers,
      });
      expect(upload.status).not.toBe(201);
      expect(await prisma.document.count({ where: { ownerId: vehicle.id } })).toBe(0);

      const viaShare = await request({
        method: 'POST',
        url: `/api/v1/fleet/sharing/shares/${shareId}/papers`,
        user: brother,
        payload: {},
      });
      expect(viaShare.status).toBe(404);
    });
  });

  describe('following the shared vehicle', () => {
    const live = (user: TestUser, shareId: string, from?: Date) =>
      request<SharedVehicleLive>({
        method: 'GET',
        url: `/api/v1/fleet/sharing/shares/${shareId}/live${from ? `?from=${from.toISOString()}` : ''}`,
        user,
      });

    /** Fixes a kilometre or so apart, ten minutes apart, ending now. */
    async function drove(vehicleId: string, count: number, tripId?: string): Promise<Date[]> {
      const now = Date.now();
      const times = Array.from({ length: count }, (_, i) => new Date(now - (count - 1 - i) * 10 * 60_000));
      for (const [i, recordedAt] of times.entries()) {
        await prisma.truckLocation.create({
          data: {
            truckId: vehicleId,
            organizationId: ownerAccount.id,
            tripId,
            latitude: 26.85 - i * 0.01,
            longitude: 80.95 - i * 0.01,
            speedKph: 40,
            recordedAt,
            routeState: tripId ? 'ON_ROUTE' : 'NO_TRIP',
          },
        });
      }
      return times;
    }

    it('shows the road covered today in the trail’s colours, and only what is new when asked', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const shareId = await sharedWithBrother(vehicle.id);
      // Two days ago: older than the day's path, so not drawn.
      await prisma.truckLocation.create({
        data: {
          truckId: vehicle.id,
          organizationId: ownerAccount.id,
          latitude: 27.5,
          longitude: 81.5,
          recordedAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
      const times = await drove(vehicle.id, 3);

      const all = await live(brother, shareId);
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.data.trip).toBeNull();
      expect(all.body.data.trail.map((point) => point.routeState)).toEqual(['NO_TRIP', 'NO_TRIP', 'NO_TRIP']);

      const since = await live(brother, shareId, times[1]);
      expect(since.body.data.trail.map((point) => point.recordedAt)).toEqual(
        times.slice(1).map((time) => time.toISOString()),
      );
    });

    it('marks the trip it is on: its ends, its planned road, the path since it started', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const driver = await createUser({ role: RoleName.DRIVER, organizationId: ownerAccount.id, driver: true });
      await prisma.truck.update({
        where: { id: vehicle.id },
        data: { currentDriverId: driver.driverId!, status: 'ASSIGNED' },
      });
      const shareId = await sharedWithBrother(vehicle.id);
      const logged = await request<SharedTripView>({
        method: 'POST',
        url: `/api/v1/fleet/sharing/shares/${shareId}/trips`,
        user: brother,
        payload: { origin: ORIGIN, destination: DESTINATION },
      });
      const startedAt = new Date(Date.now() - 25 * 60_000);
      await prisma.trip.update({
        where: { id: logged.body.data.id },
        data: {
          status: 'IN_TRANSIT',
          actualStartAt: startedAt,
          plannedRoute: [
            { latitude: ORIGIN.latitude, longitude: ORIGIN.longitude },
            { latitude: DESTINATION.latitude, longitude: DESTINATION.longitude },
          ],
        },
      });
      await prisma.truck.update({ where: { id: vehicle.id }, data: { currentTripId: logged.body.data.id } });
      await drove(vehicle.id, 3, logged.body.data.id);

      const view = await live(brother, shareId);
      expect(view.body.data.trip).toMatchObject({
        id: logged.body.data.id,
        destination: DESTINATION.addressLine,
        destinationLatitude: DESTINATION.latitude,
        startedAt: startedAt.toISOString(),
      });
      expect(view.body.data.trip?.plannedRoute).toHaveLength(2);
      expect(view.body.data.trail.every((point) => point.routeState === 'ON_ROUTE')).toBe(true);
    });

    it('shows the readings the owner sees, and never a simulated one', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const shareId = await sharedWithBrother(vehicle.id);
      const phone = await prisma.hardwareDevice.create({
        data: {
          organizationId: ownerAccount.id,
          deviceIdentifier: unique('PHONE-').toUpperCase(),
          provider: DeviceProvider.MOBILE,
          serialNumber: unique('SN-'),
          secretHash: 'not-a-real-hash',
        },
      });
      await prisma.telemetryReading.create({
        data: {
          deviceId: phone.id,
          vehicleId: vehicle.id,
          organizationId: ownerAccount.id,
          metrics: [TelemetryMetric.LOCATION, TelemetryMetric.SPEED, TelemetryMetric.RPM, TelemetryMetric.COOLANT_TEMPERATURE],
          simulatedMetrics: [TelemetryMetric.COOLANT_TEMPERATURE],
          latitude: 26.85,
          longitude: 80.95,
          speedKph: 48,
          rpm: 1800,
          coolantTemperature: 90,
          recordedAt: new Date(),
        },
      });

      const ownerSees = await request<{ metrics: string[]; simulatedMetrics: string[]; rpm: number | null }>({
        method: 'GET',
        url: `/api/v1/telemetry/vehicles/${vehicle.id}/latest`,
        user: owner,
      });
      expect(ownerSees.status, JSON.stringify(ownerSees.body)).toBe(200);
      const ownerRpm =
        ownerSees.body.data.metrics.includes('RPM') && !ownerSees.body.data.simulatedMetrics.includes('RPM')
          ? ownerSees.body.data.rpm
          : null;

      const view = await live(brother, shareId);
      expect(view.body.data.reading).toMatchObject({ speedKph: 48, rpm: ownerRpm, coolantTemperature: null });
    });

    it('is for the person it is shared with, and only while the share lasts', async () => {
      const vehicle = await confirmedVehicle(ownerAccount.id);
      const shareId = await sharedWithBrother(vehicle.id);
      const stranger = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: (await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL)).id,
      });
      expect((await live(stranger, shareId)).status).toBe(404);

      await request({ method: 'DELETE', url: `/api/v1/fleet/sharing/shares/${shareId}`, user: owner });
      expect((await live(brother, shareId)).status).toBe(404);
    });
  });
});
