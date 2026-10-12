import type { CityFuelRate, LatLng, PetrolFuelFilter } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { routingProvider, type Locality } from '../../providers/routing';
import { getCityFuelRate } from '../fuel-rates/fuel-rate.service';
import { tripForSlip } from '../expenses/expense.service';
import type { AuthContext } from '../../auth/context';

/**
 * The things a driver needs that the terminal could not previously reach.
 *
 * Each of these already existed on the platform and was visible only to a fleet
 * manager in a browser: the FASTag balance, the papers a checkpoint asks for,
 * today's diesel rate, the driver's own trip history, and the notifications the
 * server was already writing for them. A driver at a toll plaza with a blocked
 * tag, or at a state border without an insurance certificate, is stopped — and
 * the system knew, and had no way to tell them.
 *
 * Deliberately one small module rather than five. Every function here answers
 * the same question — "what does *this* driver, on *this* vehicle, need to know
 * right now" — and each is a thin, read-only projection of a service that owns
 * the real logic.
 */

const FUEL_LOCALITY_TTL_SECONDS = 6 * 60 * 60;

/**
 * How coarsely a position is turned into a place, for caching.
 *
 * Two decimal places is roughly a kilometre. A diesel rate is published per
 * city and does not change across a kilometre, so rounding here turns a moving
 * vehicle's thousands of distinct positions into a handful of cache keys —
 * without which every telemetry frame would be a geocoder call.
 */
function localityKey(at: LatLng): string {
  // `v2`: entries now carry the district, and an older entry without one must
  // not be read as "this place has no district".
  return `terminal:locality:v2:${at.latitude.toFixed(2)},${at.longitude.toFixed(2)}`;
}

export interface DriverFuelPrice {
  city: string;
  state: string | null;
  /** Rupees per litre. Null when the provider does not cover this city. */
  diesel: number | null;
  petrol: number | null;
  /** Rupees per kilogram, not per litre — CNG is sold by weight. */
  cng: number | null;
  /**
   * The date the publisher stamped on it, never the clock.
   *
   * "When we fetched it" is not "when it was priced", and the fuel-rate service
   * is deliberate about the difference; passing that distinction through means a
   * driver can see a rate is yesterday's.
   */
  publishedOn: string | null;
  source: string;
  /**
   * What the rate is published for. `STATE` is the state-wide average for a
   * town nobody prices on its own, and must be labelled as an average.
   */
  scope: 'CITY' | 'DISTRICT' | 'STATE';
}

/**
 * Today's pump price where the vehicle actually is.
 *
 * Two hops, because the two datasets are keyed differently: the vehicle reports
 * a coordinate and the rate is published for a city, so the position is reverse
 * geocoded first. Both hops are cached — the locality for six hours because a
 * city does not move, and the rate by the fuel-rate service's own policy.
 *
 * Returns null rather than a zero when anything is unavailable. A fuel price is
 * a number a driver may spend money against, and a wrong one is worse than an
 * absent one.
 */
export async function fuelPriceNear(
  at: LatLng,
  fuel?: PetrolFuelFilter,
): Promise<DriverFuelPrice | null> {
  if (!routingProvider) return null;

  const key = localityKey(at);
  let locality = await cache.get<Locality>(key);

  if (locality === null) {
    try {
      locality = await routingProvider.reverseGeocode(at);
    } catch (error) {
      logger.debug({ err: error }, 'Could not name the locality for a fuel price');
      return null;
    }
    if (!locality) return null;
    await cache.set(key, locality, FUEL_LOCALITY_TTL_SECONDS);
  }

  const state = locality.state ?? undefined;
  const priced = await pricedPlace(locality, fuel);

  if (!priced) {
    // The city is known and the rate is not. Saying where we looked is more
    // use than a bare "unavailable" — a driver can tell whether we looked in
    // the right place.
    return {
      city: locality.city,
      state: locality.state,
      scope: 'CITY',
      diesel: null,
      petrol: null,
      cng: null,
      publishedOn: null,
      source: 'unavailable',
    };
  }

  const { rate, scope } = priced;
  return {
    // The place the rate is published for: the town, its district, or the state.
    city: rate.city,
    state: state ?? null,
    scope,
    diesel: rate.diesel?.price ?? null,
    petrol: rate.petrol?.price ?? null,
    cng: rate.cng?.price ?? null,
    publishedOn: rate.publishedOn,
    source: rate.source,
  };
}

/**
 * The pump fuel a vehicle's recorded fuel type buys — the same rule the app's
 * `PumpPrice` applies: a hybrid buys petrol; electric and LNG buy none that is
 * published; an unrecorded type is left open.
 */
