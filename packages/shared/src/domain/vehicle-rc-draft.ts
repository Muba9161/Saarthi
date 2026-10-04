import { FuelType, TruckType, VehicleCapability, VehicleCategory, VehicleType } from './enums';
import type { VehicleRcRecord } from './vehicle-rc';
import { vehicleSupports } from './vehicles';

/**
 * The vehicle form, filled in from an RC record.
 *
 * Adding a vehicle starts with its registration number: Saarthi fetches the
 * RC and proposes everything else, and the owner reviews and saves. RTO text
 * is free-form ("Goods Carrier(HGV)", "Motor Car(LMV)", "PETROL/CNG"), so each
 * field is read conservatively — anything that cannot be read with confidence
 * is left `null` for the owner to fill in, rather than guessed.
 *
 * Only vehicle facts. The owner's name, address and phone, and the engine and
 * chassis numbers, are never part of a draft: it is produced before the
 * vehicle is on the account, when those must not be shown.
 */
export interface VehicleRcDraft {
  vehicleType: VehicleType | null;
  truckType: TruckType | null;
  /** Scooter, sedan… only where the RC itself says; see `categoryFrom`. */
  category: VehicleCategory | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  fuelType: FuelType | null;
  /** Payload in tonnes — gross vehicle weight less unladen weight. */
  capacityTons: number | null;
  passengerCapacity: number | null;
  registrationDate: string | null;
  registrationStatus: string | null;
  insuranceValidUntil: string | null;
  fitnessValidUntil: string | null;
  puccValidUntil: string | null;
}

function text(...parts: (string | null)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toUpperCase();
}

function isGoods(description: string): boolean {
  return /GOODS|\bHGV\b|\bMGV\b|\bLGV\b|\bHMV\b|TIPPER|TANKER|TRAILER|TRACTOR/.test(description);
}

/** A light goods vehicle at or under 3.5 t gross is a pickup, not a truck. */
const PICKUP_MAX_GVW_KG = 3500;

function vehicleTypeFrom(record: VehicleRcRecord): VehicleType | null {
  const description = text(record.vehicleClass, record.vehicleCategory, record.bodyType);
  if (!description) return null;

  const threeWheeler = /THREE WHEELER|3W|E-?RICKSHAW|AUTO RICKSHAW/.test(description);
  if (threeWheeler) return isGoods(description) ? VehicleType.TEMPO : VehicleType.AUTO_RICKSHAW;
  if (TWO_WHEELER_CLASS.test(description)) return VehicleType.TWO_WHEELER;

  if (isGoods(description)) {
    const gvw = record.grossVehicleWeight;
    return gvw !== null && gvw > 0 && gvw <= PICKUP_MAX_GVW_KG ? VehicleType.PICKUP : VehicleType.TRUCK;
  }
  if (/\bBUS\b|OMNI ?BUS|\bHPV\b/.test(description)) return VehicleType.BUS;
  if (/MAXI ?CAB|MOTOR ?CAB|\bTAXI\b/.test(description)) return VehicleType.TAXI;
  if (/\bVAN\b/.test(description)) return VehicleType.VAN;
  if (/\bSUV\b|\bMUV\b/.test(description)) return VehicleType.SUV;
  if (/MOTOR ?CAR|\bLMV\b|SALOON|SEDAN|HATCHBACK/.test(description)) return VehicleType.CAR;
  return null;
}

/**
 * RTO wording for two-wheelers: "M-Cycle/Scooter(2WN)", "Moped(2WN)",
 * "Motor Cycle/Scooter-Used For Hire(2WT)", "Motorised Cycle (CC > 25cc)".
 */
const TWO_WHEELER_CLASS = /\b2W[NT]?\b|TWO WHEELER|M-?CYCLE|MOTOR ?CYCLE|MOTORISED CYCLE|SCOOTER|MOPED/;

/**
 * Which kind of two-wheeler, only where the RC actually says.
 *
 * The usual class is "M-Cycle/Scooter", which names both, so it settles
 * nothing; a body type of "Scooter" or a class of "Moped" does. Sports,
 * cruiser and adventure are never on an RC — the owner picks those.
 */
function twoWheelerCategoryFrom(record: VehicleRcRecord): VehicleCategory | null {
  const body = text(record.bodyType);
  const description = text(record.vehicleClass, record.vehicleCategory, record.bodyType);
  if (/MOPED/.test(description)) return VehicleCategory.MOPED;
  const saysScooter = /SCOOTER/.test(body || description);
  const saysMotorcycle = /M-?CYCLE|MOTOR ?CYCLE/.test(body || description);
  if (saysScooter && !saysMotorcycle) {
    return fuelTypeFrom(record.fuelType) === FuelType.ELECTRIC
      ? VehicleCategory.ELECTRIC_SCOOTER
      : VehicleCategory.SCOOTER;
  }
  if (saysMotorcycle && !saysScooter) return VehicleCategory.MOTORCYCLE;
  return null;
}

/**
 * A car's body style, from the RC's body type — "SALOON", "HATCHBACK", "MUV".
 * Compact SUV and luxury are never on an RC; the owner picks those.
 */
