import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, TruckType } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { summariseTripFuel } from '../src/modules/trips/trip-fuel.service';
import { createOrganization, resetDatabase, unique, type TestOrganization } from './helpers';

/**
 * What a journey cost in fuel.
 *
 * The arithmetic is the whole risk here. Consumption arrives as a *rate*, and
 * every wrong way of turning a series of rates into a total produces a number
 * that looks perfectly reasonable — which is the dangerous kind of wrong, because
 * a fleet will act on it. So the cases below are the ones where a plausible
 * implementation and a correct one disagree.
 */
describe('trip fuel', () => {
  let fleet: TestOrganization;
  let vehicleId: string;
  let deviceId: string;
  const start = new Date('2026-09-04T06:00:00.000Z');

  /*
   * No app, and no `closeApp`.
   *
   * These call the service directly — there is no HTTP here — so booting Fastify
   * would be waste. More importantly `closeApp` disconnects the shared Prisma
   * client, and a file that does that while its neighbours are still running
   * leaves them querying a closed engine. Opening a connection is enough.
   */
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP32').toUpperCase().slice(-12),
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });
    vehicleId = truck.id;

    // A reading belongs to a device. Nothing here exercises the device itself —
    // it exists so the foreign key holds.
    const device = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('SAARTHI-FUEL-'),
        provider: 'MOBILE',
        serialNumber: unique('SN'),
        secretHash: 'not-used-by-these-tests',
      },
    });
    deviceId = device.id;
  });

  /** Readings `seconds` apart, each carrying a litres-per-hour rate. */
  async function record(samples: { atSeconds: number; fuelRate: number | null }[]): Promise<void> {
    for (const sample of samples) {
      await prisma.telemetryReading.create({
        data: {
          deviceId,
          vehicleId,
          organizationId: fleet.id,
          recordedAt: new Date(start.getTime() + sample.atSeconds * 1000),
          receivedAt: new Date(start.getTime() + sample.atSeconds * 1000),
          fuelRate: sample.fuelRate,
          simulated: false,
        },
      });
    }
  }

  it('integrates the rate over time rather than averaging the samples', async () => {
    /*
     * Ten litres an hour for an hour is ten litres.
     *
     * Two readings an hour apart, and the answer depends entirely on treating
     * the rate as a rate. A mean of the samples would give "10" with no unit
     * attached to it and happen to look right here, which is why the uneven case
     * below matters more.
     */
    await record([
      { atSeconds: 0, fuelRate: 10 },
      { atSeconds: 240, fuelRate: 10 },
    ]);

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 240_000),
      distanceKm: 4,
    });

    // 10 L/h for 240 s = 0.667 L.
    expect(summary?.litres).toBeCloseTo(0.67, 2);
    expect(summary?.economyKmpl).toBeCloseTo(6.0, 1);
  });

  it('weights a long interval more than a short one', async () => {
    /*
     * The case a plain average gets wrong.
     *
     * Four minutes at 6 L/h then ten seconds at 60 L/h — a hard pull away from a
     * junction. The mean of the two samples is 33 L/h, five times the truth. On
     * a stop-go city run that error compounds all day.
     */
    await record([
      { atSeconds: 0, fuelRate: 6 },
      { atSeconds: 240, fuelRate: 60 },
      { atSeconds: 250, fuelRate: 6 },
    ]);

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 250_000),
      distanceKm: 3,
    });

    // 6 L/h × 240 s = 0.400 L, then 60 L/h × 10 s = 0.167 L.
    expect(summary?.litres).toBeCloseTo(0.57, 2);
  });

  it('skips a gap where the terminal was not reporting', async () => {
    /*
     * A two-hour gap is a break, not two hours of idling.
     *
     * Carrying the last known rate across it would invent a tankful. The gap is
     * skipped, so the total comes out low — and the coverage figure says so
     * rather than the litres pretending to be complete.
     */
    await record([
      { atSeconds: 0, fuelRate: 12 },
      { atSeconds: 60, fuelRate: 12 },
      { atSeconds: 7_260, fuelRate: 12 },
      { atSeconds: 7_320, fuelRate: 12 },
    ]);

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 7_320_000 / 1000 * 1000),
      distanceKm: 20,
    });

    // Two measured minutes at 12 L/h, and nothing for the gap between them.
    expect(summary?.litres).toBeCloseTo(0.4, 1);
    expect(summary?.coverage).toBeLessThan(0.1);
  });

  it('reports nothing at all when the vehicle never gave a rate', async () => {
    // Most of the fleet. Absent is the honest answer — a trip showing 0 L would
    // drag every average built on it in the flattering direction.
    await record([
      { atSeconds: 0, fuelRate: null },
      { atSeconds: 60, fuelRate: null },
    ]);

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 60_000),
      distanceKm: 2,
    });

    expect(summary).toBeNull();
  });

  it('ignores simulated frames entirely', async () => {
    /*
     * Section 19, at the point where it would cost real money: a fabricated
     * consumption figure becoming a fleet's fuel report.
     */
    await prisma.telemetryReading.createMany({
      data: [0, 60].map((seconds) => ({
        deviceId,
        vehicleId,
        organizationId: fleet.id,
        recordedAt: new Date(start.getTime() + seconds * 1000),
        receivedAt: new Date(start.getTime() + seconds * 1000),
        fuelRate: 30,
        simulated: true,
      })),
    });

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 60_000),
      distanceKm: 2,
    });

    expect(summary).toBeNull();
  });

  it('gives no economy for a trip that covered no distance', async () => {
    // An hour of idling burns fuel and travels nowhere. Kilometres per litre is
    // not zero there, it is undefined — and zero would look like a catastrophe.
    await record([
      { atSeconds: 0, fuelRate: 3 },
      { atSeconds: 240, fuelRate: 3 },
    ]);

    const summary = await summariseTripFuel({
      vehicleId,
      startedAt: start,
      endedAt: new Date(start.getTime() + 240_000),
      distanceKm: 0,
    });

    expect(summary?.litres).toBeGreaterThan(0);
    expect(summary?.economyKmpl).toBeNull();
  });
});