export function pumpFuelFor(fuelType: string | null): PetrolFuelFilter | undefined {
  switch (fuelType) {
    case 'DIESEL':
      return 'diesel';
    case 'PETROL':
    case 'HYBRID':
      return 'petrol';
    case 'CNG':
      return 'cng';
    default:
      return undefined;
  }
}

/**
 * The most local published rate for a place: the town, then its district, then
 * the state-wide average.
 *
 * In that order so a town that publishes its own rate always keeps it. A suburb
 * or a highway village is priced by its district; a district nobody prices on
 * its own falls back to the state average, which the card labels as such.
 *
 * With `fuel` named, a place that prices other fuels but not this one is
 * passed over: a town publishing diesel and CNG is no answer for a petrol car.
 */
async function pricedPlace(
  locality: Locality,
  fuel: PetrolFuelFilter | undefined,
): Promise<{ rate: CityFuelRate; scope: DriverFuelPrice['scope'] } | null> {
  const state = locality.state ?? undefined;
  const usable = (rate: CityFuelRate | null): rate is CityFuelRate =>
    rate !== null && (fuel === undefined || rate[fuel] !== null);

  const city = await getCityFuelRate({ city: locality.city, state });
  if (usable(city)) return { rate: city, scope: 'CITY' };

  const district = locality.district;
  if (district && district.toLowerCase() !== locality.city.toLowerCase()) {
    const rate = await getCityFuelRate({ city: district, state });
    if (usable(rate)) return { rate, scope: 'DISTRICT' };
  }

  if (state) {
    const rate = await getCityFuelRate({ city: state, state }, 'state');
    if (usable(rate)) return { rate, scope: 'STATE' };
  }

  // Nothing prices this fuel; the town's other fuels are still worth showing.
  return city ? { rate: city, scope: 'CITY' } : null;
}

export interface DriverFastag {
  tagId: string | null;
  issuerBank: string | null;
  status: string;
  /** Rupees. Null when the bank has never reported one. */
  balanceRupees: number | null;
  lowBalance: boolean;
  balanceUpdatedAt: string | null;
}

/**
 * The vehicle's FASTag, as a driver needs it.
 *
 * One number and one warning. A blocked tag or an empty one is a stopped truck
 * and an argument at a barrier, and it is the kind of problem that is trivial to
 * fix an hour before and impossible to fix in the queue.
 *
 * Read straight from the account rather than through the fleet listing service:
 * that one paginates, sorts and totals across a whole fleet for a manager's
 * table, and none of that is meaningful for the single tag on the vehicle the
 * driver is sitting in.
 */
export async function fastagForVehicle(
  organizationId: string,
  vehicleId: string,
): Promise<DriverFastag | null> {
  const account = await prisma.fastagAccount.findFirst({
    where: { organizationId, vehicleId },
    orderBy: { updatedAt: 'desc' },
    select: {
      tagId: true,
      issuerBank: true,
      status: true,
      balance: true,
      lowBalanceThreshold: true,
      balanceUpdatedAt: true,
    },
  });
  if (!account) return null;

  const balance = account.balance === null ? null : Number(account.balance);
  const threshold =
    account.lowBalanceThreshold === null ? null : Number(account.lowBalanceThreshold);

  return {
    tagId: account.tagId,
    issuerBank: account.issuerBank,
    status: account.status,
    balanceRupees: balance,
    // Only a real balance against a real threshold is a warning. Unknown is
    // not low, and colouring it red would train drivers to ignore the colour.
    lowBalance: balance !== null && threshold !== null && balance <= threshold,
    // When the *balance* was last known, not when we last talked to the bank.
    // A successful sync that returned nothing new is not fresher information.
    balanceUpdatedAt: account.balanceUpdatedAt?.toISOString() ?? null,
  };
}

export interface DriverNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * What the server has already been telling this driver.
 *
 * `notify()` has been writing these all along — an approval, a revocation, a
 * document about to lapse — and the app has never read one, so the only way a
 * driver learned they were approved was the cockpit polling every five seconds.
 */
export async function driverNotifications(
  userId: string,
  limit: number,
): Promise<{ items: DriverNotification[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: String(row.type),
      title: row.title,
      body: row.body,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    unread,
  };
}

export interface DriverTrip {
  id: string;
  reference: string | null;
  status: string;
  registrationNumber: string | null;
  startedAt: string | null;
  completedAt: string | null;
  distanceKm: number | null;
  /** True when `distanceKm` is the plan rather than what was driven. */
  distanceIsPlanned: boolean;
  fromLabel: string | null;
  toLabel: string | null;
  /** The driver added this trip; the fleet did not dispatch it. */
  driverCreated: boolean;
  /** A service run the app opened on its own, not a trip anyone planned. */
  adHoc: boolean;
  plannedStartAt: string | null;
  createdAt: string;
  notes: string | null;
}

