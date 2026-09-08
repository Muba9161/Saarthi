import { describe, expect, it } from 'vitest';
import {
  RegistryVerificationOutcome,
  advisoryFindings,
  blockingFindings,
  evaluateDrivingLicence,
  evaluateVehicleRegistration,
  invalidNumberEvaluation,
  notFoundEvaluation,
  registrationLooksUsable,
  type DrivingLicenceRecord,
  type VehicleRcRecord,
} from '../index';

/**
 * The rules that decide whether a registry answer verifies a subject.
 *
 * These run with no network, no database and no API key, which matters more
 * here than anywhere else in the codebase: every alternative way of observing
 * this logic costs a billable provider call.
 *
 * `NOW` is fixed so "expired" and "expiring" never depend on the day the suite
 * runs — a test that passes in March and fails in April is worse than no test.
 */

const NOW = new Date('2026-06-15T00:00:00.000Z');

function rcRecord(overrides: Partial<VehicleRcRecord> = {}): VehicleRcRecord {
  return {
    registrationNumber: 'UP32AB1234',
    registrationDate: '2019-04-02',
    registrationStatus: 'ACTIVE',
    owner: {
      name: 'Ramesh Kumar',
      fatherName: null,
      serialNumber: '1',
      mobileNumber: null,
      presentAddress: null,
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
    insurer: 'ICICI Lombard',
    insurancePolicyNumber: 'POL-1',
    insuranceValidUntil: '2027-01-31',
    puccNumber: 'PUC-1',
    puccValidUntil: '2026-12-31',
    fitnessValidUntil: '2027-03-31',
    tax: { validUntil: '2027-03-31', paidUntil: '2026-03-31' },
    permit: {
      number: 'PRM-1',
      type: 'NATIONAL',
      issuedOn: '2024-01-01',
      validFrom: '2024-01-01',
      validUntil: '2029-01-01',
      national: { number: 'NP-1', validUntil: '2029-01-01', issuedBy: 'UP' },
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
    ...overrides,
  };
}

function licenceRecord(overrides: Partial<DrivingLicenceRecord> = {}): DrivingLicenceRecord {
  return {
    licenceNumber: 'UP3220140001234',
    state: 'Uttar Pradesh',
    holder: {
      name: 'Ramesh Kumar',
      fatherOrHusbandName: null,
      gender: 'M',
      dateOfBirth: '1988-03-14',
      bloodGroup: null,
      citizenship: 'IND',
      permanentAddress: null,
      permanentZip: null,
      temporaryAddress: null,
      temporaryZip: null,
    },
    issuingAuthority: 'RTO LUCKNOW',
    issuingAuthorityCode: 'UP32',
    issuedOn: '2014-05-20',
    validUntil: '2034-05-19',
    transportIssuedOn: '2015-01-10',
    transportValidUntil: '2028-01-09',
    vehicleClasses: ['LMV-NT', 'HGMV'],
    hasPhotograph: true,
    partialRecord: false,
    redacted: false,
    ...overrides,
  };
}

const options = { now: NOW };

describe('vehicle registration verification', () => {
  it('verifies a live registration that matches the plate on file', () => {
    const result = evaluateVehicleRegistration(
      rcRecord(),
      { registrationNumber: 'up-32-ab-1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(result.verified).toBe(true);
    expect(result.summary).toContain('UP32AB1234');
    expect(result.summary).toContain('TATA MOTORS LTD SIGNA 4018.S');
    expect(blockingFindings(result)).toHaveLength(0);
  });

  it('refuses a record that belongs to a different vehicle', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({ registrationNumber: 'MH12XY9999' }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.MISMATCH);
    expect(result.verified).toBe(false);
    expect(blockingFindings(result)[0]?.code).toBe('RC_PLATE_MISMATCH');
  });

  it('treats a success envelope with nothing in it as a not-found', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({
        registrationNumber: null,
        registrationDate: null,
        maker: null,
        model: null,
        vehicleClass: null,
        rto: null,
      }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.NOT_FOUND);
    expect(blockingFindings(result)[0]?.code).toBe('RC_EMPTY_RECORD');
  });

  it.each(['CANCELLED', 'RC Cancelled', 'SCRAPPED', 'SUSPENDED', 'DEREGISTERED'])(
    'refuses a registration the RTO reports as %s',
    (status) => {
      const result = evaluateVehicleRegistration(
        rcRecord({ registrationStatus: status }),
        { registrationNumber: 'UP32AB1234' },
        options,
      );

      expect(result.outcome).toBe(RegistryVerificationOutcome.INELIGIBLE);
      expect(blockingFindings(result)[0]?.code).toBe('RC_STATUS_BARRED');
      expect(result.summary).toContain(status);
    },
  );

  it('refuses a blacklisted vehicle', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({ blacklistStatus: 'Blacklisted by RTO LUCKNOW' }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.INELIGIBLE);
    expect(blockingFindings(result)[0]?.code).toBe('RC_BLACKLISTED');
  });

  it.each(['NO', 'None', 'Nil', 'Not Blacklisted', 'CLEAR', ''])(
    'reads %s as a clean blacklist answer rather than a hit',
    (value) => {
      const result = evaluateVehicleRegistration(
        rcRecord({ blacklistStatus: value }),
        { registrationNumber: 'UP32AB1234' },
        options,
      );

      expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    },
  );

  it('verifies a vehicle with lapsed compliance, and says what has lapsed', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({
        insuranceValidUntil: '2026-01-31',
        puccValidUntil: '2026-06-30',
        fitnessValidUntil: null,
      }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    // The registration is live, so the vehicle verifies — the lapses are work
    // the operator now knows about, not grounds to refuse the vehicle.
    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(blockingFindings(result)).toHaveLength(0);

    const codes = advisoryFindings(result).map((entry) => entry.code);
    expect(codes).toContain('RC_INSURANCE_EXPIRED');
    expect(codes).toContain('RC_PUCC_EXPIRING');
    expect(codes).toContain('RC_FITNESS_UNKNOWN');
  });

  it('flags a non-use declaration without blocking on it', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({ nonUse: { status: 'Under non-use', from: '2026-01-01', to: '2026-12-31' } }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    const finding = advisoryFindings(result).find((entry) => entry.code === 'RC_NON_USE');
    expect(finding?.detail).toContain('from 2026-01-01');
    expect(finding?.detail).toContain('to 2026-12-31');
  });

  it('reaches the same verdict for a caller who may not see personal fields', () => {
    // What `redactRecord` strips in the lookup service: owner, chassis, engine.
    const redacted = rcRecord({
      owner: null,
      chassisNumber: null,
      engineNumber: null,
      redacted: true,
    });

    const result = evaluateVehicleRegistration(
      redacted,
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(blockingFindings(result)).toHaveLength(0);
  });

  it('puts blocking findings ahead of advisories', () => {
    const result = evaluateVehicleRegistration(
      rcRecord({ registrationStatus: 'CANCELLED', insuranceValidUntil: '2020-01-01' }),
      { registrationNumber: 'UP32AB1234' },
      options,
    );

    expect(result.findings[0]?.severity).toBe('BLOCKING');
  });
});

describe('driving licence verification', () => {
  it('verifies a current licence that matches the number on file', () => {
    const result = evaluateDrivingLicence(
      licenceRecord(),
      { licenceNumber: 'up32-2014-0001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(result.summary).toContain('Ramesh Kumar');
    expect(blockingFindings(result)).toHaveLength(0);
  });

  it('refuses an expired licence', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ validUntil: '2025-12-31' }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.INELIGIBLE);
    expect(result.verified).toBe(false);
    expect(blockingFindings(result)[0]?.code).toBe('DL_EXPIRED');
    expect(result.summary).toContain('2025-12-31');
  });

  it('refuses a record for a different licence number', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ licenceNumber: 'MH1220100009999' }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.MISMATCH);
    expect(blockingFindings(result)[0]?.code).toBe('DL_NUMBER_MISMATCH');
  });

  it('treats an all-null record as a not-found', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({
        licenceNumber: null,
        issuingAuthority: null,
        issuedOn: null,
        validUntil: null,
        state: null,
        vehicleClasses: [],
        holder: null,
      }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.NOT_FOUND);
    expect(blockingFindings(result)[0]?.code).toBe('DL_EMPTY_RECORD');
  });

  it('verifies a licence with no commercial class, and says so', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ vehicleClasses: ['MCWG', 'LMV-NT'], transportValidUntil: null }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    const codes = advisoryFindings(result).map((entry) => entry.code);
    expect(codes).toContain('DL_NO_TRANSPORT_CLASS');
  });

  it('does not hold a driver back because the RTO published no classes', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ vehicleClasses: [] }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(advisoryFindings(result).map((entry) => entry.code)).toContain('DL_CLASSES_UNKNOWN');
  });

  it('flags a lapsed commercial endorsement on an otherwise valid licence', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ transportValidUntil: '2026-02-01' }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(advisoryFindings(result).map((entry) => entry.code)).toContain('DL_TRANSPORT_EXPIRED');
  });

  it('flags a licence about to expire', () => {
    const result = evaluateDrivingLicence(
      licenceRecord({ validUntil: '2026-07-01' }),
      { licenceNumber: 'UP3220140001234' },
      options,
    );

    expect(result.outcome).toBe(RegistryVerificationOutcome.VERIFIED);
    expect(advisoryFindings(result).map((entry) => entry.code)).toContain('DL_EXPIRING');
  });
});

describe('outcomes reached without a record', () => {
  it('reports an unusable number as a format problem, not a missing record', () => {
    const result = invalidNumberEvaluation('REGISTRATION', 'ABCDEFG');

    expect(result.outcome).toBe(RegistryVerificationOutcome.INVALID_FORMAT);
    expect(result.verified).toBe(false);
    expect(result.summary).toContain('nothing was sent');
    expect(blockingFindings(result)[0]?.code).toBe('RC_NUMBER_INVALID');
  });

  it('carries the provider not-found through as an answer about the number', () => {
    expect(notFoundEvaluation('LICENCE').outcome).toBe(RegistryVerificationOutcome.NOT_FOUND);
    expect(blockingFindings(notFoundEvaluation('LICENCE'))[0]?.code).toBe('DL_NOT_FOUND');
  });

  it('spends nothing on a plate that cannot be real', () => {
    expect(registrationLooksUsable('UP32AB1234')).toBe(true);
    expect(registrationLooksUsable('up 32 ab 1234')).toBe(true);
    expect(registrationLooksUsable('ABCDEFG')).toBe(false);
    expect(registrationLooksUsable('')).toBe(false);
  });
});
