import { z } from 'zod';
import {
  AUTHORIZED_TERMINAL_SESSION_STATUSES,
  DEFAULT_CHECKLIST_ITEMS,
  Feature,
  MaintenanceStatus,
  Permission,
  TERMINAL_SERVICE_CATEGORIES,
  TelemetryMetric,
  type TerminalSessionStatus,
  nearbyCategoriesFor,
  resolveDocumentValidity,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { latestReadingForVehicle } from '../../telemetry/telemetry.service';
import { findServices } from '../../terminal/navigation.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Saarthi Terminal tools — the assistant a driver talks to in the cab.
 *
 * These are the tools behind "Hey Saarthi". They are deliberately *driver*
 * tools rather than fleet tools: every one of them is about the vehicle the
 * caller is currently signed on to, resolved from their live terminal session,
 * and none of them takes a vehicle id. A driver who could name a vehicle could
 * name any vehicle in the fleet, and the assistant would happily read out
 * another truck's fuel level to whoever was holding the tablet.
 *
 * Two rules from specification sections 30 and 32 are enforced here rather than
 * asked for in a prompt, because a prompt is a request and this is a rule:
 *
 *  1. **The model is never the source of truth for live vehicle data.** Every
 *     figure comes from a stored reading, and every reading says which of its
 *     values were measured and which a simulator produced. The two are returned
 *     under separate headings so they cannot be averaged, merged or quoted
 *     interchangeably.
 *
 *  2. **Unavailable is said, not filled in.** A vehicle that does not report
 *     fuel level returns `available: false` with a reason. There is no code
 *     path here that returns a plausible number for a sensor nobody read.
 *
 * Authorisation is the driver's own, resolved through the normal registry: a
 * driver with no live session has no session for these tools to resolve, and
 * every one of them refuses in words the model can relay.
 */

const result = <T>(
  data: T,
  options: {
    basis?: ResultBasis;
    references?: ToolResult['references'];
    caveats?: string[];
    recordCount?: number;
  } = {},
): ToolResult<T> => ({
  data,
  basis: options.basis ?? ResultBasis.SOURCE_DATA,
  references: options.references ?? [],
  caveats: options.caveats ?? [],
  recordCount: options.recordCount ?? 1,
});

/**
 * The vehicle the caller is currently authorised to drive.
 *
 * Resolved from their live terminal session, never from an argument. Throws a
 * sentence the model is expected to relay verbatim — "you are not signed on to
 * a vehicle" is a genuinely useful answer, and far better than a tool that
 * silently answers about the last truck they drove.
 */
async function currentAssignment(driverId: string | null): Promise<{
  sessionId: string;
  vehicleId: string;
  registrationNumber: string;
  organizationId: string;
  vehicleType: string;
  status: TerminalSessionStatus;
}> {
  if (!driverId) {
    throw new Error(
      'You are not signed in as a driver, so I cannot tell which vehicle you are asking about.',
    );
  }

  const session = await prisma.terminalSession.findFirst({
    where: { driverId, status: { in: AUTHORIZED_TERMINAL_SESSION_STATUSES } },
    orderBy: { requestedAt: 'desc' },
    select: {
      id: true,
      vehicleId: true,
      organizationId: true,
      status: true,
      vehicle: { select: { registrationNumber: true, vehicleType: true } },
    },
  });

  if (!session) {
    throw new Error(
      'You are not signed on to a vehicle at the moment. Scan the vehicle QR on the terminal to sign on.',
    );
  }

  return {
    sessionId: session.id,
    vehicleId: session.vehicleId,
    registrationNumber: session.vehicle.registrationNumber,
    organizationId: session.organizationId,
    vehicleType: session.vehicle.vehicleType,
    status: session.status as TerminalSessionStatus,
  };
}

/** Split a reading into what was measured and what was invented. */
function partitionReading(reading: {
  metrics: TelemetryMetric[];
  simulatedMetrics: TelemetryMetric[];
}): { measured: TelemetryMetric[]; simulated: TelemetryMetric[] } {
  const simulated = new Set(reading.simulatedMetrics);
  return {
    measured: reading.metrics.filter((metric) => !simulated.has(metric)),
    simulated: [...simulated],
  };
}

/**
 * One metric's value, or an honest refusal.
 *
 * The shape is the enforcement. There is no field that can hold a number when
 * `available` is false, so a caller cannot accidentally render a placeholder as
 * a reading.
 */
interface MetricAnswer {
  available: boolean;
  value: number | null;
  unit: string | null;
  /** True when a simulator produced it. Never omitted when it applies. */
  simulated: boolean;
  recordedAt: string | null;
  reason: string | null;
}

function metricAnswer(
  reading: Awaited<ReturnType<typeof latestReadingForVehicle>>,
  metric: TelemetryMetric,
  value: number | null,
  unit: string,
): MetricAnswer {
  if (!reading) {
    return {
      available: false,
      value: null,
      unit: null,
      simulated: false,
      recordedAt: null,
      reason: 'This vehicle has not reported any data yet.',
    };
  }
  if (!reading.metrics.includes(metric) || value === null) {
    return {
      available: false,
      value: null,
      unit: null,
      simulated: false,
      recordedAt: reading.recordedAt,
      reason: `This vehicle does not report ${metric.toLowerCase().replace(/_/g, ' ')}.`,
    };
  }
  return {
    available: true,
    value,
    unit,
    simulated: reading.simulatedMetrics.includes(metric),
    recordedAt: reading.recordedAt,
    reason: null,
  };
}

const NO_ARGS = z.object({});

const SIMULATED_CAVEAT =
  'Some of these values came from the on-device simulator, not from the engine. ' +
  'Say so when you quote them, and never present them as measurements.';

export const TERMINAL_TOOLS: AiTool[] = [
  {
    name: 'get_current_vehicle',
    description:
      'The vehicle the driver is currently signed on to at a Saarthi Terminal, with its registration, type and odometer. Use this before any other terminal tool when the driver says "my vehicle" or "this truck".',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'vehicle',
    cacheTtlSeconds: 15,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);
      const vehicle = await prisma.truck.findUnique({
        where: { id: assignment.vehicleId },
        select: {
          registrationNumber: true,
          vehicleType: true,
          truckType: true,
          manufacturer: true,
          model: true,
          year: true,
          fuelType: true,
          odometerKm: true,
          status: true,
        },
      });

      return result(
        { sessionStatus: assignment.status, ...vehicle },
        {
          references: [
            {
              type: 'Vehicle',
              id: assignment.vehicleId,
              label: assignment.registrationNumber,
            },
          ],
        },
      );
    },
  },

  {
    name: 'get_current_vehicle_position',
    description:
      'Where the driver\'s current vehicle is right now, with its speed and heading. Returns availability rather than a guess when there is no recent fix.',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'vehicle',
    // Live data. A cached position is a wrong position by definition.
    cacheTtlSeconds: 0,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);
      const reading = await latestReadingForVehicle(assignment.vehicleId);

      if (!reading || reading.latitude === null || reading.longitude === null) {
        return result(
          {
            available: false,
            reason:
              'No position has been reported recently. The terminal may have lost GPS or network.',
          },
          { basis: ResultBasis.SOURCE_DATA, recordCount: 0 },
        );
      }

      const ageSeconds = Math.round(
        (Date.now() - new Date(reading.recordedAt).getTime()) / 1000,
      );

      return result(
        {
          available: true,
          latitude: reading.latitude,
          longitude: reading.longitude,
          speedKph: reading.speedKph,
          heading: reading.heading,
          recordedAt: reading.recordedAt,
          ageSeconds,
          // A phone's GPS is a real measurement of a real vehicle, whatever
          // else in the frame is simulated. Saying so stops the model hedging
          // about a position it can trust.
          measured: !reading.simulatedMetrics.includes(TelemetryMetric.LOCATION),
        },
        {
          caveats:
            ageSeconds > 300
              ? [
                  `The last position is ${Math.round(ageSeconds / 60)} minutes old. Say so rather than implying it is live.`,
                ]
              : [],
          references: [
            {
              type: 'Vehicle',
              id: assignment.vehicleId,
              label: assignment.registrationNumber,
            },
          ],
        },
      );
    },
  },

  {
    name: 'get_current_vehicle_status',
    description:
      'Live engine and fuel readings for the driver\'s current vehicle — fuel level, coolant temperature, battery voltage, RPM and any stored trouble codes. Each value says whether it was measured or produced by the simulator; never quote a simulated value as a measurement.',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'vehicle',
    cacheTtlSeconds: 10,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);
      const reading = await latestReadingForVehicle(assignment.vehicleId);

      const answers = {
        fuelLevel: metricAnswer(reading, TelemetryMetric.FUEL_LEVEL, reading?.fuelLevel ?? null, '%'),
        coolantTemperature: metricAnswer(
          reading,
          TelemetryMetric.COOLANT_TEMPERATURE,
          reading?.coolantTemperature ?? null,
          '°C',
        ),
        batteryVoltage: metricAnswer(
          reading,
          TelemetryMetric.BATTERY_VOLTAGE,
          reading?.batteryVoltage ?? null,
          'V',
        ),
        rpm: metricAnswer(reading, TelemetryMetric.RPM, reading?.rpm ?? null, 'rpm'),
        engineLoad: metricAnswer(
          reading,
          TelemetryMetric.ENGINE_LOAD,
          reading?.engineLoad ?? null,
          '%',
        ),
        speedKph: metricAnswer(reading, TelemetryMetric.SPEED, reading?.speedKph ?? null, 'km/h'),
      };

      const anySimulated = Object.values(answers).some((answer) => answer.simulated);
      const partition = reading
        ? partitionReading(reading)
        : { measured: [], simulated: [] };

      return result(
        {
          recordedAt: reading?.recordedAt ?? null,
          measuredMetrics: partition.measured,
          simulatedMetrics: partition.simulated,
          ...answers,
          diagnosticCodes: reading?.diagnostics ?? [],
        },
        {
          caveats: [
            ...(anySimulated ? [SIMULATED_CAVEAT] : []),
            ...(reading ? [] : ['This vehicle has not reported any telemetry yet.']),
          ],
          recordCount: reading ? 1 : 0,
          references: [
            {
              type: 'Vehicle',
              id: assignment.vehicleId,
              label: assignment.registrationNumber,
            },
          ],
        },
      );
    },
  },

  {
    name: 'get_current_vehicle_health',
    description:
      'A safety verdict for the driver\'s current vehicle: outstanding maintenance, next service, document validity and any open trouble codes. Use this for "is my vehicle okay?". It is a rule result, not an opinion — do not soften or override it.',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'vehicle',
    cacheTtlSeconds: 60,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);

      const [vehicle, maintenance, documents, reading, lastCheck] = await Promise.all([
        prisma.truck.findUnique({
          where: { id: assignment.vehicleId },
          select: { odometerKm: true, status: true },
        }),
        prisma.maintenanceRecord.findMany({
          where: {
            truckId: assignment.vehicleId,
            status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 20,
          select: {
            type: true,
            title: true,
            status: true,
            scheduledAt: true,
            nextDueAt: true,
            nextDueOdometerKm: true,
          },
        }),
        prisma.document.findMany({
          where: {
            ownerType: 'TRUCK',
            ownerId: assignment.vehicleId,
            deletedAt: null,
          },
          select: { documentType: true, expiryDate: true, verificationStatus: true },
        }),
        latestReadingForVehicle(assignment.vehicleId),
        prisma.terminalChecklistSubmission.findFirst({
          where: { vehicleId: assignment.vehicleId },
          orderBy: { submittedAt: 'desc' },
          select: { outcome: true, submittedAt: true, usedSimulatedData: true },
        }),
      ]);

      const documentStatus = documents.map((document) => {
        const { validity, daysRemaining } = resolveDocumentValidity({
          expiryDate: document.expiryDate,
          verificationStatus: document.verificationStatus,
        });
        return { type: document.documentType, validity, daysRemaining };
      });

      const expired = documentStatus.filter((entry) => entry.validity === 'EXPIRED');
      const expiring = documentStatus.filter((entry) => entry.validity === 'EXPIRING_SOON');

      let nextServiceInKm: number | null = null;
      for (const record of maintenance) {
        if (vehicle?.odometerKm !== undefined && record.nextDueOdometerKm !== null) {
          const remaining = record.nextDueOdometerKm - (vehicle?.odometerKm ?? 0);
          if (nextServiceInKm === null || remaining < nextServiceInKm) {
            nextServiceInKm = remaining;
          }
        }
      }

      const concerns: string[] = [];
      if (expired.length > 0) {
        concerns.push(`${expired.length} vehicle document(s) expired`);
      }
      if (maintenance.length > 0) {
        concerns.push(`${maintenance.length} open maintenance item(s)`);
      }
      if (reading && reading.diagnostics.length > 0) {
        concerns.push(`${reading.diagnostics.length} stored trouble code(s)`);
      }
      if (nextServiceInKm !== null && nextServiceInKm <= 0) {
        concerns.push('service overdue');
      }

      return result(
        {
          registrationNumber: assignment.registrationNumber,
          vehicleStatus: vehicle?.status ?? null,
          verdict: concerns.length === 0 ? 'NO_OPEN_CONCERNS' : 'ATTENTION_NEEDED',
          concerns,
          openMaintenance: maintenance,
          nextServiceInKm,
          documents: documentStatus,
          expiredDocuments: expired.map((entry) => entry.type),
          expiringDocuments: expiring.map((entry) => entry.type),
          diagnosticCodes: reading?.diagnostics ?? [],
          lastSafetyCheck: lastCheck
            ? {
                outcome: lastCheck.outcome,
                submittedAt: lastCheck.submittedAt.toISOString(),
                usedSimulatedData: lastCheck.usedSimulatedData,
              }
            : null,
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: maintenance.length + documents.length,
          caveats: [
            'This is a records check, not a mechanical inspection. It cannot see a fault nobody has recorded.',
            ...(lastCheck?.usedSimulatedData
              ? [
                  'The last safety check used simulated engine data for some items. Say so if you mention it.',
                ]
              : []),
          ],
          references: [
            {
              type: 'Vehicle',
              id: assignment.vehicleId,
              label: assignment.registrationNumber,
            },
          ],
        },
      );
    },
  },

  {
    name: 'get_my_driver_status',
    description:
      'The signed-on driver\'s own profile: name, licence class and validity, verification status, the vehicle they are assigned to and when the assignment was approved. Only ever returns the caller\'s own record.',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'driver',
    cacheTtlSeconds: 60,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);

      const driver = await prisma.driver.findUnique({
        where: { id: auth.driverId ?? '__none__' },
        select: {
          licenseClass: true,
          licenseExpiryDate: true,
          verificationStatus: true,
          experienceYears: true,
          totalTrips: true,
          user: { select: { firstName: true, lastName: true } },
        },
      });
      if (!driver) throw new Error('Your driver profile could not be found.');

      const session = await prisma.terminalSession.findUnique({
        where: { id: assignment.sessionId },
        select: { decidedAt: true, checklistCompletedAt: true, tripStartedAt: true },
      });

      const { validity, daysRemaining } = resolveDocumentValidity({
        expiryDate: driver.licenseExpiryDate,
        verificationStatus:
          driver.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING_VERIFICATION',
      });

      return result({
        name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
        licenceClass: driver.licenseClass,
        licenceValidity: validity,
        licenceDaysRemaining: daysRemaining,
        verificationStatus: driver.verificationStatus,
        experienceYears: driver.experienceYears,
        totalTrips: driver.totalTrips,
        currentVehicle: assignment.registrationNumber,
        assignmentStatus: assignment.status,
        approvedAt: session?.decidedAt?.toISOString() ?? null,
        safetyCheckCompletedAt: session?.checklistCompletedAt?.toISOString() ?? null,
        tripStartedAt: session?.tripStartedAt?.toISOString() ?? null,
      });
    },
  },

  {
    name: 'find_nearby_services',
    description:
      'Find fuel stations, mechanics, tyre shops, truck parking, food stops, hospitals, police or weighbridges near the driver\'s current vehicle. Use the service key that matches what they asked for. Returns the distance the driver will actually cover by road, with a driving time, where routing is available — and says so when it could only give the direct distance. Never describe a direct distance as a driving distance.',
    input: z.object({
      service: z
        .enum([
          'FUEL',
          'MECHANIC',
          'TYRE',
          'PARKING',
          'FOOD',
          'HOSPITAL',
          'POLICE',
          'WEIGHBRIDGE',
        ])
        .describe('The kind of service the driver asked for.'),
      radiusKm: z
        .number()
        .min(1)
        .max(100)
        .default(15)
        .describe('How far to search, in kilometres.'),
      limit: z.number().int().min(1).max(10).default(5).describe('How many to return.'),
    }),
    permissions: [Permission.TERMINAL_READ, Permission.NEARBY_READ],
    feature: Feature.NEARBY_SERVICES,
    category: 'safety',
    cacheTtlSeconds: 120,
    handler: async ({ auth }, input) => {
      const args = input as { service: string; radiusKm: number; limit: number };
      const assignment = await currentAssignment(auth.driverId);
      const reading = await latestReadingForVehicle(assignment.vehicleId);

      if (!reading || reading.latitude === null || reading.longitude === null) {
        // No position means no honest answer. A search around the fleet's
        // office would look like a working answer and send a driver 200 km.
        return result(
          {
            available: false,
            reason:
              'I do not have a recent position for your vehicle, so I cannot search around you.',
            places: [],
          },
          { recordCount: 0 },
        );
      }

      // The same road-distance path the services screen uses, so the assistant
      // and the list can never disagree about which pump is nearest.
      const found = await findServices({
        organizationId: assignment.organizationId,
        vehicleId: assignment.vehicleId,
        service: args.service,
        categories: nearbyCategoriesFor(args.service),
        latitude: reading.latitude,
        longitude: reading.longitude,
        radiusKm: args.radiusKm,
        limit: args.limit,
      });

      const label =
        TERMINAL_SERVICE_CATEGORIES.find((entry) => entry.key === args.service)?.label ??
        args.service;

      return result(
        {
          available: true,
          service: label,
          from: found.from,
          /**
           * Stated rather than left for the model to infer from the rows.
           *
           * "The nearest fuel station is 3.2 kilometres away" is a different
           * claim depending on which kind of distance that is, and a driver on
           * a quarter tank acts on it either way.
           */
          distancesAreRoadDistances: found.roadDistancesAvailable,
          places: found.places.map((place) => ({
            name: place.name,
            category: place.category,
            distanceKm: place.distance.km,
            distanceBasis: place.distance.basis,
            drivingMinutes: place.distance.durationMinutes,
            straightLineKm: place.straightLineKm,
            direction: place.direction,
            latitude: place.latitude,
            longitude: place.longitude,
            address: place.address,
            phone: place.phone,
            open24Hours: place.open24Hours,
            source: place.source,
          })),
        },
        {
          basis: ResultBasis.PROVIDER_REPORTED,
          recordCount: found.places.length,
          caveats: [
            'These come from open map data and may be out of date. Suggest calling ahead for anything the driver is relying on.',
            ...(found.roadDistancesAvailable
              ? []
              : [
                  'These are DIRECT distances, not driving distances — the real drive is longer, sometimes much longer. Say "about N kilometres away in a straight line", never "N kilometres to drive".',
                ]),
            ...(found.routingNote ? [found.routingNote] : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_pretrip_checklist_status',
    description:
      'Whether the driver has completed the mandatory pre-trip safety check on their current vehicle, and what it found. Use this for "can I start?" or "did I do my checks?". Never tell a driver they may start a trip when this says the check is outstanding or failed.',
    input: NO_ARGS,
    permissions: [Permission.TERMINAL_READ],
    category: 'safety',
    cacheTtlSeconds: 15,
    handler: async ({ auth }) => {
      const assignment = await currentAssignment(auth.driverId);

      const submission = await prisma.terminalChecklistSubmission.findFirst({
        where: { sessionId: assignment.sessionId },
        orderBy: { submittedAt: 'desc' },
        include: {
          results: {
            where: { status: { in: ['CRITICAL', 'ATTENTION', 'UNAVAILABLE'] } },
            select: { label: true, status: true, detail: true, simulated: true },
          },
        },
      });

      if (!submission) {
        return result(
          {
            completed: false,
            outcome: null,
            mayStartTrip: false,
            itemCount: DEFAULT_CHECKLIST_ITEMS.length,
            reason: 'The pre-trip safety check has not been completed on this vehicle yet.',
          },
          { basis: ResultBasis.RULE_RESULT, recordCount: 0 },
        );
      }

      return result(
        {
          completed: true,
          outcome: submission.outcome,
          mayStartTrip: submission.outcome !== 'FAILED',
          submittedAt: submission.submittedAt.toISOString(),
          usedSimulatedData: submission.usedSimulatedData,
          concerns: submission.results,
        },
        {
          basis: ResultBasis.RULE_RESULT,
          caveats: submission.usedSimulatedData
            ? [
                'Some items in this check were answered from simulated engine data rather than real sensors.',
              ]
            : [],
        },
      );
    },
  },
];
