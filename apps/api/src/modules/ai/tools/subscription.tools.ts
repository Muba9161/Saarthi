import { z } from 'zod';
import {
  PLAN_CATALOGUE,
  Permission,
  TRACKER_PRODUCTS,
  VEHICLE_TOPUP,
  describeTrackerPrices,
  quoteSubscription,
  type PlanTier,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { COPILOT_USAGE_FILTER } from '../ai-usage';
import { listTopUps, vehicleCapacity } from '../../subscriptions/topup.service';
import { trackerCoverage } from '../../subscriptions/tracker.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Subscription tools.
 *
 * "Can I add another vehicle?" is a question the assistant should answer from
 * the tenant's actual entitlement state, never from the plan names it happens
 * to know. The distinction matters because the answer decides whether someone
 * buys a top-up they do not need, or is told to upgrade when a top-up for the
 * price of one vehicle would have done. Every vehicle plan covers one vehicle,
 * so an upgrade is never the answer to "I need room for another" — a top-up is.
 */

function result<T>(
  data: T,
  options: { basis?: ResultBasis; caveats?: string[]; recordCount?: number } = {},
): ToolResult<T> {
  return {
    data,
    basis: options.basis ?? ResultBasis.RULE_RESULT,
    references: [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 1,
  };
}

export const SUBSCRIPTION_TOOLS: AiTool[] = [
  {
    name: 'get_vehicle_subscription_capacity',
    description:
      'How many vehicles the plan covers, how many are in use, how many top-ups are active, and whether another vehicle can be added right now.',
    input: z.object({}),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 15,
    handler: async ({ organizationId }) => {
      const capacity = await vehicleCapacity(organizationId);

      return result(capacity, {
        caveats: capacity.atCapacity
          ? [
              'The fleet is at capacity. Existing vehicles keep working — only adding another is blocked, and a +1 top-up or a plan upgrade unblocks it.',
            ]
          : [],
      });
    },
  },

  {
    name: 'get_vehicle_topups',
    description: 'Active and past +1 vehicle top-ups on this subscription, with what each costs.',
    input: z.object({}),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }) => {
      const topUps = await listTopUps(organizationId);
      const active = topUps.filter((topUp) => topUp.status === 'ACTIVE');

      return result(
        {
          activeCount: active.length,
          monthlyCost: Number(
            active.reduce((sum, topUp) => sum + topUp.priceMonthly, 0).toFixed(2),
          ),
          unitPrice: VEHICLE_TOPUP.priceMonthly,
          topUps: topUps.slice(0, 20).map((topUp) => ({
            status: topUp.status,
            startsAt: topUp.startsAt,
            expiresAt: topUp.expiresAt,
            priceMonthly: topUp.priceMonthly,
          })),
        },
        { basis: ResultBasis.SOURCE_DATA, recordCount: topUps.length },
      );
    },
  },

  {
    name: 'get_subscription',
    description:
      'The current plan: name, status, what it includes, and the plans available to move to.',
    input: z.object({}),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 60,
    handler: async ({ auth, organizationId }) => {
      const subscription = await prisma.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });

      return result(
        {
          plan: subscription
            ? {
                tier: subscription.plan.tier,
                name: subscription.plan.name,
                status: subscription.status,
                startsAt: subscription.startsAt.toISOString(),
                endsAt: subscription.endsAt?.toISOString() ?? null,
                priceMonthly: subscription.plan.priceMonthly
                  ? Number(subscription.plan.priceMonthly)
                  : null,
              }
            : null,
          featuresHeld: auth.subscription?.features ?? [],
          availablePlans: PLAN_CATALOGUE.map((plan) => ({
            tier: plan.tier,
            name: plan.name,
            // One on every vehicle plan. Said explicitly so the assistant does
            // not present an upgrade as the way to get more vehicles.
            vehiclesIncluded: plan.limits.maxTrucks,
            priceMonthlyGstIncluded: plan.priceMonthly,
            maxTopUps: plan.limits.maxVehicleTopUps,
            maxTrackers: plan.limits.maxTrackers,
          })),
          topUp: {
            name: VEHICLE_TOPUP.name,
            priceMonthlyGstIncluded: VEHICLE_TOPUP.priceMonthly,
            description: VEHICLE_TOPUP.description,
          },
          trackers: TRACKER_PRODUCTS.map((product) => ({
            name: product.name,
            priceOneTimeBeforeGst: product.priceOneTime,
            priceFinal: product.price,
            recurring: false,
            description: product.description,
          })),
        },
        { basis: ResultBasis.SOURCE_DATA },
      );
    },
  },

  {
    name: 'get_tracker_coverage',
    description:
      'How many vehicles have a Saarthi tracker fitted and how many are running on driver-app data only. Use this before quoting an odometer, fuel figure or trip distance, so the answer can say whether it was measured or estimated.',
    input: z.object({}),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }) => {
      const coverage = await trackerCoverage(organizationId);

      return result(
        {
          ...coverage,
          trackerRecurring: false,
        },
        {
          basis: ResultBasis.SOURCE_DATA,
          caveats:
            coverage.uncovered > 0
              ? [
                  `${coverage.uncovered} vehicle(s) have no tracker. For those, distance, fuel and trip times are worked out from the driver's phone and carry an error — and a phone that was left behind or ran flat reports nothing at all.`,
                  `A tracker is a one-time charge per vehicle with no monthly fee: ${describeTrackerPrices()}.`,
                ]
              : [],
        },
      );
    },
  },

  {
    name: 'quote_fleet_cost',
    description:
      'What a given number of vehicles costs per month on each plan, including the per-vehicle top-ups. Use this to answer "what would ten vehicles cost".',
    input: z.object({
      vehicles: z.coerce.number().int().min(1).max(500),
    }),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 3600,
    handler: async (_context, input) => {
      const { vehicles } = input as { vehicles: number };

      return result(
        {
          vehicles,
          quotes: PLAN_CATALOGUE.map((plan) => {
            const ceiling =
              plan.limits.maxTrucks === null
                ? null
                : plan.limits.maxTrucks + plan.limits.maxVehicleTopUps;
            const quote = quoteSubscription({ tier: plan.tier, vehicles });
            return {
              tier: plan.tier as PlanTier,
              name: plan.name,
              monthlyTotal: quote.monthly.total,
              // A quote for a fleet the plan cannot hold is a quote nobody can
              // act on, so it is marked rather than silently offered.
              available: ceiling === null || vehicles <= ceiling,
              vehicleCeiling: ceiling,
            };
          }),
        },
        {
          basis: ResultBasis.RULE_RESULT,
          caveats: [
            'Plan and top-up prices are final monthly prices with GST included. Quote them as they are, without a GST breakdown.',
            `Trackers are charged once per vehicle, plus GST, so they are not part of the monthly figure: ${describeTrackerPrices()}. A fleet owner running trucks needs one for live telemetry.`,
          ],
        },
      );
    },
  },

  {
    name: 'get_subscription_usage',
    description:
      'How much of the plan allowance has been used: vehicles, drivers, connected devices and AI requests today.',
    input: z.object({}),
    permissions: [Permission.SUBSCRIPTION_READ],
    category: 'subscription',
    cacheTtlSeconds: 30,
    handler: async ({ auth, organizationId }) => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [vehicles, drivers, devices, aiToday] = await Promise.all([
        prisma.truck.count({ where: { organizationId, archivedAt: null } }),
        prisma.driver.count({ where: { organizationId } }),
        prisma.hardwareDevice.count({ where: { organizationId, archivedAt: null } }),
        prisma.aiUsage.count({
          where: { organizationId, createdAt: { gte: startOfDay }, ...COPILOT_USAGE_FILTER },
        }),
      ]);

      const limits = auth.subscription?.limits;

      return result(
        {
          vehicles: { used: vehicles, limit: limits?.maxTrucks ?? null },
          drivers: { used: drivers, limit: limits?.maxDrivers ?? null },
          // The device allowance is the number of trackers bought, not a plan
          // figure — see `assertDeviceLimit`.
          devices: { used: devices, limit: limits?.maxDevices ?? null },
          trackersHeld: limits?.maxDevices ?? 0,
          aiRequestsToday: { used: aiToday, limit: limits?.aiRequestsPerDay ?? 0 },
        },
        {
          basis: ResultBasis.RULE_RESULT,
          caveats: [
            'The vehicle limit shown already includes any active +1 top-ups.',
            'The device limit is the number of trackers this organization has bought. Registering another device needs another tracker, not a plan change.',
          ],
        },
      );
    },
  },
];
