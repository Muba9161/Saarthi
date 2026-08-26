import { z } from 'zod';
import { Feature, Permission } from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { driverPerformance } from '../../analytics/analytics.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Driver tools.
 *
 * Driver data needs a lighter touch than vehicle data, because it is about a
 * person's livelihood rather than an asset. Two consequences show up here:
 *
 *   • Scores come with their *reasons*, always. "Ramesh scored 62" invites a
 *     conversation nobody can have; "62, after three harsh-braking events and a
 *     lapsed licence" is something a manager and a driver can actually discuss.
 *   • Events are returned as recorded, never characterised. Whether a pattern
 *     of harsh braking means a careless driver or a bad brake is not something
 *     this data can settle, and the caveats say so.
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
    basis: options.basis ?? ResultBasis.SOURCE_DATA,
    references: options.references ?? [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 0,
  };
}

async function loadDriver(organizationId: string, driverId: string) {
  const driver = await prisma.driver.findFirst({
    where: { id: driverId, organizationId },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (!driver) throw new Error('No driver with that id in your fleet.');
  return driver;
}

export const DRIVER_TOOLS: AiTool[] = [
  {
    name: 'find_driver',
    description:
      'Find a driver by name, or list the fleet drivers. Use this to turn a name into a driver id.',
    input: z.object({
      name: z.string().max(80).optional().describe('Full or partial name.'),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    permissions: [Permission.DRIVERS_READ],
    category: 'driver',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }, input) => {
      const { name, limit } = input as { name?: string; limit: number };

      const drivers = await prisma.driver.findMany({
        where: {
          organizationId,
          ...(name
            ? {
                user: {
                  OR: [
                    { firstName: { contains: name, mode: 'insensitive' } },
                    { lastName: { contains: name, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        },
        take: limit,
        include: { user: { select: { firstName: true, lastName: true } } },
      });

      return result(
        drivers.map((driver) => ({
          driverId: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          availability: driver.availability,
          experienceYears: driver.experienceYears,
          overallScore: driver.overallScore,
        })),
        {
          recordCount: drivers.length,
          references: drivers.map((driver) => ({
            type: 'driver',
            id: driver.id,
            label: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          })),
        },
      );
    },
  },

  {
    name: 'get_driver_score',
    description:
      'A driver score with the events that produced it. Always returns the reasons alongside the number.',
    input: z.object({ driverId: z.string().uuid() }),
    permissions: [Permission.DRIVERS_SCORE_READ],
    feature: Feature.DRIVER_SCORING,
    category: 'driver',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { driverId } = input as { driverId: string };
      const driver = await loadDriver(organizationId, driverId);

      const [score, recentEvents] = await Promise.all([
        prisma.driverScore.findFirst({ where: { driverId } }),
        prisma.driverScoreEvent.findMany({
          where: { driverId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            eventType: true,
            category: true,
            points: true,
            reason: true,
            createdAt: true,
          },
        }),
      ]);

      return result(
        {
          driverId: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          overallScore: driver.overallScore,
          totalTrips: driver.totalTrips,
          totalDistanceKm: Math.round(driver.totalDistanceKm),
          categories: score
            ? {
                safety: score.safetyScore,
                reliability: score.reliabilityScore,
                timeliness: score.timelinessScore,
                compliance: score.complianceScore,
                vehicleCare: score.vehicleCareScore,
              }
            : null,
          recentEvents: recentEvents.map((event) => ({
            type: event.eventType,
            category: event.category,
            points: event.points,
            reason: event.reason,
            at: event.createdAt.toISOString(),
          })),
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: recentEvents.length,
          references: [
            {
              type: 'driver',
              id: driver.id,
              label: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
            },
          ],
          caveats: [
            'A score is the sum of recorded events against fixed rules. It measures what Saarthi observed, not the driver.',
            ...(driver.overallScore === null
              ? ['This driver has no score yet — not enough recorded activity.']
              : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_driver_safety_events',
    description:
      'Safety events recorded for a driver — harsh braking, rapid acceleration, speeding — over a window.',
    input: z.object({
      driverId: z.string().uuid(),
      days: z.number().int().min(1).max(365).default(30),
    }),
    permissions: [Permission.DRIVERS_SCORE_READ],
    feature: Feature.DRIVER_SCORING,
    category: 'driver',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { driverId, days } = input as { driverId: string; days: number };
      const driver = await loadDriver(organizationId, driverId);
      const since = new Date(Date.now() - days * 86_400_000);

      const [scoreEvents, telemetryAlerts] = await Promise.all([
        prisma.driverScoreEvent.findMany({
          where: { driverId, category: 'SAFETY', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { eventType: true, points: true, reason: true, createdAt: true },
        }),
        prisma.telemetryAlert.findMany({
          where: { driverId, occurredAt: { gte: since } },
          orderBy: { occurredAt: 'desc' },
          take: 100,
          select: { type: true, severity: true, message: true, occurredAt: true },
        }),
      ]);

      const grouped = new Map<string, number>();
      for (const alert of telemetryAlerts) {
        grouped.set(alert.type, (grouped.get(alert.type) ?? 0) + 1);
      }

      return result(
        {
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          windowDays: days,
          scoreEvents: scoreEvents.map((event) => ({
            type: event.eventType,
            points: event.points,
            reason: event.reason,
            at: event.createdAt.toISOString(),
          })),
          telemetryAlertsByType: Object.fromEntries(grouped),
          telemetryAlertCount: telemetryAlerts.length,
        },
        {
          recordCount: scoreEvents.length + telemetryAlerts.length,
          caveats: [
            'These are recorded events. A pattern of harsh braking can be a driver, a road or a brake fault — the data does not distinguish between them.',
          ],
        },
      );
    },
  },

  {
    name: 'get_fleet_driver_scores',
    description:
      'Driver performance across the fleet: trips, distance, on-time rate, score and safety events.',
    input: z.object({
      days: z.number().int().min(1).max(365).default(30),
    }),
    permissions: [Permission.DRIVERS_SCORE_READ],
    feature: Feature.DRIVER_SCORING,
    category: 'driver',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { days } = input as { days: number };
      const from = new Date(Date.now() - days * 86_400_000);
      const performance = await driverPerformance(organizationId, {
        from,
        to: new Date(),
        granularity: 'day',
      });

      return result(
        { windowDays: days, drivers: performance.slice(0, 30) },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: performance.length,
          caveats:
            performance.length > 30
              ? [`Showing 30 of ${performance.length} drivers.`]
              : [],
        },
      );
    },
  },
];
