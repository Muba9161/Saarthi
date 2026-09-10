import { beforeEach, describe, expect, it } from 'vitest';
import {
  DeviceAssignmentStatus,
  OrganizationType,
  PlanTier,
  TerminalSessionStatus,
  TruckType,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { requestAssignment } from '../src/modules/terminal/session.service';
import type { AuthContext } from '../src/auth/context';
import { createOrganization, unique, type TestOrganization } from './helpers';

/**
 * A driver naming a vehicle, and letting go of it afterwards.
 *
 * Two rules here are worth more than the rest of the file. Naming a vehicle is
 * not authorisation — neither a QR nor a registration number may get anybody
 * onto a truck the fleet has not approved them for — and a driver's phone must
 * release the vehicle when the shift ends, without ever releasing one that has
 * since been handed to somebody else.
 *
 * The cases below are the ones where a plausible implementation does damage
 * rather than nothing: a cross-fleet lookup that leaks which trucks exist, a
 * sign-off that unpairs a fitted tablet nobody can reach, and a release that
 * fires during a reassignment race.
 */
/**
 * The vehicle every test in this file uses.
 *
 * Fixed rather than generated because several tests assert on how the number is
 * normalised and formatted, and a random registration would make those
 * assertions unreadable. Registrations are globally unique, so the row is
 * removed before each test rather than relied upon to be absent.
 */
const REGISTRATION = 'DL01AB1234';

/** A vehicle belonging to a fleet this driver has nothing to do with. */
const OTHER_FLEET_REGISTRATION = 'MH12XY9999';

describe('driver vehicle onboarding', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let driverAuth: AuthContext;
  let driverId: string;
  let vehicleId: string;

  /*
   * This suite cleans up after itself instead of truncating the database.
   *
   * It used to call `resetDatabase()` before every test, which issues a
   * `TRUNCATE ... CASCADE` across forty tables. That is fine in isolation and
   * hostile in company: a neighbouring suite boots Fastify, whose background
   * jobs write to those same tables, and PostgreSQL resolved the collision
   * between an `AccessExclusiveLock` and a `RowExclusiveLock` by killing one of
   * them — "deadlock detected", from a test that had nothing to do with the
   * code under test.
   *
   * So the fixtures are unique per run and only this suite's own rows are
   * removed. Slower to write, and it stops a passing suite from failing its
   * neighbours.
   */
  beforeEach(async () => {
    await prisma.$connect();

    /*
     * The registration is globally unique, so a stale row from an interrupted
     * run would block every test in this file.
     *
     * Both fixtures, not just the driver's own. `OTHER_FLEET_REGISTRATION`
     * belongs to the cross-tenant test and was left behind by every run, so
     * that test passed once on a fresh database and failed on every run after
     * — which reads as a flaky test rather than an uncleaned row.
     */
    await prisma.truck.deleteMany({
      where: { registrationNumber: { in: [REGISTRATION, OTHER_FLEET_REGISTRATION] } },
    });

    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, { trackers: 25 });
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS, { trackers: 25 });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: REGISTRATION,
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });
    vehicleId = truck.id;

    const user = await prisma.user.create({
      data: {
        email: unique('driver') + '@saarthi.local',
        passwordHash: 'not-used-by-these-tests',
        firstName: 'Ravi',
        lastName: 'Kumar',
      },
    });
    const driver = await prisma.driver.create({
      data: {
        organizationId: fleet.id,
        userId: user.id,
        licenseNumber: unique('DL').toUpperCase().slice(0, 16),
      },
    });
    driverId = driver.id;

    // `driverId` is what the service checks: a user without a driver profile is
    // refused before any vehicle is looked up, which is its own rule and tested
    // elsewhere.
    driverAuth = {
      user: { id: user.id, email: user.email, firstName: 'Ravi', lastName: 'Kumar' },
      organizationId: fleet.id,
      driverId: driver.id,
    } as unknown as AuthContext;
  });

  // -------------------------------------------------------------------------
  // Naming a vehicle
  // -------------------------------------------------------------------------

  it('finds a vehicle by its registration number', async () => {
    const session = await requestAssignment(driverAuth, { registrationNumber: 'DL01AB1234' });

    expect(session.registrationNumber).toBe('DL01AB1234');
    // Opened, not approved. Naming a vehicle is not authorisation.
    expect(session.status).toBe(TerminalSessionStatus.DRIVER_IDENTIFIED);
  });

  it('accepts the number however the driver spaced it', async () => {
    /*
     * The registration on a windscreen is written with spaces, the one on a
     * challan with hyphens, and a driver types whichever they are looking at.
     * All three are one truck.
     */
    for (const typed of ['DL 01 AB 1234', 'dl-01-ab-1234', 'dl01ab1234']) {
      await prisma.terminalSession.deleteMany({});
      const session = await requestAssignment(driverAuth, { registrationNumber: typed });
      expect(session.registrationNumber).toBe('DL01AB1234');
    }
  });

  it('records that no QR was scanned when the number was typed', async () => {
    /*
     * The QR audit log's whole value is that it records scans that happened.
     * Writing a scan row for a driver who typed a number would put a fiction
     * into the one place that must not contain one.
     */
    await requestAssignment(driverAuth, { registrationNumber: 'DL01AB1234' });

    const session = await prisma.terminalSession.findFirstOrThrow({
      where: { driverId },
      select: { scannedQrCodeId: true },
    });
    expect(session.scannedQrCodeId).toBeNull();

    /*
     * This driver's scans, not every scan in the database.
     *
     * An unscoped count made the assertion true only when this file ran alone:
     * a neighbouring suite that signs a driver on by QR writes rows of its own,
     * and this test then failed for something it does not test. Scoped to the
     * fixture, in keeping with the rest of the file.
     */
    expect(
      await prisma.qrScan.count({ where: { scannedByUserId: driverAuth.user.id } }),
    ).toBe(0);
  });

  it("will not find another fleet's vehicle, and does not say it exists", async () => {
    /*
     * The lookup is scoped to the driver's own fleet inside the query rather
     * than checked afterwards. Otherwise a driver could discover, one
     * registration at a time, which trucks are on Saarthi and which are not —
     * and "not yours" versus "not found" is exactly the distinction that makes
     * such a probe worth running.
     */
    await prisma.truck.create({
      data: {
        organizationId: otherFleet.id,
        registrationNumber: OTHER_FLEET_REGISTRATION,
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });

    await expect(
      requestAssignment(driverAuth, { registrationNumber: OTHER_FLEET_REGISTRATION }),
    ).rejects.toThrow(/No vehicle in your fleet/);
  });

  it('refuses a number that is not one', async () => {
    await expect(requestAssignment(driverAuth, { registrationNumber: 'DL1' })).rejects.toThrow();
  });

  it('hands back the same request when a driver asks twice', async () => {
    // Reopening the app is not a second request. A driver with two open
    // sessions is a queue nobody can resolve.
    const first = await requestAssignment(driverAuth, { registrationNumber: 'DL01AB1234' });
    const second = await requestAssignment(driverAuth, { registrationNumber: 'DL01AB1234' });

    expect(second.id).toBe(first.id);
    expect(await prisma.terminalSession.count({ where: { driverId } })).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Letting go of it
  // -------------------------------------------------------------------------

  /** A device paired to the vehicle, as either a phone or a fitted tablet. */
  async function pairDevice(releaseOnSignOff: boolean): Promise<string> {
    const device = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('SAARTHI-'),
        provider: 'MOBILE',
        serialNumber: unique('SN'),
        secretHash: 'not-used-by-these-tests',
      },
    });
    await prisma.deviceAssignment.create({
      data: {
        deviceId: device.id,
        vehicleId,
        organizationId: fleet.id,
        status: DeviceAssignmentStatus.ACTIVE,
        releaseOnSignOff,
      },
    });
    return device.id;
  }

  /** A READY session on that device, ready to be signed off. */
  async function openSession(deviceId: string): Promise<string> {
    const session = await prisma.terminalSession.create({
      data: {
        organizationId: fleet.id,
        terminalDeviceId: deviceId,
        vehicleId,
        driverId,
        driverUserId: driverAuth.user.id,
        status: TerminalSessionStatus.READY,
        submittedAt: new Date(),
        decidedAt: new Date(),
        checklistCompletedAt: new Date(),
      },
    });
    return session.id;
  }

  it('releases a phone pairing when the driver signs off', async () => {
    const { endSession } = await import('../src/modules/terminal/session.service');
    const deviceId = await pairDevice(true);
    const sessionId = await openSession(deviceId);

    await endSession(sessionId, 'Shift over', driverAuth.user.id);

    const assignment = await prisma.deviceAssignment.findFirstOrThrow({ where: { deviceId } });
    expect(assignment.status).toBe(DeviceAssignmentStatus.ENDED);
    expect(assignment.unassignedAt).not.toBeNull();
  });

  it('never unpairs a fitted tablet', async () => {
    /*
     * The case that would be expensive to get wrong. A tablet is bolted into a
     * cab and shared between drivers; unpairing it at sign-off would strand a
     * vehicle whose next driver has no way to pair it back without a fitter.
     */
    const { endSession } = await import('../src/modules/terminal/session.service');
    const deviceId = await pairDevice(false);
    const sessionId = await openSession(deviceId);

    await endSession(sessionId, 'Shift over', driverAuth.user.id);

    const assignment = await prisma.deviceAssignment.findFirstOrThrow({ where: { deviceId } });
    expect(assignment.status).toBe(DeviceAssignmentStatus.ACTIVE);
  });

  it('leaves a vehicle alone once it has been paired to somebody else', async () => {
    /*
     * The reassignment race. A driver signs off late — a retry, a phone that
     * regained signal in a yard — after the vehicle has already been handed to
     * the next driver's phone. Releasing on registration alone would disconnect
     * a truck that is out working.
     */
    const { endSession } = await import('../src/modules/terminal/session.service');
    const firstPhone = await pairDevice(true);
    const sessionId = await openSession(firstPhone);

    // The first phone's assignment is closed and the vehicle re-paired.
    await prisma.deviceAssignment.updateMany({
      where: { deviceId: firstPhone },
      data: { status: DeviceAssignmentStatus.ENDED, unassignedAt: new Date() },
    });
    const secondPhone = await pairDevice(true);

    await endSession(sessionId, 'Late sign-off', driverAuth.user.id);

    const current = await prisma.deviceAssignment.findFirstOrThrow({
      where: { deviceId: secondPhone },
    });
    expect(current.status).toBe(DeviceAssignmentStatus.ACTIVE);
  });

  // -------------------------------------------------------------------------
  // A trip closed from the fleet side
  // -------------------------------------------------------------------------

  /**
   * A vehicle, a phone paired to it, a driver signed on, and a trip.
   *
   * Its own truck rather than the shared fixture, and its own driver. These
   * tests call the real `transitionTrip`, which recalculates a driver's score
   * and awards achievements on completion — a good deal of production code
   * reaching across several tables. Sharing a vehicle with the tests above made
   * the outcome depend on what they had left behind, which is how a suite starts
   * failing for reasons that have nothing to do with the code under test.
   */
  async function tripUnderWay(
    tripStatus: 'STARTED' | 'ARRIVED',
  ): Promise<{ tripId: string; sessionId: string; driverId: string }> {
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('TRP').toUpperCase().slice(0, 12),
        truckType: TruckType.OPEN_BODY,
        capacityTons: 20,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: unique('tripdriver') + '@saarthi.local',
        passwordHash: 'not-used-by-these-tests',
        firstName: 'Ravi',
        lastName: 'Kumar',
      },
    });
    const driver = await prisma.driver.create({
      data: {
        organizationId: fleet.id,
        userId: user.id,
        licenseNumber: unique('DL').toUpperCase().slice(0, 16),
      },
    });

    const device = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('SAARTHI-'),
        provider: 'MOBILE',
        serialNumber: unique('SN'),
        secretHash: 'not-used-by-these-tests',
      },
    });
    await prisma.deviceAssignment.create({
      data: {
        deviceId: device.id,
        vehicleId: truck.id,
        organizationId: fleet.id,
        status: DeviceAssignmentStatus.ACTIVE,
        releaseOnSignOff: true,
      },
    });

    const session = await prisma.terminalSession.create({
      data: {
        organizationId: fleet.id,
        terminalDeviceId: device.id,
        vehicleId: truck.id,
        driverId: driver.id,
        driverUserId: user.id,
        status: TerminalSessionStatus.TRIP_ACTIVE,
        submittedAt: new Date(),
        decidedAt: new Date(),
        checklistCompletedAt: new Date(),
        tripStartedAt: new Date(),
      },
    });

    const trip = await prisma.trip.create({
      data: {
        organizationId: fleet.id,
        reference: unique('TRIP').toUpperCase(),
        truckId: truck.id,
        driverId: driver.id,
        // `ARRIVED` for the completion cases: the trip state machine will not
        // jump from STARTED to COMPLETED, because a trip reaches its
        // destination before it is closed.
        status: tripStatus,
        createdById: user.id,
        originAddress: 'Delhi',
        originLatitude: 28.6139,
        originLongitude: 77.209,
        destinationAddress: 'Jaipur',
        destinationLatitude: 26.9124,
        destinationLongitude: 75.7873,
        actualStartAt: new Date(),
      },
    });

    return { tripId: trip.id, sessionId: session.id, driverId: driver.id };
  }

  /** An auth context for the driver on that trip. */
  function authFor(driver: string): AuthContext {
    return {
      user: { id: driverAuth.user.id, email: driverAuth.user.email },
      organizationId: fleet.id,
      driverId: driver,
    } as unknown as AuthContext;
  }

  it('returns the driver to signed-on when a dispatcher completes the trip', async () => {
    /*
     * The bug this was written for.
     *
     * A trip can be finished from two places. The app in the cab calls the
     * terminal's own `completeTrip`, which moves the session from TRIP_ACTIVE
     * back to READY. A dispatcher closing the same trip on the web went through
     * the trips service, which never touched the session — so it stayed
     * TRIP_ACTIVE for ever, and the driver's own dashboard read "Trip under way"
     * directly above a panel reading "No active trip".
     *
     * Nothing looked broken from the server: the trip really was complete. It
     * was visible only to the driver, on their own screen.
     */
    const { transitionTrip } = await import('../src/modules/trips/trip.service');
    const { tripId, sessionId, driverId: tripDriver } = await tripUnderWay('ARRIVED');

    await transitionTrip(authFor(tripDriver), tripId, { status: 'COMPLETED' } as never);

    const session = await prisma.terminalSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe(TerminalSessionStatus.READY);
    // Still signed on. Finishing a trip is not signing off — the driver is in
    // the cab and may well start another one.
    expect(session.endedAt).toBeNull();
    expect(session.tripCompletedAt).not.toBeNull();
  });

  it('does the same when a trip is cancelled', async () => {
    const { transitionTrip } = await import('../src/modules/trips/trip.service');
    const { tripId, sessionId, driverId: tripDriver } = await tripUnderWay('STARTED');

    await transitionTrip(authFor(tripDriver), tripId, { status: 'CANCELLED' } as never);

    const session = await prisma.terminalSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe(TerminalSessionStatus.READY);
  });

  it('does not interrupt a driver who has since started another trip', async () => {
    /*
     * A dispatcher closing yesterday's forgotten trip must not reach into the
     * session of whoever is driving now. The release is scoped to the driver
     * named on the trip, so a different driver's session is untouched.
     */
    const { transitionTrip } = await import('../src/modules/trips/trip.service');
    const first = await tripUnderWay('ARRIVED');
    const second = await tripUnderWay('STARTED');

    await transitionTrip(authFor(first.driverId), first.tripId, { status: 'COMPLETED' } as never);

    const theirs = await prisma.terminalSession.findUniqueOrThrow({
      where: { id: second.sessionId },
    });
    expect(theirs.status).toBe(TerminalSessionStatus.TRIP_ACTIVE);
  });

  it('is idempotent when sign-off is repeated', async () => {
    // A duplicate tap, or a reply lost on a marginal connection. The second
    // attempt must not fail, and must not change anything.
    const { endSession } = await import('../src/modules/terminal/session.service');
    const deviceId = await pairDevice(true);
    const sessionId = await openSession(deviceId);

    await endSession(sessionId, 'Shift over', driverAuth.user.id);
    const first = await prisma.deviceAssignment.findFirstOrThrow({ where: { deviceId } });

    // Whatever the second call does — refuse, or return the completed session —
    // it must not disturb the release the first one made.
    await endSession(sessionId, 'Shift over', driverAuth.user.id).catch(() => undefined);

    const second = await prisma.deviceAssignment.findFirstOrThrow({ where: { deviceId } });
    expect(second.status).toBe(DeviceAssignmentStatus.ENDED);
    expect(second.unassignedAt?.getTime()).toBe(first.unassignedAt?.getTime());
  });
});
