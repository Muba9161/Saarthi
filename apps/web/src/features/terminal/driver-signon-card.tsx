import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, CheckCircle2, Clock, RefreshCw, ShieldAlert, Truck } from 'lucide-react';
import {
  Permission,
  RealtimeEvent,
  TERMINAL_APPROVAL_SLA,
  type TerminalSessionView,
} from '@saarthi/shared';
import { ApiError, api, apiRequest, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtimeEvent } from '@/hooks/use-realtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MediaImage } from '@/features/media/media-image';
import { Separator } from '@/components/ui/separator';

/**
 * "I am at this vehicle" — the driver's half of the terminal handshake.
 *
 * Rendered on the QR scan page, and only for a signed-in driver scanning a
 * vehicle in their own fleet. Everyone else — a traffic officer, a loading
 * supervisor, a customer at a gate — sees the ordinary scan result and nothing
 * about sign-on, because nothing about sign-on concerns them.
 *
 * The flow is three deliberate steps rather than one button:
 *
 *   1. **Request.** The scan proved the driver is standing at the vehicle. It
 *      proves nothing else, and it authorises nothing (specification §52).
 *   2. **Selfie.** Taken here, in the browser, from the phone the driver
 *      already has. The terminal does not take it — the driver does, from their
 *      own account, so the photograph is attributable to them.
 *   3. **Submit.** This is what starts the approver's clock.
 *
 * The waiting state is the part worth getting right. A driver stands beside a
 * truck watching this screen, so it says what is happening, who it is waiting
 * on and what happens if nobody answers — and it never implies that waiting
 * long enough will be enough.
 */

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  DRIVER_IDENTIFIED: {
    title: 'Vehicle confirmed',
    body: 'Take an arrival photo so your fleet can confirm it is you.',
  },
  SELFIE_SUBMITTED: {
    title: 'Photo captured',
    body: 'Submit your request when you are ready.',
  },
  PENDING_APPROVAL: {
    title: 'Waiting for approval',
    body: 'Your fleet has been notified. You will be told here and on the terminal as soon as somebody decides.',
  },
  APPROVED: {
    title: 'Approved',
    body: 'Complete the vehicle safety check on the terminal before starting your trip.',
  },
  READY: {
    title: 'Ready to drive',
    body: 'The safety check is done. Everything else is on the terminal.',
  },
  TRIP_ACTIVE: {
    title: 'Trip under way',
    body: 'You are signed on to this vehicle.',
  },
  REJECTED: {
    title: 'Not approved',
    body: 'Your fleet did not approve this request.',
  },
  EXPIRED: {
    title: 'Request expired',
    body: 'Nobody answered in time. Scan the vehicle QR again to ask once more.',
  },
  CANCELLED: {
    title: 'Request withdrawn',
    body: 'You cancelled this request.',
  },
};

/** Downscale before upload: a 12 MP selfie over a yard's signal is a failure. */
async function prepareSelfie(file: File): Promise<{ full: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file);

  const render = async (maxEdge: number, quality: number): Promise<Blob> => {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot process the photo.');
    context.drawImage(bitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo.'))),
        'image/jpeg',
        quality,
      );
    });
  };

  const [full, thumb] = await Promise.all([render(800, 0.85), render(200, 0.7)]);
  bitmap.close();
  return { full, thumb };
}

function WaitingPanel({ session }: { session: TerminalSessionView }): React.ReactElement {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!session.submittedAt) return <></>;

  const elapsed = Math.max(
    0,
    Math.round((now - new Date(session.submittedAt).getTime()) / 1000),
  );
  const minutes = Math.floor(elapsed / 60);

  return (
    <div className="rounded-md bg-muted p-3 text-sm">
      <p className="inline-flex items-center gap-1.5 font-medium">
        <Clock className="size-4" />
        Waiting {minutes} min {elapsed % 60}s
      </p>
      <p className="mt-1 text-muted-foreground">
        {minutes >= TERMINAL_APPROVAL_SLA.escalateAfterMinutes
          ? 'This has been escalated to your fleet owner. Call your dispatcher if it is urgent.'
          : `If nobody answers within ${TERMINAL_APPROVAL_SLA.escalateAfterMinutes} minutes it is escalated to your fleet owner.`}
      </p>
    </div>
  );
}

