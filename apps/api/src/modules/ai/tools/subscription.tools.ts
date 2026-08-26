import { z } from 'zod';
import { PLAN_CATALOGUE, Permission, VEHICLE_TOPUP } from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { listTopUps, vehicleCapacity } from '../../subscriptions/topup.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Subscription tools.
 *
 * "Can I add another vehicle?" is a question the assistant should answer from
 * the tenant's actual entitlement state, never from the plan names it happens
 * to know. The distinction matters because the answer decides whether someone
 * buys a top-up they do not need, or is told to upgrade when a ₹399 top-up
 * would have done.
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
            vehicles: plan.limits.maxTrucks,
            priceMonthly: plan.priceMonthly,
            maxTopUps: plan.limits.maxVehicleTopUps,
          })),
          topUp: {
            name: VEHICLE_TOPUP.name,
            priceMonthly: VEHICLE_TOPUP.priceMonthly,
            description: VEHICLE_TOPUP.description,
          },
        },
        { basis: ResultBasis.SOURCE_DATA },
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
        prisma.aiUsage.count({ where: { organizationId, createdAt: { gte: startOfDay } } }),
      ]);

      const limits = auth.subscription?.limits;

      return result(
        {
          vehicles: { used: vehicles, limit: limits?.maxTrucks ?? null },
          drivers: { used: drivers, limit: limits?.maxDrivers ?? null },
          devices: { used: devices, limit: limits?.maxDevices ?? null },
          aiRequestsToday: { used: aiToday, limit: limits?.aiRequestsPerDay ?? 0 },
        },
        {
          basis: ResultBasis.RULE_RESULT,
          caveats: [
            'The vehicle limit shown already includes any active +1 top-ups.',
          ],
        },
      );
    },
  },
];
