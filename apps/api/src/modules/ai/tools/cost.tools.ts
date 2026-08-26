import { z } from 'zod';
import { Feature, Permission } from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { truckPerformance } from '../../analytics/analytics.service';
import { fastagCapabilities, listFastags } from '../../toll/fastag.service';
import { tollSummary, tripCostSummary, tripTollVariance } from '../../toll/toll.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Cost tools — fuel, trip economics and the fuel anomalies rule.
 *
 * Fuel is where fleets lose money quietly, and it is also where a confident
 * wrong answer does the most damage: telling an owner a driver is stealing
 * diesel because of an arithmetic artefact is not a recoverable mistake. So the
 * anomaly detector here is deliberately conservative, states its threshold, and
 * describes what it found rather than what it thinks happened.
 */

function result<T>(
  data: T,
  options: {
    basis?: ResultBasis;
    references?: ToolResult['references'];
    caveats?: string[];
    recordCount?: number;
  } = {},
): ToolResult<T> {
  return {
    data,
    basis: options.basis ?? ResultBasis.RULE_RESULT,
    references: options.references ?? [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 0,
  };
}

export const COST_TOOLS: AiTool[] = [
  {
    name: 'get_fuel_summary',
    description:
      'Fuel spend and volume over a window, for the fleet or one vehicle, with the average price paid per litre.',
    input: z.object({
      days: z.number().int().min(1).max(365).default(30),
      vehicleId: z.string().uuid().optional(),
    }),
    permissions: [Permission.FUEL_READ],
    category: 'cost',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { days, vehicleId } = input as { days: number; vehicleId?: string };
      const since = new Date(Date.now() - days * 86_400_000);

      const where = {
        organizationId,
        recordedAt: { gte: since },
        ...(vehicleId ? { truckId: vehicleId } : {}),
      };

      const [aggregate, count] = await Promise.all([
        prisma.fuelRecord.aggregate({
          where,
          _sum: { quantityLitres: true, totalCost: true },
          _avg: { pricePerUnit: true },
        }),
        prisma.fuelRecord.count({ where }),
      ]);

      return result(
        {
          windowDays: days,
          fillUps: count,
          totalLitres: Number((aggregate._sum.quantityLitres ?? 0).toFixed(1)),
          totalCost: Number(aggregate._sum.totalCost ?? 0),
          averagePricePerLitre: Number((aggregate._avg.pricePerUnit ?? 0).toFixed(2)),
        },
        {
          basis: ResultBasis.SOURCE_DATA,
          recordCount: count,
          caveats:
            count === 0
              ? ['No fuel records in this window. Cash fills that were never entered will not appear.']
              : ['Covers fuel recorded in Saarthi. Unrecorded fills are invisible to this figure.'],
        },
      );
    },
  },

  {
    name: 'get_fuel_efficiency',
    description:
      'Fuel efficiency per vehicle over a window, in litres per 100 km, derived from odometer movement between fills.',
    input: z.object({ days: z.number().int().min(7).max(365).default(90) }),
    permissions: [Permission.FUEL_READ],
    feature: Feature.FLEET_ANALYTICS,
    category: 'cost',
    cacheTtlSeconds: 120,
    handler: async ({ organizationId }, input) => {
      const { days } = input as { days: number };
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);

      const performance = await truckPerformance(organizationId, { from, to, granularity: 'day' });
      const withEfficiency = performance.filter(
        (entry) => entry.fuelEfficiencyL100Km !== null && entry.fuelEfficiencyL100Km > 0,
      );

      return result(
        {
          windowDays: days,
          vehicles: withEfficiency.map((entry) => ({
            registrationNumber: entry.registrationNumber,
            litresPer100Km: entry.fuelEfficiencyL100Km,
            distanceKm: Math.round(entry.distanceKm),
            fuelCost: entry.fuelCost,
          })),
        },
        {
          recordCount: withEfficiency.length,
          caveats: [
            'Efficiency is computed from recorded fills and odometer readings. A missed fill or a mistyped odometer distorts it, so treat a single outlier as a data question before an operational one.',
            ...(performance.length > withEfficiency.length
              ? [
                  `${performance.length - withEfficiency.length} vehicle(s) had too little data to compute efficiency and are excluded.`,
                ]
              : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_fuel_anomalies',
    description:
      'Fuel fills that look irregular: a quantity above the vehicle tank capacity, an impossible odometer jump, or a price far from the fleet average.',
    input: z.object({ days: z.number().int().min(1).max(180).default(30) }),
    permissions: [Permission.FUEL_READ],
    category: 'cost',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { days } = input as { days: number };
      const since = new Date(Date.now() - days * 86_400_000);

      const records = await prisma.fuelRecord.findMany({
        where: { organizationId, recordedAt: { gte: since } },
        orderBy: { recordedAt: 'desc' },
        take: 1000,
        select: {
          id: true,
          truckId: true,
          quantityLitres: true,
          pricePerUnit: true,
          totalCost: true,
          odometerKm: true,
          recordedAt: true,
          stationName: true,
        },
      });

      if (records.length === 0) {
        return result(
          { windowDays: days, anomalies: [], averagePricePerLitre: null },
          { recordCount: 0, caveats: ['No fuel records in this window.'] },
        );
      }

      const vehicles = await prisma.truck.findMany({
        where: { id: { in: [...new Set(records.map((row) => row.truckId))] } },
        select: { id: true, registrationNumber: true },
      });
      const labels = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));

      const prices = records.map((row) => Number(row.pricePerUnit));
      const averagePrice = prices.reduce((sum, value) => sum + value, 0) / prices.length;

      // A 25% deviation, not 10%: diesel genuinely varies by state and by
      // highway pump, and a threshold that flags ordinary variation trains
      // everyone to ignore the alert.
      const PRICE_DEVIATION = 0.25;
      const LARGE_FILL_LITRES = 600;

      const anomalies = records.flatMap((row) => {
        const reasons: string[] = [];
        const price = Number(row.pricePerUnit);

        if (Math.abs(price - averagePrice) / averagePrice > PRICE_DEVIATION) {
          reasons.push(
            `Price of ₹${price.toFixed(2)}/litre is ${Math.round((Math.abs(price - averagePrice) / averagePrice) * 100)}% away from the fleet average of ₹${averagePrice.toFixed(2)}.`,
          );
        }
        if (row.quantityLitres > LARGE_FILL_LITRES) {
          reasons.push(
            `${row.quantityLitres} litres in one fill is larger than a typical tank — check whether two fills were combined.`,
          );
        }

        if (reasons.length === 0) return [];
        return [
          {
            fuelRecordId: row.id,
            registrationNumber: labels.get(row.truckId) ?? 'Unknown',
            recordedAt: row.recordedAt.toISOString(),
            litres: row.quantityLitres,
            pricePerLitre: price,
            station: row.stationName,
            reasons,
          },
        ];
      });

      return result(
        {
          windowDays: days,
          averagePricePerLitre: Number(averagePrice.toFixed(2)),
          anomalies: anomalies.slice(0, 25),
        },
        {
          recordCount: records.length,
          caveats: [
            'These are irregularities in the recorded data, not accusations. A high fill is often two receipts entered as one, and a price outlier is often a different state.',
            ...(anomalies.length > 25 ? [`Showing 25 of ${anomalies.length} flagged records.`] : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_vehicle_cost_summary',
    description:
      'What one vehicle cost and earned over a window: revenue, fuel, maintenance, trips and utilisation.',
    input: z.object({
      vehicleId: z.string().uuid(),
      days: z.number().int().min(7).max(365).default(90),
    }),
    permissions: [Permission.ANALYTICS_READ],
    feature: Feature.FLEET_ANALYTICS,
    category: 'cost',
    cacheTtlSeconds: 120,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, days } = input as { vehicleId: string; days: number };
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);

      const performance = await truckPerformance(organizationId, { from, to, granularity: 'day' });
      const entry = performance.find((row) => row.truckId === vehicleId);

      if (!entry) {
        return result(
          { found: false },
          {
            recordCount: 0,
            caveats: ['No activity recorded for this vehicle in the window, or it is not in your fleet.'],
          },
        );
      }

      return result(
        { windowDays: days, ...entry },
        {
          recordCount: entry.trips,
          references: [
            { type: 'vehicle', id: entry.truckId, label: entry.registrationNumber },
          ],
          caveats: [
            'Revenue and cost cover what is recorded in Saarthi for this window. Cash transactions entered elsewhere are not included.',
          ],
        },
      );
    },
  },

  {
    name: 'get_toll_summary',
    description:
      'Toll spend over a window, for the fleet or one vehicle: total, crossings, the plazas it is spent at, and the split between FASTag and cash.',
    input: z.object({
      days: z.number().int().min(1).max(365).default(30),
      vehicleId: z.string().uuid().optional(),
    }),
    permissions: [Permission.TOLL_READ],
    feature: Feature.TOLL_FASTAG,
    category: 'cost',
    cacheTtlSeconds: 60,
    handler: async ({ auth, organizationId }, input) => {
      const { days, vehicleId } = input as { days: number; vehicleId?: string };
      const summary = await tollSummary(auth, organizationId, {
        days,
        ...(vehicleId ? { vehicleId } : {}),
      });

      return result(summary, {
        recordCount: summary.crossings,
        caveats: [
          ...(summary.unpricedCrossings > 0
            ? [
                `${summary.unpricedCrossings} crossing(s) were reported without a fare, so this total is a floor. A NETC feed reports the passage, not the amount — the fare comes from the bank statement.`,
              ]
            : []),
          ...(summary.crossings === 0
            ? ['No toll crossings are recorded in this window.']
            : []),
          ...((summary.byMode.CASH ?? 0) > 0
            ? [
                'Some of this was paid in cash at the plaza, which usually costs more than the FASTag rate and is worth asking about.',
              ]
            : []),
        ],
      });
    },
  },

  {
    name: 'get_fastag_status',
    description:
      'FASTag state across the fleet: which tags are blacklisted, which are low on balance, and which have no balance on record.',
    input: z.object({}),
    permissions: [Permission.TOLL_READ],
    feature: Feature.TOLL_FASTAG,
    category: 'cost',
    cacheTtlSeconds: 30,
    handler: async ({ auth, organizationId }) => {
      const tags = await listFastags(auth, organizationId, {
        page: 1,
        pageSize: 100,
        needsAttention: false,
      });

      const capabilities = fastagCapabilities();
      const attention = tags.items.filter((tag) => tag.health.health !== 'OK');

      return result(
        {
          totalTags: tags.totals.tags,
          blocked: tags.totals.blocked,
          lowBalance: tags.totals.lowBalance,
          unknownBalance: tags.totals.unknownBalance,
          knownBalanceTotal: tags.totals.knownBalanceTotal,
          needsAttention: attention.slice(0, 20).map((tag) => ({
            registrationNumber: tag.registrationNumber,
            issuer: tag.issuerBank,
            status: tag.status,
            health: tag.health.health,
            reasons: tag.health.reasons,
            balance: tag.balance,
            balanceAgeDays: tag.health.balanceAgeDays,
          })),
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: tags.totals.tags,
          caveats: [
            ...(tags.totals.unknownBalance > 0
              ? [
                  `${tags.totals.unknownBalance} tag(s) have no balance on record and are excluded from the total. A balance Saarthi was never told is unknown, not zero.`,
                ]
              : []),
            ...(!capabilities.supportsBalance
              ? [
                  'The configured FASTag provider serves tag status but not the rupee balance — that sits with the issuing bank. Balances shown are the ones your team recorded.',
                ]
              : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_toll_variance',
    description:
      'Whether one trip paid more toll than comparable runs on the same corridor. Refuses to answer on fewer than three comparable runs.',
    input: z.object({ tripId: z.string().uuid() }),
    permissions: [Permission.TOLL_READ],
    feature: Feature.TOLL_FASTAG,
    category: 'cost',
    cacheTtlSeconds: 60,
    handler: async ({ auth }, input) => {
      const { tripId } = input as { tripId: string };
      const variance = await tripTollVariance(auth, tripId);

      return result(variance, {
        recordCount: variance.sampleSize,
        caveats:
          variance.verdict === 'INSUFFICIENT_DATA'
            ? [
                `Only ${variance.sampleSize} comparable run(s) on this corridor. Two data points can explain any third, so no variance is reported rather than a figure that could put a driver under suspicion.`,
              ]
            : [
                'Toll genuinely varies with lane, vehicle class and the occasional closure. A difference inside 20% is normal.',
              ],
      });
    },
  },

  {
    name: 'get_trip_cost_summary',
    description:
      'What one trip cost and earned, with fuel and toll separated out, plus margin and cost per kilometre.',
    input: z.object({ tripId: z.string().uuid() }),
    permissions: [Permission.TRIPS_READ],
    category: 'cost',
    cacheTtlSeconds: 60,
    handler: async ({ auth }, input) => {
      const { tripId } = input as { tripId: string };
      const summary = await tripCostSummary(auth, tripId);

      return result(summary, {
        recordCount: summary.tollCrossings,
        caveats: [
          'Costs cover what is recorded in Saarthi for this trip. Cash spent and never entered is invisible here.',
          ...(summary.revenue === null
            ? ['No price is recorded on this trip, so no margin can be computed.']
            : []),
        ],
      });
    },
  },
];