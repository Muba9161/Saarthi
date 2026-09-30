import * as React from 'react';
import { ArrowLeftRight, Flag, RotateCcw, Scissors, Sparkles, X } from 'lucide-react';
import { VEHICLE_SPIN_FRAMES } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reverseTurn, reversedIndex, startAt, withoutFrame } from './frame-order';
import { type SpinDraft, draftUploadSize } from './spin-frames';
import { SpinViewer } from './spin-viewer';
import { useBlobUrls } from './use-spin-frames';

function readableSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A prepared spin, turned and tidied before it is saved.
 *
 * The fixes offered are the ones a walk-around actually needs: open on the
 * right side of the vehicle (people rarely start filming at the front), turn
 * the other way (people walk both ways round), and drop the odd frame with a
 * passer-by or a thumb in it. Everything is done on the frames already made —
 * nothing is re-processed and nothing is uploaded until the caller saves.
 */
export function SpinEditor({
  draft,
  onChange,
  onDiscard,
  label,
  disabled = false,
  className,
}: {
  draft: SpinDraft;
  onChange: (draft: SpinDraft) => void;
  onDiscard: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [current, setCurrent] = React.useState(0);
  const thumbs = useBlobUrls(React.useMemo(() => draft.frames.map((f) => f.thumb), [draft.frames]));
  const fulls = useBlobUrls(React.useMemo(() => draft.frames.map((f) => f.full), [draft.frames]));
  const strip = React.useRef<HTMLDivElement>(null);

  const resolveHiRes = React.useCallback(
    (index: number): Promise<string> => {
      const url = fulls[index];
      return url ? Promise.resolve(url) : Promise.reject(new Error('No such frame.'));
    },
    [fulls],
  );

  // Keep the filmstrip's current frame centred as the spin is turned — by
  // scrolling the strip alone, never the page it sits in.
  React.useEffect(() => {
    const box = strip.current;
    const tile = box?.querySelector<HTMLElement>(`[data-frame="${current}"]`);
    if (!box || !tile) return;
    box.scrollLeft = tile.offsetLeft - box.clientWidth / 2 + tile.clientWidth / 2;
  }, [current]);

  const count = draft.frames.length;
  const canDrop = count > VEHICLE_SPIN_FRAMES.min;
  const update = (frames: SpinDraft['frames'], nextIndex: number): void => {
    onChange({ ...draft, frames });
    setCurrent(nextIndex);
  };

  return (
    <div className={cn('space-y-2.5', className)}>
      <SpinViewer
        frames={thumbs}
        resolveHiRes={resolveHiRes}
        label={label}
        index={current}
        onIndexChange={setCurrent}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update(startAt(draft.frames, current), 0)}
          disabled={disabled || current === 0}
          title="Make the angle on screen the one the spin opens on"
        >
          <Flag className="size-3.5" aria-hidden />
          Set as front
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update(reverseTurn(draft.frames), reversedIndex(current, count))}
          disabled={disabled || count < 3}
          title="Turn the other way round"
        >
          <ArrowLeftRight className="size-3.5" aria-hidden />
          Reverse
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update(withoutFrame(draft.frames, current), Math.min(current, count - 2))}
          disabled={disabled || !canDrop}
          title={
            canDrop
              ? 'Remove the frame on screen'
              : `A spin needs at least ${VEHICLE_SPIN_FRAMES.min} frames`
          }
        >
          <X className="size-3.5" aria-hidden />
          Drop frame
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={disabled}
          className="ml-auto"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Start over
        </Button>
      </div>

      {/* Every frame at a glance — the quickest way to spot the one with a person in it. */}
      <div
        ref={strip}
        className="relative flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
        role="group"
        aria-label="Frames"
      >
        {thumbs.map((src, index) => (
          <button
            key={src}
            type="button"
            data-frame={index}
            onClick={() => setCurrent(index)}
            aria-label={`Frame ${index + 1} of ${count}${index === 0 ? ', front' : ''}`}
            aria-pressed={index === current}
            className={cn(
              'relative aspect-[4/3] w-14 shrink-0 overflow-hidden rounded-md border transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              index === current
                ? 'border-primary ring-1 ring-primary'
                : 'border-border opacity-70 hover:opacity-100',
            )}
          >
            <img src={src} alt="" className="size-full object-cover" draggable={false} />
            {index === 0 ? (
              <Flag
                className="absolute left-0.5 top-0.5 size-3 rounded-sm bg-black/55 p-px text-white"
                aria-hidden
              />
            ) : null}
          </button>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {count} frames · {readableSize(draftUploadSize(draft.frames))} to upload
        </span>
        {draft.source === 'video' ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3 text-primary" aria-hidden />
            Sharpest frame kept from each step
          </span>
        ) : null}
        {draft.trimmed ? (
          <span className="inline-flex items-center gap-1">
            <Scissors className="size-3 text-primary" aria-hidden />
            Trimmed to exactly one turn
          </span>
        ) : null}
      </p>
    </div>
  );
}
