/**
 * Declarative state machines for the order, trip and SOS lifecycles.
 *
 * The API validates every transition against these tables before writing, so a
 * client can never push an entity into an impossible state. The UI uses the
 * same tables to decide which action buttons to render.
 */

import { OrderStatus, SosStatus, TripStatus, TruckStatus } from './enums';

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
}

function buildValidator<T extends string>(
  label: string,
  table: Record<T, readonly T[]>,
): {
  transitions: Record<T, readonly T[]>;
  canTransition: (from: T, to: T) => boolean;
  assertTransition: (from: T, to: T) => TransitionResult;
  nextStates: (from: T) => readonly T[];
  isTerminal: (state: T) => boolean;
} {
  return {
    transitions: table,
    canTransition: (from, to) => (table[from] ?? []).includes(to),
    assertTransition: (from, to) => {
      if (from === to) {
        return { allowed: false, reason: `${label} is already ${to}.` };
      }
      const allowedNext = table[from] ?? [];
      if (!allowedNext.includes(to)) {
        return {
          allowed: false,
          reason: `${label} cannot move from ${from} to ${to}. Allowed next: ${
            allowedNext.length > 0 ? allowedNext.join(', ') : 'none (terminal state)'
          }.`,
        };
      }
      return { allowed: true };
    },
    nextStates: (from) => table[from] ?? [],
    isTerminal: (state) => (table[state] ?? []).length === 0,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.DRAFT]: [OrderStatus.REQUESTED, OrderStatus.CANCELLED],
  [OrderStatus.REQUESTED]: [OrderStatus.QUOTED, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.QUOTED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.REQUESTED],
  [OrderStatus.CONFIRMED]: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  [OrderStatus.ASSIGNED]: [OrderStatus.PICKUP, OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
  [OrderStatus.PICKUP]: [OrderStatus.IN_TRANSIT, OrderStatus.FAILED, OrderStatus.CANCELLED],
  [OrderStatus.IN_TRANSIT]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED, OrderStatus.FAILED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.FAILED]: [],
};

export const orderStateMachine = buildValidator('Order', ORDER_TRANSITIONS);

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.QUOTED,
  OrderStatus.CONFIRMED,
  OrderStatus.ASSIGNED,
  OrderStatus.PICKUP,
  OrderStatus.IN_TRANSIT,
];

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

const TRIP_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  [TripStatus.DRAFT]: [TripStatus.ASSIGNED, TripStatus.CANCELLED],
  [TripStatus.ASSIGNED]: [TripStatus.LOADING, TripStatus.STARTED, TripStatus.CANCELLED],
  [TripStatus.LOADING]: [TripStatus.STARTED, TripStatus.CANCELLED, TripStatus.SUSPENDED],
  [TripStatus.STARTED]: [
    TripStatus.IN_TRANSIT,
    TripStatus.DELAYED,
    TripStatus.EMERGENCY,
    TripStatus.SUSPENDED,
    TripStatus.CANCELLED,
  ],
  [TripStatus.IN_TRANSIT]: [
    TripStatus.ARRIVED,
    TripStatus.DELAYED,
    TripStatus.EMERGENCY,
    TripStatus.SUSPENDED,
    TripStatus.CANCELLED,
  ],
  [TripStatus.DELAYED]: [
    TripStatus.IN_TRANSIT,
    TripStatus.ARRIVED,
    TripStatus.EMERGENCY,
    TripStatus.SUSPENDED,
    TripStatus.CANCELLED,
  ],
  [TripStatus.EMERGENCY]: [
    TripStatus.IN_TRANSIT,
    TripStatus.DELAYED,
    TripStatus.SUSPENDED,
    TripStatus.CANCELLED,
    TripStatus.ARRIVED,
  ],
  [TripStatus.SUSPENDED]: [TripStatus.IN_TRANSIT, TripStatus.STARTED, TripStatus.CANCELLED],
  [TripStatus.ARRIVED]: [TripStatus.UNLOADING, TripStatus.COMPLETED, TripStatus.EMERGENCY],
  [TripStatus.UNLOADING]: [TripStatus.COMPLETED, TripStatus.EMERGENCY],
  [TripStatus.COMPLETED]: [],
  [TripStatus.CANCELLED]: [],
};

export const tripStateMachine = buildValidator('Trip', TRIP_TRANSITIONS);

export const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.ASSIGNED,
  TripStatus.LOADING,
  TripStatus.STARTED,
  TripStatus.IN_TRANSIT,
  TripStatus.DELAYED,
  TripStatus.EMERGENCY,
  TripStatus.SUSPENDED,
  TripStatus.ARRIVED,
  TripStatus.UNLOADING,
];

