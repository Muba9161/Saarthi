import { RequirementKind, formatNumber, humanizeEnum } from '@saarthi/shared';
import type { RequirementSummary } from '@/lib/api-types';

/**
 * One line describing what a requirement is actually asking for.
 *
 * A single table shows all four kinds, and each one is legible in a different
 * unit: tonnes for a load, heads for a cab, nights for a tour. Rendering that
 * in one place means the customer's list, the provider board and the detail
 * header cannot describe the same requirement three different ways.
 */
export function summarise(requirement: RequirementSummary): {
  headline: string;
  detail: string | null;
} {
  switch (requirement.kind) {
    case RequirementKind.MATERIAL_SUPPLY: {
      const amount =
        requirement.quantity !== null && requirement.unit
          ? `${formatNumber(requirement.quantity)} ${humanizeEnum(requirement.unit).toLowerCase()}`
          : null;
      return {
        headline: [amount, requirement.materialName].filter(Boolean).join(' of ') || 'Material',
        detail: requirement.needsTransport ? 'Delivery needed' : 'Customer arranges transport',
      };
    }

    case RequirementKind.FREIGHT_TRANSPORT: {
      const amount =
        requirement.quantity !== null && requirement.unit
          ? `${formatNumber(requirement.quantity)} ${humanizeEnum(requirement.unit).toLowerCase()}`
          : null;
      return {
        headline: requirement.goodsDescription ?? 'Load',
        detail: [amount, requirement.requiredCapacityTons ? `${requirement.requiredCapacityTons}T truck` : null]
          .filter(Boolean)
          .join(' · '),
      };
    }

    case RequirementKind.CAB_HIRE:
      return {
        headline: `${requirement.passengers ?? 1} passenger${(requirement.passengers ?? 1) > 1 ? 's' : ''}`,
        detail: [
          requirement.hireBasis ? humanizeEnum(requirement.hireBasis) : null,
          requirement.durationHours ? `${requirement.durationHours} hours` : null,
          requirement.durationDays ? `${requirement.durationDays} days` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };

    case RequirementKind.TOUR_PACKAGE:
      return {
        headline:
          requirement.destinations.length > 0
            ? requirement.destinations.slice(0, 3).join(', ') +
              (requirement.destinations.length > 3 ? ` +${requirement.destinations.length - 3}` : '')
            : 'Tour',
        detail: [
          `${requirement.passengers ?? 1} travelling`,
          requirement.durationDays ? `${requirement.durationDays} days` : null,
          requirement.durationNights ? `${requirement.durationNights} nights` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };

    default:
      return { headline: requirement.title, detail: null };
  }
}

export function RequirementLine({ requirement }: { requirement: RequirementSummary }) {
  const { headline, detail } = summarise(requirement);

  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{headline}</p>
      {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/** "Jaipur → Gurugram", or just the origin when there is no fixed end point. */
export function routeLabel(requirement: RequirementSummary): string {
  const from = (requirement.originCity ?? requirement.originAddress).split(',')[0]?.trim() ?? '';
  if (!requirement.destinationAddress) return from;
  const to =
    (requirement.destinationCity ?? requirement.destinationAddress).split(',')[0]?.trim() ?? '';
  return `${from} → ${to}`;
}
