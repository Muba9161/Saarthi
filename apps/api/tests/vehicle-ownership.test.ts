import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IdentityDocumentKind,
  IdentityVerificationOutcome,
  OrganizationType,
  RcDetailAccess,
  RoleName,
  TruckType,
  VehicleOwnershipStatus,
  VehicleType,
  VerificationSubjectType,
  type VehicleLookupResult,
  type VehicleOwnershipView,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { runVehicleOwnershipSweep } from '../src/modules/vehicles/vehicle-ownership.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  requestRaw,
  resetDatabase,
  unlockSecureAccess,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Vehicle ownership, automatically: an account sees a vehicle's owner unmasked,
 * and can take a plate from another account, only once the RC owner's name
 * matches a government-verified name on it. Every test seeds the stored RC
 * record directly, so no provider is ever called.
 */

const PLATE = 'UP32AB1234';
const RC_OWNER = 'SNEHA MOHANTY';

function rcRecord(ownerName: string = RC_OWNER): VehicleRcRecord {
  return {
    registrationNumber: PLATE,
    registrationDate: '2019-04-02',
    registrationStatus: 'ACTIVE',
    owner: {
      name: ownerName,
      fatherName: null,
      serialNumber: '1',
      mobileNumber: '9800000000',
      presentAddress: 'Jagatsinghapur, 754119',
      permanentAddress: null,
    },
    vehicleCategory: 'HGV',
    vehicleClass: 'Heavy Goods Vehicle',
    bodyType: 'OPEN BODY',
    maker: 'TATA MOTORS LTD',
    model: 'SIGNA 4018.S',
    variant: null,
    fuelType: 'DIESEL',
    color: 'WHITE',
    emissionNorms: 'BHARAT STAGE VI',
    manufacturedOn: '2019-02',
    engineNumber: 'ENG123456',
    chassisNumber: 'CHS123456789',
    cubicCapacity: 5883,
    cylinders: 6,
    seatingCapacity: 2,
    sleeperCapacity: null,
    standingCapacity: null,
    wheelbaseMm: 3880,
    grossVehicleWeight: 40000,
    unladenWeight: 8000,
    rto: 'RTO LUCKNOW',
    rtoCode: 'UP32',
    insurer: null,
    insurancePolicyNumber: null,
    insuranceValidUntil: null,
    puccNumber: null,
    puccValidUntil: null,
    fitnessValidUntil: null,
    tax: { validUntil: null, paidUntil: null },
    permit: {
      number: null,
      type: null,
      issuedOn: null,
      validFrom: null,
      validUntil: null,
      national: { number: null, validUntil: null, issuedBy: null },
    },
    financed: false,
    financer: null,
    blacklistStatus: null,
    nocDetails: null,
    nonUse: { status: null, from: null, to: null },
    challanDetails: null,
    dataAsOf: '2026-06-01',
    partialRecord: false,
    maskedByProvider: { ownerName: false, chassisNumber: false, engineNumber: false },
    redacted: false,
  };
}