/** Statuses in which the truck is physically moving and should stream GPS. */
export const MOVING_TRIP_STATUSES: TripStatus[] = [
  TripStatus.STARTED,
  TripStatus.IN_TRANSIT,
  TripStatus.DELAYED,
  TripStatus.EMERGENCY,
];

/** Truck status implied by a trip status — keeps fleet state consistent. */
export const TRIP_STATUS_TO_TRUCK_STATUS: Partial<Record<TripStatus, TruckStatus>> = {
  [TripStatus.ASSIGNED]: TruckStatus.ASSIGNED,
  [TripStatus.LOADING]: TruckStatus.LOADING,
  [TripStatus.STARTED]: TruckStatus.ON_TRIP,
  [TripStatus.IN_TRANSIT]: TruckStatus.ON_TRIP,
  [TripStatus.DELAYED]: TruckStatus.ON_TRIP,
  [TripStatus.EMERGENCY]: TruckStatus.EMERGENCY,
  [TripStatus.ARRIVED]: TruckStatus.ON_TRIP,
  [TripStatus.UNLOADING]: TruckStatus.UNLOADING,
  [TripStatus.COMPLETED]: TruckStatus.AVAILABLE,
  [TripStatus.CANCELLED]: TruckStatus.AVAILABLE,
  [TripStatus.SUSPENDED]: TruckStatus.IDLE,
};

/** Order status implied by a trip status, when the trip belongs to an order. */
export const TRIP_STATUS_TO_ORDER_STATUS: Partial<Record<TripStatus, OrderStatus>> = {
  [TripStatus.ASSIGNED]: OrderStatus.ASSIGNED,
  [TripStatus.LOADING]: OrderStatus.PICKUP,
  [TripStatus.STARTED]: OrderStatus.IN_TRANSIT,
  [TripStatus.IN_TRANSIT]: OrderStatus.IN_TRANSIT,
  [TripStatus.ARRIVED]: OrderStatus.IN_TRANSIT,
  [TripStatus.UNLOADING]: OrderStatus.IN_TRANSIT,
  [TripStatus.COMPLETED]: OrderStatus.DELIVERED,
};

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

const SOS_TRANSITIONS: Record<SosStatus, readonly SosStatus[]> = {
  [SosStatus.TRIGGERED]: [SosStatus.BROADCASTING, SosStatus.RESOLVED, SosStatus.CANCELLED],
  [SosStatus.BROADCASTING]: [
    SosStatus.ACKNOWLEDGED,
    SosStatus.HELP_ASSIGNED,
    SosStatus.RESOLVED,
    SosStatus.CANCELLED,
  ],
  // A responder who has acknowledged may simply turn up: assignment is a
  // coordination step, not a precondition for someone arriving to help.
  [SosStatus.ACKNOWLEDGED]: [
    SosStatus.HELP_ASSIGNED,
    SosStatus.ASSISTANCE_ARRIVED,
    SosStatus.RESOLVED,
    SosStatus.CANCELLED,
  ],
  [SosStatus.HELP_ASSIGNED]: [
    SosStatus.ASSISTANCE_ARRIVED,
    SosStatus.RESOLVED,
    SosStatus.CANCELLED,
  ],
  [SosStatus.ASSISTANCE_ARRIVED]: [SosStatus.RESOLVED],
  [SosStatus.RESOLVED]: [],
  [SosStatus.CANCELLED]: [],
};

export const sosStateMachine = buildValidator('SOS incident', SOS_TRANSITIONS);

export const ACTIVE_SOS_STATUSES: SosStatus[] = [
  SosStatus.TRIGGERED,
  SosStatus.BROADCASTING,
  SosStatus.ACKNOWLEDGED,
  SosStatus.HELP_ASSIGNED,
  SosStatus.ASSISTANCE_ARRIVED,
];

// ---------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------

/** Truck statuses that make a truck eligible for a new assignment. */
export const ASSIGNABLE_TRUCK_STATUSES: TruckStatus[] = [
  TruckStatus.AVAILABLE,
  TruckStatus.IDLE,
  TruckStatus.ASSIGNED,
];

/** Truck statuses that make a truck eligible to respond to an SOS. */
export const SOS_ELIGIBLE_TRUCK_STATUSES: TruckStatus[] = [
  TruckStatus.AVAILABLE,
  TruckStatus.IDLE,
  TruckStatus.ON_TRIP,
  TruckStatus.ASSIGNED,
  TruckStatus.LOADING,
  TruckStatus.UNLOADING,
];
