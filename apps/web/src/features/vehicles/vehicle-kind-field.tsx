import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import {
  describeVehicle,
  type StoredVehicleKind,
  type VehicleClass,
  type VehicleClassDefinition,
  type VehicleOption,
} from '@saarthi/shared';
import { VEHICLE_ART_ASPECT, VehicleArt } from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';

/**
 * What the vehicle is: its class ("Car"), then its kind within the class
 * ("SUV") — the first question of the vehicle form.
 *
 * Classes rather than the stored types, because the types include several
 * that an owner would call kinds of something else (an SUV is a car, a pickup
 * is a truck). Each tile carries the record it writes (`VehicleOption`), so
 * the form never has to translate. Only tiles the account may add are given
 * in `classes` — see `vehicleClassesFor`.
 *
 * Both groups are Radix radio groups, so arrow keys move within each and a
 * screen reader announces one choice of several.
 */

export interface VehicleKindValue {
  vehicleClass: VehicleClass;
  /** The chosen tile, or `null` before one is picked (or for a record matching none). */
  optionId: string | null;
}

/** The class and tile a stored record reads as. */
export function kindOfRecord(record: StoredVehicleKind): VehicleKindValue {
  const { vehicleClass, option } = describeVehicle(record);
  return { vehicleClass, optionId: option?.id ?? null };
}

/** The art for a tile: its category, else its body, else its type. */
function tileArtType(option: VehicleOption): string {
  return option.category ?? option.truckType ?? option.vehicleType;
}

const CHIP =
  'inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function VehicleKindField({
  classes,
  value,
  onClassChange,
  onOptionChange,
  error,
}: {
  classes: VehicleClassDefinition[];
  value: VehicleKindValue;
  onClassChange: (vehicleClass: VehicleClass) => void;
  onOptionChange: (option: VehicleOption) => void;
  error?: string | undefined;
}) {
  const active = classes.find((definition) => definition.id === value.vehicleClass);

  return (
    <div className="space-y-4">
      <RadioGroupPrimitive.Root
        aria-label="Vehicle class"
        value={value.vehicleClass}
        onValueChange={(next) => onClassChange(next as VehicleClass)}
        className="flex flex-wrap gap-2"
      >
        {classes.map((definition) => (
          <RadioGroupPrimitive.Item
            key={definition.id}
            value={definition.id}
            className={cn(
              CHIP,
              'border-border hover:border-primary/40 hover:bg-muted/40',
              'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
            )}
          >
            {definition.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>

      {active && active.options.length > 0 ? (
        <div className="space-y-1.5">
          <p className={cn('text-sm font-medium', error ? 'text-destructive' : 'text-foreground')}>
            Kind of {active.label.toLowerCase()}
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          </p>
          <RadioGroupPrimitive.Root
            aria-label={`Kind of ${active.label.toLowerCase()}`}
            value={value.optionId ?? ''}
            onValueChange={(id) => {
              const option = active.options.find((entry) => entry.id === id);
              if (option) onOptionChange(option);
            }}
            aria-invalid={Boolean(error) || undefined}
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          >
            {active.options.map((option) => (
              <RadioGroupPrimitive.Item
                key={option.id}
                value={option.id}
                className={cn(
                  'group flex flex-col rounded-xl border p-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
                  error && !value.optionId
                    ? 'border-destructive/60'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <VehicleArt
                  type={tileArtType(option)}
                  className={cn('w-full rounded-lg', VEHICLE_ART_ASPECT)}
                  padding="p-1.5"
                />
                <span className="mt-2 block px-1 text-sm font-medium">{option.label}</span>
                <span className="block px-1 pb-1 text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{active?.description}</p>
      )}
    </div>
  );
}
