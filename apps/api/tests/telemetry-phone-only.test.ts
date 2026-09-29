import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceProvider,
  OrganizationType,
  PlanTier,
  RoleName,
  TelemetryMetric,
  TruckType,
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
 * Telemetry on an account with no tracker.
 *
 * The driver app reports the vehicle's position, speed and motion from the
 * phone, and those are the vehicle's own movements — so the owner sees them
 * without buying anything. Engine, fuel and fault codes are what a tracker
 * reads off the vehicle; from a phone they are simulated, and they must never
 * reach an account that has not bought the hardware that measures them.
 */
describe('Telemetry without a tracker', () => {
  let owner: TestUser;
  let vehicleId: string;

  interface Reading {
    metrics: string[];
    simulatedMetrics: string[];
    latitude: number | null;
    speedKph: number | null;
    rpm: number | null;
    fuelLevel: number | null;
    odometerKm: number | null;
    diagnostics: unknown[];
  }

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    const fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        capacityTons: 25,
      },
    });
    vehicleId = truck.id;

    const phone = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('PHONE-').toUpperCase(),
        provider: DeviceProvider.MOBILE,
        serialNumber: unique('SN-'),
        secretHash: 'not-a-real-hash',
      },
    });

    // An older reading from the phone: a real position, a simulated engine.
    await prisma.telemetryReading.create({
      data: {
        deviceId: phone.id,
        vehicleId,
        organizationId: fleet.id,
        metrics: [
          TelemetryMetric.LOCATION,
          TelemetryMetric.SPEED,
          TelemetryMetric.RPM,
          TelemetryMetric.FUEL_LEVEL,
        ],
        simulatedMetrics: [TelemetryMetric.RPM, TelemetryMetric.FUEL_LEVEL],
        latitude: 28.61,
        longitude: 77.2,
        speedKph: 42,
        rpm: 1850,
        fuelLevel: 60,
        recordedAt: new Date(Date.now() - 60_000),
      },
    });

    // The newest reading carries nothing a phone measures, so the live panel
    // must skip past it rather than show an empty frame.
    await prisma.telemetryReading.create({
      data: {
        deviceId: phone.id,
        vehicleId,
        organizationId: fleet.id,
        metrics: [TelemetryMetric.ODOMETER],
        odometerKm: 42_000,
        recordedAt: new Date(),
      },
    });
  });

  it('shows the latest phone position and speed, without engine or fuel', async () => {
    const { status, body } = await request<Reading | null>({
      method: 'GET',
      url: `/api/v1/telemetry/vehicles/${vehicleId}/latest`,
      user: owner,
    });

    expect(status).toBe(200);
    expect(body.data?.latitude).toBe(28.61);
    expect(body.data?.speedKph).toBe(42);
    expect(body.data?.rpm).toBeNull();
    expect(body.data?.fuelLevel).toBeNull();
    expect(body.data?.metrics).toEqual(
      expect.arrayContaining([TelemetryMetric.LOCATION, TelemetryMetric.SPEED]),
    );
    expect(body.data?.metrics).not.toContain(TelemetryMetric.RPM);
    expect(body.data?.simulatedMetrics).toEqual([]);
  });

  it('returns phone history narrowed the same way', async () => {
    const { status, body } = await request<{ items: Reading[] }>({
      method: 'GET',
      url: `/api/v1/telemetry/history?vehicleId=${vehicleId}`,
      user: owner,
    });

    expect(status).toBe(200);
    // The odometer-only reading carries nothing a phone measures.
    expect(body.data.items).toHaveLength(1);
    const [reading] = body.data.items;
    expect(reading?.speedKph).toBe(42);
    expect(reading?.rpm).toBeNull();
    expect(reading?.odometerKm).toBeNull();
    expect(reading?.diagnostics).toEqual([]);
  });
});
