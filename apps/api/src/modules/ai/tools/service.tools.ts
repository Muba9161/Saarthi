import { z } from 'zod';
import { Feature, Permission } from '@saarthi/shared';
import {
  getServiceRecord,
  vehicleServiceTimeline,
} from '../../maintenance/service-history.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Service-history tools.
 *
 * The patterns these expose — a component replaced three times, a cost curve
 * bending upward — are computed by deterministic Saarthi logic before the model
 * ever sees them. That ordering matters: asked to find patterns in raw service
 * rows, a language model will find some whether or not any exist.
 *
 * The model's job here is to explain what the rules found and what it might
 * mean. Saying *why* a component keeps failing is a workshop's judgement, and
 * the caveats say so.
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

export const SERVICE_TOOLS: AiTool[] = [
  {
    name: 'get_vehicle_service_history',
    description:
      'Complete service history for one vehicle: every recorded job, total spend, cost trend, and any component replaced more than once.',
    input: z.object({
      vehicleId: z.string().uuid(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(15)
        .describe('How many recent records to include in the timeline.'),
    }),
    permissions: [Permission.MAINTENANCE_READ],
    feature: Feature.MAINTENANCE_BASIC,
    category: 'service',
    cacheTtlSeconds: 60,
    handler: async ({ auth }, input) => {
      const { vehicleId, limit } = input as { vehicleId: string; limit: number };
      const timeline = await vehicleServiceTimeline(auth, vehicleId);

      return result(
        {
          registrationNumber: timeline.registrationNumber,
          health: timeline.health.health,
          healthReasons: timeline.health.reasons,
          lastServiceAt: timeline.lastServiceAt,
          nextDueAt: timeline.nextDueAt,
          spend: timeline.spend,
          costTrend: timeline.costTrend,
          repeatedComponents: timeline.repeated.map((entry) => ({
            component: entry.label,
            occurrences: entry.occurrences,
            daysBetween: entry.daysBetween,
            kmBetween: entry.kmBetween,
            totalCost: entry.totalCost,
          })),
          records: timeline.records.slice(0, limit).map((record) => ({
            recordId: record.id,
            date: record.serviceDate,
            title: record.title,
            category: record.category,
            odometerKm: record.odometerKm,
            workshop: record.workshopName,
            totalCost: record.totalCost,
            replacedComponents: record.replacedComponents,
            source: record.source,
            verificationStatus: record.verificationStatus,
          })),
        },
        {
          recordCount: timeline.records.length,
          references: [
            { type: 'vehicle', id: timeline.vehicleId, label: timeline.registrationNumber },
          ],
          caveats: [
            timeline.coverageNote,
            ...(timeline.repeated.length > 0
              ? [
                  'A repeated component is a count, not a diagnosis. Whether it is wear, the roads, the driver or a bad part is a question for the workshop.',
                ]
              : []),
            ...(timeline.spend.unverifiedRecords > 0
              ? [
                  `${timeline.spend.unverifiedRecords} record(s) have not been confirmed by a person, so the spend figures may change.`,
                ]
              : []),
            ...(timeline.records.length > limit
              ? [`Showing the ${limit} most recent of ${timeline.records.length} records.`]
              : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_vehicle_service_record',
    description:
      'One service record in full: the invoice split, the parts fitted, the workshop and where the record came from.',
    input: z.object({ recordId: z.string().uuid() }),
    permissions: [Permission.MAINTENANCE_READ],
    feature: Feature.MAINTENANCE_BASIC,
    category: 'service',
    cacheTtlSeconds: 60,
    handler: async ({ auth }, input) => {
      const { recordId } = input as { recordId: string };
      const record = await getServiceRecord(auth, recordId);

      return result(record, {
        basis: ResultBasis.SOURCE_DATA,
        recordCount: 1,
        references: [
          { type: 'vehicle', id: record.vehicleId, label: record.registrationNumber },
        ],
        caveats: record.needsReview
          ? [
              'This record has not been confirmed by a person. Treat its figures as a draft until it is verified.',
            ]
          : [],
      });
    },
  },
];
