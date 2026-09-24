import {
  Building2,
  Package,
  Plane,
  ShoppingCart,
  Truck,
  UserRound,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  ASSOCIATION_NAVIGATION,
  CUSTOMER_NAVIGATION,
  DRIVER_NAVIGATION,
  FLEET_NAVIGATION,
  MOBILITY_NAVIGATION,
  SUPPLIER_NAVIGATION,
  type NavSection,
} from '@/app/navigation';

/* -------------------------------------------------------------------------
 * What each kind of account actually gets
 *
 * Read from the same navigation trees the signed-in shell renders, so this
 * section lists real screens rather than aspirational ones. Individual items
 * still carry their own permission and plan gates inside the app; what is
 * shown here is the full surface for the account type.
 * ---------------------------------------------------------------------- */

export interface RoleShowcase {
  id: string;
  label: string;
  /** How somebody in this seat would describe the win, in their words. */
  quote: string;
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  navigation: NavSection[];
}

export const ROLE_SHOWCASE: RoleShowcase[] = [
  {
    id: 'fleet',
    label: 'Fleet owner',
    quote: 'I know what is happening across my whole operation.',
    blurb:
      'Trucks, drivers, documents, orders, trips, fuel, EMIs and toll in one command centre - with analytics that come from the same records rather than a monthly spreadsheet.',
    icon: Truck,
    navigation: FLEET_NAVIGATION,
  },
  {
    id: 'driver',
    label: 'Driver',
    quote: 'I am not alone on the road.',
    blurb:
      'The current trip, one-tap SOS, nearby fuel and workshops, a score that explains itself, and a career profile that travels with you between employers.',
    icon: UserRound,
    navigation: DRIVER_NAVIGATION,
  },
  {
    id: 'customer',
    label: 'Customer',
    quote: 'I know where my order and my truck are.',
    blurb:
      'Post what needs moving, compare real quotes from verified fleets, then track the actual vehicle to your gate and rate what arrived.',
    icon: ShoppingCart,
    navigation: CUSTOMER_NAVIGATION,
  },
  {
    id: 'supplier',
    label: 'Supplier',
    quote: 'I manage material and transport in one place.',
    blurb:
      'A live catalogue with yard-level stock, orders straight from customers, reservations against those orders, and dispatch you can follow out of the gate.',
    icon: Package,
    navigation: SUPPLIER_NAVIGATION,
  },
  {
    id: 'travel',
    label: 'Travel operator',
    quote: 'My taxis, buses and tours sell themselves.',
    blurb:
      'Publish passenger packages, take bookings, and run the vehicles behind them with the same fleet, document and telemetry tools freight operators use.',
    icon: Plane,
    navigation: MOBILITY_NAVIGATION,
  },
  {
    id: 'association',
    label: 'Truck association',
    quote: 'My district can answer a call for help.',
    blurb:
      'An emergency desk that receives SOS alerts raised in your district, with the nearby services and responders needed to close them out.',
    icon: Building2,
    navigation: ASSOCIATION_NAVIGATION,
  },
];

/** Total distinct destinations across every role — used as a proof point. */
export const TOTAL_DESTINATIONS = new Set(
  ROLE_SHOWCASE.flatMap((role) =>
    role.navigation.flatMap((section) => section.items.map((item) => item.to)),
  ),
).size;
