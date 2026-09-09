import * as React from 'react';
import { MediaImage } from '@/features/media/media-image';
import { cn } from '@/lib/utils';

/**
 * A vehicle's picture in a card or a detail header.
 *
 * Three sources, tried in order of how specific they are to this vehicle:
 *
 *  1. `photoId` — the vehicle's own photograph, when a caller has one. It is a
 *     media asset under the `VEHICLE_EXTERIOR` purpose, uploaded from the
 *     vehicle's Photos tab. No list endpoint returns one yet — reading it per
 *     card is a request per vehicle and something a forty-card grid cannot
 *     afford — so the parameter is here for the callers that already hold an
 *     id, and so that when a list response grows the field, wiring it up is a
 *     prop and not a redesign.
 *  2. The cut-out artwork for its class, from `/vehicles/` — six side
 *     profiles covering the ten types, so it is coarse in places. See the note
 *     on PHOTO_BY_SILHOUETTE.
 *  3. The drawing below, if that artwork cannot be loaded at all.
 *
 * The drawing is last rather than first because artwork reads as a vehicle at a
 * glance where line art has to be studied. It is kept because it is the only
 * one of the three that is accurate for every type: it is generated from the
 * vehicle's own type, so a tanker is drawn as a tanker even though no tanker
 * artwork exists. Inline SVG rather than an asset, so it inherits the theme
 * through CSS custom properties and costs no request.
 */

/** The silhouettes actually drawn below. */
type Silhouette =
  'truck' | 'trailer' | 'tanker' | 'tipper' | 'van' | 'pickup' | 'car' | 'suv' | 'bus' | 'rickshaw';

/**
 * Vehicle and truck types both land here — a record's shape is described by
 * `vehicleType` on some endpoints and `truckType` on others, and a caller
 * should not have to know which one it is holding.
 */
const SILHOUETTE_BY_TYPE: Record<string, Silhouette> = {
  // VehicleType
  TRUCK: 'truck',
  TAXI: 'car',
  CAR: 'car',
  BUS: 'bus',
  VAN: 'van',
  SUV: 'suv',
  TEMPO: 'van',
  AUTO_RICKSHAW: 'rickshaw',
  PICKUP: 'pickup',
  // TruckType
  OPEN_BODY: 'truck',
  CLOSED_CONTAINER: 'truck',
  TIPPER: 'tipper',
  TRAILER: 'trailer',
  TANKER: 'tanker',
  FLATBED: 'trailer',
  REFRIGERATED: 'truck',
  MINI_TRUCK: 'van',
  MULTI_AXLE: 'trailer',
};

export function silhouetteFor(type: string | null | undefined): Silhouette {
  if (!type) return 'truck';
  return SILHOUETTE_BY_TYPE[type.toUpperCase().replace(/[\s-]/g, '_')] ?? 'truck';
}

/* --- Drawing parts ---------------------------------------------------------
   One coordinate system for every silhouette (160 x 72, facing right, ground
   at y=63) so vehicles of different kinds keep the same visual weight when
   they sit next to each other in a grid. */

const BODY = 'fill-[hsl(var(--card))] stroke-[hsl(var(--foreground)/0.30)]';
const GLASS = 'fill-[hsl(var(--primary)/0.18)] stroke-[hsl(var(--foreground)/0.22)]';
const SEAM = 'stroke-[hsl(var(--foreground)/0.12)]';
const TYRE = 'fill-[hsl(var(--foreground)/0.72)]';
const HUB = 'fill-[hsl(var(--card))]';
const TRIM = 'fill-[hsl(var(--foreground)/0.14)]';

function Wheel({ cx, cy = 54, r = 9 }: { cx: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className={TYRE} />
      <circle cx={cx} cy={cy} r={r * 0.38} className={HUB} />
    </g>
  );
}

/** The chassis rail the wheels hang from. */
function Chassis({ x1, x2, y = 48 }: { x1: number; x2: number; y?: number }) {
  return <rect x={x1} y={y} width={x2 - x1} height="3" rx="1.5" className={TRIM} />;
}

function Truck() {
  return (
    <>
      <Chassis x1={8} x2={148} />
      {/* Cargo box */}
      <rect x="6" y="14" width="92" height="34" rx="3" className={BODY} strokeWidth="2" />
      <path d="M6 22h92" className={SEAM} strokeWidth="2" />
      {/* Cab, with a raked windscreen */}
      <path d="M98 48V20h28l12 10h10v18Z" className={BODY} strokeWidth="2" />
      <path d="M126 21l11 9h-11Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={30} />
      <Wheel cx={54} />
      <Wheel cx={132} />
    </>
  );
}

