import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceProvider,
  OrganizationType,
  PlanTier,
  RoleName,
  TruckStatus,
  TruckType,
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
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * What a driver may read off a vehicle, and what belongs to the owner.
 *
 * The vehicle owner owns their fleet's telemetry. A driver is entitled to data
 * about the vehicle in their hands, because it is what their own score is
 * computed from — and to nothing else.
 *
 * The bug this suite exists for was a membership check standing in for an
 * authorisation check. An employed driver *is* a member of their employer's
 * organization; that is how they were hired. So "same organization as the
 * vehicle" was true for every lorry in the fleet, and a driver could read the
 * full operating record of vehicles they had never sat in: engine hours, fuel
 * draw, where each one had been and when.
 */
describe('Driver telemetry boundary', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let otherDriver: TestUser;

  /** The vehicle this driver is assigned to. */
  let assignedVehicleId: string;
  /** A vehicle in the same fleet, driven by somebody else. */
  let colleagueVehicleId: string;

  let deviceId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();

    // A tracker on the account, because the telemetry capabilities are granted
    // by owning hardware rather than by a plan. Without one there would be
    // nothing to read and the test would pass for the wrong reason.
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, {
      trackers: 2,
    });

    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    otherDriver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });

    const makeVehicle = async (driverId: string): Promise<string> => {
      const truck = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          // `unique` puts its entropy at the end, so the prefix has to stay
          // short enough that a 12-character registration keeps it.
          registrationNumber: unique('DL').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 25,
          verificationStatus: VerificationStatus.VERIFIED,
          status: TruckStatus.AVAILABLE,
          currentDriverId: driverId,
        },
      });
      await prisma.truckAssignment.create({
        data: { truckId: truck.id, driverId, organizationId: fleet.id, status: 'ACTIVE' },
      });
      return truck.id;
    };

    assignedVehicleId = await makeVehicle(driver.driverId!);
    colleagueVehicleId = await makeVehicle(otherDriver.driverId!);

    const device = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('DEV-').toUpperCase(),
        provider: DeviceProvider.FREEMATICS,
        serialNumber: unique('SN-'),
        secretHash: 'not-a-real-hash',
      },
    });
    deviceId = device.id;

    // One reading on each vehicle, so a refusal cannot be mistaken for an
    // empty result.
    for (const vehicleId of [assignedVehicleId, colleagueVehicleId]) {
      await prisma.telemetryReading.create({
        data: {
          deviceId,
          vehicleId,
          organizationId: fleet.id,
          metrics: ['LOCATION', 'ODOMETER'],
          latitude: 28.61,
          longitude: 77.2,
          odometerKm: 42_000,
          recordedAt: new Date(),
        },
      });
    }
  });

  it('lets a driver read the vehicle they are driving', async () => {
    const { status, body } = await request<{ vehicleId: string } | null>({
      method: 'GET',
      url: `/api/v1/telemetry/vehicles/${assignedVehicleId}/latest`,
      user: driver,
    });

    expect(status).toBe(200);
    expect(body.data).not.toBeNull();
  });

  it('refuses a driver the telemetry of a colleague’s vehicle', async () => {
    const { status } = await request({
      method: 'GET',
      url: `/api/v1/telemetry/vehicles/${colleagueVehicleId}/latest`,
      user: driver,
    });

    // Reported as "not found" rather than 403, exactly as tenant isolation is,
    // so the difference cannot be used to enumerate a fleet.
    expect(status).toBe(404);
  });

  it('refuses a driver the history of a colleague’s vehicle', async () => {
    const { status } = await request({
      method: 'GET',
      url: `/api/v1/telemetry/history?vehicleId=${colleagueVehicleId}`,
      user: driver,
    });

    expect(status).toBe(404);
  });

  it('scopes a driver’s history to their own vehicles when asked by device', async () => {
    // The route accepts a device id on its own, and a device id names a unit
    // fitted to a vehicle rather than a person. Without the scope filter this
    // returned a colleague's vehicle by naming its tracker — the same
    // disclosure by another route.
    const { status, body } = await request<{ items: { vehicleId: string }[] }>({
      method: 'GET',
      url: `/api/v1/telemetry/history?deviceId=${deviceId}`,
      user: driver,
    });

    expect(status).toBe(200);
    // The device reported against both vehicles, so an empty list would mean
    // the filter was too wide a net rather than the right one.
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const reading of body.data.items) {
      expect(reading.vehicleId).toBe(assignedVehicleId);
    }
  });

  it('leaves the owner the whole fleet’s telemetry', async () => {
    // The point of the fix is the boundary, not a blanket restriction: the
    // person who owns the vehicles still sees all of them.
    for (const vehicleId of [assignedVehicleId, colleagueVehicleId]) {
      const { status, body } = await request<{ vehicleId: string } | null>({
        method: 'GET',
        url: `/api/v1/telemetry/vehicles/${vehicleId}/latest`,
        user: owner,
      });

      expect(status).toBe(200);
      expect(body.data).not.toBeNull();
    }
  });
});
