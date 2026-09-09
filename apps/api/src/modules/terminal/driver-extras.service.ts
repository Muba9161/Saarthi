import { DocumentOwnerType, type LatLng } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { routingProvider } from '../../providers/routing';
import { getCityFuelRate } from '../fuel-rates/fuel-rate.service';
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
  return `terminal:locality:${at.latitude.toFixed(2)},${at.longitude.toFixed(2)}`;
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
export async function fuelPriceNear(at: LatLng): Promise<DriverFuelPrice | null> {
  if (!routingProvider) return null;

  const key = localityKey(at);
  let locality = await cache.get<{ city: string; state: string | null }>(key);

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

  const rate = await getCityFuelRate({ city: locality.city, state: locality.state ?? undefined });
  if (!rate) {
    // The city is known and the rate is not. Saying where we looked is more
    // use than a bare "unavailable" — a driver can tell whether we looked in
    // the right place.
    return {
      city: locality.city,
      state: locality.state,
      diesel: null,
      petrol: null,
      cng: null,
      publishedOn: null,
      source: 'unavailable',
    };
  }

  return {
    city: locality.city,
    state: locality.state,
    diesel: rate.diesel?.price ?? null,
    petrol: rate.petrol?.price ?? null,
    cng: rate.cng?.price ?? null,
    publishedOn: rate.publishedOn,
    source: rate.source,
  };
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

export interface DriverDocument {
  id: string;
  ownerType: string;
  documentType: string;
  title: string | null;
  number: string | null;
  expiryDate: string | null;
  verificationStatus: string;
  /** Days until expiry; negative once expired. Null with no expiry recorded. */
  daysToExpiry: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

/**
 * Every paper a checkpoint might ask for, vehicle and driver together.
 *
 * Returned as one list rather than two because that is how they are asked for:
 * an officer at a state border wants the RC, the insurance, the permit, the PUC
 * *and* the licence, and a driver holding a phone should not have to know which
 * of Saarthi's tables each lives in.
 *
 * Sorted by expiry, soonest first, so the one about to cause a problem is at the
 * top. Documents with no expiry sort last — they cannot lapse.
 */
export async function driverDocuments(
  organizationId: string,
  vehicleId: string,
  driverId: string | null,
): Promise<DriverDocument[]> {
  const rows = await prisma.document.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        { ownerType: DocumentOwnerType.TRUCK, ownerId: vehicleId },
        ...(driverId ? [{ ownerType: DocumentOwnerType.DRIVER, ownerId: driverId }] : []),
      ],
    },
    select: {
      id: true,
      ownerType: true,
      documentType: true,
      title: true,
      documentNumber: true,
      expiryDate: true,
      verificationStatus: true,
      mimeType: true,
      fileSize: true,
    },
  });

  return rows
    .map((row) => ({
      id: row.id,
      ownerType: String(row.ownerType),
      documentType: String(row.documentType),
      title: row.title,
      number: row.documentNumber,
      expiryDate: row.expiryDate?.toISOString() ?? null,
      verificationStatus: String(row.verificationStatus),
      daysToExpiry: daysUntil(row.expiryDate),
      mimeType: row.mimeType,
      sizeBytes: row.fileSize === null ? null : Number(row.fileSize),
    }))
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
}

/** One document's stored object, for the app to cache against a checkpoint. */
export async function driverDocumentForDownload(
  organizationId: string,
  vehicleId: string,
  driverId: string | null,
  documentId: string,
): Promise<{ storageKey: string; mimeType: string | null; fileName: string } | null> {
  const row = await prisma.document.findFirst({
    // Scoped by owner as well as by id: a document id is not a capability, and
    // a driver may read the papers of the vehicle they are signed on to and
    // their own — nothing else in the fleet.
    where: {
      id: documentId,
      organizationId,
      deletedAt: null,
      OR: [
        { ownerType: DocumentOwnerType.TRUCK, ownerId: vehicleId },
        ...(driverId ? [{ ownerType: DocumentOwnerType.DRIVER, ownerId: driverId }] : []),
      ],
    },
    select: { storageKey: true, mimeType: true, fileName: true, documentType: true },
  });
  if (!row) return null;

  return {
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    fileName: row.fileName ?? `${String(row.documentType).toLowerCase()}.pdf`,
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
     * flag travels with the number.
     */
    distanceKm:
      row.actualDistanceKm !== null
        ? Number(row.actualDistanceKm)
        : row.plannedDistanceKm !== null
          ? Number(row.plannedDistanceKm)
          : null,
    distanceIsPlanned: row.actualDistanceKm === null && row.plannedDistanceKm !== null,
    fromLabel: row.originAddress ?? null,
    toLabel: row.destinationAddress ?? null,
  }));
}

export interface FuelSlipInput {
  organizationId: string;
  vehicleId: string;
  driverId: string | null;
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
 */
export async function recordFuelSlip(input: FuelSlipInput): Promise<{ id: string }> {
  const record = await prisma.fuelRecord.create({
    data: {
      truckId: input.vehicleId,
      organizationId: input.organizationId,
      driverId: input.driverId,
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

/** Unused today, kept so the auth shape of this module stays explicit. */
export type DriverExtrasAuth = AuthContext;
