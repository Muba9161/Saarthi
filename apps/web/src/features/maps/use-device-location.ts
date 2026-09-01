import * as React from 'react';
import { haversineDistance, type LatLng } from '@saarthi/shared';

/**
 * The browser's own position, tracked continuously.
 *
 * Screens that answer "what is around me" must not wait for the operator to
 * press a button first — the answer is wrong until the position is known. So
 * this starts a `watchPosition` as soon as it is enabled and keeps it running,
 * which is also what makes turn-by-turn guidance count down instead of sitting
 * frozen on the first fix.
 *
 * Two honesty rules:
 *
 *  * A denied or unavailable permission is reported as such and never papered
 *    over with a default city — a driver shown the wrong city's fuel stations is
 *    worse off than one told location is off.
 *  * `speedKph` is the device's own reading where it publishes one. Where it does
 *    not (most desktop browsers report `null`), it is derived from consecutive
 *    fixes and flagged as derived, so a caller can say which it is.
 */

export interface DeviceLocation extends LatLng {
  /** Horizontal accuracy in metres, as reported. */
  accuracyMeters: number | null;
  /** Ground speed in km/h, or null when neither reported nor derivable. */
  speedKph: number | null;
  /** Where the speed came from — the device, or two consecutive fixes. */
  speedSource: 'device' | 'derived' | null;
  /** Course over ground in degrees, or null when the device reports none. */
  headingDegrees: number | null;
  /** Epoch milliseconds of the fix. */
  timestamp: number;
}

export type DeviceLocationStatus =
  | 'idle'
  | 'unsupported'
  | 'locating'
  | 'tracking'
  | 'denied'
  | 'error';

export interface DeviceLocationState {
  position: DeviceLocation | null;
  status: DeviceLocationStatus;
  /** Human-readable failure, ready to show. Null while things are working. */
  error: string | null;
  supported: boolean;
  /** True while a watch is running. */
  tracking: boolean;
  /** Start (or restart) tracking — used by a "use my location" control. */
  start: () => void;
  stop: () => void;
}

export interface UseDeviceLocationOptions {
  /** Off until the caller is allowed to ask — permissions, entitlements. */
  enabled?: boolean;
  highAccuracy?: boolean;
  /** How old a cached fix may be before the device must take a new one. */
  maximumAgeMs?: number;
  timeoutMs?: number;
}

/** Below this the reading is GPS noise rather than movement, whatever the accuracy. */
const MIN_DERIVED_MOVE_METERS = 3;
/** Outside this window two fixes are too far apart to derive a speed from. */
const MIN_DERIVED_GAP_MS = 400;
const MAX_DERIVED_GAP_MS = 30_000;
/**
 * Ceiling on a derived speed, in km/h.
 *
 * A positioning system re-anchoring — wifi to GPS, or one cell tower to the
 * next — moves the reported point hundreds of metres in a second. That is a
 * jump, not driving, and no figure is better than an impossible one.
 */
const MAX_DERIVED_KPH = 200;

function messageFor(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission is blocked. Allow it in your browser to see what is around you.';
    case error.POSITION_UNAVAILABLE:
      return 'Your device could not get a position fix. Move somewhere with a clearer sky view.';
    case error.TIMEOUT:
      return 'Getting your location took too long. Trying again.';
    default:
      return error.message || 'Your location could not be read.';
  }
}

export function useDeviceLocation(
  options: UseDeviceLocationOptions = {},
): DeviceLocationState {
  const { enabled = true, highAccuracy = true, maximumAgeMs = 5_000, timeoutMs = 15_000 } = options;

  const supported =
    typeof navigator !== 'undefined' && typeof navigator.geolocation?.watchPosition === 'function';

  const [position, setPosition] = React.useState<DeviceLocation | null>(null);
  const [status, setStatus] = React.useState<DeviceLocationStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  /** Bumped by `start()` to re-enter the watch effect after a stop or a denial. */
  const [attempt, setAttempt] = React.useState(0);
  const [wanted, setWanted] = React.useState(enabled);

  React.useEffect(() => {
    setWanted(enabled);
  }, [enabled]);

  // The previous fix, kept for deriving a speed the device did not report.
  const previous = React.useRef<DeviceLocation | null>(null);

  React.useEffect(() => {
    if (!wanted) return undefined;
    if (!supported) {
      setStatus('unsupported');
      setError('This browser cannot report your location.');
      return undefined;
    }

    setStatus((current) => (current === 'tracking' ? current : 'locating'));

    const handle = navigator.geolocation.watchPosition(
      (fix) => {
        const { coords } = fix;
        const next: DeviceLocation = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
          speedKph: null,
          speedSource: null,
          headingDegrees:
            typeof coords.heading === 'number' && Number.isFinite(coords.heading)
              ? coords.heading
              : null,
          timestamp: fix.timestamp,
        };

        if (typeof coords.speed === 'number' && Number.isFinite(coords.speed) && coords.speed >= 0) {
          next.speedKph = coords.speed * 3.6;
          next.speedSource = 'device';
        } else {
          const last = previous.current;
          const gap = last ? next.timestamp - last.timestamp : 0;
          if (last && gap >= MIN_DERIVED_GAP_MS && gap <= MAX_DERIVED_GAP_MS) {
            const moved = haversineDistance(last, next);

            /**
             * The noise floor is the fixes' own uncertainty, not a fixed number.
             *
             * A wifi-derived position is accurate to tens or hundreds of metres
             * and hops around inside that circle while the device sits still. A
             * hop no larger than the error bars is not evidence of movement, so
             * the honest reading is zero rather than a phantom crawl.
             */
            const uncertainty = Math.max(
              last.accuracyMeters ?? 0,
              next.accuracyMeters ?? 0,
            );
            const noiseFloor = Math.max(MIN_DERIVED_MOVE_METERS, uncertainty);

            if (moved <= noiseFloor) {
              next.speedKph = 0;
              next.speedSource = 'derived';
            } else {
              const kph = (moved / (gap / 1000)) * 3.6;
              // Beyond this the "movement" was a positioning jump, not driving.
              // No reading at all beats a figure a truck could not reach.
              if (kph <= MAX_DERIVED_KPH) {
                next.speedKph = kph;
                next.speedSource = 'derived';
              }
            }
          }
        }

        previous.current = next;
        setPosition(next);
        setStatus('tracking');
        setError(null);
      },
      (failure) => {
        setError(messageFor(failure));
        // A denial is terminal until the operator changes it in the browser; a
        // timeout is not, and `watchPosition` keeps trying on its own.
        setStatus(failure.code === failure.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: highAccuracy, maximumAge: maximumAgeMs, timeout: timeoutMs },
    );

    return () => {
      navigator.geolocation.clearWatch(handle);
    };
  }, [wanted, supported, highAccuracy, maximumAgeMs, timeoutMs, attempt]);

  const start = React.useCallback(() => {
    previous.current = null;
    setError(null);
    setWanted(true);
    setAttempt((value) => value + 1);
  }, []);

  const stop = React.useCallback(() => {
    setWanted(false);
    setStatus('idle');
  }, []);

  return {
    position,
    status,
    error,
    supported,
    tracking: wanted && (status === 'locating' || status === 'tracking'),
    start,
    stop,
  };
}
