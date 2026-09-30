import * as React from 'react';
import { toast } from 'sonner';
import { Images, Video } from 'lucide-react';
import { VEHICLE_SPIN_FRAMES } from '@saarthi/shared';
import { FileDropzone } from '@/components/common/file-dropzone';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { isAbortError } from './spin-api';
import { SpinEditor } from './spin-editor';
import {
  SPIN_PHOTO_ACCEPT,
  SPIN_PHOTO_MAX_MB,
  SPIN_VIDEO_ACCEPT,
  SPIN_VIDEO_MAX_MB,
  type SpinDraft,
  type SpinPhase,
  type SpinProgress,
  SpinSourceError,
  framesFromPhotos,
  framesFromVideo,
} from './spin-frames';
import { OrbitGuide } from './spin-guide';

const PHASE_LABEL: Record<SpinPhase, string> = {
  opening: 'Opening the video…',
  analysing: 'Finding the sharpest frames…',
  encoding: 'Preparing frames…',
};

/**
 * The optional ask for a 360° spin, and the draft it produces.
 *
 * Always optional: nothing downstream waits on a spin, and the ordinary photos
 * stay the record of the vehicle whether or not one is added. It offers the two
 * things people actually have — a walk-around video, or a few photos taken the
 * same way — and once they are prepared hands over to `SpinEditor`, so the
 * result is turned and tidied before anything is saved.
 *
 * Like `ImageDropField` it holds no upload of its own: the caller owns the
 * draft and decides when it goes up, which on an add form is only once the
 * vehicle exists.
 *
 * `withGuide={false}` drops the short instructions and makes the two pickers
 * full-height tiles, for a caller that shows `SpinShootingGuide` beside it.
 */
export function SpinCapture({
  value,
  onChange,
  label,
  disabled = false,
  withGuide = true,
  className,
}: {
  value: SpinDraft | null;
  onChange: (draft: SpinDraft | null) => void;
  /** The vehicle, for the preview's accessible name. */
  label: string;
  disabled?: boolean;
  withGuide?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = React.useState<{ phase: SpinPhase; fraction: number } | null>(
    null,
  );
  const job = React.useRef<AbortController | null>(null);

  // Preparing a video takes seconds; the form may close before it finishes.
  React.useEffect(() => () => job.current?.abort(), []);

  const prepare = async (
    work: (report: SpinProgress, signal: AbortSignal) => Promise<SpinDraft>,
  ): Promise<void> => {
    const controller = new AbortController();
    job.current = controller;
    setProgress({ phase: 'opening', fraction: 0 });
    try {
      const draft = await work((update) => {
        if (!controller.signal.aborted) setProgress(update);
      }, controller.signal);
      if (!controller.signal.aborted) onChange(draft);
    } catch (error) {
      if (!isAbortError(error)) {
        toast.error('Could not make the 360° spin', {
          description:
            error instanceof SpinSourceError
              ? error.message
              : 'Try again, or choose photos instead.',
        });
      }
    } finally {
      if (job.current === controller) {
        job.current = null;
        setProgress(null);
      }
    }
  };

  if (value) {
    return (
      <SpinEditor
        draft={value}
        onChange={onChange}
        onDiscard={() => onChange(null)}
        label={label}
        disabled={disabled}
        className={className}
      />
    );
  }

  const { min, max } = VEHICLE_SPIN_FRAMES;
  const onReject = (reason: string): void => void toast.error(reason);

  const pickers = progress ? (
    <div
      className={cn(
        'flex flex-col justify-center gap-2',
        !withGuide &&
          'h-full min-h-44 rounded-xl border border-dashed border-border-strong/70 px-6',
      )}
      role="status"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{PHASE_LABEL[progress.phase]}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {Math.round(progress.fraction * 100)}%
        </span>
      </div>
      <Progress value={progress.fraction * 100} className="h-1.5" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => job.current?.abort()}
      >
        Cancel
      </Button>
    </div>
  ) : (
    <div className={cn('grid gap-2.5 sm:grid-cols-2', !withGuide && 'h-full')}>
      <FileDropzone
        compact={withGuide}
        accept={SPIN_VIDEO_ACCEPT}
        maxSizeMb={SPIN_VIDEO_MAX_MB}
        disabled={disabled}
        icon={Video}
        title="Walk-around video"
        hint={withGuide ? 'Best result' : 'Best result · MP4, MOV or WebM'}
        onReject={onReject}
        onFiles={([file]) =>
          file && void prepare((report, signal) => framesFromVideo(file, report, signal))
        }
        className={cn(!withGuide && 'h-full min-h-44')}
      />
      <FileDropzone
        compact={withGuide}
        multiple
        accept={SPIN_PHOTO_ACCEPT}
        maxSizeMb={SPIN_PHOTO_MAX_MB}
        maxFiles={max}
        disabled={disabled}
        icon={Images}
        title="Choose photos"
        hint={`${min}–${max}, in walking order`}
        onReject={onReject}
        onFiles={(files) =>
          void prepare((report, signal) => framesFromPhotos(files, report, signal))
        }
        className={cn(!withGuide && 'h-full min-h-44')}
      />
    </div>
  );

  if (!withGuide) return <div className={cn('h-full', className)}>{pickers}</div>;

  return (
    <div className={cn('glass-inset space-y-3 p-3.5', className)}>
      <div className="flex items-start gap-3">
        <OrbitGuide />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            Add a 360° spin{' '}
            <span className="text-xs font-normal text-muted-foreground">· optional</span>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Stand about two metres away and walk one slow circle round the vehicle, keeping it in
            the middle of the frame. A 20–40 second video gives the smoothest turn; {min} to {max}{' '}
            photos taken every few steps work too.
          </p>
        </div>
      </div>
      {pickers}
    </div>
  );
}