async function storeRc(
  organizationId: string,
  options: { pdf?: boolean; ownerName?: string } = {},
) {
  return prisma.vehicleLookup.create({
    data: {
      registrationNumber: PLATE,
      organizationId,
      provider: 'test',
      responseData: rcRecord(options.ownerName) as unknown as object,
      pdfStorageKey: options.pdf ? 'vehicle-rc/test.pdf' : null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

/** A government-verified PAN on the user, which is what a name is matched against. */
async function verifyPan(userId: string, holderName: string) {
  await prisma.identityVerification.create({
    data: {
      kind: IdentityDocumentKind.PAN,
      subjectType: VerificationSubjectType.USER,
      subjectId: userId,
      numberHash: `hash-${userId}`,
      maskedNumber: 'XXXXX1234X',
      outcome: IdentityVerificationOutcome.VERIFIED,
      holderName,
      verifiedAt: new Date(),
    },
  });
}

async function addVehicle(user: TestUser, registrationNumber = PLATE) {
  return request<{ id: string; ownership: VehicleOwnershipView }>({
    method: 'POST',
    url: '/api/v1/fleet/vehicles',
    user,
    payload: {
      registrationNumber,
      vehicleType: VehicleType.TRUCK,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 25,
      fuelType: 'DIESEL',
    },
  });
}

const storedLookup = (user: TestUser) =>
  request<VehicleLookupResult>({
    method: 'GET',
    url: `/api/v1/vehicles/lookups/latest?registrationNumber=${PLATE}`,
    user,
  });

describe('vehicle ownership', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let otherFleet: TestOrganization;
  let otherOwner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);
    otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
  });

  describe('confirming ownership', () => {
    it('confirms it on add when the RC owner matches the director’s verified PAN', async () => {
      await storeRc(fleet.id);
      await verifyPan(owner.id, 'Sneha Mohanty');

      const created = await addVehicle(owner);

      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);
    });

    it('matches a company RC against the business’s verified GST legal name', async () => {
      await storeRc(fleet.id, { ownerName: 'M/S SHARMA ROADWAYS PVT LTD' });
      await prisma.organization.update({
        where: { id: fleet.id },
        data: { gstLegalName: 'SHARMA ROADWAYS PRIVATE LIMITED', gstVerifiedAt: new Date() },
      });

      const created = await addVehicle(owner);

      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);
    });

    it('does not count a profile name, which anyone can type', async () => {
      await storeRc(fleet.id);
      await prisma.user.update({
        where: { id: owner.id },
        data: { firstName: 'Sneha', lastName: 'Mohanty' },
      });

      const created = await addVehicle(owner);

      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.PENDING);
      expect(created.body.data.ownership.note).toMatch(/no government-verified name/i);
    });

    it('never repeats the RC owner’s name in the explanation', async () => {
      await storeRc(fleet.id);
      await verifyPan(owner.id, 'Amit Kumar Verma');

      const created = await addVehicle(owner);

      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.PENDING);
      expect(JSON.stringify(created.body)).not.toContain('SNEHA');
    });

    it('confirms it on "Check again" once a PAN has been verified since', async () => {
      await storeRc(fleet.id);
      const created = await addVehicle(owner);
      await verifyPan(owner.id, RC_OWNER);

      const checked = await request<VehicleOwnershipView>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${created.body.data.id}/ownership/check`,
        user: owner,
      });

      expect(checked.status).toBe(200);
      expect(checked.body.data.status).toBe(VehicleOwnershipStatus.VERIFIED);
    });

    it('confirms it in the background once a PAN has been verified since', async () => {
      await storeRc(fleet.id);
      const created = await addVehicle(owner);
      await verifyPan(owner.id, RC_OWNER);
      await prisma.truck.update({
        where: { id: created.body.data.id },
        data: { ownershipCheckedAt: null },
      });

      const result = await runVehicleOwnershipSweep();

      expect(result.checked).toBeGreaterThanOrEqual(1);
      const vehicle = await prisma.truck.findUniqueOrThrow({ where: { id: created.body.data.id } });
      expect(vehicle.ownershipStatus).toBe(VehicleOwnershipStatus.VERIFIED);
      // Unconfirmed vehicles are never archived for it.
      expect(vehicle.archivedAt).toBeNull();
    });

    it('does not let another account check someone else’s vehicle', async () => {
      const created = await addVehicle(owner);

      const checked = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${created.body.data.id}/ownership/check`,
        user: otherOwner,
      });

      expect(checked.status).toBe(404);
    });

    it('starts over when the plate is changed', async () => {
      await storeRc(fleet.id);
      await verifyPan(owner.id, RC_OWNER);
      const created = await addVehicle(owner);
      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);

      const updated = await request<{ ownership: VehicleOwnershipView }>({
        method: 'PATCH',
        url: `/api/v1/fleet/vehicles/${created.body.data.id}`,
        user: owner,
        payload: { registrationNumber: 'UP32ZZ9999' },
      });

      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.data.ownership.status).toBe(VehicleOwnershipStatus.PENDING);
    });

    it('refuses a PAN already verified on another account', async () => {
      await prisma.user.update({
        where: { id: otherOwner.id },
        data: { panNumber: 'ABCPE1234F', panVerifiedAt: new Date() },
      });

      const attempt = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: owner,
        payload: {
          kind: IdentityDocumentKind.PAN,
          subjectType: VerificationSubjectType.USER,
          subjectId: owner.id,
          number: 'ABCPE1234F',
        },
      });

      expect(attempt.status).toBe(409);
      expect(attempt.body.error?.message).toMatch(/already verified on another/i);
    });
  });

  describe('RC details', () => {
    it('stay masked, certificate included, until ownership is confirmed — PIN or not', async () => {
      await storeRc(fleet.id, { pdf: true });
      await addVehicle(owner);
      await unlockSecureAccess(owner);

      const stored = await storedLookup(owner);

      expect(stored.status).toBe(200);
      expect(stored.body.data.access).toBe(RcDetailAccess.OWNERSHIP_REQUIRED);
      expect(stored.body.data.vehicle.owner?.name).toBe('SNEHA M.');
      expect(stored.body.data.vehicle.owner?.mobileNumber).toBe('98******00');
      expect(JSON.stringify(stored.body)).not.toContain('9800000000');

      const pdf = await requestRaw({
        method: 'GET',
        url: `/api/v1/vehicles/lookups/${stored.body.data.lookupId}/document`,
        user: owner,
      });
      expect(pdf.status).toBe(403);
    });

    it('stay masked for a confirmed owner until the secure PIN is entered', async () => {
      await storeRc(fleet.id, { pdf: true });
      await verifyPan(owner.id, RC_OWNER);
      await addVehicle(owner);

      const locked = await storedLookup(owner);
      expect(locked.body.data.access).toBe(RcDetailAccess.LOCKED);
      expect(locked.body.data.vehicle.owner?.name).toBe('SNEHA M.');

      const pdf = await request({
        method: 'GET',
        url: `/api/v1/vehicles/lookups/${locked.body.data.lookupId}/document`,
        user: owner,
      });
      expect(pdf.status).toBe(403);
      expect(pdf.body.error?.code).toBe('SECURE_ACCESS_REQUIRED');

      await unlockSecureAccess(owner);
      const unlocked = await storedLookup(owner);
      expect(unlocked.body.data.access).toBe(RcDetailAccess.FULL);
      expect(unlocked.body.data.vehicle.owner?.name).toBe(RC_OWNER);
      expect(unlocked.body.data.vehicle.owner?.mobileNumber).toBe('9800000000');
    });

    it('refuses the certificate from a prefill for a plate that was never added', async () => {
      const lookup = await storeRc(fleet.id, { pdf: true });
      await unlockSecureAccess(owner);

      const pdf = await requestRaw({
        method: 'GET',
        url: `/api/v1/vehicles/lookups/${lookup.id}/document`,
        user: owner,
      });

      expect(pdf.status).toBe(403);
    });
  });

  describe('a plate another account holds', () => {
    it('releases an unconfirmed hold to the account whose verified name matches the RC', async () => {
      const squatted = await addVehicle(otherOwner);
      expect(squatted.body.data.ownership.status).toBe(VehicleOwnershipStatus.PENDING);

      await storeRc(fleet.id);
      await verifyPan(owner.id, RC_OWNER);
      const claimed = await addVehicle(owner);

      expect(claimed.status, JSON.stringify(claimed.body)).toBe(201);
      expect(claimed.body.data.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);

      const released = await prisma.truck.findUniqueOrThrow({
        where: { id: squatted.body.data.id },
      });
      expect(released.ownershipStatus).toBe(VehicleOwnershipStatus.RELEASED);
      expect(released.archivedAt).not.toBeNull();
      expect(released.releasedRegistrationNumber).toBe(PLATE);
      expect(released.registrationNumber).not.toBe(PLATE);

      const restore = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${released.id}/restore`,
        user: otherOwner,
      });
      expect(restore.status).toBe(422);
    });

    it('keeps the hold when the newcomer cannot show the plate is theirs', async () => {
      const squatted = await addVehicle(otherOwner);
      await storeRc(fleet.id);
      await verifyPan(owner.id, 'Amit Kumar Verma');

      const claimed = await addVehicle(owner);

      expect(claimed.status).toBe(409);
      const kept = await prisma.truck.findUniqueOrThrow({ where: { id: squatted.body.data.id } });
      expect(kept.ownershipStatus).toBe(VehicleOwnershipStatus.PENDING);
      expect(kept.archivedAt).toBeNull();
    });

    it('never takes a plate from an account that has confirmed it', async () => {
      await storeRc(otherFleet.id);
      await verifyPan(otherOwner.id, RC_OWNER);
      await addVehicle(otherOwner);
      await verifyPan(owner.id, RC_OWNER);

      const claimed = await addVehicle(owner);

      expect(claimed.status).toBe(409);
      expect(claimed.body.error?.message).toMatch(/already registered/);
    });
  });

  describe('fleet operations while ownership is pending', () => {
    it('still assigns and unassigns a driver', async () => {
      const driver = await createUser({
        role: RoleName.DRIVER,
        organizationId: fleet.id,
        driver: true,
      });
      const created = await addVehicle(owner);
      expect(created.body.data.ownership.status).toBe(VehicleOwnershipStatus.PENDING);

      const assigned = await request<{ currentDriver: { id: string } | null }>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${created.body.data.id}/assign-driver`,
        user: owner,
        payload: { driverId: driver.driverId },
      });
      expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
      expect(assigned.body.data.currentDriver?.id).toBe(driver.driverId);

      const unassigned = await request<{ currentDriver: { id: string } | null }>({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${created.body.data.id}/unassign-driver`,
        user: owner,
      });
      expect(unassigned.status).toBe(200);
      expect(unassigned.body.data.currentDriver).toBeNull();
    });
  });
});
