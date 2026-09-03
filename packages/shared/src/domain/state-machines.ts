/**
 * Declarative state machines for the order, trip and SOS lifecycles.
 *
 * The API validates every transition against these tables before writing, so a
 * client can never push an entity into an impossible state. The UI uses the
 * same tables to decide which action buttons to render.
 */

import {
  AssociationAlertStatus,
  BookingStatus,
  DEFAULT_DEVICE_ROLE,
  DeviceProvider,
  DeviceRole,
  DeviceStatus,
  OrderStatus,
  RelayStatus,
  RequirementBidStatus,
  RequirementStatus,
  ReturnLoadStatus,
  SosStatus,
  TripStatus,
  TruckStatus,
  VehicleListingStatus,
  VehicleTransferStatus,
} from './enums';

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
// Requirements & bids
// ---------------------------------------------------------------------------

/**
 * PARTIALLY_AWARDED exists only for a material requirement that also needs
 * transport: the customer has picked a supplier but no lorry yet, so the
 * requirement must stay on the transport board while being closed to further
 * material bids. Every other kind goes straight from BIDDING to AWARDED.
 */
const REQUIREMENT_TRANSITIONS: Record<RequirementStatus, readonly RequirementStatus[]> = {
  [RequirementStatus.OPEN]: [
    RequirementStatus.BIDDING,
    RequirementStatus.CANCELLED,
    RequirementStatus.EXPIRED,
  ],
  [RequirementStatus.BIDDING]: [
    RequirementStatus.PARTIALLY_AWARDED,
    RequirementStatus.AWARDED,
    RequirementStatus.CANCELLED,
    RequirementStatus.EXPIRED,
  ],
  [RequirementStatus.PARTIALLY_AWARDED]: [
    RequirementStatus.AWARDED,
    RequirementStatus.CANCELLED,
    RequirementStatus.EXPIRED,
  ],
  // Cancelling after the award is still possible, because the order or booking
  // it produced can itself be cancelled and the requirement must follow it.
  [RequirementStatus.AWARDED]: [RequirementStatus.FULFILLED, RequirementStatus.CANCELLED],
  [RequirementStatus.FULFILLED]: [],
  [RequirementStatus.CANCELLED]: [],
  [RequirementStatus.EXPIRED]: [],
};

export const requirementStateMachine = buildValidator('Requirement', REQUIREMENT_TRANSITIONS);

const REQUIREMENT_BID_TRANSITIONS: Record<RequirementBidStatus, readonly RequirementBidStatus[]> = {
  [RequirementBidStatus.OFFERED]: [
    RequirementBidStatus.SHORTLISTED,
    RequirementBidStatus.ACCEPTED,
    RequirementBidStatus.REJECTED,
    RequirementBidStatus.WITHDRAWN,
    RequirementBidStatus.EXPIRED,
  ],
  // A shortlisted bid can fall back to plain OFFERED when the customer changes
  // their mind, so shortlisting stays a low-commitment signal.
  [RequirementBidStatus.SHORTLISTED]: [
    RequirementBidStatus.OFFERED,
    RequirementBidStatus.ACCEPTED,
    RequirementBidStatus.REJECTED,
    RequirementBidStatus.WITHDRAWN,
    RequirementBidStatus.EXPIRED,
  ],
  [RequirementBidStatus.ACCEPTED]: [],
  [RequirementBidStatus.REJECTED]: [],
  [RequirementBidStatus.WITHDRAWN]: [],
  [RequirementBidStatus.EXPIRED]: [],
};

export const requirementBidStateMachine = buildValidator(
  'Bid',
  REQUIREMENT_BID_TRANSITIONS,
);

