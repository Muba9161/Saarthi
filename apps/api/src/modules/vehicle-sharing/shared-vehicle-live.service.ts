import {
  Feature,
  TelemetryMetric,
  type SharedLiveQuery,
  type SharedReading,
  type SharedVehicleLive,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import type { AuthContext } from '../../auth/context';
import { resolveSubscription } from '../subscriptions/entitlements.service';
import { latestReadingOnPlan, type TelemetryReadingSummary } from '../telemetry/telemetry.service';
import { coveredPath } from '../tracking/tracking.service';
import { routePoints } from '../trips/trip.view';
import { requireActiveShare } from './vehicle-share.service';

/**
 * Following a shared vehicle the way its owner follows it: the trip it is on,
 * the road it has covered in the trail's colours, and its latest readings.
 *
 * The readings are the ones the owner's plan shows the owner — the owner pays
 * for the vehicle, so the person it is shared with sees what the owner would,
 * no more — and a figure the vehicle did not measure is never passed on.
 */

/** Points drawn at most; the server thins long paths while keeping every colour change. */
const TRAIL_LIMIT = 1500;

/** With no trip, the path reaches back this far, as the web's live map does. */
const NO_TRIP_WINDOW_MS = 12 * 60 * 60 * 1000;

/** However far back `from` asks, a shared view goes back no further than a week. */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function sharedVehicleLive(
  auth: AuthContext,
  shareId: string,
  query: SharedLiveQuery,
): Promise<SharedVehicleLive> {
  const share = await requireActiveShare(auth, shareId);
  const { vehicle } = share;
  const now = Date.now();

  const trip = vehicle.currentTripId
    ? await prisma.trip.findFirst({
        where: { id: vehicle.currentTripId, truckId: vehicle.id, organizationId: vehicle.organizationId },
        select: {
          id: true,
          reference: true,
          status: true,
          originAddress: true,
          destinationAddress: true,
          originLatitude: true,
          originLongitude: true,
          destinationLatitude: true,
          destinationLongitude: true,
          plannedRoute: true,
          actualStartAt: true,
        },
      })
    : null;

  const asked = query.from ?? trip?.actualStartAt ?? new Date(now - NO_TRIP_WINDOW_MS);
  const from = new Date(Math.max(asked.getTime(), now - MAX_WINDOW_MS));

  const [points, subscription] = await Promise.all([
    coveredPath(vehicle.id, from, TRAIL_LIMIT),
    resolveSubscription(share.ownerOrganizationId),
  ]);
  const reading = await latestReadingOnPlan(vehicle.id, subscription.features.includes(Feature.TELEMETRY_LIVE));

  return {
    trip: trip
      ? {
          id: trip.id,
          reference: trip.reference,
          status: trip.status,
          origin: trip.originAddress,
          destination: trip.destinationAddress,
          originLatitude: trip.originLatitude,
          originLongitude: trip.originLongitude,
          destinationLatitude: trip.destinationLatitude,
          destinationLongitude: trip.destinationLongitude,
          plannedRoute: routePoints(trip),
          startedAt: trip.actualStartAt?.toISOString() ?? null,
        }
      : null,
    trail: points.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      speedKph: point.speedKph,
      recordedAt: point.recordedAt,
      routeState: point.routeState,
    })),
    reading: reading ? measuredReading(reading) : null,
  };
}

/** The figures the reading carries that were measured, each null when it was not. */
function measuredReading(reading: TelemetryReadingSummary): SharedReading | null {
  const measured = (metric: TelemetryMetric, value: number | null): number | null =>
    value !== null && reading.metrics.includes(metric) && !reading.simulatedMetrics.includes(metric)
      ? value
      : null;
  const shown: SharedReading = {
    recordedAt: reading.recordedAt,
    speedKph: measured(TelemetryMetric.SPEED, reading.speedKph),
    rpm: measured(TelemetryMetric.RPM, reading.rpm),
    engineLoad: measured(TelemetryMetric.ENGINE_LOAD, reading.engineLoad),
    coolantTemperature: measured(TelemetryMetric.COOLANT_TEMPERATURE, reading.coolantTemperature),
    fuelLevel: measured(TelemetryMetric.FUEL_LEVEL, reading.fuelLevel),
    batteryVoltage: measured(TelemetryMetric.BATTERY_VOLTAGE, reading.batteryVoltage),
  };
  const anything = Object.entries(shown).some(([key, value]) => key !== 'recordedAt' && value !== null);
  return anything ? shown : null;
}
