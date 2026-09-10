import {
  CLOSED_SALES_LEAD_STATUSES,
  CONVERTED_SALES_LEAD_STATUSES,
  OPEN_SALES_LEAD_STATUSES,
  type PlanTier,
  ReferralStatus,
  type SalesLeadStatus,
  TrackerHandoverStatus,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { cache, cached } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { commissionTotals, type CommissionTotals } from './commission.service';
import { handoverSummary, type HandoverSummary } from './handover.service';

/**
 * The salesman dashboard and customer list.
 *
 * Every number on these screens is a `COUNT` or a `SUM` over real rows. There
 * is no seeded pipeline, no demo lead, no illustrative commission figure. A
 * salesperson's first login shows zeros, and that is correct — a dashboard that
 * opens with twenty-four invented leads is a dashboard nobody can trust the
 * day it has twenty-four real ones.
 *
 * ## What a salesperson may see of a customer
 *
 * Deliberately thin, and assembled here rather than by granting fleet
 * permissions. The list answers "did the sale land, and is the customer
 * actually using it" — a name, a vehicle count, a subscription state, how many
 * vehicles are reporting. It carries no driver names, no positions, no trips,
 * no documents, no contact details beyond what the salesperson captured on the
 * lead themselves.
 *
 * That restriction is why `SALESMAN` holds none of the fleet read permissions:
 * a salesperson who closed a deal last quarter has no business watching that
 * customer's vehicles move, and if this screen needed those grants to work, the
 * grants would be the leak.
 */

export interface SalesDashboard {
  salesmanId: string;
  godId: string;
  leads: {
    total: number;
    open: number;
    /** Follow-up date has passed and the lead is still open. */
    overdue: number;
    demosCompleted: number;
    converted: number;
    lost: number;
  };
  referrals: {
    captured: number;
    attributed: number;
    converted: number;
  };
  customers: {
    total: number;
    /** Customers with an active or trialing subscription. */
    active: number;
  };
  trackers: HandoverSummary;
  commission: CommissionTotals;
  onboarding: {
    /** Customers with a tracker in hand and no live vehicle yet. */
    awaitingFirstVehicle: number;
    /** First-vehicle demonstrations the salesperson has completed. */
    completed: number;
  };
}

/**
 * The salesperson's own roll-up.
 *
 * Cached for twenty seconds — long enough to absorb a screen that polls, short
 * enough that a salesperson who has just created a lead sees it. Keyed by
 * salesman id, which is the isolation boundary that applies to them; nothing in
 * the payload belongs to a tenant, so there is no tenant to key by.
 */
export async function dashboard(input: {
  salesmanId: string;
  godId: string;
}): Promise<SalesDashboard> {
  return cached(
    cacheKeys.salesDashboard(input.salesmanId),
    cacheTtl.salesDashboard,
    async () => {
      const now = new Date();
      const { salesmanId } = input;

      const [
        leadTotal,
        leadOpen,
        leadOverdue,
        demosCompleted,
        leadConverted,
        leadLost,
        referralGrouped,
        customerOrganizationIds,
        trackers,
        commission,
        onboardingCompleted,
      ] = await Promise.all([
        prisma.salesLead.count({ where: { salesmanId } }),
        prisma.salesLead.count({
          where: { salesmanId, status: { in: OPEN_SALES_LEAD_STATUSES as never } },
        }),
        prisma.salesLead.count({
          where: {
            salesmanId,
            nextFollowUpAt: { lt: now },
            status: { notIn: CLOSED_SALES_LEAD_STATUSES as never },
          },
        }),
        // Counted from the timestamp rather than from the status, because a
        // lead that has moved on to SUBSCRIBED still had its demo.
        prisma.salesLead.count({ where: { salesmanId, demoCompletedAt: { not: null } } }),
        prisma.salesLead.count({
          where: { salesmanId, status: { in: CONVERTED_SALES_LEAD_STATUSES as never } },
        }),
        prisma.salesLead.count({
          where: { salesmanId, status: { in: CLOSED_SALES_LEAD_STATUSES as never } },
        }),
        prisma.referralAttribution.groupBy({
          by: ['status'],
          where: { salesmanId },
          _count: { _all: true },
        }),
        prisma.referralAttribution.findMany({
          where: {
            salesmanId,
            organizationId: { not: null },
            status: { in: [ReferralStatus.ATTRIBUTED, ReferralStatus.CONVERTED] },
          },
          select: { organizationId: true },
        }),
        handoverSummary(salesmanId),
        commissionTotals(salesmanId),
        prisma.salesLead.count({ where: { salesmanId, onboardingCompletedAt: { not: null } } }),
      ]);

      const organizationIds = customerOrganizationIds
        .map((row) => row.organizationId)
        .filter((id): id is string => id !== null);

      const [activeSubscriptions, awaitingFirstVehicle] = await Promise.all([
        organizationIds.length === 0
          ? Promise.resolve(0)
          : prisma.subscription.count({
              where: {
                organizationId: { in: organizationIds },
                status: { in: ['ACTIVE', 'TRIALING'] },
              },
            }),
        prisma.trackerHandover.count({
          where: {
            salesmanId,
            status: TrackerHandoverStatus.HANDED_TO_CUSTOMER,
          },
        }),
      ]);

      const referralCount = (status: ReferralStatus): number =>
        referralGrouped.find((group) => group.status === status)?._count._all ?? 0;

      return {
        salesmanId,
        godId: input.godId,
        leads: {
          total: leadTotal,
          open: leadOpen,
          overdue: leadOverdue,
          demosCompleted,
          converted: leadConverted,
          lost: leadLost,
        },
        referrals: {
          captured: referralCount(ReferralStatus.CAPTURED),
          attributed: referralCount(ReferralStatus.ATTRIBUTED),
          converted: referralCount(ReferralStatus.CONVERTED),
        },
        customers: {
          total: new Set(organizationIds).size,
          active: activeSubscriptions,
        },
        trackers,
        commission,
        onboarding: {
          awaitingFirstVehicle,
          completed: onboardingCompleted,
        },
      };
    },
  );
}

/** Invalidate the roll-up after a write that changes any of its numbers. */
export async function invalidateDashboard(salesmanId: string): Promise<void> {
  await cache.delete(cacheKeys.salesDashboard(salesmanId));
}

export interface SalesCustomerView {
  organizationId: string;
  name: string;
  city: string | null;
  /** How this customer came to Saarthi. */
  source: string;
  attributedAt: string | null;
  subscription: {
    planTier: PlanTier | null;
    status: string | null;
  };
  vehicles: number;
  trackers: number;
  /** Vehicles that have reported a position at least once. */
  live: number;
  leadId: string | null;
  leadStatus: SalesLeadStatus | null;
  onboardingCompletedAt: string | null;
}

/**
 * The customers attributed to one salesperson.
 *
 * Built from the attribution table outwards, so a salesperson sees exactly the
 * customers they are credited with and no others. Each row is then enriched
 * with four counts, and the choice of *which* four is the access-control
 * decision: they describe whether the product is being used, which is what a
 * salesperson legitimately needs, and they describe nothing about who is
 * driving where.
 */
export async function customers(
  salesmanId: string,
  page: number,
  pageSize: number,
): Promise<{ items: SalesCustomerView[]; total: number }> {
  const where = {
    salesmanId,
    organizationId: { not: null },
    status: { in: [ReferralStatus.ATTRIBUTED, ReferralStatus.CONVERTED] },
  };

  const [attributions, total] = await Promise.all([
    prisma.referralAttribution.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true, city: true } },
        lead: { select: { id: true, status: true, onboardingCompletedAt: true } },
      },
      orderBy: { attributedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.referralAttribution.count({ where }),
  ]);

  const organizationIds = attributions
    .map((row) => row.organizationId)
    .filter((id): id is string => id !== null);

  if (organizationIds.length === 0) return { items: [], total };

  /*
   * Four grouped queries rather than a per-customer loop.
   *
   * A salesperson with forty customers would otherwise cost a hundred and
   * sixty round trips on a page they open every morning.
   */
  const [subscriptions, vehicleGroups, liveGroups, trackerGroups] = await Promise.all([
    prisma.subscription.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, status: true, plan: { select: { tier: true } } },
    }),
    prisma.truck.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizationIds }, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.truck.groupBy({
      by: ['organizationId'],
      where: {
        organizationId: { in: organizationIds },
        archivedAt: null,
        lastLocationAt: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.vehicleTracker.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizationIds }, status: 'ACTIVE' },
      _count: { _all: true },
    }),
  ]);

  const subscriptionBy = new Map(
    subscriptions.map((row) => [row.organizationId, row]),
  );
  const countBy = (
    groups: { organizationId: string; _count: { _all: number } }[],
  ): Map<string, number> => new Map(groups.map((row) => [row.organizationId, row._count._all]));

  const vehicleBy = countBy(vehicleGroups);
  const liveBy = countBy(liveGroups);
  const trackerBy = countBy(trackerGroups);

  const items = attributions
    .filter((row) => row.organization !== null)
    .map((row) => {
      const organization = row.organization!;
      const subscription = subscriptionBy.get(organization.id);
      return {
        organizationId: organization.id,
        name: organization.name,
        city: organization.city,
        source: row.source,
        attributedAt: row.attributedAt?.toISOString() ?? null,
        subscription: {
          planTier: (subscription?.plan.tier as PlanTier | undefined) ?? null,
          status: subscription?.status ?? null,
        },
        vehicles: vehicleBy.get(organization.id) ?? 0,
        trackers: trackerBy.get(organization.id) ?? 0,
        live: liveBy.get(organization.id) ?? 0,
        leadId: row.lead?.id ?? null,
        leadStatus: (row.lead?.status as SalesLeadStatus | undefined) ?? null,
        onboardingCompletedAt: row.lead?.onboardingCompletedAt?.toISOString() ?? null,
      };
    });

  return { items, total };
}

