/**
 * How an owner names a vehicle — a class ("Car") and a kind within it ("SUV")
 * — and how that maps onto the stored record.
 *
 * Storage keeps its existing shape: a `VehicleType` (which business rules ask
 * about through capabilities), an optional `VehicleCategory`, and for goods
 * vehicles a `TruckType` body. The classes are a presentation over it. Every
 * tile names exactly the record it creates, so choosing "Car → SUV" stores an
 * SUV that travel packages and requirements already understand, and choosing
 * "Truck → Tipper" stores the body that order and backhaul matching compare.
 *
 * What an account may add is still decided by `allowedVehicleTypes`; the
 * picker offers only the tiles whose stored type is allowed, so it can never
 * offer a choice the API would refuse.
 */

import { FuelType, TruckType, VehicleCategory, VehicleType } from './enums';
import { vehicleTypeDefinition } from './vehicles';

export const VehicleClass = {
  TWO_WHEELER: 'TWO_WHEELER',
  THREE_WHEELER: 'THREE_WHEELER',
  CAR: 'CAR',
  TAXI: 'TAXI',
  VAN: 'VAN',
  BUS: 'BUS',
  TRUCK: 'TRUCK',
  OTHER: 'OTHER',
} as const;
export type VehicleClass = (typeof VehicleClass)[keyof typeof VehicleClass];

/** One tile: what the owner picks, and the record it becomes. */
export interface VehicleOption {
  /** Unique across all classes, e.g. `CAR:SUV`, `TRUCK:TIPPER`. */
  id: string;
  label: string;
  /** Short line under the tile. */
  description: string;
  vehicleType: VehicleType;
  category?: VehicleCategory;
  /** The body, for goods vehicles — what order and backhaul matching compare. */
  truckType?: TruckType;
  /** Set on the form when picked — an electric scooter runs on electricity. */
  impliesFuel?: FuelType;
}

export interface VehicleClassDefinition {
  id: VehicleClass;
  label: string;
  description: string;
  /** Empty for a class with no kinds (Other), which stores `implicitType`. */
  options: VehicleOption[];
  implicitType?: VehicleType;
}

function option(
  vehicleClass: VehicleClass,
  key: string,
  definition: Omit<VehicleOption, 'id'>,
): VehicleOption {
  return { id: `${vehicleClass}:${key}`, ...definition };
}

const car = (key: string, label: string, description: string, vehicleType: VehicleType, category: VehicleCategory) =>
  option(VehicleClass.CAR, key, { label, description, vehicleType, category });
const taxi = (key: string, label: string, description: string, category: VehicleCategory) =>
  option(VehicleClass.TAXI, key, { label, description, vehicleType: VehicleType.TAXI, category });
const bus = (key: string, label: string, description: string, category: VehicleCategory) =>
  option(VehicleClass.BUS, key, { label, description, vehicleType: VehicleType.BUS, category });
const truck = (key: string, label: string, description: string, truckType: TruckType) =>
  option(VehicleClass.TRUCK, key, { label, description, vehicleType: VehicleType.TRUCK, truckType });
const twoWheeler = (
  key: string,
  label: string,
  description: string,
  category: VehicleCategory,
  impliesFuel?: FuelType,
) =>
  option(VehicleClass.TWO_WHEELER, key, {
    label,
    description,
    vehicleType: VehicleType.TWO_WHEELER,
    category,
    ...(impliesFuel ? { impliesFuel } : {}),
  });

