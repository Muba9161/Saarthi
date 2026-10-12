import { describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, TruckType, VehicleCategory, VehicleType } from './enums';
import { allowedVehicleTypes } from './vehicle-eligibility';
import {
  VEHICLE_CLASSES,
  VehicleClass,
  describeVehicle,
  resolveVehicleCategory,
  vehicleTypesOfClass,
  validateVehicleCategory,
  vehicleClassesFor,
} from './vehicle-taxonomy';

/**
 * The picker's classes and tiles against the records they write. Every tile
 * must store something the API accepts, and each kind of account must be
 * offered exactly its classes — no tile it would be refused.
 */

const personal = { tier: PlanTier.PERSONAL, organizationType: OrganizationType.FLEET_OWNER };
const fleet = { tier: PlanTier.BUSINESS, organizationType: OrganizationType.FLEET_OWNER };
const mobility = { tier: PlanTier.BUSINESS, organizationType: OrganizationType.MOBILITY_PROVIDER };

const classIds = (context: typeof personal) =>
  vehicleClassesFor(allowedVehicleTypes(context)).map((definition) => definition.id);

describe('vehicle taxonomy', () => {
  it('gives every tile a unique id and a record the API accepts', () => {
    const options = VEHICLE_CLASSES.flatMap((definition) => definition.options);
    expect(new Set(options.map((entry) => entry.id)).size).toBe(options.length);
    for (const entry of options) {
      expect(
        validateVehicleCategory(entry.vehicleType, { category: entry.category ?? null }),
      ).toEqual([]);
    }
  });

  it('offers Personal its own vehicles only', () => {
    expect(classIds(personal)).toEqual([
      VehicleClass.TWO_WHEELER,
      VehicleClass.THREE_WHEELER,
      VehicleClass.CAR,
      VehicleClass.VAN,
      VehicleClass.OTHER,
    ]);
    const threeWheeler = vehicleClassesFor(allowedVehicleTypes(personal)).find(
      (definition) => definition.id === VehicleClass.THREE_WHEELER,
    );
    // The cargo three-wheeler is a goods carrier, so not on Personal.
    expect(threeWheeler?.options.map((entry) => entry.label)).toEqual(['Auto rickshaw', 'E-rickshaw']);
  });

  it('offers a fleet owner trucks and the cargo three-wheeler', () => {
    expect(classIds(fleet)).toEqual([VehicleClass.THREE_WHEELER, VehicleClass.TRUCK]);
  });

  it('offers a mobility provider every passenger class and no truck', () => {
    expect(classIds(mobility)).toEqual([
      VehicleClass.TWO_WHEELER,
      VehicleClass.THREE_WHEELER,
      VehicleClass.CAR,
      VehicleClass.TAXI,
      VehicleClass.VAN,
      VehicleClass.BUS,
      VehicleClass.OTHER,
    ]);
  });

  it('reads stored records back as their class and kind', () => {
    const read = (vehicle: Parameters<typeof describeVehicle>[0]) => {
      const { classLabel, kindLabel } = describeVehicle(vehicle);
      return [classLabel, kindLabel];
    };
    expect(read({ vehicleType: VehicleType.SUV })).toEqual(['Car', 'SUV']);
    expect(read({ vehicleType: VehicleType.SUV, category: VehicleCategory.MUV })).toEqual(['Car', 'MUV / MPV']);
    expect(read({ vehicleType: VehicleType.TRUCK, truckType: TruckType.TIPPER })).toEqual(['Truck', 'Tipper']);
    expect(
      read({ vehicleType: VehicleType.PICKUP, category: VehicleCategory.CARGO_THREE_WHEELER }),
    ).toEqual(['Three-wheeler', 'Cargo three-wheeler']);
    expect(read({ vehicleType: VehicleType.PICKUP })).toEqual(['Truck', 'Pickup']);
    expect(read({ vehicleType: VehicleType.TEMPO })).toEqual(['Van', 'Tempo traveller']);
    expect(read({ vehicleType: VehicleType.TAXI, category: VehicleCategory.SEDAN })).toEqual(['Taxi', 'Sedan']);
    // A car filed as "SUV" before SUVs were stored as their own type.
    expect(read({ vehicleType: VehicleType.CAR, category: VehicleCategory.SUV })).toEqual(['Car', 'SUV']);
    // Saying no more than its class.
    expect(read({ vehicleType: VehicleType.BUS })).toEqual(['Bus', null]);
    expect(read({ vehicleType: VehicleType.TRUCK, truckType: TruckType.OTHER })).toEqual(['Truck', null]);
  });

  it('filters a list by class through the types at home in it', () => {
    expect(vehicleTypesOfClass(VehicleClass.CAR)).toEqual([VehicleType.CAR, VehicleType.SUV]);
    expect(vehicleTypesOfClass(VehicleClass.VAN)).toEqual([VehicleType.VAN, VehicleType.TEMPO]);
    expect(vehicleTypesOfClass(VehicleClass.TRUCK)).toEqual([VehicleType.TRUCK, VehicleType.PICKUP]);
  });

  it('keeps what older records were filed as, and drops what a new type cannot hold', () => {
    expect(resolveVehicleCategory(VehicleType.CAR, VehicleCategory.SUV)).toBe(VehicleCategory.SUV);
    expect(resolveVehicleCategory(VehicleType.TAXI, VehicleCategory.LUXURY)).toBe(VehicleCategory.LUXURY);
    expect(resolveVehicleCategory(VehicleType.BUS, VehicleCategory.SEDAN)).toBeNull();
    expect(validateVehicleCategory(VehicleType.TRUCK, { category: VehicleCategory.SEDAN })).toHaveLength(1);
  });
});
