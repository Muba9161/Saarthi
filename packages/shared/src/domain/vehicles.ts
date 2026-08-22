/**
 * Vehicle type capability model.
 *
 * Saarthi started as a truck platform. Generalising it to taxis, buses and vans
 * did **not** mean rewriting the domain around `if (type === 'TAXI')` branches —
 * that would have to be revisited for every new vehicle type. Instead each type
 * declares what it *can do*, and business rules ask the capability question:
 *
 *     vehicleSupports(vehicleType, VehicleCapability.FREIGHT)
 *
 * Adding a vehicle type is then a change to this one table.
 */

import { VehicleCapability, VehicleType, TruckType } from './enums';

export interface VehicleTypeDefinition {
  type: VehicleType;
  label: string;
  /** Short line used in pickers and empty states. */
  description: string;
  capabilities: VehicleCapability[];
  /** Sensible default when the operator does not state one. */
  defaultPassengerCapacity: number | null;
  defaultCapacityTons: number | null;
  /** Truck body type recorded for non-trucks so the legacy column stays valid. */
  legacyTruckType: TruckType;
}

const TRACKING: VehicleCapability[] = [
  VehicleCapability.LIVE_TRACKING,
  VehicleCapability.HARDWARE,
  VehicleCapability.TELEMETRY,
];

const FREIGHT: VehicleCapability[] = [
  VehicleCapability.FREIGHT,
  VehicleCapability.CARGO_CAPACITY,
];

const PASSENGER: VehicleCapability[] = [
  VehicleCapability.PASSENGER_TRANSPORT,
  VehicleCapability.PASSENGER_CAPACITY,
  VehicleCapability.TRAVEL_PACKAGES,
];

