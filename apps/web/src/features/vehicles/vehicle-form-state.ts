import {
  FuelType,
  describeVehicle,
  resolveVehicleCategory,
  type VehicleCategory,
  type VehicleClass,
  type VehicleRcPrefill,
  type VehicleType,
} from '@saarthi/shared';
import { kindOfRecord } from './vehicle-kind-field';

/**
 * The vehicle form's answers, and where they start from — blank, an existing
 * vehicle, or an RC record. Plain functions, so the dialog holds only the
 * flow and the fields.
 */

/**
 * What the form needs in order to show a vehicle that already exists.
 *
 * Structural rather than `VehicleSummary`, so the fleet list, a detail header
 * and a resale listing can all open this with the record they already hold.
 * Every field here is on the list response, so opening the dialog from the
 * grid costs no further request.
 */
export interface EditableVehicle {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  /** Optional so records that predate categories can still open the form. */
  category?: VehicleCategory | null;
  /** The goods body — what a truck's tile is chosen by. */
  truckType?: string | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  capacityTons: number | null;
  passengerCapacity: number | null;
  airConditioned: boolean | null;
  /** Widened to `string` on the summary responses; narrowed back on the way in. */
  fuelType: string;
  odometerKm: number;
}

export interface VehicleFormState {
  registrationNumber: string;
  /** What the owner picked — the class, then a tile in it. */
  vehicleClass: VehicleClass;
  optionId: string | null;
  /** What the tile writes. */
  vehicleType: VehicleType;
  category: VehicleCategory | null;
  truckType: string | null;
  manufacturer: string;
  model: string;
  year: string;
  colour: string;
  capacityTons: string;
  passengerCapacity: string;
  airConditioned: boolean;
  fuelType: FuelType;
  odometerKm: string;
}

export type FieldErrors = Partial<Record<keyof VehicleFormState, string>>;

export const FUEL_TYPES = Object.values(FuelType);

export function initialState(defaultType: VehicleType): VehicleFormState {
  return {
    registrationNumber: '',
    // The class only: which kind it is is the owner's first answer.
    vehicleClass: describeVehicle({ vehicleType: defaultType }).vehicleClass,
    optionId: null,
    vehicleType: defaultType,
    category: null,
    truckType: null,
    manufacturer: '',
    model: '',
    year: '',
    colour: '',
    capacityTons: '',
    passengerCapacity: '',
    airConditioned: false,
    fuelType: FuelType.DIESEL,
    odometerKm: '0',
  };
}

/** The summary responses type `fuelType` as a plain string; keep the union honest. */
function asFuelType(value: string): FuelType {
  return (FUEL_TYPES as string[]).includes(value) ? (value as FuelType) : FuelType.DIESEL;
}

/** A number the form holds as text — blank when the record has none. */
function numberField(value: number | null): string {
  return value === null ? '' : String(value);
}

export function stateFromVehicle(vehicle: EditableVehicle): VehicleFormState {
  return {
    registrationNumber: vehicle.registrationNumber,
    ...kindOfRecord(vehicle),
    vehicleType: vehicle.vehicleType,
    category: vehicle.category ?? null,
    truckType: vehicle.truckType ?? null,
    manufacturer: vehicle.manufacturer ?? '',
    model: vehicle.model ?? '',
    year: numberField(vehicle.year),
    colour: vehicle.colour ?? '',
    capacityTons: numberField(vehicle.capacityTons),
    passengerCapacity: numberField(vehicle.passengerCapacity),
    airConditioned: vehicle.airConditioned ?? false,
    fuelType: asFuelType(vehicle.fuelType),
    // Whole kilometres: the dial does not show a fraction of one.
    odometerKm: String(Math.round(vehicle.odometerKm)),
  };
}

/**
 * The form, filled in from the RC. The type is taken only when this account
 * may add it; otherwise the caller's default stands and the owner is told.
 */
export function stateFromRc(
  prefill: VehicleRcPrefill,
  fallbackType: VehicleType,
  offeredTypes: readonly VehicleType[],
): { state: VehicleFormState; typeAccepted: boolean } {
  const { draft } = prefill;
  const typeAccepted = draft.vehicleType !== null && offeredTypes.includes(draft.vehicleType);
  const base = initialState(typeAccepted && draft.vehicleType ? draft.vehicleType : fallbackType);
  // The tile the RC points at — only where it names one ("M-Cycle/Scooter"
  // leaves the owner to pick, and so does an RC this account cannot add).
  const category = typeAccepted ? resolveVehicleCategory(base.vehicleType, draft.category) : null;
  const truckType = typeAccepted ? draft.truckType : null;
  const kind = typeAccepted
    ? kindOfRecord({ vehicleType: base.vehicleType, category, truckType })
    : { vehicleClass: base.vehicleClass, optionId: null };
  return {
    typeAccepted,
    state: {
      ...base,
      ...kind,
      registrationNumber: prefill.registrationNumber,
      category,
      truckType,
      manufacturer: draft.manufacturer ?? '',
      model: draft.model ?? '',
      year: numberField(draft.year),
      colour: draft.colour ?? '',
      capacityTons: numberField(draft.capacityTons),
      passengerCapacity: numberField(draft.passengerCapacity),
      fuelType: draft.fuelType ?? base.fuelType,
    },
  };
}

/** Blank means "this vehicle has no recorded value", which a patch says as null. */
export function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
