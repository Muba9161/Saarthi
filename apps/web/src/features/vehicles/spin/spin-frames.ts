import { MediaPurpose, VEHICLE_SPIN_FRAMES, mediaPurposeDefinition } from '@saarthi/shared';
import { encodeJpeg } from '@/features/media/encode-image';
import {
  type FrameCandidate,
  findLoopClosure,
  pickSharpestPerSlot,
  sharpness,
  toLuma,
} from './frame-analysis';

/**
 * Turning what a phone captures into the frames of a 360° spin.
 *
 * Two sources are accepted, because people have one or the other: a video
 * recorded while walking around the vehicle (the smoothest result), or a
 * handful of photos taken the same way. Either way the work happens here, on
 * the device — a walk-around video is hundreds of megabytes, and the frames
 * chosen from it are all the server ever needs to see.
 *
 * Every frame is produced twice: a full rendition for zooming and full screen,
 * and a small one the page turns through. A spin is looked at far more often
 * than it is zoomed into, so most views never download a full frame at all.
 */

/** Longest edge of a stored frame; read from the catalogue so it cannot drift. */
const FULL_EDGE = mediaPurposeDefinition(MediaPurpose.VEHICLE_SPIN_FRAME).maxDimension;
const FULL_QUALITY = 0.82;
const THUMB_EDGE = 640;
const THUMB_QUALITY = 0.72;
/** Sampled per kept frame, so the sharpest of them can be chosen. */
const CANDIDATES_PER_FRAME = 2;
/** Width of the greyscale sample used to judge sharpness and similarity. */
const ANALYSIS_WIDTH = 96;
/** Shorter than this and the walk cannot have gone all the way round. */
const MIN_VIDEO_SECONDS = 4;
/** How long a browser gets to open the video or reach a frame before we give up. */
const VIDEO_STEP_TIMEOUT_MS = 15_000;
/** Share of the progress bar spent judging candidates, before encoding starts. */
const ANALYSIS_SHARE = 0.55;

export const SPIN_VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm';
export const SPIN_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic';
/** Never uploaded, only read locally — so the cap is about memory, not the API. */
export const SPIN_VIDEO_MAX_MB = 500;
export const SPIN_PHOTO_MAX_MB = 25;

/** One angle of the spin, in both renditions. */
export interface SpinFrame {
  full: Blob;
  thumb: Blob;
}

/** A prepared spin that has not been saved yet. */
export interface SpinDraft {
  frames: SpinFrame[];
  source: 'video' | 'photos';
  /** The video ran past its starting view and was cut where the loop closed. */
  trimmed: boolean;
}

export type SpinPhase = 'opening' | 'analysing' | 'encoding';

/** Reported as frames are prepared; `fraction` covers the whole job, 0 to 1. */
export type SpinProgress = (update: { phase: SpinPhase; fraction: number }) => void;

/** A failure worth showing the user as it is — the message says what to do. */
export class SpinSourceError extends Error {}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Preparing the spin was cancelled.', 'AbortError');
}

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

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const seeked = waitFor(video, 'seeked');
  video.currentTime = time;
  await seeked;
}

/** Both renditions of whatever the source shows right now. */
async function encodeFrame(
  source: CanvasImageSource,
  size: { width: number; height: number },
): Promise<SpinFrame> {
  // Each call draws synchronously before it awaits, so the source may move on
  // (a video seek) as soon as this returns.
  const [full, thumb] = await Promise.all([
    encodeJpeg(source, size, FULL_EDGE, FULL_QUALITY),
    encodeJpeg(source, size, THUMB_EDGE, THUMB_QUALITY),
  ]);
  return { full, thumb };
}

/** A small reusable canvas that turns a frame into a greyscale sample. */
function createSampler(sourceWidth: number, sourceHeight: number) {
  const width = ANALYSIS_WIDTH;
  const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // Read back on every sample; this keeps the canvas on the CPU where that is cheap.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new SpinSourceError('This browser cannot process video frames.');

  return {
    width,
    height,
    sample(source: CanvasImageSource): Float32Array {
      context.drawImage(source, 0, 0, width, height);
      return toLuma(context.getImageData(0, 0, width, height).data);
    },
  };
}

/**
 * The frames of a spin from a walk-around video.
 *
 * Two passes. The first samples twice as many moments as the spin needs, at a
 * postage-stamp size, to judge sharpness and to find where the walk returned
 * to its starting view. The second seeks only to the moments chosen and
 * encodes them properly — so the expensive work is done once per kept frame.
 */
export async function framesFromVideo(
  file: File,
  onProgress?: SpinProgress,
  signal?: AbortSignal,
): Promise<SpinDraft> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    onProgress?.({ phase: 'opening', fraction: 0 });
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
    const total = count * CANDIDATES_PER_FRAME;
    const sampler = createSampler(videoWidth, videoHeight);
    const candidates: FrameCandidate[] = [];
    const samples: Float32Array[] = [];

    for (let index = 0; index < total; index += 1) {
      throwIfAborted(signal);
      // Mid-slot, so the very first and last instants — where the phone is
      // usually still being raised or lowered — are never candidates.
      const time = ((index + 0.5) * duration) / total;
      await seekTo(video, time);
      const sample = sampler.sample(video);
      samples.push(sample);
      candidates.push({ time, sharpness: sharpness(sample, sampler.width, sampler.height) });
      onProgress?.({ phase: 'analysing', fraction: ((index + 1) / total) * ANALYSIS_SHARE });
    }

    const closure = findLoopClosure(samples);
    const end = closure === null ? duration : (candidates[closure]?.time ?? duration);
    const times = pickSharpestPerSlot(
      candidates.filter((candidate) => candidate.time < end),
      0,
      end,
      count,
    );

    const frames: SpinFrame[] = [];
    for (const [index, time] of times.entries()) {
      throwIfAborted(signal);
      await seekTo(video, time);
      frames.push(await encodeFrame(video, { width: videoWidth, height: videoHeight }));
      onProgress?.({
        phase: 'encoding',
        fraction: ANALYSIS_SHARE + ((index + 1) / times.length) * (1 - ANALYSIS_SHARE),
      });
    }

    return { frames, source: 'video', trimmed: closure !== null };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * The frames of a spin from photos taken while walking around the vehicle.
 *
 * Ordered by when each was taken rather than by the order the picker returns
 * them, which varies by browser. The file's modified time is the capture time
 * for anything that came straight off a phone camera.
 */
export async function framesFromPhotos(
  files: File[],
  onProgress?: SpinProgress,
  signal?: AbortSignal,
): Promise<SpinDraft> {
  const { min, max } = VEHICLE_SPIN_FRAMES;
  if (files.length < min) {
    throw new SpinSourceError(
      `Choose at least ${min} photos — front, both sides and the rear at the very least.`,
    );
  }

  const ordered = [...files]
    .sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name))
    .slice(0, max);

  const frames: SpinFrame[] = [];
  for (const [index, file] of ordered.entries()) {
    throwIfAborted(signal);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new SpinSourceError(
        `${file.name} could not be read by this browser. Use JPEG, PNG or WebP photos.`,
      );
    }
    try {
      frames.push(await encodeFrame(bitmap, bitmap));
    } finally {
      bitmap.close();
    }
    onProgress?.({ phase: 'encoding', fraction: (index + 1) / ordered.length });
  }

  return { frames, source: 'photos', trimmed: false };
}

/** Bytes a draft will send, both renditions of every frame. */
export function draftUploadSize(frames: readonly SpinFrame[]): number {
  return frames.reduce((total, frame) => total + frame.full.size + frame.thumb.size, 0);
}
