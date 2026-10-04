import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatCurrency, formatDistanceKm, humanizeEnum } from '@saarthi/shared';
import type { TruckPassport } from '@/lib/api-types';
import { StatusBadge } from '@/components/common/status-badge';
import { ServiceTimelinePanel } from '@/features/service/service-timeline';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyRows, Panel, PanelHeader } from './panel';
import { SectionSwitch } from './section-switch';

/** The History tab's sections, also the targets the header menu can open. */
export const HISTORY_SECTIONS = {
  trips: 'trips',
  maintenance: 'maintenance',
  drivers: 'drivers',
} as const;

/** A maintenance row as the passport serialises it. */
interface MaintenanceEntry {
  id: string;
  title: string;
  type: string;
  status: string;
  serviceProvider: string | null;
  cost: number | null;
  completedAt: string | null;
}

/**
 * Trips, maintenance and driver history — what this vehicle has done, and who
 * has driven it. Every table keeps its heading row when empty, so the reader
 * learns what will appear as well as that nothing has yet.
 */
export function VehicleHistory({
  vehicleId,
  passport,
  section,
  onSectionChange,
}: {
  vehicleId: string;
  passport: TruckPassport | undefined;
  section: string | undefined;
  onSectionChange: (section: string) => void;
}) {
  const navigate = useNavigate();
  const trips = passport?.recentTrips ?? [];
  const maintenance = (passport?.maintenance ?? []) as unknown as MaintenanceEntry[];
  const drivers = passport?.driverHistory ?? [];

  return (
    <SectionSwitch
      label="History sections"
      value={section}
      onValueChange={onSectionChange}
      sections={[
        {
          value: HISTORY_SECTIONS.trips,
          label: 'Trips',
          content: (
            <Panel aria-labelledby="history-trips" className="px-0 pb-2">
              <PanelHeader id="history-trips" title="Trips" className="px-6" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Trip</TableHead>
                    <TableHead className="hidden md:table-cell">Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="hidden pr-6 text-right md:table-cell">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.map((trip) => (
                    <TableRow
                      key={trip.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/trips/${trip.id}`)}
                    >
                      <TableCell className="pl-6 font-medium">{trip.reference}</TableCell>
                      <TableCell className="hidden max-w-72 truncate text-sm text-muted-foreground md:table-cell">
                        {trip.originAddress.split(',')[0]} → {trip.destinationAddress.split(',')[0]}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={trip.status} size="sm" />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatDistanceKm(trip.actualDistanceKm)}
                      </TableCell>
                      <TableCell className="tabular hidden pr-6 text-right md:table-cell">
                        {formatCurrency(trip.price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {trips.length === 0 ? (
                <EmptyRows
                  title="No trips recorded yet"
                  hint="Trips this vehicle runs are listed here."
                />
              ) : null}
            </Panel>
          ),
        },
        {
          value: HISTORY_SECTIONS.maintenance,
          label: 'Maintenance',
          content: (
            // Service history first: what has been done to the vehicle is the
            // question people open this to answer; what is booked is smaller.
            <div className="flex flex-col gap-5">
              <ServiceTimelinePanel vehicleId={vehicleId} />

              <Panel aria-labelledby="history-scheduled" className="px-0 pb-2">
                <PanelHeader
                  id="history-scheduled"
                  title="Scheduled work"
                  description="Jobs booked but not yet completed."
                  className="px-6"
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Provider</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="hidden pr-6 text-right md:table-cell">
                        Completed
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenance.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="pl-6">
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-xs text-muted-foreground">{humanizeEnum(entry.type)}</p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} size="sm" />
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {entry.serviceProvider ?? '-'}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatCurrency(entry.cost)}
                        </TableCell>
                        <TableCell className="hidden pr-6 text-right text-sm text-muted-foreground md:table-cell">
                          {entry.completedAt
                            ? new Date(entry.completedAt).toLocaleDateString('en-IN')
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {maintenance.length === 0 ? (
                  <EmptyRows
                    title="No maintenance recorded"
                    hint="Jobs booked but not yet completed appear here."
                  />
                ) : null}
              </Panel>
            </div>
          ),
        },
        {
          value: HISTORY_SECTIONS.drivers,
          label: 'Driver history',
          content: (
            <Panel aria-labelledby="history-drivers" className="px-0 pb-2">
              <PanelHeader id="history-drivers" title="Driver history" className="px-6" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">From</TableHead>
                    <TableHead className="hidden pr-6 md:table-cell">Until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.map((assignment) => (
                    <TableRow key={`${assignment.driverId}-${assignment.assignedAt}`}>
                      <TableCell className="pl-6">
                        <Link
                          to={`/fleet/drivers/${assignment.driverId}`}
                          className="font-medium hover:underline"
                        >
                          {assignment.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={assignment.status} size="sm" />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {new Date(assignment.assignedAt).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell className="hidden pr-6 text-sm text-muted-foreground md:table-cell">
                        {assignment.unassignedAt
                          ? new Date(assignment.unassignedAt).toLocaleDateString('en-IN')
                          : 'Current'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {drivers.length === 0 ? (
                <EmptyRows
                  title="No driver assignments yet"
                  hint="Every driver assigned to this vehicle is listed here."
                />
              ) : null}
            </Panel>
          ),
        },
      ]}
    />
  );
}
