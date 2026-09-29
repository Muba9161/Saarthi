import * as React from 'react';
import { Activity, BatteryCharging, Fuel, Gauge, Thermometer, TriangleAlert } from 'lucide-react';
import {
  MOBILE_DEVICE_METRICS,
  TELEMETRY_ALERT_RULES,
  TelemetryAlertType,
  TelemetryMetric,
} from '@saarthi/shared';
import type { TelemetryReadingSummary } from '@/lib/mobility-types';
import { SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MetricTile } from './metric-tile';
import { TelemetryDial, type DialZone } from './telemetry-dial';

/** The organization-default limit for an alert rule, for drawing its band. */
function defaultLimit(type: TelemetryAlertType): number | null {
  return TELEMETRY_ALERT_RULES.find((rule) => rule.type === type)?.defaultThreshold ?? null;
}

const OVERSPEED_KPH = defaultLimit(TelemetryAlertType.OVERSPEED);
const HOT_COOLANT_C = defaultLimit(TelemetryAlertType.ENGINE_TEMPERATURE);
const LOW_VOLTAGE_V = defaultLimit(TelemetryAlertType.LOW_VOLTAGE);
/** The fuel figure the tile has always flagged as low. */
const LOW_FUEL_PERCENT = 15;

interface DialSpec {
  metric: TelemetryMetric;
  label: string;
  unit: string;
  /** The printed scale. Display ranges only — a reading past `max` widens it. */
  min: number;
  max: number;
  step: number;
  precision?: number;
  zones: DialZone[];
  icon: React.ComponentType<{ className?: string }>;
  value: (reading: TelemetryReadingSummary) => number | null;
}

const DIALS: DialSpec[] = [
  {
    metric: TelemetryMetric.SPEED,
    label: 'Speed',
    unit: 'km/h',
    min: 0,
    max: 140,
    step: 20,
    zones: OVERSPEED_KPH === null ? [] : [{ from: OVERSPEED_KPH, tone: 'warning' }],
    icon: Gauge,
    value: (reading) => reading.speedKph,
  },
  {
    metric: TelemetryMetric.RPM,
    label: 'RPM',
    unit: 'rpm',
    min: 0,
    max: 5000,
    step: 500,
    zones: [],
    icon: Gauge,
    value: (reading) => reading.rpm,
  },
  {
    metric: TelemetryMetric.FUEL_LEVEL,
    label: 'Fuel level',
    unit: '%',
    min: 0,
    max: 100,
    step: 10,
    zones: [{ from: 0, to: LOW_FUEL_PERCENT, tone: 'warning' }],
    icon: Fuel,
    value: (reading) => reading.fuelLevel,
  },
  {
    metric: TelemetryMetric.COOLANT_TEMPERATURE,
    label: 'Coolant',
    unit: '°C',
    min: 40,
    max: 130,
    step: 10,
    zones: HOT_COOLANT_C === null ? [] : [{ from: HOT_COOLANT_C, tone: 'destructive' }],
    icon: Thermometer,
    value: (reading) => reading.coolantTemperature,
  },
  {
    metric: TelemetryMetric.ENGINE_LOAD,
    label: 'Engine load',
    unit: '%',
    min: 0,
    max: 100,
    step: 10,
    zones: [],
    icon: Activity,
    value: (reading) => reading.engineLoad,
  },
  {
    metric: TelemetryMetric.THROTTLE_POSITION,
    label: 'Throttle',
    unit: '%',
    min: 0,
    max: 100,
    step: 10,
    zones: [],
    icon: Activity,
    value: (reading) => reading.throttlePosition,
  },
  {
    metric: TelemetryMetric.BATTERY_VOLTAGE,
    label: 'Battery',
    unit: 'V',
    min: 10,
    max: 15,
    step: 1,
    precision: 1,
    zones: LOW_VOLTAGE_V === null ? [] : [{ from: 10, to: LOW_VOLTAGE_V, tone: 'warning' }],
    icon: BatteryCharging,
    value: (reading) => reading.batteryVoltage,
  },
];

const PHONE_METRICS = new Set<TelemetryMetric>(MOBILE_DEVICE_METRICS);

/**
 * The Live tab once a reading exists.
 *
 * Dials for whichever instruments the latest report carries, then the figures
 * that read better as numbers. Without a tracker the API sends only what the
 * phone measured, so the engine and fuel sections are left out rather than
 * shown as a wall of "Not reported".
 */