/**
 * The vehicles of one attributed customer, for the first-vehicle demonstration.
 *
 * Registration and a live flag, nothing else. The salesperson needs to pick
 * which vehicle they are setting up and see whether it came alive; a position,
 * a driver or an odometer reading would be somebody else's data.
 *
 * Refuses outright when the customer is not attributed to this salesperson —
 * as a 404, so the endpoint cannot be used to test whether an organization id
 * exists.
 */
export async function customerVehicles(
  salesmanId: string,
  organizationId: string,
): Promise<{
  organizationId: string;
  organizationName: string;
  vehicles: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    hasTracker: boolean;
    live: boolean;
  }[];
}> {
  const attribution = await prisma.referralAttribution.findFirst({
    where: {
      salesmanId,
      organizationId,
      status: { in: [ReferralStatus.ATTRIBUTED, ReferralStatus.CONVERTED] },
    },
    include: { organization: { select: { id: true, name: true } } },
  });

  if (!attribution?.organization) throw errors.notFound('Customer');

  const [vehicles, trackers] = await Promise.all([
    prisma.truck.findMany({
      where: { organizationId, archivedAt: null },
      select: {
        id: true,
        registrationNumber: true,
        vehicleType: true,
        lastLocationAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.vehicleTracker.findMany({
      where: { organizationId, status: 'ACTIVE', truckId: { not: null } },
      select: { truckId: true },
    }),
  ]);

  const fitted = new Set(trackers.map((tracker) => tracker.truckId));

  return {
    organizationId,
    organizationName: attribution.organization.name,
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      vehicleType: vehicle.vehicleType,
      hasTracker: fitted.has(vehicle.id),
      live: vehicle.lastLocationAt !== null,
    })),
  };
}