export const VEHICLE_CLASSES: VehicleClassDefinition[] = [
  {
    id: VehicleClass.TWO_WHEELER,
    label: 'Two-wheeler',
    description: 'Scooter, motorcycle or moped.',
    options: [
      twoWheeler('SCOOTER', 'Scooter', 'Step-through with a floorboard and under-seat storage.', VehicleCategory.SCOOTER),
      twoWheeler(
        'ELECTRIC_SCOOTER',
        'Electric scooter',
        'Battery scooter, charged at home or a station.',
        VehicleCategory.ELECTRIC_SCOOTER,
        FuelType.ELECTRIC,
      ),
      twoWheeler('MOTORCYCLE', 'Motorcycle', 'Everyday commuter with the tank between the knees.', VehicleCategory.MOTORCYCLE),
      twoWheeler(
        'ELECTRIC_MOTORCYCLE',
        'Electric motorcycle',
        'Battery motorcycle — no tank, no exhaust.',
        VehicleCategory.ELECTRIC_MOTORCYCLE,
        FuelType.ELECTRIC,
      ),
      twoWheeler('SPORTS_BIKE', 'Sports bike', 'Faired, performance-focused motorcycle.', VehicleCategory.SPORTS_BIKE),
      twoWheeler('CRUISER', 'Cruiser', 'Low seat and relaxed stance for long rides.', VehicleCategory.CRUISER),
      twoWheeler('ADVENTURE', 'Adventure', 'Tall, long-travel bike for touring and rough roads.', VehicleCategory.ADVENTURE),
      twoWheeler('MOPED', 'Moped', 'Light, low-powered runabout for short trips and errands.', VehicleCategory.MOPED),
    ],
  },
  {
    id: VehicleClass.THREE_WHEELER,
    label: 'Three-wheeler',
    description: 'Auto, e-rickshaw or cargo three-wheeler.',
    options: [
      option(VehicleClass.THREE_WHEELER, 'AUTO_RICKSHAW', {
        label: 'Auto rickshaw',
        description: 'Petrol, CNG or LPG passenger auto.',
        vehicleType: VehicleType.AUTO_RICKSHAW,
        category: VehicleCategory.AUTO_RICKSHAW,
      }),
      option(VehicleClass.THREE_WHEELER, 'E_RICKSHAW', {
        label: 'E-rickshaw',
        description: 'Battery rickshaw for short city hops.',
        vehicleType: VehicleType.AUTO_RICKSHAW,
        category: VehicleCategory.E_RICKSHAW,
        impliesFuel: FuelType.ELECTRIC,
      }),
      // A goods carrier, so it is stored as one — tonnage, not seats.
      option(VehicleClass.THREE_WHEELER, 'CARGO', {
        label: 'Cargo three-wheeler',
        description: 'Goods auto or loader for city deliveries.',
        vehicleType: VehicleType.PICKUP,
        category: VehicleCategory.CARGO_THREE_WHEELER,
      }),
    ],
  },
  {
    id: VehicleClass.CAR,
    label: 'Car',
    description: 'Private or company car.',
    options: [
      car('HATCHBACK', 'Hatchback', 'Compact car with a rear door instead of a boot.', VehicleType.CAR, VehicleCategory.HATCHBACK),
      car('SEDAN', 'Sedan', 'Saloon with a separate boot behind the cabin.', VehicleType.CAR, VehicleCategory.SEDAN),
      car('COMPACT_SUV', 'Compact SUV', 'High-riding car under four metres long.', VehicleType.CAR, VehicleCategory.COMPACT_SUV),
      // Stored as the SUV type, which travel packages and requirements name.
      car('SUV', 'SUV', 'Full-size sport utility, often with a third row.', VehicleType.SUV, VehicleCategory.SUV),
      car('MUV', 'MUV / MPV', 'People carrier with three rows of seats.', VehicleType.SUV, VehicleCategory.MUV),
      car('LUXURY', 'Luxury', 'Premium sedan or SUV from a luxury marque.', VehicleType.CAR, VehicleCategory.LUXURY),
    ],
  },
  {
    id: VehicleClass.TAXI,
    label: 'Taxi',
    description: 'Licensed cab for point-to-point trips.',
    options: [
      taxi('HATCHBACK', 'Hatchback', 'Compact cab for city rides.', VehicleCategory.HATCHBACK),
      taxi('SEDAN', 'Sedan', 'Saloon cab with a separate boot.', VehicleCategory.SEDAN),
      taxi('SUV', 'SUV', 'High-riding cab for families and hills.', VehicleCategory.SUV),
      taxi('MUV', 'MUV / MPV', 'Seven-seat cab for groups and airport runs.', VehicleCategory.MUV),
    ],
  },
  {
    id: VehicleClass.VAN,
    label: 'Van',
    description: 'Passenger, cargo or tour van.',
    options: [
      option(VehicleClass.VAN, 'PASSENGER', {
        label: 'Passenger van',
        description: 'Eight-seat van for staff and family trips.',
        vehicleType: VehicleType.VAN,
        category: VehicleCategory.PASSENGER_VAN,
      }),
      option(VehicleClass.VAN, 'CARGO', {
        label: 'Cargo van',
        description: 'Panel van for parcels and light goods.',
        vehicleType: VehicleType.VAN,
        category: VehicleCategory.CARGO_VAN,
      }),
      option(VehicleClass.VAN, 'TEMPO_TRAVELLER', {
        label: 'Tempo traveller',
        description: 'Twelve-to-seventeen seat van for tours.',
        vehicleType: VehicleType.TEMPO,
      }),
    ],
  },
  {
    id: VehicleClass.BUS,
    label: 'Bus',
    description: 'Mini bus, coach or school bus.',
    options: [
      bus('MINI_BUS', 'Mini bus', 'Up to about 25 seats, for short tours.', VehicleCategory.MINI_BUS),
      bus('STANDARD_BUS', 'Standard bus', 'Full-size seater for routes and staff.', VehicleCategory.STANDARD_BUS),
      bus('COACH', 'Coach', 'Long-distance seater with luggage bays.', VehicleCategory.COACH),
      bus('SLEEPER', 'Sleeper bus', 'Berths for overnight journeys.', VehicleCategory.SLEEPER_BUS),
      bus('SCHOOL_BUS', 'School bus', 'Yellow bus for pupils.', VehicleCategory.SCHOOL_BUS),
    ],
  },
  {
    id: VehicleClass.TRUCK,
    label: 'Truck',
    description: 'Goods carrier, from pickup to multi-axle.',
    options: [
      option(VehicleClass.TRUCK, 'PICKUP', {
        label: 'Pickup',
        description: 'Light goods carrier for city and last-mile runs.',
        vehicleType: VehicleType.PICKUP,
      }),
      truck('MINI_TRUCK', 'Mini truck', 'Small goods truck for city loads.', TruckType.MINI_TRUCK),
      truck('OPEN_BODY', 'Open body', 'Open deck with side walls.', TruckType.OPEN_BODY),
      truck('CONTAINER', 'Container', 'Closed box body for protected loads.', TruckType.CLOSED_CONTAINER),
      truck('TIPPER', 'Tipper', 'Tilting body for sand, stone and soil.', TruckType.TIPPER),
      truck('TANKER', 'Tanker', 'Liquid or gas carrier.', TruckType.TANKER),
      truck('TRAILER', 'Trailer', 'Tractor unit with a long trailer.', TruckType.TRAILER),
      truck('FLATBED', 'Flatbed', 'Flat deck for machinery and steel.', TruckType.FLATBED),
      truck('REFRIGERATED', 'Refrigerated', 'Cold-chain body for food and medicine.', TruckType.REFRIGERATED),
      truck('MULTI_AXLE', 'Multi-axle', 'Heavy haulage on three or more axles.', TruckType.MULTI_AXLE),
    ],
  },
  {
    id: VehicleClass.OTHER,
    label: 'Other',
    description: 'Anything not covered above.',
    options: [],
    implicitType: VehicleType.OTHER,
  },
];

