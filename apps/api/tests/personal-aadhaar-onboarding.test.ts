import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FuelType,
  OrganizationType,
  PlanTier,
  RoleName,
  TruckStatus,
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
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * The Personal plan's Aadhaar requirement, at the point it bites.
 *
 * A Personal subscription is sold to a person, so before they put a vehicle on
 * the road they confirm who they are. Three things have to hold at once, and
 * each is easy to break by fixing another:
 *
 *   1. A new Personal account cannot add a vehicle or fit a tracker until the
 *      account holder's own Aadhaar is confirmed.
 *   2. An account that signed up before the cutover keeps everything it already
 *      runs — the vehicles, their tracking, their history — and meets the rule
 *      only when it comes to add the next one. A rule introduced after somebody
 *      signed up must never reach back and switch off their fleet.
 *   3. Nobody else is touched. Free runs no vehicle; a supplier, a fleet owner
 *      and a mobility provider are businesses verified as businesses; a driver
 *      is on no plan and adds no vehicles.
 *
 * The cutover is pinned in `tests/setup.ts`.
 */

/** Matches PERSONAL_AADHAAR_REQUIRED_FROM in tests/setup.ts. */
const CUTOVER = new Date('2026-01-01T00:00:00.000Z');
const BEFORE_CUTOVER = new Date('2025-06-01T00:00:00.000Z');
const AFTER_CUTOVER = new Date('2026-03-01T00:00:00.000Z');

const VALID_AADHAAR_LAST4 = '0124';

