import { describe, expect, it } from 'vitest';
import { FuelType, TruckType, VehicleType, vehicleDraftFromRc, type VehicleRcRecord } from '../index';

/**
 * Filling the add-vehicle form from an RC record. RTO text is free-form, so
 * these pin the readings the form relies on — and that anything unreadable is
 * left blank rather than guessed.
 */

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

describe('vehicleDraftFromRc', () => {
  it('reads a heavy goods vehicle as a truck with its payload', () => {
    const draft = vehicleDraftFromRc(rcRecord());
    expect(draft.vehicleType).toBe(VehicleType.TRUCK);
    expect(draft.truckType).toBe(TruckType.OPEN_BODY);
    expect(draft.manufacturer).toBe('TATA MOTORS LTD');
    expect(draft.model).toBe('SIGNA 4018.S');
    expect(draft.year).toBe(2019);
    expect(draft.fuelType).toBe(FuelType.DIESEL);
    expect(draft.capacityTons).toBe(32);
    expect(draft.passengerCapacity).toBeNull();
    expect(draft.insuranceValidUntil).toBe('2027-01-31');
  });

  it('never carries the owner or the engine and chassis numbers', () => {
    const draft = vehicleDraftFromRc(rcRecord()) as unknown as Record<string, unknown>;
    expect(draft).not.toHaveProperty('owner');
    expect(draft).not.toHaveProperty('engineNumber');
    expect(draft).not.toHaveProperty('chassisNumber');
  });

  it('reads a light goods vehicle as a pickup', () => {
    const draft = vehicleDraftFromRc(
      rcRecord({ vehicleClass: 'Goods Carrier(LGV)', vehicleCategory: 'LGV', grossVehicleWeight: 1840, unladenWeight: 1090 }),
    );
    expect(draft.vehicleType).toBe(VehicleType.PICKUP);
    expect(draft.capacityTons).toBe(0.8);
  });

  it('reads a private car, its seats and a dual-fuel engine', () => {
    const draft = vehicleDraftFromRc(
      rcRecord({
        vehicleClass: 'Motor Car(LMV)',
        vehicleCategory: 'LMV',
        bodyType: 'SALOON',
        fuelType: 'PETROL/CNG',
        seatingCapacity: 5,
        variant: 'VXI',
        model: 'DZIRE',
      }),
    );
    expect(draft.vehicleType).toBe(VehicleType.CAR);
    expect(draft.truckType).toBeNull();
    expect(draft.fuelType).toBe(FuelType.CNG);
    expect(draft.passengerCapacity).toBe(5);
    expect(draft.capacityTons).toBeNull();
    expect(draft.model).toBe('DZIRE VXI');
  });

  it('reads a bus, a cab and an e-rickshaw', () => {
    expect(vehicleDraftFromRc(rcRecord({ vehicleClass: 'Bus', vehicleCategory: 'HPV', bodyType: null })).vehicleType).toBe(
      VehicleType.BUS,
    );
    expect(vehicleDraftFromRc(rcRecord({ vehicleClass: 'Maxi Cab', vehicleCategory: 'LPV', bodyType: null })).vehicleType).toBe(
      VehicleType.TAXI,
    );
    expect(
      vehicleDraftFromRc(rcRecord({ vehicleClass: 'e-Rickshaw(P)', vehicleCategory: '3WT', bodyType: null })).vehicleType,
    ).toBe(VehicleType.AUTO_RICKSHAW);
  });

  it('leaves what it cannot read blank', () => {
    const draft = vehicleDraftFromRc(
      rcRecord({
        vehicleClass: null,
        vehicleCategory: null,
        bodyType: null,
        fuelType: 'HYDROGEN',
        manufacturedOn: null,
        registrationDate: null,
        grossVehicleWeight: null,
      }),
    );
    expect(draft.vehicleType).toBeNull();
    expect(draft.fuelType).toBeNull();
    expect(draft.year).toBeNull();
  });
});