const ALL_OPTIONS = VEHICLE_CLASSES.flatMap((definition) => definition.options);
const OPTION_BY_ID = new Map(ALL_OPTIONS.map((entry) => [entry.id, entry]));
const CLASS_BY_ID = new Map(VEHICLE_CLASSES.map((definition) => [definition.id, definition]));

export function vehicleOption(id: string | null | undefined): VehicleOption | null {
  return id ? (OPTION_BY_ID.get(id) ?? null) : null;
}

export function vehicleClassDefinition(id: VehicleClass): VehicleClassDefinition {
  return CLASS_BY_ID.get(id)!;
}

/** The classes, and their tiles, an account may add — none it would be refused. */
export function vehicleClassesFor(allowedTypes: readonly VehicleType[]): VehicleClassDefinition[] {
  return VEHICLE_CLASSES.map((definition) => ({
    ...definition,
    options: definition.options.filter((entry) => allowedTypes.includes(entry.vehicleType)),
  })).filter((definition) =>
    definition.implicitType
      ? allowedTypes.includes(definition.implicitType)
      : definition.options.length > 0,
  );
}

// --- Categories per stored type -------------------------------------------------

/**
 * Categories a type keeps on a record in its own right, beyond those its tiles
 * write: a car or taxi given "SUV" or "Luxury" before tiles stored those
 * elsewhere keeps them, so editing it never drops what it was filed as.
 */
