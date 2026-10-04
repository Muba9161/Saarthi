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

import { FuelType, VehicleCapability, VehicleCategory, VehicleType, TruckType } from './enums';

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
    type: VehicleType.TWO_WHEELER,
    label: 'Two-wheeler',
    description: 'Scooter, motorcycle or moped for everyday riding.',
    // A GPS tracker or the driver app can be fitted; there is no OBD port to
    // read telemetry from, and a pillion is not a seat count worth asking for.
    capabilities: [VehicleCapability.LIVE_TRACKING, VehicleCapability.HARDWARE],
    defaultPassengerCapacity: null,
    defaultCapacityTons: null,
    legacyTruckType: TruckType.OTHER,
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

// --- Categories ------------------------------------------------------------------

export interface VehicleCategoryDefinition {
  category: VehicleCategory;
  label: string;
  /** Short line used in the picker. */
  description: string;
  /** Set on the form when this category is picked — an electric scooter runs on electricity. */
  impliesFuel?: FuelType;
}

const FOUR_WHEELER_CATEGORIES: VehicleCategoryDefinition[] = [
  {
    category: VehicleCategory.HATCHBACK,
    label: 'Hatchback',
    description: 'Compact car with a rear door instead of a boot.',
  },
  {
    category: VehicleCategory.SEDAN,
    label: 'Sedan',
    description: 'Saloon with a separate boot behind the cabin.',
  },
  {
    category: VehicleCategory.COMPACT_SUV,
    label: 'Compact SUV',
    description: 'High-riding car under four metres long.',
  },
  {
    category: VehicleCategory.SUV,
    label: 'SUV',
    description: 'Full-size sport utility, often with a third row.',
  },
  {
    category: VehicleCategory.MUV,
    label: 'MUV / MPV',
    description: 'People carrier with three rows of seats.',
  },
  {
    category: VehicleCategory.LUXURY,
    label: 'Luxury',
    description: 'Premium sedan or SUV from a luxury marque.',
  },
];

/**
 * The categories each vehicle type offers, in picker order. A type that is not
 * listed has none, and its form asks for none.
 */
export const VEHICLE_CATEGORIES: Partial<Record<VehicleType, VehicleCategoryDefinition[]>> = {
  [VehicleType.TWO_WHEELER]: [
    {
      category: VehicleCategory.SCOOTER,
      label: 'Scooter',
      description: 'Step-through with a floorboard and under-seat storage.',
    },
    {
      category: VehicleCategory.ELECTRIC_SCOOTER,
      label: 'Electric scooter',
      description: 'Battery-powered scooter, charged at home or a station.',
      impliesFuel: FuelType.ELECTRIC,
    },
    {
      category: VehicleCategory.MOTORCYCLE,
      label: 'Motorcycle',
      description: 'Everyday commuter with the tank between the knees.',
    },
    {
      category: VehicleCategory.SPORTS_BIKE,
      label: 'Sports bike',
      description: 'Faired, performance-focused motorcycle.',
    },
    {
      category: VehicleCategory.CRUISER,
      label: 'Cruiser',
      description: 'Low seat and relaxed stance for long rides.',
    },
    {
      category: VehicleCategory.ADVENTURE,
      label: 'Adventure',
      description: 'Tall, long-travel bike for touring and rough roads.',
    },
    {
      category: VehicleCategory.MOPED,
      label: 'Moped',
      description: 'Light, low-powered runabout for short trips and errands.',
    },
  ],
  [VehicleType.CAR]: FOUR_WHEELER_CATEGORIES,
  [VehicleType.TAXI]: FOUR_WHEELER_CATEGORIES,
};

/** The categories a type offers — empty when it has none. */
export function categoriesFor(type: VehicleType): VehicleCategoryDefinition[] {
  return VEHICLE_CATEGORIES[type] ?? [];
}

const CATEGORY_BY_VALUE = new Map<VehicleCategory, VehicleCategoryDefinition>(
  Object.values(VEHICLE_CATEGORIES)
    .flat()
    .map((definition) => [definition.category, definition]),
);

export function vehicleCategoryDefinition(
  category: VehicleCategory | null | undefined,
): VehicleCategoryDefinition | null {
  return category ? (CATEGORY_BY_VALUE.get(category) ?? null) : null;
}

/**
 * The category a vehicle keeps: its own when its type offers it, none
 * otherwise — so retyping a scooter as a car clears it rather than leaving a
 * stale category on the row.
 */
export function resolveVehicleCategory(
  vehicleType: VehicleType,
  category: VehicleCategory | null | undefined,
): VehicleCategory | null {
  if (!category) return null;
  return categoriesFor(vehicleType).some((definition) => definition.category === category)
    ? category
    : null;
}

/**
 * Types whose category the API insists on. Two-wheelers had categories from
 * their first day; cars and taxis predate theirs, so a caller that has never
 * sent one keeps working and an old car stays editable without one.
 */
const CATEGORY_REQUIRED_TYPES: ReadonlySet<VehicleType> = new Set([VehicleType.TWO_WHEELER]);

/**
 * Shared by the API and the vehicle form, like `validateVehicleCapacities`: a
 * category the type does not offer is always refused, and a missing one is
 * refused where it is required — always for a two-wheeler, and for any
 * categorised type when the form asks (`requireCategory`), since its picture
 * and label are chosen by it.
 */
export function validateVehicleCategory(
  type: VehicleType,
  input: { category?: VehicleCategory | null },
  { requireCategory = false }: { requireCategory?: boolean } = {},
): string[] {
  const offered = categoriesFor(type);
  if (offered.length === 0) return [];
  if (!input.category) {
    return requireCategory || CATEGORY_REQUIRED_TYPES.has(type)
      ? [`Choose what kind of ${vehicleTypeDefinition(type).label.toLowerCase()} this is.`]
      : [];
  }
  if (!offered.some((definition) => definition.category === input.category)) {
    return [`That category does not apply to a ${vehicleTypeDefinition(type).label.toLowerCase()}.`];
  }
  return [];
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