export function LiveReadings({
  reading,
  observedMetrics,
  supportedMetricCount,
  needsTracker,
}: {
  reading: TelemetryReadingSummary;
  /** Metrics this vehicle has ever reported, for the "Not reported" tiles. */
  observedMetrics: TelemetryMetric[];
  supportedMetricCount: number;
  needsTracker: boolean;
}) {
  const observed = new Set(observedMetrics);
  const has = (metric: TelemetryMetric) => observed.has(metric);
  const simulated = new Set(reading.simulatedMetrics);
  const isSimulated = (metric: TelemetryMetric) => simulated.has(metric);

  // Only instruments this account can be sent are candidates, so a phone-only
  // account is never told its RPM is "not in this report".
  const candidates = needsTracker ? DIALS.filter((dial) => PHONE_METRICS.has(dial.metric)) : DIALS;
  const inReport = new Set(reading.metrics);
  const present = candidates.filter((dial) => inReport.has(dial.metric));
  const absent = candidates.filter((dial) => !inReport.has(dial.metric));

  return (
    <>
      {present.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Instruments"
              description={`Recorded ${new Date(reading.recordedAt).toLocaleString('en-IN')}. Bands mark the default alert limits.`}
            />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {present.map((dial) => (
                <TelemetryDial
                  key={dial.metric}
                  label={dial.label}
                  value={dial.value(reading)}
                  unit={dial.unit}
                  min={dial.min}
                  max={dial.max}
                  step={dial.step}
                  precision={dial.precision}
                  zones={dial.zones}
                  simulated={isSimulated(dial.metric)}
                  icon={dial.icon}
                />
              ))}
            </div>
            {absent.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Not in this report: {absent.map((dial) => dial.label).join(', ')}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            title="Position"
            description={
              present.length > 0
                ? undefined
                : `Recorded ${new Date(reading.recordedAt).toLocaleString('en-IN')}`
            }
          />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-3">
          <MetricTile
            label="Heading"
            value={reading.heading}
            unit="°"
            icon={Activity}
            available={has(TelemetryMetric.HEADING)}
          />
          <MetricTile
            label="Altitude"
            value={reading.altitude}
            unit="m"
            icon={Activity}
            available={has(TelemetryMetric.ALTITUDE)}
          />
          <MetricTile
            label="Satellites"
            value={reading.satellites}
            unit=""
            icon={Activity}
            available={has(TelemetryMetric.SATELLITES)}
          />
        </CardContent>
      </Card>

      {!needsTracker ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader title="Fuel and distance" />
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pt-0">
            <MetricTile
              label="Consumption"
              value={reading.fuelRate}
              unit="L/h"
              icon={Fuel}
              available={has(TelemetryMetric.FUEL_RATE)}
              simulated={isSimulated(TelemetryMetric.FUEL_RATE)}
            />
            <MetricTile
              label="Odometer"
              value={reading.odometerKm}
              unit="km"
              icon={Gauge}
              available={has(TelemetryMetric.ODOMETER)}
              simulated={isSimulated(TelemetryMetric.ODOMETER)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <SectionHeader title="Motion" />
        </CardHeader>
        <CardContent className="pt-0">
          {!has(TelemetryMetric.ACCELEROMETER) ? (
            <p className="text-sm text-muted-foreground">
              This device does not report accelerometer data, so harsh-driving events cannot be
              detected for this vehicle.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Badge variant={reading.harshBraking ? 'destructive' : 'secondary'}>
                {reading.harshBraking ? 'Harsh braking detected' : 'No harsh braking'}
              </Badge>
              <Badge variant={reading.harshAcceleration ? 'destructive' : 'secondary'}>
                {reading.harshAcceleration
                  ? 'Harsh acceleration detected'
                  : 'No harsh acceleration'}
              </Badge>
              {reading.accelerationX !== null ? (
                <Badge variant="outline">longitudinal {reading.accelerationX.toFixed(2)} g</Badge>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {reading.diagnostics.length > 0 ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-3">
            <SectionHeader title="Diagnostic trouble codes" />
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {reading.diagnostics.map((code) => (
              <div key={code.code} className="flex items-start gap-2 text-sm">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-mono font-medium">{code.code}</p>
                  {code.description ? (
                    <p className="text-muted-foreground">{code.description}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            This vehicle reports <strong>{observedMetrics.length}</strong> of the{' '}
            {supportedMetricCount} metrics the device is capable of. What a device can do and what a
            given vehicle exposes are different questions - Saarthi shows only the second.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