function Trailer() {
  return (
    <>
      <Chassis x1={6} x2={150} />
      {/* Long deck on a bogie of four */}
      <rect x="4" y="24" width="104" height="24" rx="2" className={BODY} strokeWidth="2" />
      <rect x="4" y="24" width="104" height="6" rx="2" className={TRIM} />
      <path d="M108 48V20h26l12 10h8v18Z" className={BODY} strokeWidth="2" />
      <path d="M134 21l11 9h-11Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={20} cy={55} r={8} />
      <Wheel cx={40} cy={55} r={8} />
      <Wheel cx={62} cy={55} r={8} />
      <Wheel cx={140} cy={55} r={8} />
    </>
  );
}

function Tanker() {
  return (
    <>
      <Chassis x1={8} x2={148} />
      {/* A cylinder read from the side: full-height rounded ends */}
      <rect x="6" y="18" width="92" height="30" rx="15" className={BODY} strokeWidth="2" />
      <path d="M40 18v30M68 18v30" className={SEAM} strokeWidth="2" />
      <path d="M98 48V20h28l12 10h10v18Z" className={BODY} strokeWidth="2" />
      <path d="M126 21l11 9h-11Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={30} />
      <Wheel cx={54} />
      <Wheel cx={132} />
    </>
  );
}

function Tipper() {
  return (
    <>
      <Chassis x1={8} x2={148} />
      {/* The raked skip is the one shape that still says tipper at card size */}
      <path d="M8 48l8-28h82v28Z" className={BODY} strokeWidth="2" />
      <path d="M16 26h82" className={SEAM} strokeWidth="2" />
      <path d="M98 48V20h28l12 10h10v18Z" className={BODY} strokeWidth="2" />
      <path d="M126 21l11 9h-11Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={32} />
      <Wheel cx={56} />
      <Wheel cx={132} />
    </>
  );
}

function Van() {
  return (
    <>
      <Chassis x1={12} x2={146} />
      <path d="M12 48V22a4 4 0 014-4h86l24 16h8a4 4 0 014 4v10Z" className={BODY} strokeWidth="2" />
      <path d="M104 20l22 14h-22Z" className={GLASS} strokeWidth="1.5" />
      <rect x="24" y="24" width="30" height="14" rx="2" className={TRIM} />
      <Wheel cx={40} cy={52} r={10} />
      <Wheel cx={124} cy={52} r={10} />
    </>
  );
}

function Pickup() {
  return (
    <>
      <Chassis x1={10} x2={148} />
      {/* An open bed behind a crew cab */}
      <path
        d="M10 48V30h56V22a4 4 0 014-4h32l22 16h14a4 4 0 014 4v10Z"
        className={BODY}
        strokeWidth="2"
      />
      <path d="M102 20l20 14h-20Z" className={GLASS} strokeWidth="1.5" />
      <path d="M70 22h28v12H70Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={36} cy={52} r={10} />
      <Wheel cx={122} cy={52} r={10} />
    </>
  );
}

function Car() {
  return (
    <>
      {/* Sedan roofline, cabin set back over the rear axle */}
      <path
        d="M14 48v-8q0-8 8-10l20-4 14-10h28q7 0 12 5l11 9 20 4q9 2 9 10v4Z"
        className={BODY}
        strokeWidth="2"
      />
      <path d="M58 18h26q6 0 10 4l9 8H48Z" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={44} cy={48} r={11} />
      <Wheel cx={118} cy={48} r={11} />
    </>
  );
}

function Bus() {
  return (
    <>
      <Chassis x1={10} x2={150} />
      <rect x="8" y="12" width="144" height="36" rx="7" className={BODY} strokeWidth="2" />
      {/* A window band rather than separate panes, which turn to mud at card size */}
      <rect x="16" y="18" width="112" height="14" rx="3" className={GLASS} strokeWidth="1.5" />
      <rect x="134" y="18" width="12" height="14" rx="3" className={GLASS} strokeWidth="1.5" />
      <Wheel cx={38} cy={52} r={10} />
      <Wheel cx={124} cy={52} r={10} />
    </>
  );
}

function Rickshaw() {
  return (
    <>
      {/* Three-wheeler: one wheel forward, canopy over a rear bench */}
      <path d="M44 50V30q0-14 16-16h26q16 4 20 20l4 16Z" className={BODY} strokeWidth="2" />
      <path d="M60 18h24q10 3 13 12H58Z" className={GLASS} strokeWidth="1.5" />
      <path d="M44 40h66" className={SEAM} strokeWidth="2" />
      <Wheel cx={52} cy={52} r={10} />
      <Wheel cx={100} cy={52} r={10} />
    </>
  );
}