/**
 * What this driver has actually run.
 *
 * The question drivers ask most often and the one the app could not answer —
 * there was no driver-scoped trip endpoint at all, which is why the dashboard
 * showed no history rather than an invented one.
 *
 * Scoped by `driverId` directly. `listTrips` would also do it, through an auth
 * context whose organisation scope is wider than this driver, and a wider query
 * narrowed afterwards is a query that can be got wrong once.
 */
export async function driverTrips(driverId: string, limit: number): Promise<DriverTrip[]> {
  const rows = await prisma.trip.findMany({
    where: { driverId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      reference: true,
      status: true,
      actualStartAt: true,
      actualArrivalAt: true,
      actualDistanceKm: true,
      plannedDistanceKm: true,
      originAddress: true,
      destinationAddress: true,
      truckId: true,
      driverCreated: true,
      adHoc: true,
      plannedStartAt: true,
      createdAt: true,
      notes: true,
    },
  });

  // One lookup for the registrations rather than a join per row: a driver's
  // recent trips are nearly always the same one or two vehicles.
  const registrations = new Map<string, string>();
  const truckIds = [...new Set(rows.map((row) => row.truckId))];
  if (truckIds.length > 0) {
    const trucks = await prisma.truck.findMany({
      where: { id: { in: truckIds } },
      select: { id: true, registrationNumber: true },
    });
    for (const truck of trucks) registrations.set(truck.id, truck.registrationNumber);
  }

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference ?? null,
    status: String(row.status),
    registrationNumber: registrations.get(row.truckId) ?? null,
    startedAt: row.actualStartAt?.toISOString() ?? null,
    completedAt: row.actualArrivalAt?.toISOString() ?? null,
    /*
     * What was driven, or what was planned, and which of the two.
     *
     * A trip still under way has no actual distance yet, and showing a plan as
     * though it were a measurement is the one thing this must not do — so the
     * flag travels with the number. The driven figure defaults to zero in the
     * database, so zero is "not driven yet", not a measurement.
     */
    distanceKm:
      row.actualDistanceKm > 0
        ? Number(row.actualDistanceKm.toFixed(1))
        : row.plannedDistanceKm !== null
          ? Number(row.plannedDistanceKm)
          : null,
    distanceIsPlanned: row.actualDistanceKm <= 0 && row.plannedDistanceKm !== null,
    fromLabel: row.originAddress ?? null,
    toLabel: row.destinationAddress ?? null,
    driverCreated: row.driverCreated,
    adHoc: row.adHoc,
    plannedStartAt: row.plannedStartAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    notes: row.notes,
  }));
}

export interface FuelSlipInput {
  organizationId: string;
  vehicleId: string;
  driverId: string | null;
  /** The driver's own user, recorded as who entered the slip. */
  createdById: string | null;
  litres: number;
  totalCost: number;
  odometerKm: number | null;
  stationName: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * A fuel slip, recorded from the pump.
 *
 * Drivers carry paper. A till roll from a petrol pump goes in a shirt pocket,
 * survives a week of diesel and sunlight, and reaches the office as an argument
 * about whether it was 40 litres or 45 — because filling in a form on a phone
 * beside a running engine is worse than keeping the paper.
 *
 * So this asks for the two numbers that are printed largest on every slip, and
 * takes the photograph as the evidence for everything else. The office gets a
 * record it can reconcile; the driver gets a fifteen-second task instead of a
 * pocketful of receipts.
 *
 * The price per litre is derived rather than asked for. It is on the slip, but
 * it is also exactly `total ÷ litres`, and a third number to type at a pump is
 * a third chance to mistype one.
 *
 * Filed against the dispatched trip under way, as a fleet-entered fuel record
 * is, so the fill lands in that trip's cost instead of floating free of it.
 */
export async function recordFuelSlip(input: FuelSlipInput): Promise<{ id: string }> {
  const record = await prisma.fuelRecord.create({
    data: {
      truckId: input.vehicleId,
      organizationId: input.organizationId,
      tripId: await tripForSlip(input.vehicleId),
      driverId: input.driverId,
      createdById: input.createdById,
      quantityLitres: input.litres,
      pricePerUnit: input.totalCost / input.litres,
      totalCost: input.totalCost,
      odometerKm: input.odometerKm,
      stationName: input.stationName,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    select: { id: true },
  });

  return record;
}

/** Undo a fuel slip whose photograph could not be stored. */
export async function discardFuelSlip(id: string): Promise<void> {
  await prisma.fuelRecord.deleteMany({ where: { id } });
}

/** Unused today, kept so the auth shape of this module stays explicit. */
export type DriverExtrasAuth = AuthContext;