describe('Personal Aadhaar before vehicle onboarding', () => {
  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  /** An account of a given plan and type, with its owner signed in. */
  async function account(options: {
    tier: PlanTier;
    type?: OrganizationType;
    role?: RoleName;
    createdAt?: Date;
  }): Promise<{ organization: TestOrganization; owner: TestUser }> {
    const organization = await createOrganization(
      options.type ?? OrganizationType.FLEET_OWNER,
      options.tier,
      // Room to add a second vehicle, so a capacity refusal can never be
      // mistaken for an identity one.
      { vehicleTopUps: 4 },
    );
    const owner = await createUser({
      role: options.role ?? RoleName.FLEET_OWNER,
      organizationId: organization.id,
    });

    if (options.createdAt) {
      await prisma.organization.update({
        where: { id: organization.id },
        data: { createdAt: options.createdAt },
      });
    }

    return { organization, owner };
  }

  /** Confirm the account holder's own Aadhaar, as a successful check would. */
  async function verifyHolder(owner: TestUser): Promise<void> {
    await prisma.user.update({
      where: { id: owner.id },
      data: { aadhaarLast4: VALID_AADHAAR_LAST4, aadhaarVerifiedAt: new Date() },
    });
  }

  /** A vehicle already on the account, put there before the rule existed. */
  async function existingVehicle(organizationId: string): Promise<string> {
    const vehicle = await prisma.truck.create({
      data: {
        organizationId,
        registrationNumber: unique('DL').toUpperCase().slice(0, 12),
        vehicleType: VehicleType.CAR,
        truckType: TruckType.OPEN_BODY,
        capacityTons: 0,
        fuelType: FuelType.PETROL,
        status: TruckStatus.AVAILABLE,
        verificationStatus: VerificationStatus.VERIFIED,
      },
    });
    return vehicle.id;
  }

  function addVehicle(owner: TestUser) {
    return request<unknown>({
      method: 'POST',
      url: '/api/v1/fleet/vehicles',
      user: owner,
      payload: {
        registrationNumber: unique('MH').toUpperCase().slice(0, 12),
        vehicleType: VehicleType.CAR,
        // A car is a passenger vehicle, so the capability model requires seats
        // rather than tonnage — see `validateVehicleCapacities`.
        passengerCapacity: 4,
        fuelType: FuelType.PETROL,
        odometerKm: 0,
      },
    });
  }

  // -------------------------------------------------------------------------
  // A new Personal account
  // -------------------------------------------------------------------------

  describe('a new Personal account', () => {
    it('cannot add a vehicle until the account holder is verified', async () => {
      const { owner } = await account({ tier: PlanTier.PERSONAL, createdAt: AFTER_CUTOVER });

      const response = await addVehicle(owner);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('IDENTITY_VERIFICATION_REQUIRED');
      // The remedy is a check they can complete themselves, so the reply says
      // which one and about whom.
      expect(response.body.error?.details?.subjectType).toBe('USER');
      expect(response.body.error?.details?.kind).toBe('AADHAAR');
      expect(response.body.error?.details?.grandfathered).toBe(false);

      // Nothing was created on the way past.
      expect(await prisma.truck.count()).toBe(0);
    });

    it('adds the vehicle once the account holder is verified', async () => {
      const { owner } = await account({ tier: PlanTier.PERSONAL, createdAt: AFTER_CUTOVER });
      await verifyHolder(owner);

      const response = await addVehicle(owner);

      expect(response.status).toBe(201);
      expect(await prisma.truck.count()).toBe(1);
    });

    it('cannot buy a tracker until the account holder is verified', async () => {
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: AFTER_CUTOVER,
      });
      // A vehicle to fit it to, so the refusal cannot be the "add a vehicle
      // first" one.
      await existingVehicle(organization.id);

      const response = await request({
        method: 'POST',
        url: '/api/v1/subscriptions/trackers',
        user: owner,
        payload: {},
      });

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('IDENTITY_VERIFICATION_REQUIRED');
      // Refused before the charge: no hardware bought, nothing to refund.
      expect(await prisma.vehicleTracker.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // An account that predates the cutover
  // -------------------------------------------------------------------------

  describe('a Personal account created before the cutover', () => {
    it('keeps using the vehicles it already runs', async () => {
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: BEFORE_CUTOVER,
      });
      const vehicleId = await existingVehicle(organization.id);

      // Reading the fleet, and one vehicle in it, is untouched by a rule that
      // guards additions.
      const list = await request<{ items: { id: string }[] }>({
        method: 'GET',
        url: '/api/v1/fleet/vehicles',
        user: owner,
      });
      expect(list.status).toBe(200);
      expect(list.body.data.items.map((entry) => entry.id)).toContain(vehicleId);

      const detail = await request({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicleId}`,
        user: owner,
      });
      expect(detail.status).toBe(200);
    });

    it('keeps its telemetry', async () => {
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: BEFORE_CUTOVER,
      });
      const vehicleId = await existingVehicle(organization.id);

      // What a tracker reads keeps flowing. This is the guarantee that makes
      // the rule safe to introduce: an owner who has not got round to verifying
      // does not lose sight of a vehicle that is out on the road.
      const response = await request({
        method: 'GET',
        url: `/api/v1/telemetry/vehicles/${vehicleId}/capabilities`,
        user: owner,
      });

      expect(response.status).toBe(200);
    });

    it('must still verify before adding a new vehicle, and is told why', async () => {
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: BEFORE_CUTOVER,
      });
      await existingVehicle(organization.id);

      const response = await addVehicle(owner);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('IDENTITY_VERIFICATION_REQUIRED');
      // Flagged as an existing account, which is what lets the client say "your
      // vehicles carry on as they are" rather than implying a suspension.
      expect(response.body.error?.details?.grandfathered).toBe(true);
      expect(response.body.error?.message).toMatch(/already run|carry on/i);

      // And the vehicle they already had is still there.
      expect(await prisma.truck.count()).toBe(1);
    });

    it('adds the new vehicle once verified, keeping the old one', async () => {
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: BEFORE_CUTOVER,
      });
      await existingVehicle(organization.id);
      await verifyHolder(owner);

      const response = await addVehicle(owner);

      expect(response.status).toBe(201);
      expect(await prisma.truck.count()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Everybody else
  // -------------------------------------------------------------------------

  describe('the account types this rule does not touch', () => {
    it('lets a Business fleet owner add a vehicle without it', async () => {
      // A fleet is a business and proves itself with business documents. Gating
      // its fleet on one person's Aadhaar would be answering the wrong question
      // about the wrong subject.
      const { owner } = await account({
        tier: PlanTier.BUSINESS,
        type: OrganizationType.FLEET_OWNER,
        role: RoleName.FLEET_OWNER,
        createdAt: AFTER_CUTOVER,
      });

      const response = await addVehicle(owner);
      expect(response.status).toBe(201);
    });

    it('lets a Business mobility provider add a vehicle without it', async () => {
      const { owner } = await account({
        tier: PlanTier.BUSINESS,
        type: OrganizationType.MOBILITY_PROVIDER,
        role: RoleName.MOBILITY_PROVIDER,
        createdAt: AFTER_CUTOVER,
      });

      const response = await addVehicle(owner);
      expect(response.status).toBe(201);
    });

    it('refuses a supplier for being a supplier, not for an unverified Aadhaar', async () => {
      // A supplier sells material out of a yard and runs no vehicles at all, so
      // it is refused a long way before this rule — and must be told the real
      // reason rather than sent to verify an Aadhaar that would not help.
      const { owner } = await account({
        tier: PlanTier.BUSINESS,
        type: OrganizationType.SUPPLIER,
        role: RoleName.SUPPLIER,
        createdAt: AFTER_CUTOVER,
      });

      const response = await addVehicle(owner);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).not.toBe('IDENTITY_VERIFICATION_REQUIRED');
    });

    it('refuses a Free account for being Free, not for an unverified Aadhaar', async () => {
      const { owner } = await account({
        tier: PlanTier.FREE,
        type: OrganizationType.CUSTOMER,
        role: RoleName.CUSTOMER,
        createdAt: AFTER_CUTOVER,
      });

      const response = await addVehicle(owner);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).not.toBe('IDENTITY_VERIFICATION_REQUIRED');
    });

    it('never consults a driver’s own verification, in either direction', async () => {
      // The two are separate concepts sharing a document. A Personal owner who
      // also drives clears the driver checks on their driver profile; that does
      // not verify the account, and verifying the account does not clear them
      // to drive.
      const { organization, owner } = await account({
        tier: PlanTier.PERSONAL,
        createdAt: AFTER_CUTOVER,
      });

      // A fully verified driver profile against the very same person.
      await prisma.driver.create({
        data: {
          userId: owner.id,
          organizationId: organization.id,
          licenseNumber: unique('DL-'),
          verificationStatus: VerificationStatus.VERIFIED,
          aadhaarLast4: VALID_AADHAAR_LAST4,
          aadhaarVerifiedAt: new Date(),
          panVerifiedAt: new Date(),
          voterIdVerifiedAt: new Date(),
          licenceVerifiedAt: new Date(),
        },
      });

      // Still refused: a DRIVER_AADHAAR is not a USER_AADHAAR.
      const refused = await addVehicle(owner);
      expect(refused.status).toBe(403);
      expect(refused.body.error?.code).toBe('IDENTITY_VERIFICATION_REQUIRED');

      // And the account-holder check alone is what releases it.
      await verifyHolder(owner);
      const allowed = await addVehicle(owner);
      expect(allowed.status).toBe(201);
    });
  });

  it('reads the cutover from configuration rather than a constant', () => {
    // Pinned in tests/setup.ts. Asserted so that changing the env var without
    // changing these fixtures fails loudly rather than quietly reclassifying
    // every account in the suite.
    expect(process.env.PERSONAL_AADHAAR_REQUIRED_FROM).toBe(CUTOVER.toISOString());
    expect(BEFORE_CUTOVER.getTime()).toBeLessThan(CUTOVER.getTime());
    expect(AFTER_CUTOVER.getTime()).toBeGreaterThan(CUTOVER.getTime());
  });
});
