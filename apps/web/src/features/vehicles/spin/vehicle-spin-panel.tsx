import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { isAbortError, removeSpin, spinQueryKey, uploadSpin } from './spin-api';
import { SpinCapture } from './spin-capture';
import { SpinDetails } from './spin-details';
import type { SpinDraft } from './spin-frames';
import { SpinShootingGuide } from './spin-guide';
import { SpinViewer } from './spin-viewer';
import { useSpinFrameSources, useVehicleSpin } from './use-spin-frames';

/**
 * A vehicle's 360° spin, in its Photos tab: turned if there is one, offered if
 * there is not.
 *
 * One spin per vehicle. Replacing one keeps the current spin on screen and on
 * record until the new walk-around has been prepared and checked; only saving
 * swaps them. (The per-purpose cap is one spin's worth of frames, so the old
 * one does have to go before the new one can land.)
 */
export function VehicleSpinPanel({
  vehicleId,
  label,
  canUpload,
  canDelete,
}: {
  vehicleId: string;
  /** The vehicle as people know it — its plate, usually. */
  label: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const spin = useVehicleSpin(vehicleId);
  const assetIds = React.useMemo(() => spin.assets.map((asset) => asset.id), [spin.assets]);
  const sources = useSpinFrameSources(assetIds);

  const [draft, setDraft] = React.useState<SpinDraft | null>(null);
  const [replacing, setReplacing] = React.useState(false);
  const [uploaded, setUploaded] = React.useState(0);
  const upload = React.useRef<AbortController | null>(null);

  // Leaving mid-upload cancels it, and the frames already sent are taken back.
  React.useEffect(() => () => upload.current?.abort(), []);

  const invalidate = (): void =>
    void queryClient.invalidateQueries({ queryKey: spinQueryKey(vehicleId) });

  const save = useMutation({
    mutationFn: async (next: SpinDraft) => {
      const controller = new AbortController();
      upload.current = controller;
      if (replacing && assetIds.length > 0) await removeSpin(assetIds);
      await uploadSpin(vehicleId, next.frames, {
        onProgress: setUploaded,
        signal: controller.signal,
      });
    },
    onSuccess: () => {
      toast.success(replacing ? '360° spin replaced' : '360° spin saved');
      setDraft(null);
      setReplacing(false);
    },
    onError: (error) => {
      // A replacement clears the old spin first, so there is nothing left to
      // keep; the draft stays, ready to try again.
      const cleared = replacing ? ' The earlier spin had already been cleared to make room.' : '';
      if (isAbortError(error)) toast(`Upload cancelled.${cleared || ' Nothing was saved.'}`);
      else {
        toast.error('Could not save the 360° spin', {
          description: `${errorMessage(error)}${cleared}`,
        });
      }
      setReplacing(false);
    },
    onSettled: () => {
      upload.current = null;
      setUploaded(0);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: () => removeSpin(assetIds),
    onSuccess: () => toast.success('360° spin removed'),
    onError: (error) =>
      toast.error('Could not remove the 360° spin', { description: errorMessage(error) }),
    // Either way: a partial removal must show what is actually left.
    onSettled: invalidate,
  });

  const hasSpin = spin.assets.length > 0;
  const capturing = canUpload && (!hasSpin || replacing);
  const percent = Math.round(uploaded * 100);

  const stopReplacing = (): void => {
    setReplacing(false);
    setDraft(null);
  };

  let main: React.ReactNode;
  let aside: React.ReactNode = null;

  if (spin.status === 'loading') {
    main = <div className="aspect-[4/3] animate-pulse rounded-xl bg-muted" aria-hidden />;
  } else if (spin.status === 'error' || (hasSpin && !capturing && sources.failed)) {
    main = (
      <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-border px-4 text-center">
        <p className="text-xs text-muted-foreground">The 360° spin could not be loaded.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={spin.status === 'error' ? spin.refetch : sources.retry}
        >
          Try again
        </Button>
      </div>
    );
  } else if (capturing) {
    main = (
      <div className="flex h-full flex-col gap-2.5">
        <SpinCapture
          value={draft}
          onChange={setDraft}
          label={label}
          disabled={save.isPending}
          withGuide={false}
          className="flex-1"
        />
        {draft ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => save.mutate(draft)} loading={save.isPending}>
                {save.isPending
                  ? `Uploading… ${percent}%`
                  : replacing
                    ? 'Replace spin'
                    : 'Save 360° spin'}
              </Button>
              {save.isPending ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => upload.current?.abort()}
                >
                  Cancel
                </Button>
              ) : replacing ? (
                <p className="text-xs text-muted-foreground">Saving replaces the current spin.</p>
              ) : null}
            </div>
            {save.isPending ? <Progress value={percent} className="h-1" /> : null}
          </div>
        ) : null}
      </div>
    );
    aside = <SpinShootingGuide className="h-full" />;
  } else if (hasSpin) {
    main = <SpinViewer frames={sources.frames} resolveHiRes={sources.resolveHiRes} label={label} />;
    aside = (
      <SpinDetails
        frameCount={spin.assets.length}
        label={label}
        removing={remove.isPending}
        {...(canUpload && canDelete ? { onReplace: () => setReplacing(true) } : {})}
        {...(canDelete ? { onRemove: () => remove.mutateAsync().catch(() => undefined) } : {})}
      />
    );
  } else {
    main = null;
  }

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">360° spin</h4>
          <p className="text-xs text-muted-foreground">
            A walk-around anyone can turn with a drag. Optional.
          </p>
        </div>
        {replacing && !save.isPending ? (
          <Button type="button" variant="ghost" size="sm" onClick={stopReplacing}>
            Keep current spin
          </Button>
        ) : null}
      </div>

      {main === null ? (
        <p className="text-xs text-muted-foreground">No 360° spin yet.</p>
      ) : (
        <div className={cn('grid gap-3', aside && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <div className="min-w-0">{main}</div>
          {aside}
        </div>
      )}
    </section>
  );
}