export function DriverSignOnCard({
  qrToken,
  registrationNumber,
}: {
  /**
   * The scanned vehicle's code.
   *
   * Optional, because this card is also rendered where nothing has been
   * scanned — the driver's own scan page, showing a request that is already
   * under way. Without a token the card can still carry the photo, the
   * submission and the wait; it just cannot *open* a request, and the button
   * that would is not offered rather than being offered and failing.
   */
  qrToken?: string;
  registrationNumber: string;
}): React.ReactElement | null {
  const { isDriver, can, status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = React.useState<GeolocationPosition | null>(null);

  // Asked for once, opportunistically. A refusal is fine — the request records
  // "position not available" rather than failing, because a driver in an
  // underground bay has no fix and still has to start work.
  React.useEffect(() => {
    if (!isDriver || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (fix) => setPosition(fix),
      () => setPosition(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  }, [isDriver]);

  const mine = useQuery({
    queryKey: ['terminal', 'my-session'],
    queryFn: () => api.get<TerminalSessionView | null>('/terminal/assignments/mine'),
    enabled: authStatus === 'authenticated' && isDriver && can(Permission.TERMINAL_READ),
    refetchInterval: 20_000,
  });

  useRealtimeEvent(RealtimeEvent.TERMINAL_SESSION_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['terminal', 'my-session'] });
  });

  const request = useMutation({
    mutationFn: () => {
      if (!qrToken) throw new Error('Scan the vehicle QR to start a request.');
      return api.post<TerminalSessionView>('/terminal/assignments/request', {
        qrToken,
        ...(position
          ? {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }
          : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['terminal', 'my-session'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const uploadSelfie = useMutation({
    mutationFn: async (file: File) => {
      const session = mine.data;
      if (!session) throw new Error('Start the request first.');

      const { full, thumb } = await prepareSelfie(file);
      const form = new FormData();
      form.append('file', full, 'arrival.jpg');
      form.append('thumbnail', thumb, 'arrival-thumb.jpg');
      form.append('capturedAt', new Date().toISOString());
      if (position) {
        form.append('latitude', String(position.coords.latitude));
        form.append('longitude', String(position.coords.longitude));
      }

      return apiRequest<TerminalSessionView>(
        `/terminal/assignments/${session.id}/selfie`,
        { method: 'POST', body: form },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['terminal', 'my-session'] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : errorMessage(error)),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/terminal/assignments/${mine.data?.id}/submit`, {}),
    onSuccess: async () => {
      toast.success('Sent to your fleet for approval.');
      await queryClient.invalidateQueries({ queryKey: ['terminal', 'my-session'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/terminal/assignments/${mine.data?.id}/cancel`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['terminal', 'my-session'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Not a driver, not signed in, or no terminal grant — this card is not for
  // them, and the scan result below is complete without it.
  if (authStatus !== 'authenticated' || !isDriver || !can(Permission.TERMINAL_DRIVE)) {
    return null;
  }

  const session = mine.data ?? null;
  const copy = session ? STATUS_COPY[session.status] : null;

  // Rendered away from a scan result, with nothing under way: there is no
  // vehicle to sign on to yet, and an empty card would only be in the way.
  if (!session && !qrToken) return null;

  // A live request somewhere else. Saying which vehicle is what stops a driver
  // standing at the wrong truck wondering why nothing works.
  if (session && session.registrationNumber !== registrationNumber) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" />
            You are signed on to another vehicle
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            You have an open request for {session.registrationNumber}. Finish or cancel it before
            signing on to {registrationNumber}.
          </p>
          <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancel that request
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Truck className="size-4" />
          {session ? (copy?.title ?? 'Signing on') : `Sign on to ${registrationNumber}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!session ? (
          <>
            <p className="text-muted-foreground">
              Tell your fleet you have arrived at this vehicle. They approve or reject the request,
              and you will be told here and on the terminal.
            </p>
            <Button
              onClick={() => request.mutate()}
              disabled={request.isPending || !qrToken}
              className="w-full"
            >
              {request.isPending ? 'Starting…' : 'I am at this vehicle'}
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">{copy?.body}</p>

            {session.selfieUrl ? (
              <div className="flex items-center gap-3">
                <MediaImage
                  source={session.selfieUrl}
                  alt="Your arrival photo"
                  variant="thumbnail"
                  className="size-16 rounded-lg border object-cover"
                />
                {session.status === 'SELFIE_SUBMITTED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInput.current?.click()}
                    disabled={uploadSelfie.isPending}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Retake
                  </Button>
                ) : null}
              </div>
            ) : null}

            {session.status === 'DRIVER_IDENTIFIED' ? (
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={uploadSelfie.isPending}
                className="w-full"
              >
                <Camera className="mr-1.5 size-4" />
                {uploadSelfie.isPending ? 'Uploading…' : 'Take arrival photo'}
              </Button>
            ) : null}

            {session.status === 'SELFIE_SUBMITTED' ? (
              <Button
                onClick={() => submit.mutate()}
                disabled={submit.isPending}
                className="w-full"
              >
                {submit.isPending ? 'Sending…' : 'Submit for approval'}
              </Button>
            ) : null}

            {session.status === 'PENDING_APPROVAL' ? <WaitingPanel session={session} /> : null}

            {session.status === 'REJECTED' && session.rejectionReason ? (
              <div className="rounded-md bg-destructive/10 p-3">
                <p className="font-medium text-destructive">Reason</p>
                <p className="text-muted-foreground">{session.rejectionReason}</p>
              </div>
            ) : null}

            {(session.status === 'APPROVED' ||
              session.status === 'READY' ||
              session.status === 'TRIP_ACTIVE') ? (
              <p className="inline-flex items-center gap-1.5 font-medium text-success">
                <CheckCircle2 className="size-4" />
                Signed on to {session.registrationNumber}
              </p>
            ) : null}

            {(session.status === 'DRIVER_IDENTIFIED' ||
              session.status === 'SELFIE_SUBMITTED' ||
              session.status === 'PENDING_APPROVAL') ? (
              <>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  Cancel this request
                </Button>
              </>
            ) : null}
          </>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          // `user` opens the front camera on a phone, which is the one a person
          // photographing themselves wants.
          capture="user"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) uploadSelfie.mutate(file);
          }}
        />
      </CardContent>
    </Card>
  );
}

export default DriverSignOnCard;
