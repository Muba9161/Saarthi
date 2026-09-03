import * as React from 'react';
import { Boxes, Car, Map, Truck, type LucideIcon } from 'lucide-react';
import { RequirementKind, REQUIREMENT_KIND_DESCRIPTIONS } from '@saarthi/shared';
import { cn } from '@/lib/utils';

/**
 * The first question: what do you actually need?
 *
 * Everything downstream hangs off this answer — which fields the form asks
 * for, which businesses are shown the requirement, and whether an awarded bid
 * becomes an order or a booking. It is presented as four large targets rather
 * than a dropdown because it is a decision, not a setting, and because on a
 * phone in a yard a dropdown of four similar phrases is genuinely hard to use.
 */

interface KindOption {
  kind: RequirementKind;
  label: string;
  icon: LucideIcon;
  /** Who ends up bidding, said plainly. */
  audience: string;
}

export const KIND_OPTIONS: KindOption[] = [
  {
    kind: RequirementKind.MATERIAL_SUPPLY,
    label: 'Material supply',
    icon: Boxes,
    audience: 'Suppliers bid for the goods, fleets bid to deliver them',
  },
  {
    kind: RequirementKind.FREIGHT_TRANSPORT,
    label: 'Freight transport',
    icon: Truck,
    audience: 'Verified fleets bid to move your load',
  },
  {
    kind: RequirementKind.CAB_HIRE,
    label: 'Cab or taxi',
    icon: Car,
    audience: 'Taxi and travel operators bid for the trip',
  },
  {
    kind: RequirementKind.TOUR_PACKAGE,
    label: 'Tour or travel package',
    icon: Map,
    audience: 'Tour operators bid with a package built for you',
  },
];

export function KindPicker({
  value,
  onChange,
}: {
  value: RequirementKind | null;
  onChange: (kind: RequirementKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What do you need?"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {KIND_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = value === option.kind;

        return (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.kind)}
            className={cn(
              'flex gap-3 rounded-lg border p-4 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border hover:border-primary/40 hover:bg-muted/40',
            )}
          >
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-md',
                selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon className="size-4.5" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs leading-snug text-muted-foreground">
                {REQUIREMENT_KIND_DESCRIPTIONS[option.kind]}
              </span>
              <span className="block text-xs font-medium text-primary/80">{option.audience}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
