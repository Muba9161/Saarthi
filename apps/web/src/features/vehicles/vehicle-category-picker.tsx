import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import {
  categoriesFor,
  vehicleTypeDefinition,
  type VehicleCategory,
  type VehicleType,
} from '@saarthi/shared';
import { VEHICLE_ART_ASPECT, VehicleArt } from '@/components/common/vehicle-art';
import { cn } from '@/lib/utils';

/**
 * Which kind of vehicle — asked on the type step, right under the type, for
 * any type that has categories (a two-wheeler, a car, a taxi).
 *
 * Pictures rather than a dropdown: "MUV" and "cruiser" are words an owner may
 * not use, but the shape of their own vehicle is unmistakable. The picture
 * shown is the one the vehicle will carry everywhere else, so choosing here is
 * also previewing.
 *
 * Built on Radix's radio group, so arrow keys move between tiles and a screen
 * reader announces one choice of several.
 */
export function VehicleCategoryPicker({
  vehicleType,
  value,
  onChange,
  error,
}: {
  vehicleType: VehicleType;
  value: VehicleCategory | null;
  onChange: (category: VehicleCategory) => void;
  error?: string | undefined;
}) {
  const options = categoriesFor(vehicleType);

  return (
    <RadioGroupPrimitive.Root
      // A <label for> cannot name a group, so the group names itself.
      aria-label={`Kind of ${vehicleTypeDefinition(vehicleType).label.toLowerCase()}`}
      value={value ?? ''}
      onValueChange={(next) => onChange(next as VehicleCategory)}
      aria-invalid={Boolean(error) || undefined}
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.category}
          value={option.category}
          className={cn(
            'group flex flex-col rounded-xl border p-2 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
            error && !value
              ? 'border-destructive/60'
              : 'border-border hover:border-primary/40 hover:bg-muted/40',
          )}
        >
          <VehicleArt
            type={option.category}
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
  );
}

export default VehicleCategoryPicker;