const LEGACY_CATEGORIES: Partial<Record<VehicleType, VehicleCategory[]>> = {
  [VehicleType.CAR]: [VehicleCategory.SUV, VehicleCategory.MUV],
  [VehicleType.TAXI]: [VehicleCategory.COMPACT_SUV, VehicleCategory.LUXURY],
};

const CATEGORIES_BY_TYPE = (() => {
  const byType = new Map<VehicleType, Set<VehicleCategory>>();
  const add = (type: VehicleType, category: VehicleCategory) => {
    const set = byType.get(type) ?? new Set<VehicleCategory>();
    set.add(category);
    byType.set(type, set);
  };
  for (const entry of ALL_OPTIONS) if (entry.category) add(entry.vehicleType, entry.category);
  for (const [type, categories] of Object.entries(LEGACY_CATEGORIES)) {
    for (const category of categories ?? []) add(type as VehicleType, category);
  }
  return byType;
})();

/** The categories a record of this type may hold — empty when it has none. */
export function categoriesFor(type: VehicleType): VehicleCategory[] {
  return [...(CATEGORIES_BY_TYPE.get(type) ?? [])];
}

const CATEGORY_LABELS = new Map<VehicleCategory, string>(
  ALL_OPTIONS.filter((entry) => entry.category && !entry.id.startsWith(`${VehicleClass.TAXI}:`)).map(
    (entry) => [entry.category!, entry.label],
  ),
);

export function vehicleCategoryLabel(category: VehicleCategory | null | undefined): string | null {
  return category ? (CATEGORY_LABELS.get(category) ?? null) : null;
}

/**
 * The category a vehicle keeps: its own when its type allows it, none
 * otherwise — so retyping a scooter as a car clears it rather than leaving a
 * stale category on the row.
 */
export function resolveVehicleCategory(
  vehicleType: VehicleType,
  category: VehicleCategory | null | undefined,
): VehicleCategory | null {
  if (!category) return null;
  return categoriesFor(vehicleType).includes(category) ? category : null;
}

/**
 * Types whose category the API insists on. Two-wheelers had categories from
 * their first day; every other type predates its, so a caller that has never
 * sent one keeps working and an old vehicle stays editable without one.
 */
const CATEGORY_REQUIRED_TYPES: ReadonlySet<VehicleType> = new Set([VehicleType.TWO_WHEELER]);

/**
 * Shared by the API and the vehicle form, like `validateVehicleCapacities`: a
 * category the type does not allow is always refused, and a missing one is
 * refused where it is required — always for a two-wheeler, and for any
 * categorised type when the caller asks (`requireCategory`).
 */
