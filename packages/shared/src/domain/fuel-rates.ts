/**
 * City fuel rate domain contract.
 *
 * Saarthi shows a fuel price only when it can say *where* the price is for and
 * *when* it was published. That rule exists because the previous source could
 * do neither: the petrol-station directory served one city figure stamped onto
 * every station, years out of date, with no timestamp to reveal it — Gurugram
 * petrol at ₹95.44 against a real ₹102.97 on 2026-08-31. See
 * `FUEL_DIRECTORY_PRICE_NOTE` in `./petrol-stations`.
 *
 * So a rate here always carries its city, its state and the date the publisher
 * stamped on it, and every figure is bounds-checked before it is allowed out of
 * the adapter. A rate that cannot be parsed or fails its band is dropped, never
 * guessed — for fuel, absent is safe and wrong is not.
 */

import type { PetrolFuelFilter } from './petrol-stations';

/** One fuel's published rate for a city. */
export interface FuelRateEntry {
  /** ₹ per litre for petrol and diesel; ₹ per kg for CNG. */
  price: number;
  /** ₹ per litre, or ₹ per kg for CNG. */
  unit: 'litre' | 'kg';
}

export interface CityFuelRate {
  /** City the rate applies to, as Saarthi asked for it. */
  city: string;
  state: string | null;
  petrol: FuelRateEntry | null;
  diesel: FuelRateEntry | null;
  cng: FuelRateEntry | null;
  /**
   * The date the publisher stamped on the page, ISO `YYYY-MM-DD`, or `null`
   * when it published none. Never inferred from the clock: "when we fetched it"
   * is not "when it was priced", and conflating the two is what made the old
   * source dangerous.
   */
  publishedOn: string | null;
  /** Who published it, for attribution in the UI. */
  source: string;
  /** When Saarthi retrieved it, ISO 8601. */
  retrievedAt: string;
  /** Served from cache rather than a fresh fetch. */
  cached: boolean;
}

/**
 * Plausible retail bands in ₹, used to reject a bad parse.
 *
 * Deliberately wide: the job is to catch a page-layout change that yields a
 * page number, a year or a phone digit — not to second-guess the market. Indian
 * retail petrol has ranged roughly ₹95–₹120 across states in recent years, so
 * these leave generous headroom in both directions while still refusing a `20`
 * or a `2026`.
 */
export const FUEL_RATE_BANDS: Record<PetrolFuelFilter, { min: number; max: number }> = {
  petrol: { min: 70, max: 160 },
  diesel: { min: 60, max: 150 },
  // CNG is per kg and varies far more by city gas distributor than liquid fuel.
  cng: { min: 35, max: 160 },
};

/** The unit a fuel is retailed in. CNG is sold by weight, not volume. */
export function fuelRateUnit(fuel: PetrolFuelFilter): 'litre' | 'kg' {
  return fuel === 'cng' ? 'kg' : 'litre';
}

/** True when a parsed figure is a believable retail rate for that fuel. */
export function isPlausibleFuelRate(fuel: PetrolFuelFilter, price: number): boolean {
  if (!Number.isFinite(price)) return false;
  const band = FUEL_RATE_BANDS[fuel];
  return price >= band.min && price <= band.max;
}

/** `₹102.31/L`, or `₹99.50/kg` for CNG. */
export function formatFuelRate(entry: FuelRateEntry | null): string {
  if (!entry) return '—';
  return `₹${entry.price.toFixed(2)}/${entry.unit === 'kg' ? 'kg' : 'L'}`;
}

/** True when the rate carries at least one usable figure. */
export function hasAnyFuelRate(rate: CityFuelRate | null | undefined): boolean {
  if (!rate) return false;
  return rate.petrol !== null || rate.diesel !== null || rate.cng !== null;
}

/**
 * How the rate should be described to a reader.
 *
 * Names the city and the publisher's own date, so a stale rate is visibly
 * stale rather than quietly presented as today's.
 */
export function describeFuelRate(rate: CityFuelRate): string {
  const place = [rate.city, rate.state].filter(Boolean).join(', ');
  if (!rate.publishedOn) return `${place} — published rate, date not stated`;
  return `${place} — published ${rate.publishedOn}`;
}

// ---------------------------------------------------------------------------
// What a trip will burn, and therefore what it should earn
// ---------------------------------------------------------------------------

/**
 * The published rate that applies to a given vehicle.
 *
 * Electric and hybrid vehicles are absent on purpose: no fuel publisher quotes
 * a per-unit price for them, and inventing one is exactly the failure this
 * module exists to prevent. LNG is missing for the same reason — it is not in
 * the daily city tables.
 */
export function fuelRateForVehicle(
  rate: CityFuelRate | null | undefined,
  fuelType: string,
): FuelRateEntry | null {
  if (!rate) return null;
  switch (fuelType) {
    case 'DIESEL':
      return rate.diesel;
    case 'PETROL':
      return rate.petrol;
    case 'CNG':
      return rate.cng;
    default:
      return null;
  }
}

/**
 * Fuel's share of a fare that also has to cover the driver, the tyres, the
 * maintenance, the tolls and something left over.
 *
 * Fifty-five percent is the middle of the range Indian road freight is
 * generally run at. It is a starting point for a dispatcher pricing a job over
 * the phone, not a rate card: the screen shows the arithmetic that produced it
 * so the number can be argued with, which is the only honest way to present a
 * figure derived from an assumption.
 */
export const FUEL_SHARE_OF_FARE = 0.55;

export interface FareEstimateInput {
  distanceKm: number;
  /** Kilometres per litre — or per kg for CNG. Null when never recorded. */
  fuelEfficiency: number | null;
  /** The city's published rate for this vehicle's fuel. */
  rate: FuelRateEntry | null;
}

export interface FareEstimate {
  distanceKm: number;
  /** Litres, or kilograms for CNG. */
  fuelUnits: number;
  unit: 'litre' | 'kg';
  pricePerUnit: number;
  /** What the fuel alone costs. A fare below this loses money on the spot. */
  fuelCost: number;
  /** Fuel plus the usual margin — see `FUEL_SHARE_OF_FARE`. */
  suggestedFare: number;
}

/**
 * What this trip burns, and a fare that covers it.
 *
 * Returns null rather than a zero whenever a piece is missing — an unknown
 * mileage, a city with no published rate, an electric van. A suggestion built
 * on a guessed input is worse than no suggestion, because it looks like it was
 * calculated.
 */
export function estimateTripFare(input: FareEstimateInput): FareEstimate | null {
  const { distanceKm, fuelEfficiency, rate } = input;
  if (!rate || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  if (!fuelEfficiency || !Number.isFinite(fuelEfficiency) || fuelEfficiency <= 0) return null;

  const fuelUnits = distanceKm / fuelEfficiency;
  const fuelCost = fuelUnits * rate.price;

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    fuelUnits: Math.round(fuelUnits * 10) / 10,
    unit: rate.unit,
    pricePerUnit: rate.price,
    fuelCost: Math.round(fuelCost),
    suggestedFare: Math.round(fuelCost / FUEL_SHARE_OF_FARE),
  };
}