function carCategoryFrom(record: VehicleRcRecord): VehicleCategory | null {
  const body = text(record.bodyType);
  if (!body) return null;
  if (body.includes('HATCH')) return VehicleCategory.HATCHBACK;
  if (/SALOON|SEDAN/.test(body)) return VehicleCategory.SEDAN;
  if (/\bMUV\b|\bMPV\b/.test(body)) return VehicleCategory.MUV;
  if (/\bSUV\b/.test(body)) return VehicleCategory.SUV;
  return null;
}

function categoryFrom(record: VehicleRcRecord, vehicleType: VehicleType | null): VehicleCategory | null {
  if (vehicleType === VehicleType.TWO_WHEELER) return twoWheelerCategoryFrom(record);
  if (
    vehicleType === VehicleType.CAR ||
    vehicleType === VehicleType.TAXI ||
    vehicleType === VehicleType.SUV
  ) {
    return carCategoryFrom(record);
  }
  return null;
}

function truckTypeFrom(record: VehicleRcRecord): TruckType | null {
  const body = text(record.bodyType);
  if (!body) return null;
  if (body.includes('TIPPER')) return TruckType.TIPPER;
  if (body.includes('TANKER')) return TruckType.TANKER;
  if (body.includes('TRAILER')) return TruckType.TRAILER;
  if (body.includes('FLAT')) return TruckType.FLATBED;
  if (/REEFER|REFRIGERAT|INSULATED/.test(body)) return TruckType.REFRIGERATED;
  if (/CONTAINER|CLOSED|BOX/.test(body)) return TruckType.CLOSED_CONTAINER;
  if (/OPEN|RIGID|DALA/.test(body)) return TruckType.OPEN_BODY;
  return null;
}

function fuelTypeFrom(value: string | null): FuelType | null {
  const fuel = text(value);
  if (!fuel) return null;
  // Dual-fuel cars run on the cheaper gas day to day.
  if (fuel.includes('CNG')) return FuelType.CNG;
  if (fuel.includes('LNG')) return FuelType.LNG;
  if (fuel.includes('HYBRID')) return FuelType.HYBRID;
  if (/ELECTRIC|BATTERY|\bEV\b|BOV/.test(fuel)) return FuelType.ELECTRIC;
  if (fuel.includes('DIESEL')) return FuelType.DIESEL;
  if (fuel.includes('PETROL')) return FuelType.PETROL;
  return null;
}

/** A plausible four-digit year out of "03/2019", "2019-03-01" or "Mar-2019". */
function yearFrom(...values: (string | null)[]): number | null {
  const now = new Date().getFullYear();
  for (const value of values) {
    const match = value?.match(/(19|20)\d{2}/);
    if (!match) continue;
    const year = Number(match[0]);
    // The vehicle forms accept 1980 onwards.
    if (year >= 1980 && year <= now + 1) return year;
  }
  return null;
}

function payloadTons(record: VehicleRcRecord): number | null {
  const gross = record.grossVehicleWeight;
  const unladen = record.unladenWeight;
  if (gross === null || unladen === null || gross <= unladen) return null;
  return Math.round(((gross - unladen) / 1000) * 10) / 10;
}

function modelName(record: VehicleRcRecord): string | null {
  const model = record.model?.trim() || null;
  const variant = record.variant?.trim() || null;
  if (!model) return variant;
  if (!variant || model.toUpperCase().includes(variant.toUpperCase())) return model;
  return `${model} ${variant}`;
}

export function vehicleDraftFromRc(record: VehicleRcRecord): VehicleRcDraft {
  const vehicleType = vehicleTypeFrom(record);
  const carriesGoods = vehicleType === VehicleType.TRUCK || vehicleType === VehicleType.PICKUP || vehicleType === VehicleType.TEMPO;
  // A two-wheeler's RC lists a pillion as a seat; the type has no seat count.
  const seats =
    vehicleType === null || vehicleSupports(vehicleType, VehicleCapability.PASSENGER_CAPACITY);

  return {
    vehicleType,
    truckType: carriesGoods ? truckTypeFrom(record) : null,
    category: categoryFrom(record, vehicleType),
    manufacturer: record.maker?.trim() || null,
    model: modelName(record),
    year: yearFrom(record.manufacturedOn, record.registrationDate),
    colour: record.color?.trim() || null,
    fuelType: fuelTypeFrom(record.fuelType),
    capacityTons: carriesGoods ? payloadTons(record) : null,
    passengerCapacity: carriesGoods || !seats ? null : record.seatingCapacity,
    registrationDate: record.registrationDate,
    registrationStatus: record.registrationStatus,
    insuranceValidUntil: record.insuranceValidUntil,
    fitnessValidUntil: record.fitnessValidUntil,
    puccValidUntil: record.puccValidUntil,
  };
}

/** What `POST /vehicles/rc-prefill` returns. */
export interface VehicleRcPrefill {
  /** Passed back on create, so the saved vehicle is verified from this record. */
  lookupId: string;
  registrationNumber: string;
  draft: VehicleRcDraft;
}