export function validateVehicleCategory(
  type: VehicleType,
  input: { category?: VehicleCategory | null },
  { requireCategory = false }: { requireCategory?: boolean } = {},
): string[] {
  const allowed = categoriesFor(type);
  if (allowed.length === 0) {
    return input.category
      ? [`A ${vehicleTypeDefinition(type).label.toLowerCase()} has no categories.`]
      : [];
  }
  if (!input.category) {
    return requireCategory || CATEGORY_REQUIRED_TYPES.has(type)
      ? [`Choose what kind of ${vehicleTypeDefinition(type).label.toLowerCase()} this is.`]
      : [];
  }
  if (!allowed.includes(input.category)) {
    return [`That category does not apply to a ${vehicleTypeDefinition(type).label.toLowerCase()}.`];
  }
  return [];
}

// --- Describing a stored vehicle ------------------------------------------------

/** The class a type belongs to when nothing more specific says otherwise. */
const CLASS_OF_TYPE: Record<VehicleType, VehicleClass> = {
  [VehicleType.TWO_WHEELER]: VehicleClass.TWO_WHEELER,
  [VehicleType.AUTO_RICKSHAW]: VehicleClass.THREE_WHEELER,
  [VehicleType.CAR]: VehicleClass.CAR,
  [VehicleType.SUV]: VehicleClass.CAR,
  [VehicleType.TAXI]: VehicleClass.TAXI,
  [VehicleType.VAN]: VehicleClass.VAN,
  [VehicleType.TEMPO]: VehicleClass.VAN,
  [VehicleType.BUS]: VehicleClass.BUS,
  [VehicleType.TRUCK]: VehicleClass.TRUCK,
  [VehicleType.PICKUP]: VehicleClass.TRUCK,
  [VehicleType.OTHER]: VehicleClass.OTHER,
};

/**
 * The stored types that are at home in a class — what a list filtered to
 * "Car" asks for (CAR and SUV). A type lives in one class only, so a cargo
 * three-wheeler, stored as a pickup, is found under Truck.
 */
export function vehicleTypesOfClass(vehicleClass: VehicleClass): VehicleType[] {
  return (Object.keys(CLASS_OF_TYPE) as VehicleType[]).filter(
    (type) => CLASS_OF_TYPE[type] === vehicleClass,
  );
}

/** The tile a type stands for when it has no category of its own to say. */
const DEFAULT_OPTION_OF_TYPE: Partial<Record<VehicleType, string>> = {
  [VehicleType.SUV]: `${VehicleClass.CAR}:SUV`,
  [VehicleType.TEMPO]: `${VehicleClass.VAN}:TEMPO_TRAVELLER`,
  [VehicleType.PICKUP]: `${VehicleClass.TRUCK}:PICKUP`,
};

export interface StoredVehicleKind {
  vehicleType: VehicleType;
  category?: VehicleCategory | null;
  truckType?: TruckType | string | null;
}

export interface VehicleDescription {
  vehicleClass: VehicleClass;
  classLabel: string;
  /** The tile this record matches, when it matches one. */
  option: VehicleOption | null;
  /** "SUV", "Tipper", "E-rickshaw" — or `null` when the record says no more than its class. */
  kindLabel: string | null;
}

/** The class and tile a stored record reads as — "Car · SUV", "Truck · Tipper". */
export function describeVehicle(vehicle: StoredVehicleKind): VehicleDescription {
  const category = vehicle.category ?? null;
  const exact =
    ALL_OPTIONS.find(
      (entry) =>
        entry.vehicleType === vehicle.vehicleType &&
        (entry.category ?? null) === category &&
        (entry.truckType === undefined || entry.truckType === vehicle.truckType),
    ) ?? (category ? null : vehicleOption(DEFAULT_OPTION_OF_TYPE[vehicle.vehicleType]));

  const vehicleClass = exact
    ? (exact.id.split(':')[0] as VehicleClass)
    : CLASS_OF_TYPE[vehicle.vehicleType] ?? VehicleClass.OTHER;

  return {
    vehicleClass,
    classLabel: vehicleClassDefinition(vehicleClass).label,
    option: exact,
    kindLabel: exact?.label ?? vehicleCategoryLabel(category),
  };
}
