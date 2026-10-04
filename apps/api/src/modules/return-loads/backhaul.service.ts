import {
  BACKHAUL_COMMISSION_RULE,
  ENABLE_BACKHAUL_ACTION,
  Feature,
  MARKETPLACE_COMMISSION_RULE,
  NotificationPriority,
  NotificationType,
  OPEN_RETURN_LOAD_STATUSES,
  OPERATOR_OWNER_ROLES,
  TripLegType,
  TripStatus,
  ReturnLoadStatus,
  backhaulUnavailableReason,
  formatPercent,
  type EnableBackhaulInput,
  type PlanTier,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hasFeature } from '../../server/guards';
import type { AuthContext } from '../../auth/context';
import { notifyOrganization } from '../notifications/notification.service';
import { resolveSubscription, subscriptionHasFeature } from '../subscriptions/entitlements.service';
import { completeBackhaulForTrip } from './backhaul-lifecycle';
import {
  openReturnLoadForTrip,
  refreshMatches,
  requestInclude,
  toView,
  type ReturnLoadView,
} from './return-load.service';

/**
 * "Enable backhaul" — the owner's decision to fill a completed trip's way home.
 *
 * The moment a Business-plan fleet's trip completes, its owner is told and
 * offered the button. Enabling opens a return-load request from where the
 * truck now stands back to its home base, and records that the owner accepted
 * the backhaul commission: any job won on that return leg is charged 3% of
 * profit rather than the ordinary 2%.
 */

const backhaulLogger = logger.child({ module: 'return-loads:backhaul' });

type TripRow = Prisma.TripGetPayload<Record<string, never>>;
type TruckRow = Prisma.TruckGetPayload<Record<string, never>>;

export interface BackhaulOffer {
  tripId: string;
  /** Why the button is not offered, or null when it is. */
  unavailableReason: string | null;
  commission: {
    rate: number;
    ruleVersion: string;
    /** The ordinary marketplace rate it replaces, for the disclosure. */
    ordinaryRate: number;
  };
  /** The backhaul already enabled from this trip, if any. */
  request: ReturnLoadView | null;
}

const COMMISSION_TERMS = {
  rate: BACKHAUL_COMMISSION_RULE.rate,
  ruleVersion: BACKHAUL_COMMISSION_RULE.version,
  ordinaryRate: MARKETPLACE_COMMISSION_RULE.rate,
} as const;

function unavailableReason(
  trip: TripRow,
  truck: TruckRow | null,
  plan: { planTier: PlanTier | null; hasReturnLoads: boolean },
): string | null {
  if (!truck) return 'The vehicle on this trip is no longer in your fleet.';
  return backhaulUnavailableReason({
    ...plan,
    tripStatus: trip.status as TripStatus,
    legType: trip.legType as TripLegType,
    adHoc: trip.adHoc,
    acceptsReturnLoads: truck.acceptsReturnLoads,
  });
}

/** The fleet's own trip and its vehicle, or not found. */
async function loadOwnTrip(
  auth: AuthContext,
  tripId: string,
): Promise<{ trip: TripRow; truck: TruckRow | null }> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || (!auth.isPlatformAdmin && trip.organizationId !== auth.organizationId)) {
    throw errors.notFound('Trip');
  }
  // `trips.truckId` is a plain column with no Prisma relation.
  const truck = await prisma.truck.findUnique({ where: { id: trip.truckId } });
  return { trip, truck: truck && !truck.archivedAt ? truck : null };
}

/** The backhaul enabled from this trip — the latest, whatever became of it. */
async function backhaulOfTrip(tripId: string) {
  return prisma.returnLoadRequest.findFirst({
    where: { outboundTripId: tripId, commissionAcceptedAt: { not: null } },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
  });
}

function planOf(auth: AuthContext): { planTier: PlanTier | null; hasReturnLoads: boolean } {
  return {
    planTier: auth.subscription?.planTier ?? null,
    hasReturnLoads: hasFeature(auth, Feature.RETURN_LOADS),
  };
}

