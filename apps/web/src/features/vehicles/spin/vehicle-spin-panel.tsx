import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Keyboard, Maximize2, MoveHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { SpinCapture } from './spin-capture';
import { OrbitGuide, SpinShootingGuide } from './spin-guide';
import { SpinViewer } from './spin-viewer';
import { removeSpin, spinQueryKey, uploadSpin } from './spin-api';
import { useVehicleSpin } from './use-spin-frames';

/**
 * A vehicle's 360° spin, in its Photos tab: turned if there is one, offered if
 * there is not.
 *
 * One spin per vehicle. Replacing it is "remove, then add" rather than an
 * overwrite, so a new walk-around that fails to upload never costs the one
 * that was already there.
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
  const [draft, setDraft] = React.useState<Blob[] | null>(null);
  const [uploaded, setUploaded] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);

  const invalidate = (): void =>
    void queryClient.invalidateQueries({ queryKey: spinQueryKey(vehicleId) });

  const save = useMutation({
    mutationFn: (frames: Blob[]) => uploadSpin(vehicleId, frames, setUploaded),
    onSuccess: () => {
      toast.success('360° spin saved');
      setDraft(null);
      invalidate();
    },
    onError: (error) =>
      toast.error('Could not save the 360° spin', { description: errorMessage(error) }),
    onSettled: () => setUploaded(0),
  });

  const remove = useMutation({
    mutationFn: () => removeSpin(spin.assets.map((asset) => asset.id)),
    onSuccess: () => toast.success('360° spin removed'),
    onError: (error) =>
      toast.error('Could not remove the 360° spin', { description: errorMessage(error) }),
    // Either way: a partial removal must show what is actually left.
    onSettled: invalidate,
  });

  const hasSpin = spin.assets.length > 0;
  const ready = spin.status === 'ready';

  const main = ready ? (
    <SpinViewer frames={spin.frames} label={label} />
  ) : spin.status === 'loading' ? (
    <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted">
      {hasSpin ? (
        <>
          <Progress value={spin.loaded * 100} className="h-1.5 w-32" />
          <p className="text-xs text-muted-foreground">Loading the spin…</p>
        </>
      ) : null}
    </div>
  ) : spin.status === 'error' ? (
    <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-border px-4 text-center">
      <p className="text-xs text-muted-foreground">The 360° spin could not be loaded.</p>
      <Button type="button" variant="outline" size="sm" onClick={spin.refetch}>
        Try again
      </Button>
    </div>
  ) : canUpload ? (
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
        <div className="space-y-1.5">
          <Button
            type="button"
            onClick={() => save.mutate(draft)}
            loading={save.isPending}
            className="w-full sm:w-auto"
          >
            {save.isPending ? `Uploading… ${Math.round(uploaded * 100)}%` : 'Save 360° spin'}
          </Button>
          {save.isPending ? <Progress value={uploaded * 100} className="h-1" /> : null}
        </div>
      ) : null}
    </div>
  ) : null;

  // Beside the spin: what it is and what can be done with it. Beside the
  // uploader: how to shoot one, which is where a good spin is actually decided.
  const aside = hasSpin ? (
    <div className="glass-inset flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <OrbitGuide className="size-14" />
        <div>
          <p className="text-sm font-medium">{spin.assets.length} frames · one full turn</p>
          <p className="text-xs text-muted-foreground">Of {label}, as it was walked round.</p>
        </div>
      </div>

      <ul className="space-y-2.5 text-xs text-muted-foreground">
        <li className="flex items-center gap-2.5">
          <MoveHorizontal className="size-3.5 shrink-0 text-primary" aria-hidden />
          Drag or swipe sideways to turn the vehicle.
        </li>
        <li className="flex items-center gap-2.5">
          <Keyboard className="size-3.5 shrink-0 text-primary" aria-hidden />
          Arrow keys step it one frame at a time.
        </li>
        {canDelete ? (
          <li className="flex items-center gap-2.5">
            <RotateCcw className="size-3.5 shrink-0 text-primary" aria-hidden />
            To reshoot, remove this spin and add a new one.
          </li>
        ) : null}
      </ul>

      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
          disabled={!ready}
        >
          <Maximize2 className="size-3.5" aria-hidden />
          Full screen
        </Button>
        {canDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove.mutate()}
            loading={remove.isPending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  ) : canUpload && spin.status === 'empty' ? (
    <SpinShootingGuide className="h-full" />
  ) : null;

  return (
    <section className="space-y-2.5">
      <div>
        <h4 className="text-sm font-medium">360° spin</h4>
        <p className="text-xs text-muted-foreground">
          A walk-around anyone can turn with a drag. Optional.
        </p>
      </div>

      {main === null ? (
        <p className="text-xs text-muted-foreground">No 360° spin yet.</p>
      ) : (
        <div className={cn('grid gap-3', aside && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <div className="min-w-0">{main}</div>
          {aside}
        </div>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>360° spin</DialogTitle>
            <DialogDescription>
              {label} · drag, or use the arrow keys, to walk round the vehicle.
            </DialogDescription>
          </DialogHeader>
          {expanded && spin.status === 'ready' ? (
            <SpinViewer frames={spin.frames} label={label} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