/** Bid statuses that are still in play for the customer to award. */
export const LIVE_BID_STATUSES: RequirementBidStatus[] = [
  RequirementBidStatus.OFFERED,
  RequirementBidStatus.SHORTLISTED,
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

// ---------------------------------------------------------------------------
// Travel bookings
//
// Passenger travel is paid before it is confirmed, which is the opposite of a
// freight order (quoted, then confirmed, then invoiced). The two therefore keep
// separate state machines rather than being forced into one shared lifecycle.
// ---------------------------------------------------------------------------

const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.DRAFT]: [BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED],
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.AWAITING_CONFIRMATION,
    BookingStatus.CANCELLED,
  ],
  // The provider still has to accept: a paid booking is a request, not a
  // guarantee that a vehicle and driver are free on the day.
  [BookingStatus.AWAITING_CONFIRMATION]: [
    BookingStatus.CONFIRMED,
    BookingStatus.DECLINED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETED,
  ],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  // A cancellation may still owe money back, so REFUNDED follows it.
  [BookingStatus.CANCELLED]: [BookingStatus.REFUNDED],
  [BookingStatus.DECLINED]: [BookingStatus.REFUNDED],
  [BookingStatus.REFUNDED]: [],
};

export const bookingStateMachine = buildValidator('Booking', BOOKING_TRANSITIONS);

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.AWAITING_CONFIRMATION,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

/** Statuses in which a customer may still cancel and expect the refund ladder. */
export const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.AWAITING_CONFIRMATION,
  BookingStatus.CONFIRMED,
];

// ---------------------------------------------------------------------------
// Association alerts
// ---------------------------------------------------------------------------

const ASSOCIATION_ALERT_TRANSITIONS: Record<
  AssociationAlertStatus,
  readonly AssociationAlertStatus[]
> = {
  [AssociationAlertStatus.NOTIFIED]: [
    AssociationAlertStatus.ACKNOWLEDGED,
    // An alert nobody picks up escalates on a timer rather than going quiet.
    AssociationAlertStatus.ESCALATED,
    AssociationAlertStatus.CLOSED,
  ],
  [AssociationAlertStatus.ACKNOWLEDGED]: [
    AssociationAlertStatus.RESPONDING,
    AssociationAlertStatus.ESCALATED,
    AssociationAlertStatus.RESOLVED,
    AssociationAlertStatus.CLOSED,
  ],
  [AssociationAlertStatus.RESPONDING]: [
    AssociationAlertStatus.ESCALATED,
    AssociationAlertStatus.RESOLVED,
    AssociationAlertStatus.CLOSED,
  ],
  [AssociationAlertStatus.ESCALATED]: [
    AssociationAlertStatus.RESPONDING,
    AssociationAlertStatus.RESOLVED,
    AssociationAlertStatus.CLOSED,
  ],
  [AssociationAlertStatus.RESOLVED]: [AssociationAlertStatus.CLOSED],
  [AssociationAlertStatus.CLOSED]: [],
};

export const associationAlertStateMachine = buildValidator(
  'Association alert',
  ASSOCIATION_ALERT_TRANSITIONS,
);

export const OPEN_ASSOCIATION_ALERT_STATUSES: AssociationAlertStatus[] = [
  AssociationAlertStatus.NOTIFIED,
  AssociationAlertStatus.ACKNOWLEDGED,
  AssociationAlertStatus.RESPONDING,
  AssociationAlertStatus.ESCALATED,
];

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * Device statuses that may submit telemetry.
 *
 * OFFLINE is included on purpose: "offline" is Saarthi's opinion, formed from
 * silence, and a device coming back after a tunnel or a dead SIM must be able
 * to report again without an operator clicking anything. SUSPENDED and RETIRED
 * are not included — those are decisions, and telemetry from them is rejected.
 */
export const TELEMETRY_ELIGIBLE_DEVICE_STATUSES: DeviceStatus[] = [
  DeviceStatus.REGISTERED,
  DeviceStatus.ACTIVE,
  DeviceStatus.OFFLINE,
];

/** Device statuses that may be assigned to a vehicle. */
export const ASSIGNABLE_DEVICE_STATUSES: DeviceStatus[] = [
  DeviceStatus.REGISTERED,
  DeviceStatus.ACTIVE,
  DeviceStatus.OFFLINE,
  DeviceStatus.INACTIVE,
];

