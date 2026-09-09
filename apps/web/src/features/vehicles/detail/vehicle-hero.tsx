import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Bus, Car, Truck } from 'lucide-react';
import { VehicleType, formatRegistrationNumber, humanizeEnum } from '@saarthi/shared';
import type { VehicleSummary } from '@/lib/mobility-types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/status-badge';
import { VEHICLE_ART_ASPECT, VehicleArt } from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';

/**
 * The identity band — who this vehicle is, and the vehicle itself at size.
 *
 * Deliberately presentational. Every action on it is composed by the page and
 * passed in through `actions`, because the page is where the permission grants,
 * the entitlement checks and the two driver mutations already live — moving any
 * of that in here would mean a second place that decides who may assign a
 * driver. This component decides layout and nothing else.
 *
 * The picture is the largest thing on the screen on purpose: it is how somebody
 * confirms they opened the right record before they press Assign driver. It is
 * also why the plate stays first in the reading order — the image is what
 * catches the eye, but the plate is what was searched for.
 */

/** The icon that matches what the vehicle actually is. */
function vehicleIcon(type: VehicleType): React.ComponentType<{ className?: string }> {
  if (type === VehicleType.BUS || type === VehicleType.TEMPO) return Bus;
  if (type === VehicleType.TRUCK || type === VehicleType.PICKUP) return Truck;
  return Car;
}

export function VehicleHero({
  vehicle,
  backTo,
  backLabel,
  /** Composed by the page, so RBAC and mutations stay in one place. */
  actions,
  /** True when the type carries goods — body type only means something then. */
  carriesFreight,
  className,
}: {
  vehicle: VehicleSummary;
  backTo: string;
  backLabel: string;
  actions?: React.ReactNode;
  carriesFreight: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const TypeIcon = vehicleIcon(vehicle.vehicleType);

  /*
   * Make, model and year on their own line under the plate.
   *
   * Split out of the single run-on description the page used to build, because
   * at four or five segments it wrapped into a grey paragraph that nobody read.
   * The identity a person recognises the vehicle by goes on line one; the
   * details that qualify it go on line two.
   */
  const makeAndModel =
    [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ') || null;

  const qualifiers = [
    vehicle.typeLabel,
    // Body type is meaningless for a passenger vehicle.
    carriesFreight ? humanizeEnum(vehicle.truckType) : null,
    vehicle.colour,
    humanizeEnum(vehicle.fuelType),
  ].filter(Boolean);

  return (
    <Card variant="glass" className={cn('edge-accent overflow-hidden rounded-3xl', className)}>
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)] lg:items-center lg:gap-8 lg:p-10">
        <div className="order-2 min-w-0 space-y-5 lg:order-1">
          <Button
            variant="ghost"
            size="sm"
            shape="pill"
            className="-ml-2 text-muted-foreground"
            onClick={() => navigate(backTo)}
          >
            <ArrowLeft className="size-4" />
            {backLabel}
          </Button>

          <div className="space-y-3">
            <p className="section-label inline-flex items-center gap-1.5">
              <TypeIcon className="size-3.5" />
              {vehicle.typeLabel}
            </p>

            <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-[2.75rem] lg:leading-[1.05]">
              {formatRegistrationNumber(vehicle.registrationNumber)}
            </h1>

            {makeAndModel ? (
              <p className="text-base text-muted-foreground">{makeAndModel}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={vehicle.status} />
              {vehicle.verificationStatus === 'VERIFIED' ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <BadgeCheck className="size-4" />
                  Verified
                </span>
              ) : (
                <StatusBadge status={vehicle.verificationStatus} size="sm" />
              )}
            </div>

            {/* Chips rather than a joined sentence: each is one fact, and a
                vehicle that lacks one simply has one fewer chip. */}
            {qualifiers.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                {qualifiers.map((qualifier, index) => (
                  <React.Fragment key={qualifier}>
                    {index > 0 ? (
                      <span className="size-1 rounded-full bg-border" aria-hidden />
                    ) : null}
                    <span className="text-xs text-muted-foreground">{qualifier}</span>
                  </React.Fragment>
                ))}
              </div>
            ) : null}
          </div>

          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>

        {/*
          The artwork keeps its own 2:1 frame — the ratio the assets in
          `/vehicles/` are cut to — so nothing is cropped at any width. On
          narrow screens it moves above the text, where a picture belongs.
        */}
        <VehicleArt
          type={vehicle.vehicleType}
          registrationNumber={vehicle.registrationNumber}
          className={cn(
            'order-1 w-full rounded-2xl ring-1 ring-border/60 lg:order-2',
            VEHICLE_ART_ASPECT,
          )}
          padding="p-2 sm:p-4 lg:p-5"
        />
      </div>
    </Card>
  );
}

export default VehicleHero;
