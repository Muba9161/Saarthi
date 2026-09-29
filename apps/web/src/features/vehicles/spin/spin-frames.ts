import { MediaPurpose, VEHICLE_SPIN_FRAMES, mediaPurposeDefinition } from '@saarthi/shared';
import { encodeJpeg } from '@/features/media/encode-image';

/**
 * Turning what a phone captures into the frames of a 360° spin.
 *
 * Two sources are accepted, because people have one or the other: a video
 * recorded while walking around the vehicle (the smoothest result), or a
 * handful of photos taken the same way. Either way the work happens here, on
 * the device — a walk-around video is hundreds of megabytes, and the frames
 * sampled from it are all the server ever needs to see.
 */

/** Longest edge of a stored frame; read from the catalogue so it cannot drift. */
const FRAME_MAX_EDGE = mediaPurposeDefinition(MediaPurpose.VEHICLE_SPIN_FRAME).maxDimension;
const FRAME_QUALITY = 0.82;
/** Shorter than this and the walk cannot have gone all the way round. */
const MIN_VIDEO_SECONDS = 4;
/** How long a browser gets to open the video or reach a frame before we give up. */
const VIDEO_STEP_TIMEOUT_MS = 15_000;

export const SPIN_VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm';
export const SPIN_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic';
/** Never uploaded, only read locally — so the cap is about memory, not the API. */
export const SPIN_VIDEO_MAX_MB = 500;
export const SPIN_PHOTO_MAX_MB = 25;

/** Reported as frames are prepared, from 0 to 1. */
export type SpinProgress = (fraction: number) => void;

/** A failure worth showing the user as it is — the message says what to do. */
export class SpinSourceError extends Error {}

function waitFor(target: HTMLVideoElement, event: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new SpinSourceError('The video took too long to read. Try a shorter recording.'));
    }, VIDEO_STEP_TIMEOUT_MS);
    const onDone = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(
        new SpinSourceError(
          'This browser cannot read that video. Record it again in the phone’s standard (H.264 / “Most compatible”) format, or choose photos instead.',
        ),
      );
    };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onDone);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onDone, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

/** Sample evenly spaced frames across a walk-around video. */
export async function framesFromVideo(file: File, onProgress?: SpinProgress): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    const opened = waitFor(video, 'loadedmetadata');
    video.src = url;
    await opened;

    const { duration, videoWidth, videoHeight } = video;
    if (!Number.isFinite(duration) || videoWidth === 0 || videoHeight === 0) {
      throw new SpinSourceError('That video has no readable length. Try recording it again.');
    }
    if (duration < MIN_VIDEO_SECONDS) {
      throw new SpinSourceError(
        `That video is under ${MIN_VIDEO_SECONDS} seconds — walk slowly all the way round the vehicle.`,
      );
    }

    /*
     * iOS Safari will not decode a frame for seeking until playback has begun
     * once. A muted inline video is allowed to start without a gesture; where a
     * browser refuses anyway, seeking below still works on its own, so the
     * refusal is not an error worth surfacing.
     */
    await video.play().catch(() => undefined);
    video.pause();

    const count = VEHICLE_SPIN_FRAMES.max;
    const frames: Blob[] = [];
    for (let index = 0; index < count; index += 1) {
      // Mid-slot rather than slot start, so the very first and last instants —
      // where the phone is usually still being raised or lowered — are skipped.
      const seeked = waitFor(video, 'seeked');
      video.currentTime = ((index + 0.5) * duration) / count;
      await seeked;
      frames.push(
        await encodeJpeg(
          video,
          { width: videoWidth, height: videoHeight },
          FRAME_MAX_EDGE,
          FRAME_QUALITY,
        ),
      );
      onProgress?.((index + 1) / count);
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Frames from photos taken while walking around the vehicle.
 *
 * Ordered by when each was taken rather than by the order the picker returns
 * them, which varies by browser. The file's modified time is the capture time
 * for anything that came straight off a phone camera.
 */
export async function framesFromPhotos(files: File[], onProgress?: SpinProgress): Promise<Blob[]> {
  const { min, max } = VEHICLE_SPIN_FRAMES;
  if (files.length < min) {
    throw new SpinSourceError(
      `Choose at least ${min} photos — front, both sides and the rear at the very least.`,
    );
  }

  const ordered = [...files]
    .sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name))
    .slice(0, max);

  const frames: Blob[] = [];
  for (const [index, file] of ordered.entries()) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new SpinSourceError(
        `${file.name} could not be read by this browser. Use JPEG, PNG or WebP photos.`,
      );
    }
    try {
      frames.push(await encodeJpeg(bitmap, bitmap, FRAME_MAX_EDGE, FRAME_QUALITY));
    } finally {
      bitmap.close();
    }
    onProgress?.((index + 1) / ordered.length);
  }
  return frames;
}
