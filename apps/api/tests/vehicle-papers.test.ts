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
  type VehicleOwnershipView,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import type { OwnerPapersWallet } from '../src/modules/vehicles/vehicle-papers.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unlockSecureAccess,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * The owner app's Papers screen: folders, the virtual RC and photographs for
 * one vehicle, in one answer.
 *
 * The risks worth testing are the ones the app shipped with before this: a
 * vehicle whose papers came from the RTO register showing "no papers", an RC
 * shown in full to an account that has not proved it owns the vehicle, and a
 * vehicle id that answers for somebody else's business.
 */

const PLATE = 'UP32AB1234';
const RC_OWNER = 'SNEHA MOHANTY';
/** A year out, so the register's insurance date reads as valid. */
const INSURED_UNTIL = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

function rcRecord(): VehicleRcRecord {
  return {
    registrationNumber: PLATE,
    registrationDate: '2019-04-02',
    registrationStatus: 'ACTIVE',
    owner: {
      name: RC_OWNER,
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
    insurer: 'TEST INSURANCE CO',
    insurancePolicyNumber: 'POL-0001',
    insuranceValidUntil: INSURED_UNTIL,
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

async function storeRc(organizationId: string) {
  return prisma.vehicleLookup.create({
    data: {
      registrationNumber: PLATE,
      organizationId,
      provider: 'test',
      responseData: rcRecord() as unknown as object,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

/** A government-verified PAN in the RC owner's name, which is what proves ownership. */
async function verifyPan(userId: string) {
  await prisma.identityVerification.create({
    data: {
      kind: IdentityDocumentKind.PAN,
      subjectType: VerificationSubjectType.USER,
      subjectId: userId,
      numberHash: `hash-${userId}`,
      maskedNumber: 'XXXXX1234X',
      outcome: IdentityVerificationOutcome.VERIFIED,
      holderName: 'Sneha Mohanty',
      verifiedAt: new Date(),
    },
  });
}

async function addVehicle(user: TestUser) {
  const created = await request<{ id: string; ownership: VehicleOwnershipView }>({
    method: 'POST',
    url: '/api/v1/fleet/vehicles',
    user,
    payload: {
      registrationNumber: PLATE,
      vehicleType: VehicleType.TRUCK,
      truckType: TruckType.OPEN_BODY,
      capacityTons: 25,
      fuelType: 'DIESEL',
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data;
}

const wallet = (user: TestUser, vehicleId: string) =>
  request<OwnerPapersWallet>({ method: 'GET', url: `/api/v1/fleet/vehicles/${vehicleId}/papers`, user });

describe('owner papers wallet', () => {
  let fleet: TestOrganization;
  let owner: TestUser;

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
  });

  it('files papers from the RTO register when nothing was uploaded', async () => {
    await storeRc(fleet.id);
    const vehicle = await addVehicle(owner);

    const answer = await wallet(owner, vehicle.id);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const folders = answer.body.data.folders;

    const rc = folders.find((folder) => folder.id === 'REGISTRATION_CERTIFICATE');
    expect(rc?.status).toBe('ON_FILE');
    const insurance = folders.find((folder) => folder.id === 'INSURANCE');
    expect(insurance?.status).toBe('VALID');
    expect(insurance?.registerValidUntil).toBe(INSURED_UNTIL);
    // The photographs and the QR sticker sit beside the papers, as on the web.
    expect(folders.map((folder) => folder.id)).toEqual(expect.arrayContaining(['PHOTOS', 'QR']));
    expect(answer.body.data.rc?.insurer).toBe('TEST INSURANCE CO');
  });

  it('masks the RC owner until ownership is proved and the PIN entered', async () => {
    await storeRc(fleet.id);
    const vehicle = await addVehicle(owner);
    expect(vehicle.ownership.status).not.toBe(VehicleOwnershipStatus.VERIFIED);

    const masked = await wallet(owner, vehicle.id);
    expect(masked.body.data.rc?.access).toBe(RcDetailAccess.OWNERSHIP_REQUIRED);
    expect(masked.body.data.rc?.ownerName).not.toBe(RC_OWNER);
    expect(masked.body.data.rc?.chassisNumber).not.toBe('CHS123456789');
  });

  it('shows the RC in full to a verified owner who has entered the PIN', async () => {
    await storeRc(fleet.id);
    await verifyPan(owner.id);
    const vehicle = await addVehicle(owner);
    expect(vehicle.ownership.status).toBe(VehicleOwnershipStatus.VERIFIED);

    const locked = await wallet(owner, vehicle.id);
    expect(locked.body.data.rc?.access).toBe(RcDetailAccess.LOCKED);

    await unlockSecureAccess(owner);
    const full = await wallet(owner, vehicle.id);
    expect(full.body.data.rc?.access).toBe(RcDetailAccess.FULL);
    expect(full.body.data.rc?.ownerName).toBe(RC_OWNER);
  });

  it('files an uploaded paper in its own folder', async () => {
    const vehicle = await addVehicle(owner);
    const expires = new Date(Date.now() + 10 * 86_400_000);
    const uploaded = await prisma.document.create({
      data: {
        ownerType: 'TRUCK',
        ownerId: vehicle.id,
        organizationId: fleet.id,
        documentType: 'INSURANCE',
        documentNumber: 'INS-42',
        expiryDate: expires,
        storageKey: 'documents/test.pdf',
        fileName: 'insurance.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        uploadedById: owner.id,
      },
    });

    const answer = await wallet(owner, vehicle.id);
    const insurance = answer.body.data.folders.find((folder) => folder.id === 'INSURANCE');
    expect(insurance?.documentIds).toEqual([uploaded.id]);
    expect(insurance?.status).toBe('EXPIRING_SOON');
    expect(answer.body.data.documents.map((document) => document.id)).toContain(uploaded.id);
    // No register record: the RC folder is missing, not quietly fine.
    expect(answer.body.data.rc).toBeNull();
    expect(
      answer.body.data.folders.find((folder) => folder.id === 'REGISTRATION_CERTIFICATE')?.status,
    ).toBe('MISSING');
  });

  it("answers 404 for another business's vehicle", async () => {
    const vehicle = await addVehicle(owner);
    const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER);
    const stranger = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });

    const answer = await wallet(stranger, vehicle.id);
    expect(answer.status).toBe(404);
  });
});