/**
 * Whether a role may only be filled by one device per vehicle.
 *
 * A vehicle is allowed to carry a telematics unit, a multi-camera recorder and
 * a phone at the same time — that is the whole point of separating the device
 * from the vehicle. What it may not carry is two position sources: a truck
 * whose Freematics and whose phone disagree about where it is produces a map
 * that flickers between two points and a support call nobody can settle. So the
 * exclusivity is on the *role*, not on the device.
 */
export function roleIsExclusivePerVehicle(role: DeviceRole): boolean {
  return role === DeviceRole.TELEMETRY;
}

/**
 * The role a device plays, falling back to its hardware family.
 *
 * Stored devices carry an explicit role; the fallback exists for records
 * created before the column did, and for adapters describing a unit they have
 * only just met.
 */
export function resolveDeviceRole(
  provider: DeviceProvider,
  explicit?: DeviceRole | null,
): DeviceRole {
  return explicit ?? DEFAULT_DEVICE_ROLE[provider] ?? DeviceRole.AUXILIARY;
}

// ---------------------------------------------------------------------------
// Vehicle resale listings
// ---------------------------------------------------------------------------

/**
 * A listing can come back from RESERVED to PUBLISHED because buyers walk away,
 * and re-listing must not require recreating the record — the price history,
 * the offers and the evidence pack all belong to the same listing.
 */
const VEHICLE_LISTING_TRANSITIONS: Record<
  VehicleListingStatus,
  readonly VehicleListingStatus[]
> = {
  [VehicleListingStatus.DRAFT]: [
    VehicleListingStatus.PENDING_REVIEW,
    VehicleListingStatus.PUBLISHED,
    VehicleListingStatus.WITHDRAWN,
  ],
  [VehicleListingStatus.PENDING_REVIEW]: [
    VehicleListingStatus.PUBLISHED,
    VehicleListingStatus.REJECTED,
    VehicleListingStatus.WITHDRAWN,
  ],
  [VehicleListingStatus.PUBLISHED]: [
    VehicleListingStatus.RESERVED,
    VehicleListingStatus.SOLD,
    VehicleListingStatus.WITHDRAWN,
    VehicleListingStatus.EXPIRED,
  ],
  [VehicleListingStatus.RESERVED]: [
    VehicleListingStatus.SOLD,
    VehicleListingStatus.PUBLISHED,
    VehicleListingStatus.WITHDRAWN,
  ],
  [VehicleListingStatus.REJECTED]: [VehicleListingStatus.DRAFT, VehicleListingStatus.WITHDRAWN],
  [VehicleListingStatus.EXPIRED]: [VehicleListingStatus.DRAFT, VehicleListingStatus.PUBLISHED],
  [VehicleListingStatus.WITHDRAWN]: [VehicleListingStatus.DRAFT],
  [VehicleListingStatus.SOLD]: [],
};

export const vehicleListingStateMachine = buildValidator(
  'Listing',
  VEHICLE_LISTING_TRANSITIONS,
);

/** Statuses that occupy a vehicle, so it cannot be listed twice. */
export const OCCUPYING_LISTING_STATUSES: VehicleListingStatus[] = [
  VehicleListingStatus.DRAFT,
  VehicleListingStatus.PENDING_REVIEW,
  VehicleListingStatus.PUBLISHED,
  VehicleListingStatus.RESERVED,
];

/** Statuses a buyer may see when browsing. */
export const BROWSABLE_LISTING_STATUSES: VehicleListingStatus[] = [
  VehicleListingStatus.PUBLISHED,
  VehicleListingStatus.RESERVED,
];

const VEHICLE_TRANSFER_TRANSITIONS: Record<
  VehicleTransferStatus,
  readonly VehicleTransferStatus[]
> = {
  [VehicleTransferStatus.PENDING]: [
    VehicleTransferStatus.DOCUMENTS_PENDING,
    VehicleTransferStatus.CANCELLED,
  ],
  [VehicleTransferStatus.DOCUMENTS_PENDING]: [
    VehicleTransferStatus.PAYMENT_PENDING,
    VehicleTransferStatus.CANCELLED,
  ],
  [VehicleTransferStatus.PAYMENT_PENDING]: [
    VehicleTransferStatus.COMPLETED,
    VehicleTransferStatus.CANCELLED,
  ],
  [VehicleTransferStatus.COMPLETED]: [],
  [VehicleTransferStatus.CANCELLED]: [],
};

