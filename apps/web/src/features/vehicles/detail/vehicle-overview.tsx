import * as React from 'react';
import { formatCurrency, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import type { TruckPassport } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { LoadingState } from '@/components/common/states';
import { VehicleSharingCard } from '@/features/vehicle-sharing/vehicle-sharing-card';
import { VehicleOwnershipCard } from './vehicle-ownership-card';
import { SpecSheet, type SpecGroup } from './spec-sheet';
import { Panel, PanelHeader } from './panel';

/**
 * The Overview tab: what the vehicle is, who holds it, what it has earned and
 * cost, and what has happened to it lately.
 */
export function VehicleOverview({
  vehicle,
  description,
  specGroups,
  passport,
  passportLoading,
}: {
  vehicle: VehicleSummary;
  /** The vehicle type's one-line description. */
  description: string;
  specGroups: SpecGroup[];
  passport: TruckPassport | undefined;
  passportLoading: boolean;
}) {
  const lifetime = passport?.lifetime;
  const events = passport?.events ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Panel aria-labelledby="vehicle-spec">
        <PanelHeader id="vehicle-spec" title="Specification" description={description} />
        {/* Three questions side by side — what it is, what it carries, what is on record. */}
        <SpecSheet groups={specGroups} className="vd-spec space-y-0" />
      </Panel>

      {/* Side by side; Ownership takes the full row when Sharing is not on the plan. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:[&>:only-child]:col-span-full">
        <VehicleOwnershipCard
          vehicleId={vehicle.id}
          ownership={vehicle.ownership}
          className="vd-panel"
        />
        <VehicleSharingCard
          vehicleId={vehicle.id}
          ownershipStatus={vehicle.ownership.status}
          className="vd-panel"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/*
          The money view. Distance, trips, orders and services are in the rail's
          usage figures, so they are not repeated here.
        */}
        <Panel aria-labelledby="vehicle-cost">
          <PanelHeader
            id="vehicle-cost"
            title="Cost & earnings"
            description="Every figure from stored records."
          />
          {passportLoading ? (
            <LoadingState />
          ) : lifetime ? (
            <SpecSheet
              groups={[
                {
                  title: 'Lifetime',
                  rows: [
                    { label: 'Revenue', value: formatCurrency(lifetime.revenue) },
                    { label: 'Fuel', value: formatCurrency(lifetime.fuelCost) },
                    { label: 'Workshop', value: formatCurrency(lifetime.maintenanceCost) },
                    {
                      label: 'Profit',
                      value: formatCurrency(lifetime.profit),
                      // Coloured only when it is actually a loss: a green
                      // figure on every vehicle stops meaning anything.
                      ...(lifetime.profit < 0 ? { tone: 'destructive' as const } : {}),
                    },
                  ],
                },
                {
                  title: 'Per kilometre',
                  rows: [
                    {
                      label: 'Running cost',
                      value: lifetime.costPerKm ? `${formatCurrency(lifetime.costPerKm)}/km` : '-',
                    },
                    {
                      label: 'Fuel efficiency',
                      value: lifetime.fuelEfficiencyL100Km
                        ? `${lifetime.fuelEfficiencyL100Km} L/100 km`
                        : 'No fuel records yet',
                    },
                  ],
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet. Revenue, fuel and workshop spend appear after the first trip or
              fill-up.
            </p>
          )}
        </Panel>

        <Panel aria-labelledby="vehicle-activity">
          <PanelHeader
            id="vehicle-activity"
            title="Recent activity"
            description="Latest events on this vehicle."
          />
          {passportLoading ? (
            <LoadingState />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded events yet.</p>
          ) : (
            // A connecting rule down the left: these are events in sequence.
            <ol className="relative space-y-4 border-l border-border/70 pl-5">
              {events.slice(0, 10).map((event) => (
                <li key={event.id} className="relative">
                  <span
                    className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-border ring-4 ring-card"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">
                    {event.description ?? humanizeEnum(event.type)}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {relativeTimeFrom(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {vehicle.notes ? (
        <Panel aria-labelledby="vehicle-notes">
          <PanelHeader id="vehicle-notes" title="Notes" />
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{vehicle.notes}</p>
        </Panel>
      ) : null}
    </div>
  );
}
