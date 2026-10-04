import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import {
  VehicleCapability,
  formatNumber,
  formatRegistrationNumber,
  humanizeEnum,
  normalizeRegistrationNumber,
} from '@saarthi/shared';
import type { VehicleSummary } from '@/lib/mobility-types';
import { statusTextClass } from '@/components/common/status-badge';
import {
  VehicleSilhouette,
  vehicleArtType,
  vehicleArtwork,
} from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';

/**
 * The identity band — who this vehicle is, and the vehicle itself at size.
 *
 * Details on the left; on the right the vehicle, turned to face them, with its
 * tail running off the edge of the page. Behind it, in outline, the plate's
 * state and district code — identity rather than decoration. The geometry
 * lives in `vehicle-detail.css` because it is measured against the hero, not
 * the viewport: the sidebar takes a different share of the screen on every
 * device.
 *
 * Deliberately presentational. Every action is composed by the page and passed
 * in through `actions`, because the page is where the permission grants, the
 * entitlement checks and the driver mutations already live — moving any of
 * that in here would mean a second place that decides who may assign a driver.
 */

/** The hero's buttons share one shape, whichever component renders them. */
export const HERO_ACTION_CLASS = 'h-11 rounded-[12px] px-[18px] text-sm font-semibold';

/**
 * `UP63N5670` → `UP 63`; `22BH1234AA` → `22 BH`. The part of a plate that says
 * where a vehicle is from, which is what the backdrop shows.
 */
function plateRegion(registrationNumber: string): string {
  const plate = normalizeRegistrationNumber(registrationNumber);
  const standard = plate.match(/^([A-Z]{2})(\d{1,2})/);
  if (standard) return `${standard[1]} ${standard[2]}`;
  const bharat = plate.match(/^(\d{2})(BH)/);
  if (bharat) return `${bharat[1]} ${bharat[2]}`;
  return plate.slice(0, 4);
}

function verificationTone(status: string): string {
  if (status === 'VERIFIED') return 'text-success';
  if (status === 'REJECTED' || status === 'EXPIRED') return 'text-destructive';
  return 'text-warning';
}

export function VehicleHero({
  vehicle,
  backTo,
  backLabel,
  /** Composed by the page, so RBAC and mutations stay in one place. */
  actions,
  className,
}: {
  vehicle: VehicleSummary;
  backTo: string;
  backLabel: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const plate = formatRegistrationNumber(vehicle.registrationNumber);
  const artType = vehicleArtType(vehicle);
  const artwork = vehicleArtwork(artType);
  const carriesFreight = vehicle.capabilities.includes(VehicleCapability.CARGO_CAPACITY);
  const carriesPassengers = vehicle.capabilities.includes(VehicleCapability.PASSENGER_CAPACITY);

  const eyebrow = [vehicle.typeLabel, vehicle.categoryLabel].filter(Boolean).join(' · ');
  const makeAndModel =
    [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ') || null;
  const verified = vehicle.verificationStatus === 'VERIFIED';

  // One fact per item, so a vehicle missing one simply has one fewer.
  const facts = [
    // Body type only means something for a goods vehicle.
    carriesFreight ? humanizeEnum(vehicle.truckType) : null,
    humanizeEnum(vehicle.fuelType),
    vehicle.colour,
    carriesFreight && vehicle.capacityTons !== null ? `${vehicle.capacityTons} t payload` : null,
    carriesPassengers && vehicle.passengerCapacity !== null
      ? `${formatNumber(vehicle.passengerCapacity)} seats`
      : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <section
      aria-labelledby="vehicle-plate"
      // Bleeds to the edges of the content area, so the vehicle can run off it.
      className={cn('vd-hero -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8', className)}
    >
      <div className="vd-hero-body">
        <p className="vd-hero-mark" aria-hidden>
          {plateRegion(vehicle.registrationNumber)}
        </p>
        <div className="vd-hero-floor" aria-hidden />

        {artwork ? (
          <img
            src={artwork.src}
            srcSet={artwork.srcSet}
            alt={`${plate}, side view`}
            decoding="async"
            className="vd-hero-car"
          />
        ) : (
          // Classes with no artwork yet — today the two-wheelers — show the
          // drawing, which is accurate for every type.
          <div className="vd-hero-car" data-drawing="">
            <VehicleSilhouette type={artType} className="h-auto" />
          </div>
        )}

        <div className="vd-hero-inner mx-auto flex max-w-[1320px] flex-col justify-center px-4 pb-10 pt-7 sm:px-6 lg:px-8">
          <div className="vd-hero-copy flex flex-col gap-5">
            <Link
              to={backTo}
              className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Link>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {eyebrow}
              </p>
              <h1 id="vehicle-plate" className="vd-display vd-plate mt-1.5">
                {plate}
              </h1>
              {makeAndModel ? (
                <p className="mt-2.5 text-base text-muted-foreground">{makeAndModel}</p>
              ) : null}
            </div>

            <ul className="vd-meta flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-sm text-muted-foreground">
              <li
                className={cn(
                  'inline-flex items-center gap-1.5 font-semibold',
                  statusTextClass(vehicle.status),
                )}
              >
                <span className="size-[7px] rounded-full bg-current" aria-hidden />
                {humanizeEnum(vehicle.status)}
              </li>
              <li
                className={cn(
                  'inline-flex items-center font-semibold',
                  verificationTone(vehicle.verificationStatus),
                )}
              >
                {verified
                  ? 'Verified'
                  : `Verification ${humanizeEnum(vehicle.verificationStatus).toLowerCase()}`}
              </li>
              {facts.map((fact) => (
                <li key={fact} className="inline-flex items-center">
                  {fact}
                </li>
              ))}
            </ul>

            {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}

            {vehicle.currentDriver || vehicle.currentTripId ? (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {vehicle.currentDriver ? (
                  <Link
                    to={`/fleet/drivers/${vehicle.currentDriver.id}`}
                    className="inline-flex min-h-11 items-center font-medium hover:underline"
                  >
                    Driver · {vehicle.currentDriver.name}
                  </Link>
                ) : null}
                {vehicle.currentTripId ? (
                  <Link
                    to={`/trips/${vehicle.currentTripId}`}
                    className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    View active trip
                    <ChevronRight className="size-4" />
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export default VehicleHero;