export const vehicleTransferStateMachine = buildValidator(
  'Transfer',
  VEHICLE_TRANSFER_TRANSITIONS,
);

// ---------------------------------------------------------------------------
// Last-mile relay
// ---------------------------------------------------------------------------

/**
 * A relay leg can be cancelled at any point before the goods are on the pickup,
 * and fails rather than cancels once they are — the difference matters because a
 * failure leaves cargo somewhere that has to be resolved.
 */
const RELAY_TRANSITIONS: Record<RelayStatus, readonly RelayStatus[]> = {
  [RelayStatus.DRAFT]: [RelayStatus.REQUESTED, RelayStatus.CANCELLED],
  [RelayStatus.REQUESTED]: [
    RelayStatus.OFFERED,
    RelayStatus.ASSIGNED,
    RelayStatus.CANCELLED,
  ],
  [RelayStatus.OFFERED]: [RelayStatus.ASSIGNED, RelayStatus.REQUESTED, RelayStatus.CANCELLED],
  [RelayStatus.ASSIGNED]: [RelayStatus.EN_ROUTE_TO_HUB, RelayStatus.CANCELLED],
  [RelayStatus.EN_ROUTE_TO_HUB]: [RelayStatus.AT_HUB, RelayStatus.CANCELLED],
  [RelayStatus.AT_HUB]: [RelayStatus.LOADED, RelayStatus.FAILED, RelayStatus.CANCELLED],
  [RelayStatus.LOADED]: [RelayStatus.IN_TRANSIT, RelayStatus.FAILED],
  [RelayStatus.IN_TRANSIT]: [RelayStatus.DELIVERED, RelayStatus.FAILED],
  [RelayStatus.DELIVERED]: [],
  [RelayStatus.FAILED]: [],
  [RelayStatus.CANCELLED]: [],
};

export const relayStateMachine = buildValidator('Relay leg', RELAY_TRANSITIONS);

export const ACTIVE_RELAY_STATUSES: RelayStatus[] = [
  RelayStatus.REQUESTED,
  RelayStatus.OFFERED,
  RelayStatus.ASSIGNED,
  RelayStatus.EN_ROUTE_TO_HUB,
  RelayStatus.AT_HUB,
  RelayStatus.LOADED,
  RelayStatus.IN_TRANSIT,
];

/** Statuses where the goods are in the pickup partner's custody. */
export const RELAY_CUSTODY_STATUSES: RelayStatus[] = [
  RelayStatus.LOADED,
  RelayStatus.IN_TRANSIT,
];

// ---------------------------------------------------------------------------
// Return loads
// ---------------------------------------------------------------------------

const RETURN_LOAD_TRANSITIONS: Record<ReturnLoadStatus, readonly ReturnLoadStatus[]> = {
  [ReturnLoadStatus.OPEN]: [
    ReturnLoadStatus.MATCHED,
    ReturnLoadStatus.BOOKED,
    ReturnLoadStatus.EXPIRED,
    ReturnLoadStatus.CANCELLED,
  ],
  // Matches are suggestions, so a matched request can go quiet again.
  [ReturnLoadStatus.MATCHED]: [
    ReturnLoadStatus.BOOKED,
    ReturnLoadStatus.OPEN,
    ReturnLoadStatus.EXPIRED,
    ReturnLoadStatus.CANCELLED,
  ],
  [ReturnLoadStatus.BOOKED]: [ReturnLoadStatus.COMPLETED, ReturnLoadStatus.CANCELLED],
  [ReturnLoadStatus.EXPIRED]: [ReturnLoadStatus.OPEN],
  [ReturnLoadStatus.COMPLETED]: [],
  [ReturnLoadStatus.CANCELLED]: [],
};

export const returnLoadStateMachine = buildValidator(
  'Return load request',
  RETURN_LOAD_TRANSITIONS,
);

export const OPEN_RETURN_LOAD_STATUSES: ReturnLoadStatus[] = [
  ReturnLoadStatus.OPEN,
  ReturnLoadStatus.MATCHED,
];
