import * as React from 'react';
import { Keyboard, MoveHorizontal, RefreshCw, Trash2, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OrbitGuide } from './spin-guide';

const TIPS = [
  { icon: MoveHorizontal, text: 'Drag or swipe to turn — flick it to keep it spinning.' },
  { icon: ZoomIn, text: 'Pinch, double-tap or Ctrl + scroll to look closer.' },
  { icon: Keyboard, text: 'Arrow keys turn · Space plays · F for full screen.' },
] as const;

/**
 * Beside a saved spin: what it is, how to use it, and what can be done to it.
 *
 * Removing asks first. A spin is a minute of somebody walking round a vehicle,
 * and one mis-tap should not be what undoes it.
 */
export function SpinDetails({
  frameCount,
  label,
  onReplace,
  onRemove,
  removing,
}: {
  frameCount: number;
  label: string;
  /** Omitted when the viewer may not replace it. */
  onReplace?: () => void;
  /** Omitted when the viewer may not remove it. */
  onRemove?: () => Promise<unknown>;
  removing: boolean;
}) {
  const [confirming, setConfirming] = React.useState(false);

  return (
    <div className="glass-inset flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <OrbitGuide className="size-14" />
        <div>
          <p className="text-sm font-medium">{frameCount} frames · one full turn</p>
          <p className="text-xs text-muted-foreground">Of {label}, as it was walked round.</p>
        </div>
      </div>

      <ul className="space-y-2.5 text-xs text-muted-foreground">
        {TIPS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2.5">
            <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
            {text}
          </li>
        ))}
      </ul>

      {onReplace || onRemove ? (
        <div className="mt-auto flex flex-wrap gap-2">
          {onReplace ? (
            <Button type="button" variant="outline" size="sm" onClick={onReplace}>
              <RefreshCw className="size-3.5" aria-hidden />
              Replace
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}

      {onRemove ? (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this 360° spin?</AlertDialogTitle>
              <AlertDialogDescription>
                All {frameCount} frames of{' '}
                <span className="font-medium text-foreground">{label}</span>’s spin will be removed.
                The vehicle’s other photos are not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={removing}
                onClick={(event) => {
                  // Held open until the removal settles, rather than closed on click.
                  event.preventDefault();
                  void onRemove().finally(() => setConfirming(false));
                }}
              >
                {removing ? 'Removing…' : 'Remove'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
