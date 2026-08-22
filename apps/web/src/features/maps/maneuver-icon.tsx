import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerLeftDown,
  CornerRightDown,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Merge,
  Navigation,
  RotateCcw,
  RotateCw,
  Split,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RouteManeuver } from './directions';

/**
 * Maps a manoeuvre (type + modifier) onto an icon.
 *
 * Drivers read the arrow before the words, so the icon has to be unambiguous:
 * a sharp left must not look like a slight left. Anything unrecognised falls
 * back to "continue" rather than rendering nothing.
 */

function directionIcon(modifier: string | null): LucideIcon {
  switch (modifier) {
    case 'sharp left':
      return ArrowLeft;
    case 'left':
      return CornerUpLeft;
    case 'slight left':
      return ArrowUpLeft;
    case 'sharp right':
      return ArrowRight;
    case 'right':
      return CornerUpRight;
    case 'slight right':
      return ArrowUpRight;
    case 'uturn':
      return RotateCcw;
    case 'straight':
    default:
      return ArrowUp;
  }
}

export function maneuverIcon(maneuver: RouteManeuver): LucideIcon {
  switch (maneuver.type) {
    case 'depart':
      return Navigation;
    case 'arrive':
      return Flag;
    case 'merge':
      return Merge;
    case 'fork':
      return Split;
    case 'on ramp':
      return maneuver.modifier?.includes('left') ? CornerLeftDown : CornerRightDown;
    case 'off ramp':
      return maneuver.modifier?.includes('left') ? ArrowUpLeft : ArrowUpRight;
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return RotateCw;
    case 'exit roundabout':
    case 'exit rotary':
      return directionIcon(maneuver.modifier);
    case 'end of road':
    case 'turn':
    case 'new name':
    case 'continue':
    case 'notification':
    default:
      return directionIcon(maneuver.modifier);
  }
}

/** Short label for a manoeuvre, used where the full instruction will not fit. */
export function maneuverLabel(maneuver: RouteManeuver): string {
  if (maneuver.type === 'roundabout' || maneuver.type === 'rotary') {
    return maneuver.exit ? `Roundabout · exit ${maneuver.exit}` : 'Roundabout';
  }
  if (maneuver.type === 'arrive') return 'Arrive';
  if (maneuver.type === 'depart') return 'Depart';
  if (!maneuver.modifier) return maneuver.type.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${maneuver.type} ${maneuver.modifier}`.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export interface ManeuverIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  maneuver: RouteManeuver;
  /** Emphasised styling for the current instruction banner. */
  emphasis?: boolean;
}

export function ManeuverIcon({ maneuver, emphasis = false, className, ...props }: ManeuverIconProps) {
  const Icon = maneuverIcon(maneuver);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg',
        emphasis
          ? 'size-11 bg-primary text-primary-foreground [&_svg]:size-6'
          : 'size-8 bg-secondary text-secondary-foreground [&_svg]:size-4',
        className,
      )}
      aria-label={maneuverLabel(maneuver)}
      {...props}
    >
      <Icon strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}
