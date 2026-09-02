import * as React from 'react';
import { Camera, CameraOff, Flashlight, Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A camera viewfinder that reads QR codes.
 *
 * Written because the alternative — "point your phone's camera app at the
 * sticker" — is not a flow, it is a hope. It requires the driver to leave
 * Saarthi, trust the OS to offer a link preview, tap it, land in whichever
 * browser the OS prefers, and be signed in *there*. On a work phone with two
 * browsers that last step fails silently: the scan resolves, the page loads,
 * and the sign-on card simply is not rendered because that browser has no
 * session. The driver sees a vehicle they cannot sign on to and no explanation.
 *
 * Two decoders, chosen at runtime:
 *
 *   * `BarcodeDetector` where it exists — Chrome and Edge on Android, which is
 *     what most Indian fleet drivers are holding. It decodes on the compositor
 *     thread and costs nothing to ship.
 *   * `jsQR` everywhere else — iOS Safari and Firefox have no detector at all.
 *     Loaded only when needed, so the common case never downloads it.
 *
 * The scan loop is deliberately throttled. A QR fills the frame or it does not;
 * decoding every animation frame drains a battery the driver may need for the
 * rest of a shift, and eight attempts a second is already faster than a human
 * can steady a phone.
 */

/** Minimal shape of the detector, which TypeScript's DOM lib does not declare. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** Between decode attempts. ~8 a second: responsive, and not a battery drain. */
const SCAN_INTERVAL_MS = 120;

type ScannerStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'denied'
  | 'unavailable'
  | 'insecure'
  | 'failed';

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * getUserMedia is only exposed on a secure origin.
 *
 * Worth naming separately: over plain HTTP the API is not merely denied, it is
 * `undefined`, and reporting that as "camera unavailable" sends somebody
 * looking for a hardware fault instead of at the address bar. Common enough on
 * a LAN IP during testing to deserve its own message.
 */
function secureEnough(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export interface QrCameraScannerProps {
  /** Called with the raw decoded text. The caller decides what it means. */
  onDecode: (value: string) => void;
  /**
   * Stop scanning without tearing the camera down — used while the caller
   * shows the result of a scan, so a code still in frame is not read twice.
   */
  paused?: boolean;
  className?: string;
}

export function QrCameraScanner({
  onDecode,
  paused = false,
  className,
}: QrCameraScannerProps): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const [status, setStatus] = React.useState<ScannerStatus>('idle');
  const [failure, setFailure] = React.useState<string | null>(null);
  const [torchOn, setTorchOn] = React.useState(false);
  const [torchable, setTorchable] = React.useState(false);

  /*
   * The callback is held in a ref rather than listed as an effect dependency.
   * A parent that rebuilds `onDecode` each render — which is the normal way to
   * write one — would otherwise stop and restart the camera on every render,
   * and a viewfinder that flickers black while a driver is lining up a sticker
   * is worse than useless.
   */
  const onDecodeRef = React.useRef(onDecode);
  React.useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const pausedRef = React.useRef(paused);
  React.useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  React.useEffect(() => {
    if (!secureEnough()) {
      setStatus('insecure');
      return undefined;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return undefined;
    }

    let cancelled = false;
    let decode: ((source: HTMLVideoElement) => Promise<string | null>) | null = null;

    async function buildDecoder(): Promise<(source: HTMLVideoElement) => Promise<string | null>> {
      const Ctor = detectorCtor();
      if (Ctor) {
        const detector = new Ctor({ formats: ['qr_code'] });
        return async (source) => {
          const found = await detector.detect(source);
          return found[0]?.rawValue ?? null;
        };
      }

      // No detector: fall back to decoding pixels ourselves.
      const { default: jsQR } = await import('jsqr');
      return async (source) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !context || !source.videoWidth) return null;

        /*
         * Decode at a capped width. A 1080p frame is four times the pixels of a
         * 540px one and jsQR is pure JavaScript on the main thread — at full
         * resolution the viewfinder visibly stutters on the mid-range Androids
         * this is for, and a QR that fills a third of the frame is still far
         * above the resolution the decoder needs.
         */
        const scale = Math.min(1, 540 / source.videoWidth);
        canvas.width = Math.round(source.videoWidth * scale);
        canvas.height = Math.round(source.videoHeight * scale);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        })?.data ?? null;
      };
    }

    async function start(): Promise<void> {
      setStatus('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera. A driver photographing a windscreen sticker with
          // the selfie camera is not a case worth supporting by default.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS refuses to play an inline video without both of these, and
          // fails by showing a black rectangle rather than by throwing.
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => undefined);
        }

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchable(Boolean(capabilities?.torch));

        decode = await buildDecoder();
        if (cancelled) return;
        setStatus('scanning');

        const tick = async (): Promise<void> => {
          if (cancelled) return;
          const video = videoRef.current;
          if (video && decode && !pausedRef.current && video.readyState >= 2) {
            try {
              const value = await decode(video);
              if (value && !cancelled && !pausedRef.current) {
                onDecodeRef.current(value);
              }
            } catch {
              // A single failed frame is ordinary — a hand moved, the lens was
              // refocusing. Dropping it and trying again is the whole recovery.
            }
          }
          if (!cancelled) {
            timerRef.current = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
          }
        };
        void tick();
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable');
        } else {
          setFailure(error instanceof Error ? error.message : 'The camera could not be started.');
          setStatus('failed');
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      // Releasing the track is what turns the phone's camera light off. Left
      // running it looks, correctly, like the app is still watching.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleTorch = React.useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Some Androids advertise torch and then refuse it. Nothing to say —
      // the button simply does not latch.
      setTorchable(false);
    }
  }, [torchOn]);

  if (status === 'insecure') {
    return (
      <Alert variant="warning">
        <ShieldAlert />
        <AlertTitle>The camera needs a secure connection</AlertTitle>
        <AlertDescription>
          Browsers only allow camera access over HTTPS. Open Saarthi on its https:// address, or
          type the code below instead.
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'denied' || status === 'unavailable' || status === 'failed') {
    return (
      <Alert variant="warning">
        <CameraOff />
        <AlertTitle>
          {status === 'denied'
            ? 'Camera permission was refused'
            : status === 'unavailable'
              ? 'No camera available'
              : 'The camera could not be started'}
        </AlertTitle>
        <AlertDescription>
          {status === 'denied'
            ? 'Allow camera access for this site in your browser settings, then reload. You can also type the code printed under the QR.'
            : failure ?? 'Type the code printed under the QR instead.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className={cn(
        'relative aspect-square w-full overflow-hidden rounded-xl border bg-black',
        className,
      )}
    >
      <video
        ref={videoRef}
        className="size-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label="Camera viewfinder"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* The frame a driver aims with. Corners only — a full box hides the code. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            'relative size-[62%] rounded-lg transition-opacity',
            paused ? 'opacity-30' : 'opacity-100',
          )}
        >
          {(
            [
              'left-0 top-0 border-l-2 border-t-2 rounded-tl-lg',
              'right-0 top-0 border-r-2 border-t-2 rounded-tr-lg',
              'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
              'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
            ] as const
          ).map((corner) => (
            <span key={corner} className={cn('absolute size-8 border-white/90', corner)} />
          ))}
        </div>
      </div>

      {status === 'starting' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm text-white">
          <Loader2 className="size-5 animate-spin" />
          Starting the camera…
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-white/90">
          <Camera className="size-3.5" />
          Hold the vehicle QR inside the frame
        </p>
        {torchable ? (
          <Button
            type="button"
            size="sm"
            variant={torchOn ? 'default' : 'secondary'}
            onClick={() => void toggleTorch()}
          >
            <Flashlight className="mr-1.5 size-3.5" />
            {torchOn ? 'Light on' : 'Light'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default QrCameraScanner;
