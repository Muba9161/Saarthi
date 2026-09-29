import * as React from 'react';
import { toast } from 'sonner';
import { Images, RotateCcw, Video } from 'lucide-react';
import { VEHICLE_SPIN_FRAMES } from '@saarthi/shared';
import { FileDropzone } from '@/components/common/file-dropzone';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  SPIN_PHOTO_ACCEPT,
  SPIN_PHOTO_MAX_MB,
  SPIN_VIDEO_ACCEPT,
  SPIN_VIDEO_MAX_MB,
  SpinSourceError,
  framesFromPhotos,
  framesFromVideo,
} from './spin-frames';
import { OrbitGuide } from './spin-guide';
import { SpinViewer } from './spin-viewer';
import { useBlobUrls } from './use-spin-frames';

/**
 * The optional ask for a 360° spin, and the frames it produces.
 *
 * Always optional: nothing downstream waits on a spin, and the ordinary photos
 * stay the record of the vehicle whether or not one is added. It offers the two
 * things people actually have — a walk-around video, or a few photos taken the
 * same way — and shows the result as it will be seen before anything is saved,
 * because a spin with the vehicle drifting out of frame is only obvious once
 * you turn it.
 *
 * Like `ImageDropField` it holds no upload of its own: the caller owns the
 * frames and decides when they go up, which on an add form is only once the
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
  value: Blob[] | null;
  onChange: (frames: Blob[] | null) => void;
  /** The vehicle, for the preview's accessible name. */
  label: string;
  disabled?: boolean;
  withGuide?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = React.useState<number | null>(null);
  const preview = useBlobUrls(value);
  // Preparing a video takes seconds; the form may be closed in the meantime.
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prepare = async (work: (report: (fraction: number) => void) => Promise<Blob[]>) => {
    setProgress(0);
    try {
      const frames = await work((fraction) => {
        if (mounted.current) setProgress(fraction);
      });
      if (mounted.current) onChange(frames);
    } catch (error) {
      toast.error('Could not make the 360° spin', {
        description:
          error instanceof SpinSourceError ? error.message : 'Try again, or choose photos instead.',
      });
    } finally {
      if (mounted.current) setProgress(null);
    }
  };

  const { min, max } = VEHICLE_SPIN_FRAMES;
  const preparing = progress !== null;
  const onReject = (reason: string): void => void toast.error(reason);

  if (value && preview.length > 0) {
    return (
      <div className={cn('space-y-2', className)}>
        <SpinViewer frames={preview} label={label} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {value.length} frames · drag to check the vehicle stays in view
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Start over
          </Button>
        </div>
      </div>
    );
  }

  const pickers = preparing ? (
    <div
      className={cn(
        'flex flex-col justify-center gap-1.5',
        !withGuide &&
          'h-full min-h-44 rounded-xl border border-dashed border-border-strong/70 px-6',
      )}
      role="status"
    >
      <Progress value={progress * 100} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        Preparing frames… {Math.round(progress * 100)}%
      </p>
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
        onFiles={([file]) => file && void prepare((report) => framesFromVideo(file, report))}
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
        onFiles={(files) => void prepare((report) => framesFromPhotos(files, report))}
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