const DRAWINGS: Record<Silhouette, () => React.ReactElement> = {
  truck: Truck,
  trailer: Trailer,
  tanker: Tanker,
  tipper: Tipper,
  van: Van,
  pickup: Pickup,
  car: Car,
  // The drawing is only the load-failure fallback, and a saloon silhouette
  // reads correctly for an SUV at card size; the artwork above is what
  // actually distinguishes them.
  suv: Car,
  bus: Bus,
  rickshaw: Rickshaw,
};

/** The drawing on its own, with no surrounding surface. */
export function VehicleSilhouette({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const Drawing = DRAWINGS[silhouetteFor(type)];
  return (
    <svg
      viewBox="0 0 160 72"
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
      className={cn('h-full w-full', className)}
      aria-hidden
    >
      <Drawing />
    </svg>
  );
}

/* --- Stock artwork ---------------------------------------------------------
   Cut-out side profiles in `/vehicles/`, one per vehicle class. They are
   transparent PNG sources normalised to a single 900x450 canvas and delivered
   as WebP: transparency is what lets one asset sit correctly on a white card
   and on a near-black one, and the shared canvas is what stops a rickshaw and
   a tipper arriving at different visual weights in the same grid.

   Six drawings for ten classes, so some sharing remains: a tanker, a trailer,
   a van and a pickup all show the goods truck. That is a gap in the artwork
   rather than in the mapping — add a file and point its class at it, which is
   all the bus took. The type label under the plate is what disambiguates in
   the meantime. */
const PHOTO_BY_SILHOUETTE: Record<Silhouette, string> = {
  truck: '/vehicles/truck.webp',
  tipper: '/vehicles/tipper.webp',
  suv: '/vehicles/suv.webp',
  car: '/vehicles/sedan.webp',
  bus: '/vehicles/bus.webp',
  rickshaw: '/vehicles/autorickshaw.webp',
  // No artwork of their own yet — nearest class by body shape.
  trailer: '/vehicles/truck.webp',
  tanker: '/vehicles/truck.webp',
  van: '/vehicles/truck.webp',
  pickup: '/vehicles/truck.webp',
};

/**
 * The shape the artwork is cut to, as a Tailwind aspect utility.
 *
 * Exported because the container has to want the same shape as the picture:
 * the artwork is drawn on a 2:1 canvas, and a container of any other ratio
 * either letterboxes it or crops it. Keeping it here means swapping the assets
 * in `/vehicles/` is a one-line change rather than a hunt through call sites
 * for a ratio that silently no longer matches.
 */
export const VEHICLE_ART_ASPECT = 'aspect-[2/1]';

/**
 * The vehicle's picture — what a card or a detail header shows.
 *
 * Three sources, in order of how specific they are: the vehicle's own
 * photograph when a caller has one, the cut-out artwork for its class, and the
 * drawing if that artwork cannot be loaded.
 *
 * The artwork and the drawing are both cut-outs, so both sit on the
 * `.vehicle-stage` pedestal and both use `object-contain`. Together those are
 * what make a cut-out look placed rather than pasted: the stage supplies a pool
 * of light and a contact shadow beneath the wheels, and `contain` guarantees
 * the whole vehicle is in frame at every card width — `cover` would crop the
 * cab off a wide card, which is exactly the failure this replaced.
 *
 * A real photograph is different in kind: it has its own background and its own
 * framing, so it fills the frame with `cover` and gets no pedestal.
 */
export function VehicleArt({
  type,
  registrationNumber,
  photoId,
  className,
  padding = 'p-4',
}: {
  /** `vehicleType` or `truckType` — either is understood. */
  type: string | null | undefined;
  /** Used for the alt text. */
  registrationNumber?: string | null;
  /** A media asset id, when this vehicle has a photograph of its own. */
  photoId?: string | null;
  className?: string;
  /** Room around the cut-out. Ignored when a real photograph is shown. */
  padding?: string;
}) {
  const [artworkFailed, setArtworkFailed] = React.useState(false);

  const drawing = (
    <div className={cn('vehicle-stage size-full', padding)}>
      <VehicleSilhouette type={type} />
    </div>
  );

  if (photoId) {
    return (
      <div className={cn('relative overflow-hidden', className)}>
        <MediaImage
          source={photoId}
          alt={registrationNumber ? `Vehicle ${registrationNumber}` : 'Vehicle'}
          variant="thumbnail"
          className="size-full object-cover"
          fallback={drawing}
        />
      </div>
    );
  }

  if (artworkFailed) return <div className={className}>{drawing}</div>;

  return (
    <div className={cn('vehicle-stage', className)}>
      <img
        src={PHOTO_BY_SILHOUETTE[silhouetteFor(type)]}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('size-full object-contain', padding)}
        onError={() => setArtworkFailed(true)}
      />
    </div>
  );
}

export default VehicleArt;