/** A return leg that has been won is not reopened from the same trip. */
const SETTLED_STATUSES: readonly string[] = [ReturnLoadStatus.BOOKED, ReturnLoadStatus.COMPLETED];
const ALREADY_BOOKED = 'The return leg of this trip is already booked.';

export async function backhaulForTrip(auth: AuthContext, tripId: string): Promise<BackhaulOffer> {
  const { trip, truck } = await loadOwnTrip(auth, tripId);
  const request = await backhaulOfTrip(tripId);
  return {
    tripId,
    unavailableReason:
      request && SETTLED_STATUSES.includes(request.status)
        ? ALREADY_BOOKED
        : unavailableReason(trip, truck, planOf(auth)),
    commission: COMMISSION_TERMS,
    request: request ? toView(request) : null,
  };
}

/** `opened` is false when this trip's backhaul was already enabled. */
export async function enableBackhaul(
  auth: AuthContext,
  tripId: string,
  input: EnableBackhaulInput,
): Promise<{ offer: BackhaulOffer; opened: boolean }> {
  const { trip, truck } = await loadOwnTrip(auth, tripId);
  const reason = unavailableReason(trip, truck, planOf(auth));
  if (reason) throw errors.businessRule(reason);

  // Enabling twice is the same decision, not a second backhaul.
  const enabled = await backhaulOfTrip(tripId);
  if (enabled && OPEN_RETURN_LOAD_STATUSES.includes(enabled.status as ReturnLoadStatus)) {
    return { offer: await backhaulForTrip(auth, tripId), opened: false };
  }
  if (enabled && SETTLED_STATUSES.includes(enabled.status)) {
    throw errors.businessRule(ALREADY_BOOKED);
  }

  // One open request per vehicle: two would produce matches nobody can reconcile.
  const other = await prisma.returnLoadRequest.findFirst({
    where: { truckId: trip.truckId, status: { in: OPEN_RETURN_LOAD_STATUSES } },
    select: { reference: true },
  });
  if (other) {
    throw errors.conflict(
      `This vehicle already has an open return-load request (${other.reference}). Cancel it before enabling backhaul here.`,
    );
  }

  const opened = await openReturnLoadForTrip({
    trip,
    truck: truck!,
    acceptedById: auth.user.id,
    detourToleranceKm: input.detourToleranceKm,
    commission: BACKHAUL_COMMISSION_RULE,
  });

  // Direct freight orders on the way home are scored by the existing engine too.
  await refreshMatches(auth, opened.id, { notify: false });

  return { offer: await backhaulForTrip(auth, tripId), opened: true };
}

/**
 * After a trip completes: close its backhaul if it was a return leg, or offer
 * the owner a backhaul if it was an outbound run.
 *
 * Never throws. Completing a trip must not fail because a notification could
 * not be sent; the owner can still enable backhaul from the trip screen.
 */
export async function onTripCompleted(tripId: string): Promise<void> {
  try {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.status !== TripStatus.COMPLETED) return;

    if (trip.legType === TripLegType.RETURN) {
      await completeBackhaulForTrip(trip);
      return;
    }

    const [truck, subscription] = await Promise.all([
      prisma.truck.findUnique({ where: { id: trip.truckId } }),
      resolveSubscription(trip.organizationId),
    ]);
    const reason = unavailableReason(trip, truck, {
      planTier: subscription.planTier,
      hasReturnLoads: subscriptionHasFeature(subscription, Feature.RETURN_LOADS),
    });
    if (reason || !truck) return;

    await notifyOrganization(trip.organizationId, {
      type: NotificationType.TRIP_COMPLETED,
      title: `${truck.registrationNumber} delivered — fill the way back`,
      body: `Trip ${trip.reference} is complete at ${trip.destinationAddress}. Enable backhaul to see customers who need goods on the way home, with sellers near your truck. Saarthi charges ${formatPercent(BACKHAUL_COMMISSION_RULE.rate * 100)} of the profit only on a job you win.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/trips/${trip.id}`,
      data: { action: ENABLE_BACKHAUL_ACTION, tripId: trip.id },
      roles: OPERATOR_OWNER_ROLES,
    });
  } catch (error) {
    backhaulLogger.warn({ err: error, tripId }, 'Post-completion backhaul step failed');
  }
}
