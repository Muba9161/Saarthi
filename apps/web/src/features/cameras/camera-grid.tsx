import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, CameraOff, Info, Play, ShieldAlert, VideoOff } from 'lucide-react';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import type { CameraView, LiveViewResult } from '@/lib/api-types';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The four-up camera wall for one vehicle.
 *
 * Laid out as a grid because that is how a four-channel recorder is actually
 * used: front, cabin, and two sides, all visible at once, and a tap to enlarge
 * the one that matters. On a phone it collapses to a single column rather than
 * four unreadable thumbnails.
 *
 * Two things are always visible on a tile and never tucked away: whether the
 * feed is simulated, and that opening a live view is recorded. A camera in a
 * cab points at a person, and the person operating it should be reminded of
 * that at the moment they use it — not in a settings page they never open.
 */

interface CameraGridProps {
  vehicleId: string;
  registrationNumber: string;
}

const POSITION_LABELS: Record<string, string> = {
  FRONT: 'Front',
  CABIN: 'Cabin',
  LEFT: 'Left',
  RIGHT: 'Right',
  REAR: 'Rear',
  CARGO: 'Cargo',
  OTHER: 'Camera',
};

export function CameraGrid({
  vehicleId,
  registrationNumber,
}: CameraGridProps): React.ReactElement {
  const [active, setActive] = React.useState<LiveViewResult | null>(null);

  const cameras = useQuery({
    queryKey: ['vehicle-cameras', vehicleId],
    queryFn: () => api.get<CameraView[]>(`/fleet/vehicles/${vehicleId}/cameras`),
  });

  const openLive = useMutation({
    mutationFn: (cameraId: string) => api.post<LiveViewResult>(`/cameras/${cameraId}/live`, {}),
    onSuccess: (result) => setActive(result),
    onError: (error) => {
      // "No gateway configured" is an expected answer on a deployment without
      // camera infrastructure, not a failure worth a red toast.
      const message = errorMessage(error);
      if (error instanceof ApiError && error.status === 503) toast.info(message);
      else toast.error(message);
    },
  });

  const endLive = useMutation({
    mutationFn: (sessionId: string) => api.post(`/cameras/sessions/${sessionId}/end`),
    onSettled: () => setActive(null),
  });

  /*
   * Close the session when the panel unmounts.
   *
   * Without this the access log would show every view running until its ticket
   * lapsed, which overstates how long somebody actually watched — the opposite
   * of what an access log is for.
   *
   * Keyed on the session id through a ref so the cleanup always closes the
   * session it was created for, and never the one that has just replaced it.
   */
  const activeSessionRef = React.useRef<string | null>(null);
  activeSessionRef.current = active?.sessionId ?? null;

  React.useEffect(
    () => () => {
      const sessionId = activeSessionRef.current;
      if (sessionId) {
        void api.post(`/cameras/sessions/${sessionId}/end`).catch(() => undefined);
      }
    },
    [],
  );

  if (cameras.isLoading) return <LoadingState label="Loading cameras…" />;
  if (cameras.isError) {
    return <ErrorState error={cameras.error} onRetry={() => void cameras.refetch()} />;
  }

  const feeds = cameras.data ?? [];

  if (feeds.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={VideoOff}
            title="No cameras fitted"
            description={`No camera recorder is currently assigned to ${registrationNumber}. Cameras belong to the device, so fitting a recorder brings its channels with it.`}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {active ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionHeader
                title={`${POSITION_LABELS[active.camera.position] ?? 'Camera'} — live`}
                description={`Channel ${active.camera.channel} · ${active.camera.deviceIdentifier}`}
              />
              <div className="flex items-center gap-2">
                {active.simulated ? (
                  <Badge variant="warning" size="sm">
                    Simulated feed
                  </Badge>
                ) : (
                  <Badge variant="destructive" size="sm">
                    Live
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => endLive.mutate(active.sessionId)}
                >
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex aspect-video items-center justify-center rounded-lg border border-border bg-muted/40">
              {active.simulated ? (
                <div className="max-w-sm p-6 text-center">
                  <Camera className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">Simulated stream</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This environment has no video gateway. A real ticket was issued and the
                    session was recorded, so the whole path is exercised — but there is no
                    footage behind it.
                  </p>
                </div>
              ) : (
                <video
                  className="h-full w-full rounded-lg"
                  autoPlay
                  muted
                  playsInline
                  poster={active.posterUrl ?? undefined}
                />
              )}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
              This view is recorded against your account. Session expires{' '}
              {new Date(active.expiresAt).toLocaleTimeString('en-IN')}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {feeds.map((feed) => (
          <CameraTile
            key={feed.id}
            camera={feed}
            isActive={active?.camera.id === feed.id}
            onOpen={() => openLive.mutate(feed.id)}
            isOpening={openLive.isPending && openLive.variables === feed.id}
          />
        ))}
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Video never passes through Saarthi. Opening a view issues a short-lived credential and the
        stream runs from the recorder to your browser — what VorldX Saarthi keeps is the record that it
        happened.
      </p>
    </div>
  );
}

function CameraTile({
  camera,
  isActive,
  onOpen,
  isOpening,
}: {
  camera: CameraView;
  isActive: boolean;
  onOpen: () => void;
  isOpening: boolean;
}): React.ReactElement {
  const label = POSITION_LABELS[camera.position] ?? 'Camera';
  const offline = camera.status === 'OFFLINE' || camera.status === 'FAULT';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border',
        isActive && 'ring-1 ring-primary',
      )}
    >
      <div className="relative flex aspect-video items-center justify-center bg-muted/40">
        {camera.thumbnailUrl ? (
          <img
            src={camera.thumbnailUrl}
            alt={`${label} camera`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Camera className="h-6 w-6 text-muted-foreground" />
        )}

        {!camera.enabled ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CameraOff className="h-3.5 w-3.5" />
              Switched off
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {camera.label ?? label}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ch {camera.channel}
            </span>
          </p>
          <p className="text-2xs text-muted-foreground">
            {camera.lastFrameAt
              ? `Last frame ${new Date(camera.lastFrameAt).toLocaleTimeString('en-IN')}`
              : 'No frame received yet'}
          </p>
        </div>

        {offline ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="muted" size="sm" className="cursor-help">
                Offline
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              The recorder has not reported this channel recently. A silent camera and a covered
              lens look the same from here.
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpen}
            disabled={!camera.enabled || isOpening}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {isOpening ? 'Opening…' : 'Live'}
          </Button>
        )}
      </div>
    </div>
  );
}
