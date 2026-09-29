import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Gauge, LogOut, MapPin, Share2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber, formatRegistrationNumber, relativeTimeFrom } from '@saarthi/shared';
import { ApiError, errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { FleetMap } from '@/features/maps/fleet-map';
import {
  SHARED_WITH_ME_KEY,
  endShare,
  useSharedVehicle,
} from '@/features/vehicle-sharing/sharing-api';
import {
  SharedFuelList,
  SharedMaintenanceList,
  SharedTripList,
} from '@/features/vehicle-sharing/shared-activity-lists';
import {
  AddSharedFuelDialog,
  AddSharedMaintenanceDialog,
  AddSharedTripDialog,
} from '@/features/vehicle-sharing/shared-log-dialogs';

/**
 * A vehicle someone shared with you.
 *
 * Its own screen rather than the owner's vehicle page with parts hidden: the
 * owner's page shows costs, finance, documents and the RC, and hiding them one
 * by one is how one gets missed. This screen is built only from what sharing
 * allows — where the vehicle is, and its trips, fuel and maintenance, which you
 * can add to.
 */
export function SharedVehiclePage() {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const vehicle = useSharedVehicle(shareId);

  const leave = useMutation({
    mutationFn: () => endShare(shareId),
    onSuccess: () => {
      toast.success('Vehicle removed from Shared with me');
      void queryClient.invalidateQueries({ queryKey: SHARED_WITH_ME_KEY });
      navigate('/fleet/vehicles?view=shared', { replace: true });
    },
    onError: (error) => toast.error('Could not remove it', { description: errorMessage(error) }),
  });

  const back = (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/fleet/vehicles?view=shared">
        <ArrowLeft className="size-4" aria-hidden />
        Shared with me
      </Link>
    </Button>
  );

  if (vehicle.isLoading) return <LoadingState label="Loading the shared vehicle…" />;
  if (vehicle.error instanceof ApiError && vehicle.error.status === 404) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={Share2}
          title="This vehicle is no longer shared with you"
          description="The owner may have stopped sharing it, or it has left their account."
        />
      </div>
    );
  }
  if (vehicle.isError || !vehicle.data) {
    return <ErrorState error={vehicle.error} onRetry={() => void vehicle.refetch()} />;
  }

  const data = vehicle.data;
  const position = data.lastLocation;

  return (
    <div className="space-y-5">
      {back}

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">
                {formatRegistrationNumber(data.registrationNumber)}
              </h1>
              <StatusBadge status={data.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[data.manufacturer, data.model].filter(Boolean).join(' ') || data.typeLabel} · shared
              by {data.ownerName}
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <UserRound className="size-3.5" aria-hidden />
                {data.currentDriverName ?? 'No driver assigned'}
              </span>
              <span className="flex items-center gap-1.5">
                <Gauge className="size-3.5" aria-hidden />
                {formatNumber(data.odometerKm)} km
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {position ? `Seen ${relativeTimeFrom(position.recordedAt)}` : 'No position yet'}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            loading={leave.isPending}
            onClick={() => leave.mutate()}
          >
            <LogOut className="size-4" aria-hidden />
            Stop using this vehicle
          </Button>
        </CardContent>
      </Card>

      {position ? (
        <Card className="overflow-hidden rounded-2xl">
          <FleetMap
            trucks={[
              {
                id: data.vehicleId,
                registrationNumber: data.registrationNumber,
                latitude: position.latitude,
                longitude: position.longitude,
                heading: position.heading,
                speedKph: position.speedKph,
                status: data.status,
                driverName: data.currentDriverName,
              },
            ]}
            height="320px"
            autoFit
            showSearch={false}
          />
        </Card>
      ) : null}

      <Tabs defaultValue="trips" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="fuel">Fuel</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="trips" className="space-y-3">
          <div className="flex justify-end">
            <AddSharedTripDialog
              shareId={shareId}
              near={
                position ? { latitude: position.latitude, longitude: position.longitude } : null
              }
            />
          </div>
          <SharedTripList shareId={shareId} />
        </TabsContent>

        <TabsContent value="fuel" className="space-y-3">
          <div className="flex justify-end">
            <AddSharedFuelDialog shareId={shareId} />
          </div>
          <SharedFuelList shareId={shareId} />
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-3">
          <div className="flex justify-end">
            <AddSharedMaintenanceDialog shareId={shareId} />
          </div>
          <SharedMaintenanceList shareId={shareId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SharedVehiclePage;
