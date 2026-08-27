import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OrganizationType,
  PlanTier,
  QrField,
  QrPrivacyProfile,
  RoleName,
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
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * QR field privacy.
 *
 * The scope tests in `expansion-batch2` cover *which categories* a scan
 * discloses. These cover what happens inside a granted category: how much of
 * each value the person holding the phone actually sees, and — the part worth
 * being certain about — that an owner's policy can only ever narrow that, never
 * widen it past the scanner's relationship.
 */
describe('QR field privacy', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let stranger: TestUser;
  let admin: TestUser;
  let truck: { id: string; registrationNumber: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    stranger = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });
    admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });

    const created = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP32AB').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        manufacturer: 'Tata Motors',
        model: 'Prima',
        year: 2022,
        capacityTons: 25,
      },
    });
    truck = { id: created.id, registrationNumber: created.registrationNumber };
  });

  /** Issue a code for the truck and return its token. */
  async function issueVehicleCode(publicResolve = false): Promise<string> {
    await request({
      method: 'GET',
      url: `/api/v1/qr/subject/vehicle/${truck.id}`,
      user: owner,
    });
    const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: truck.id } });
    if (publicResolve) {
      await prisma.qrCode.update({
        where: { id: code.id },
        data: { allowPublicResolve: true },
      });
    }
    return code.token;
  }

  interface ScanBody {
    identity: { displayName: string; imageUrl: string | null };
    vehicle?: {
      registrationNumber: string;
      manufacturer: string | null;
      model: string | null;
      status: string;
    };
    service?: { health: string; lastServiceDate: string | null };
    finance?: { financed: boolean };
    contact?: { phone: string | null };
    rc?: {
      registrationNumber: string;
      source: string;
      record: {
        registrationNumber: string | null;
        chassisNumber: string | null;
        engineNumber: string | null;
        maker: string | null;
        insuranceValidUntil: string | null;
        redacted: boolean;
        owner: {
          name: string | null;
          fatherName: string | null;
          mobileNumber: string | null;
          presentAddress: string | null;
          permanentAddress: string | null;
        } | null;
      };
    };
    licence?: {
      licenceNumber: string;
      source: string;
      record: {
        licenceNumber: string | null;
        redacted: boolean;
        holder: {
          name: string | null;
          dateOfBirth: string | null;
          bloodGroup: string | null;
          permanentAddress: string | null;
        } | null;
      };
    };
    privacy?: {
      profile: string;
      profileLabel: string;
      maskedFields: string[];
      hiddenFields: string[];
    };
  }

  const scan = (token: string, user?: TestUser) =>
    request<ScanBody>({
      method: 'GET',
      url: `/api/v1/qr/resolve/${token}`,
      ...(user ? { user } : {}),
    });

  // -------------------------------------------------------------------------

  describe('profiles', () => {
    it('reports the fleet member as the owner profile', async () => {
      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);
      expect(body.data.privacy?.profile).toBe(QrPrivacyProfile.OWNER);
      expect(body.data.privacy?.profileLabel).toBe('Fleet member');
    });

    it('reports an unrelated signed-in account as basic-verified', async () => {
      const token = await issueVehicleCode();
      const { body } = await scan(token, stranger);
      expect(body.data.privacy?.profile).toBe(QrPrivacyProfile.BASIC_VERIFIED);
    });

    it('reports platform staff as the admin profile', async () => {
      const token = await issueVehicleCode();
      const { body } = await scan(token, admin);
      expect(body.data.privacy?.profile).toBe(QrPrivacyProfile.ADMIN);
    });

    it('reports an anonymous scan as public', async () => {
      const token = await issueVehicleCode(true);
      const { status, body } = await scan(token);
      expect(status).toBe(200);
      expect(body.data.privacy?.profile).toBe(QrPrivacyProfile.PUBLIC);
    });
  });

  // -------------------------------------------------------------------------

  describe('default disclosure', () => {
    it('shows the fleet its own vehicle in full', async () => {
      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);

      expect(body.data.vehicle?.registrationNumber).toBe(truck.registrationNumber);
      expect(body.data.vehicle?.manufacturer).toBe('Tata Motors');
      expect(body.data.privacy?.maskedFields).toEqual([]);
    });

    it('answers a public scan with the registration, which is painted on the truck anyway', async () => {
      const token = await issueVehicleCode(true);
      const { body } = await scan(token);
      expect(body.data.identity.displayName).toBe(truck.registrationNumber);
    });

    it('answers a public scan with the vehicle block a roadside check needs', async () => {
      const token = await issueVehicleCode(true);
      const { body } = await scan(token);

      // VEHICLE_SUMMARY is part of the public verification set. The plate, the
      // maker and the model are visible to anyone standing in front of the
      // truck, so withholding them would protect nothing while making the
      // sticker useless.
      expect(body.data.vehicle?.registrationNumber).toBe(truck.registrationNumber);
      expect(body.data.vehicle?.manufacturer).toBe('Tata Motors');
    });

    it('still withholds the driver phone from a public scan', async () => {
      const token = await issueVehicleCode(true);
      const { body } = await scan(token);

      // CONTACT is outside the anonymous ceiling entirely, so no field policy
      // can put a phone number on a public sticker.
      expect(body.data.contact).toBeUndefined();
    });

    it('gives the fleet a rule-based service verdict, not a maintenance ledger', async () => {
      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);

      // No completed service on record must not read as "Healthy".
      expect(body.data.service?.health).toBe('No service recorded');
      expect(body.data.service?.lastServiceDate).toBeNull();
    });

    it('reports service overdue when a scheduled job has passed its date', async () => {
      await prisma.maintenanceRecord.create({
        data: {
          truckId: truck.id,
          organizationId: fleet.id,
          type: 'PREVENTIVE',
          title: 'Engine oil',
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() - 10 * 86_400_000),
        },
      });

      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);
      expect(body.data.service?.health).toBe('Service overdue');
    });

    it('tells the fleet whether the vehicle is financed, without any amounts', async () => {
      await prisma.vehicleLoan.create({
        data: {
          organizationId: fleet.id,
          vehicleId: truck.id,
          loanNumber: unique('LOAN-').toUpperCase().slice(0, 16),
          lenderName: 'Shriram Finance',
          principal: 1_000_000,
          annualRatePercent: 12,
          tenureMonths: 12,
          startDate: new Date(),
          firstDueDate: new Date(),
          emiAmount: 88_849,
        },
      });

      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);

      expect(body.data.finance).toEqual({ financed: true });
      // The amounts are not in the payload at any level — see QrField, where
      // the loan number, EMI and outstanding balance map to no scope at all.
      expect(JSON.stringify(body.data)).not.toContain('88849');
    });

    it('shows an unrelated scanner the finance flag, and never the amounts', async () => {
      await prisma.vehicleLoan.create({
        data: {
          organizationId: fleet.id,
          vehicleId: truck.id,
          loanNumber: unique('LOAN-').toUpperCase().slice(0, 16),
          lenderName: 'Shriram Finance',
          principal: 1_000_000,
          annualRatePercent: 12,
          tenureMonths: 12,
          startDate: new Date(),
          firstDueDate: new Date(),
          emiAmount: 88_849,
        },
      });

      const token = await issueVehicleCode();
      const { body } = await scan(token, stranger);

      // "Financed" as a bare fact is on the RC anyway, and is what a buyer or
      // an inspector legitimately needs.
      expect(body.data.finance).toEqual({ financed: true });
      // The amounts map to no scope at all, so they are absent at every level.
      expect(JSON.stringify(body.data)).not.toContain('88849');
    });
  });

  // -------------------------------------------------------------------------

  /*
   * The two RTO records the sticker reproduces.
   *
   * A Saarthi code is meant to answer, at the roadside, the questions the paper
   * RC and licence in the cab already answer — so the stored certificate is
   * disclosed rather than a summary of it. These cover that it arrives whole,
   * that the two highest-risk blocks are switchable, and that the one field
   * which is medical data rather than vehicle data stays behind the emergency
   * scope wherever it happens to be stored.
   */
  describe('RTO records', () => {
    /** Seed a stored RC lookup, in the shape the lookup module writes. */
    async function storeRcLookup(): Promise<void> {
      await prisma.vehicleLookup.create({
        data: {
          registrationNumber: truck.registrationNumber,
          organizationId: fleet.id,
          responseData: {
            registrationNumber: truck.registrationNumber,
            registrationDate: '2022-04-11',
            registrationStatus: 'ACTIVE',
            owner: {
              name: 'Ramesh Kumar',
              fatherName: 'Suresh Kumar',
              serialNumber: '1',
              mobileNumber: '9876543210',
              presentAddress: '12 Station Road, Kanpur',
              permanentAddress: '12 Station Road, Kanpur',
            },
            maker: 'Tata Motors',
            model: 'Prima',
            vehicleClass: 'HGV',
            fuelType: 'DIESEL',
            chassisNumber: 'MAT456789012345678',
            engineNumber: 'ENG9876543210',
            insurer: 'ICICI Lombard',
            insurancePolicyNumber: 'POL123456789',
            insuranceValidUntil: '2027-04-10',
            fitnessValidUntil: '2027-04-10',
            puccValidUntil: '2026-10-10',
            tax: { validUntil: '2027-03-31', paidUntil: '2026-03-31' },
            permit: {
              number: 'PMT-1',
              type: 'NATIONAL',
              issuedOn: null,
              validFrom: null,
              validUntil: '2027-01-01',
              national: { number: 'NP-1', validUntil: '2027-01-01', issuedBy: 'UP' },
            },
            financed: true,
            financer: 'Shriram Finance',
            nonUse: { status: null, from: null, to: null },
            maskedByProvider: { ownerName: false, chassisNumber: false, engineNumber: false },
            redacted: false,
          },
          // Well inside the retention window: an expired row is data Saarthi
          // has undertaken to stop showing, and the scan must skip it.
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    }

    it('reproduces the registration certificate on a public scan', async () => {
      await storeRcLookup();
      const token = await issueVehicleCode(true);
      const { body } = await scan(token);

      expect(body.data.rc?.source).toBe('VEHICLE');
      expect(body.data.rc?.record.maker).toBe('Tata Motors');
      expect(body.data.rc?.record.insuranceValidUntil).toBe('2027-04-10');
      // The identifiers printed on the certificate itself.
      expect(body.data.rc?.record.chassisNumber).toBe('MAT456789012345678');
      expect(body.data.rc?.record.engineNumber).toBe('ENG9876543210');
      expect(body.data.rc?.record.owner?.name).toBe('Ramesh Kumar');
      expect(body.data.rc?.record.redacted).toBe(false);
    });

    it('skips a stored record that is past its retention boundary', async () => {
      await prisma.vehicleLookup.create({
        data: {
          registrationNumber: truck.registrationNumber,
          organizationId: fleet.id,
          responseData: { registrationNumber: truck.registrationNumber, maker: 'Stale' },
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      });

      const token = await issueVehicleCode(true);
      const { body } = await scan(token);
      expect(body.data.rc).toBeUndefined();
    });

    it("lets a fleet close the owner's contact block without losing the rest", async () => {
      await storeRcLookup();

      const saved = await request({
        method: 'PUT',
        url: '/api/v1/qr/privacy-policy',
        user: owner,
        payload: {
          overrides: {
            [QrField.DOCUMENT_RC_OWNER_CONTACT]: { disabled: true },
          },
        },
      });
      expect(saved.status).toBe(200);

      const token = await issueVehicleCode(true);
      const { body } = await scan(token);

      // The address and phone are gone…
      expect(body.data.rc?.record.owner?.mobileNumber).toBeNull();
      expect(body.data.rc?.record.owner?.presentAddress).toBeNull();
      expect(body.data.rc?.record.owner?.permanentAddress).toBeNull();
      // …the certificate still answers the question it is there to answer…
      expect(body.data.rc?.record.maker).toBe('Tata Motors');
      expect(body.data.rc?.record.owner?.name).toBe('Ramesh Kumar');
      // …and the record says plainly that it is partial.
      expect(body.data.rc?.record.redacted).toBe(true);
    });

    it('masks the chassis number when the fleet raises the bar on it', async () => {
      await storeRcLookup();

      await request({
        method: 'PUT',
        url: '/api/v1/qr/privacy-policy',
        user: owner,
        payload: {
          overrides: {
            [QrField.DOCUMENT_CHASSIS_NUMBER]: { maskBelow: QrPrivacyProfile.OWNER },
          },
        },
      });

      const token = await issueVehicleCode(true);
      const { body } = await scan(token);

      expect(body.data.rc?.record.chassisNumber).not.toBe('MAT456789012345678');
      expect(body.data.rc?.record.chassisNumber).toContain('5678');
      expect(body.data.rc?.record.redacted).toBe(true);
    });

    it("releases a licence but never the holder's blood group to a public scan", async () => {
      const driverUser = await createUser({
        role: RoleName.DRIVER,
        organizationId: fleet.id,
        driver: true,
      });
      const driverRecord = await prisma.driver.findUniqueOrThrow({
        where: { id: driverUser.driverId! },
      });

      await prisma.licenceLookup.create({
        data: {
          licenceNumber: driverRecord.licenseNumber.toUpperCase().replace(/[\s-]/g, ''),
          driverId: driverRecord.id,
          organizationId: fleet.id,
          responseData: {
            licenceNumber: driverRecord.licenseNumber,
            state: 'UP',
            holder: {
              name: 'Ramesh Kumar',
              fatherOrHusbandName: 'Suresh Kumar',
              gender: 'M',
              dateOfBirth: '1988-02-14',
              bloodGroup: 'B+',
              citizenship: 'IND',
              permanentAddress: '12 Station Road, Kanpur',
              permanentZip: '208001',
              temporaryAddress: null,
              temporaryZip: null,
            },
            issuingAuthority: 'RTO Kanpur',
            issuedOn: '2012-06-01',
            validUntil: '2032-06-01',
            transportValidUntil: '2027-06-01',
            vehicleClasses: ['LMV-NT', 'HTV'],
            redacted: false,
          },
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });

      await request({
        method: 'GET',
        url: `/api/v1/qr/subject/driver/${driverRecord.id}`,
        user: owner,
      });
      const code = await prisma.qrCode.findFirstOrThrow({
        where: { subjectId: driverRecord.id },
      });

      const { body } = await scan(code.token);

      expect(body.data.licence?.source).toBe('DRIVER');
      expect(body.data.licence?.record.holder?.name).toBe('Ramesh Kumar');
      expect(body.data.licence?.record.holder?.dateOfBirth).toBe('1988-02-14');

      // A blood group is medical data wherever it is stored. It belongs to the
      // EMERGENCY scope, which no anonymous scan ever reaches.
      expect(body.data.licence?.record.holder?.bloodGroup).toBeNull();
      expect(body.data.licence?.record.redacted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------

  describe('owner policy', () => {
    const putPolicy = (payload: unknown, user: TestUser = owner) =>
      request({ method: 'PUT', url: '/api/v1/qr/privacy-policy', user, payload });

    it('returns the field catalogue with the defaults', async () => {
      const { status, body } = await request<{
        allowPublicScans: boolean;
        fields: { field: string; configurable: boolean; effectiveMinProfile: string }[];
      }>({ method: 'GET', url: '/api/v1/qr/privacy-policy', user: owner });

      expect(status).toBe(200);
      expect(body.data.allowPublicScans).toBe(true);
      const address = body.data.fields.find((field) => field.field === QrField.DRIVER_ADDRESS);
      // A home address is present in the catalogue so an owner can see that
      // Saarthi never discloses it — and is not configurable.
      expect(address?.configurable).toBe(false);
    });

    it('lets an owner switch a field off', async () => {
      await putPolicy({ overrides: { [QrField.VEHICLE_MAKE_MODEL]: { disabled: true } } });

      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);

      expect(body.data.vehicle?.manufacturer).toBeNull();
      expect(body.data.vehicle?.model).toBeNull();
      expect(body.data.privacy?.hiddenFields).toContain(QrField.VEHICLE_MAKE_MODEL);
    });

    it('lets an owner raise the bar on a field', async () => {
      await putPolicy({
        overrides: { [QrField.VEHICLE_STATUS]: { minProfile: QrPrivacyProfile.ADMIN } },
      });

      const token = await issueVehicleCode();
      const { body } = await scan(token, owner);
      expect(body.data.vehicle?.status).toBe('UNDISCLOSED');
    });

    it('strips an override on a field Saarthi does not allow configuring', async () => {
      await putPolicy({
        overrides: {
          [QrField.DRIVER_ADDRESS]: { minProfile: QrPrivacyProfile.PUBLIC },
          [QrField.VEHICLE_STATUS]: { minProfile: QrPrivacyProfile.ADMIN },
        },
      });

      const stored = await prisma.qrPrivacyPolicy.findUniqueOrThrow({
        where: { organizationId: fleet.id },
      });
      const overrides = stored.overrides as Record<string, unknown>;

      expect(overrides[QrField.DRIVER_ADDRESS]).toBeUndefined();
      // The rest of the same save still applied — one rejected field does not
      // block an owner from tightening everything else.
      expect(overrides[QrField.VEHICLE_STATUS]).toBeDefined();
    });

    it('cannot widen disclosure past what the scanner relationship allows', async () => {
      // The owner marks the driver's phone as visible to anyone. The scope
      // intersection still never grants CONTACT to an unrelated account, so
      // the policy has no effect on them.
      await putPolicy({
        overrides: {
          [QrField.DRIVER_PHONE]: {
            minProfile: QrPrivacyProfile.PUBLIC,
            maskBelow: QrPrivacyProfile.PUBLIC,
          },
        },
      });

      const token = await issueVehicleCode();
      const { body } = await scan(token, stranger);

      expect(body.data.contact).toBeUndefined();
    });

    it('refuses a policy change from someone who cannot manage codes', async () => {
      const manager = await createUser({
        role: RoleName.DISPATCHER,
        organizationId: fleet.id,
      });
      const response = await putPolicy({ allowPublicScans: false }, manager);
      expect(response.status).toBe(403);
    });

    it('does not leak one tenant policy into another', async () => {
      await putPolicy({ overrides: { [QrField.VEHICLE_MAKE_MODEL]: { disabled: true } } });

      const otherTruck = await prisma.truck.create({
        data: {
          organizationId: otherFleet.id,
          registrationNumber: unique('MH12CD').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          manufacturer: 'Ashok Leyland',
          capacityTons: 20,
        },
      });
      await request({
        method: 'GET',
        url: `/api/v1/qr/subject/vehicle/${otherTruck.id}`,
        user: stranger,
      });
      const code = await prisma.qrCode.findFirstOrThrow({ where: { subjectId: otherTruck.id } });

      const { body } = await scan(code.token, stranger);
      expect(body.data.vehicle?.manufacturer).toBe('Ashok Leyland');
    });
  });

  // -------------------------------------------------------------------------

  describe('tenant-level public scan switch', () => {
    it('closes anonymous scanning across every printed code at once', async () => {
      const token = await issueVehicleCode(true);

      const before = await scan(token);
      expect(before.status).toBe(200);

      await request({
        method: 'PUT',
        url: '/api/v1/qr/privacy-policy',
        user: owner,
        payload: { allowPublicScans: false },
      });

      const after = await scan(token);
      // Reported as not-found, like every other anonymous denial, so a scanner
      // cannot learn that the token is real.
      expect(after.status).toBe(404);

      // A signed-in fleet member is unaffected.
      const internal = await scan(token, owner);
      expect(internal.status).toBe(200);
    });

    it('records the denied anonymous attempt', async () => {
      const token = await issueVehicleCode(true);
      await request({
        method: 'PUT',
        url: '/api/v1/qr/privacy-policy',
        user: owner,
        payload: { allowPublicScans: false },
      });

      await scan(token);

      const code = await prisma.qrCode.findFirstOrThrow({ where: { token } });
      const scans = await prisma.qrScan.findMany({ where: { qrCodeId: code.id } });
      expect(scans.some((row) => row.result === 'DENIED')).toBe(true);
    });
  });
});