export const VEHICLE_TYPE_CATALOGUE: VehicleTypeDefinition[] = [
  {
    type: VehicleType.TRUCK,
    label: 'Truck',
    description: 'Goods carrier for freight and material movement.',
    capabilities: [...FREIGHT, ...TRACKING],
    defaultPassengerCapacity: null,
    defaultCapacityTons: 9,
    legacyTruckType: TruckType.OPEN_BODY,
  },
  {
    type: VehicleType.TAXI,
    label: 'Taxi',
    description: 'Licensed passenger vehicle for point-to-point mobility.',
    capabilities: [...PASSENGER, ...TRACKING],
    defaultPassengerCapacity: 4,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
  {
    type: VehicleType.CAR,
    label: 'Car',
    description: 'Private or company car.',
    capabilities: [...PASSENGER, ...TRACKING],
    defaultPassengerCapacity: 4,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
  {
    type: VehicleType.SUV,
    label: 'SUV',
    description: 'Six- to seven-seat vehicle suited to hill and tour routes.',
    capabilities: [...PASSENGER, ...TRACKING],
    defaultPassengerCapacity: 6,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
  {
    type: VehicleType.VAN,
    label: 'Van',
    description: 'Carries both passengers and light cargo.',
    capabilities: [...PASSENGER, ...FREIGHT, ...TRACKING],
    defaultPassengerCapacity: 8,
    defaultCapacityTons: 1.5,
    legacyTruckType: TruckType.CLOSED_CONTAINER,
  },
  {
    type: VehicleType.BUS,
    label: 'Bus',
    description: 'High-capacity passenger vehicle for group travel.',
    capabilities: [...PASSENGER, ...TRACKING],
    defaultPassengerCapacity: 32,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
  {
    type: VehicleType.TEMPO,
    label: 'Tempo traveller',
    description: 'Mini-coach commonly used for multi-day tours.',
    capabilities: [...PASSENGER, ...TRACKING],
    defaultPassengerCapacity: 12,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.MINI_TRUCK,
  },
  {
    type: VehicleType.PICKUP,
    label: 'Pickup',
    description: 'Small goods carrier for city and last-mile delivery.',
    capabilities: [...FREIGHT, ...TRACKING],
    defaultPassengerCapacity: null,
    defaultCapacityTons: 1.2,
    legacyTruckType: TruckType.MINI_TRUCK,
  },
  {
    type: VehicleType.AUTO_RICKSHAW,
    label: 'Auto rickshaw',
    description: 'Three-wheeler for short urban trips.',
    capabilities: [
      VehicleCapability.PASSENGER_TRANSPORT,
      VehicleCapability.PASSENGER_CAPACITY,
      VehicleCapability.LIVE_TRACKING,
    ],
    defaultPassengerCapacity: 3,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
  {
    type: VehicleType.PICKUP,
    label: 'Pickup',
    description: 'Small goods carrier for city delivery and last-mile relay.',
    capabilities: [...FREIGHT, ...TRACKING],
    defaultPassengerCapacity: null,
    defaultCapacityTons: 1,
    legacyTruckType: TruckType.MINI_TRUCK,
  },
  {
    type: VehicleType.OTHER,
    label: 'Other vehicle',
    description: 'Anything not covered by the standard types.',
    capabilities: [VehicleCapability.LIVE_TRACKING],
    defaultPassengerCapacity: null,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
  },
];

const BY_TYPE = new Map<VehicleType, VehicleTypeDefinition>(
  VEHICLE_TYPE_CATALOGUE.map((definition) => [definition.type, definition]),
);

export function vehicleTypeDefinition(type: VehicleType): VehicleTypeDefinition {
  return BY_TYPE.get(type) ?? BY_TYPE.get(VehicleType.OTHER)!;
}

export function vehicleCapabilities(type: VehicleType): VehicleCapability[] {
  return vehicleTypeDefinition(type).capabilities;
}

export function vehicleSupports(type: VehicleType, capability: VehicleCapability): boolean {
  return vehicleCapabilities(type).includes(capability);
}

/** Vehicle types able to carry goods — the fleet/freight side of the platform. */
export const FREIGHT_VEHICLE_TYPES: VehicleType[] = VEHICLE_TYPE_CATALOGUE.filter((definition) =>
  definition.capabilities.includes(VehicleCapability.FREIGHT),
).map((definition) => definition.type);

/** Vehicle types able to carry people — the mobility/travel side. */
export const PASSENGER_VEHICLE_TYPES: VehicleType[] = VEHICLE_TYPE_CATALOGUE.filter((definition) =>
  definition.capabilities.includes(VehicleCapability.PASSENGER_TRANSPORT),
).map((definition) => definition.type);

/** Vehicle types that may be sold inside a travel or tour package. */
export const TRAVEL_VEHICLE_TYPES: VehicleType[] = VEHICLE_TYPE_CATALOGUE.filter((definition) =>
  definition.capabilities.includes(VehicleCapability.TRAVEL_PACKAGES),
).map((definition) => definition.type);

/**
 * Validation shared by the API and the vehicle form: a vehicle must declare the
 * capacity its own type actually has, and must not declare capacity it cannot
 * possess. Returns human-readable problems, empty when the input is coherent.
 */
export function validateVehicleCapacities(
  type: VehicleType,
  input: { capacityTons?: number | null; passengerCapacity?: number | null },
): string[] {
  const problems: string[] = [];
  const supportsCargo = vehicleSupports(type, VehicleCapability.CARGO_CAPACITY);
  const supportsPassengers = vehicleSupports(type, VehicleCapability.PASSENGER_CAPACITY);
  const label = vehicleTypeDefinition(type).label.toLowerCase();

  if (supportsCargo && (input.capacityTons === null || input.capacityTons === undefined)) {
    problems.push(`A ${label} needs a payload capacity in tonnes.`);
  }
  if (!supportsCargo && typeof input.capacityTons === 'number' && input.capacityTons > 0) {
    problems.push(`A ${label} does not carry freight, so payload capacity does not apply.`);
  }
  if (
    supportsPassengers &&
    (input.passengerCapacity === null || input.passengerCapacity === undefined)
  ) {
    problems.push(`A ${label} needs a passenger capacity.`);
  }
  if (
    !supportsPassengers &&
    typeof input.passengerCapacity === 'number' &&
    input.passengerCapacity > 0
  ) {
    problems.push(`A ${label} does not carry passengers, so seat count does not apply.`);
  }

  return problems;
}
