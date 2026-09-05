/**
 * Saarthi RBAC catalogue.
 *
 * Permissions are plain dotted strings so they can be persisted, logged and
 * compared cheaply. The role → permission mapping lives here (shared) so the
 * frontend can render the right navigation, but the API is the *only* place
 * where the check is authoritative.
 */

import { RoleName } from './enums';

export const Permission = {
  // Organizations & members
  ORG_READ: 'org.read',
  ORG_UPDATE: 'org.update',
  ORG_MEMBERS_READ: 'org.members.read',
  ORG_MEMBERS_MANAGE: 'org.members.manage',

  // Fleet / trucks
  TRUCKS_READ: 'fleet.trucks.read',
  TRUCKS_CREATE: 'fleet.trucks.create',
  TRUCKS_UPDATE: 'fleet.trucks.update',
  TRUCKS_DELETE: 'fleet.trucks.delete',
  TRUCKS_ASSIGN: 'fleet.trucks.assign',

  // Drivers
  DRIVERS_READ: 'drivers.read',
  DRIVERS_MANAGE: 'drivers.manage',
  DRIVERS_SCORE_READ: 'drivers.score.read',
  DRIVERS_SCORE_ADJUST: 'drivers.score.adjust',

  // Documents
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_UPLOAD: 'documents.upload',
  DOCUMENTS_DELETE: 'documents.delete',
  DOCUMENTS_VERIFY: 'documents.verify',

  // Verification cases
  VERIFICATION_READ: 'verification.read',
  VERIFICATION_SUBMIT: 'verification.submit',
  VERIFICATION_REVIEW: 'verification.review',

  // Suppliers & materials
  SUPPLIERS_READ: 'suppliers.read',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  MATERIALS_READ: 'materials.read',
  MATERIALS_MANAGE: 'materials.manage',

  // Customers
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_MANAGE: 'customers.manage',

  // Requirements — the customer's cross-category request for quotes.
  //
  // Deliberately its own group rather than an extension of `orders.*`. An
  // order is a freight consignment; a requirement may be a cab, a tour or a
  // load of cement, and the businesses that answer it are different in each
  // case. Folding the two would have meant granting a tour operator the
  // freight order surface just so it could see a customer asking for a car.
  REQUIREMENTS_READ: 'requirements.read',
  REQUIREMENTS_CREATE: 'requirements.create',
  /** Award, shortlist, cancel — the customer's own requirement. */
  REQUIREMENTS_MANAGE: 'requirements.manage',
  /** Answer somebody else's requirement with a priced offer. */
  REQUIREMENTS_BID: 'requirements.bid',

  // Orders
  ORDERS_READ: 'orders.read',
  ORDERS_CREATE: 'orders.create',
  ORDERS_MANAGE: 'orders.manage',
  ORDERS_QUOTE: 'orders.quote',
  ORDERS_RATE: 'orders.rate',

  // Trips
  TRIPS_READ: 'trips.read',
  TRIPS_MANAGE: 'trips.manage',
  TRIPS_DRIVE: 'trips.drive',

  // Tracking
  TRACKING_READ: 'tracking.read',
  TRACKING_INGEST: 'tracking.ingest',
  TRACKING_HISTORY: 'tracking.history',

  // SOS
  SOS_READ: 'sos.read',
  SOS_TRIGGER: 'sos.trigger',
  SOS_RESPOND: 'sos.respond',
  SOS_MANAGE: 'sos.manage',

  // Vehicle finance — loans and EMI.
  //
  // Private financial data, so it sits alongside ANALYTICS_FINANCIAL rather
  // than with the operational fleet grants: a manager who can dispatch a truck
  // has no automatic business seeing what is still owed on it.
  LOANS_READ: 'loans.read',
  LOANS_MANAGE: 'loans.manage',
  /** Unmasked loan and mandate references. Owner-level by default. */
  LOANS_SENSITIVE: 'loans.sensitive',

  // FASTag & toll.
  //
  // Unlike loans, toll is an operational cost a dispatcher legitimately works
  // with, so read and manage sit in the general fleet grant. Only the tag
  // identifier itself is owner-level: it is a payment instrument, and enough to
  // query or dispute somebody's account.
  TOLL_READ: 'toll.read',
  TOLL_MANAGE: 'toll.manage',
  /** Unmasked FASTag id and the linked account reference. */
  FASTAG_SENSITIVE: 'toll.fastag.sensitive',

  // Maintenance & fuel
  MAINTENANCE_READ: 'maintenance.read',
  MAINTENANCE_MANAGE: 'maintenance.manage',
  FUEL_READ: 'fuel.read',
  FUEL_MANAGE: 'fuel.manage',

  // Analytics
  ANALYTICS_READ: 'analytics.read',
  ANALYTICS_FINANCIAL: 'analytics.financial',

  // Subscriptions
  SUBSCRIPTION_READ: 'subscription.read',
  SUBSCRIPTION_MANAGE: 'subscription.manage',

  // Notifications
  NOTIFICATIONS_READ: 'notifications.read',

  // AI
  AI_USE: 'ai.use',

  // Nearby
  NEARBY_READ: 'nearby.read',

  // Vehicle registration (RC) lookup
  VEHICLE_LOOKUP: 'vehicles.lookup',
  /** Owner identity, address, engine and chassis numbers on an RC record. */
  VEHICLE_LOOKUP_SENSITIVE: 'vehicles.lookup.sensitive',

  // Driving licence (RTO) lookup
  DRIVER_LICENCE_LOOKUP: 'drivers.licence.lookup',
  /** Holder name, parentage, addresses and blood group on a licence record. */
  DRIVER_LICENCE_LOOKUP_SENSITIVE: 'drivers.licence.lookup.sensitive',

  // Vehicles.
  //
  // Deliberately reuses the `fleet.trucks.*` strings. The generalized vehicle
  // surface reads and writes the same rows as the truck surface, so granting a
  // separate permission would let an operator hold one and not the other while
  // both reach the same record. Every existing role grant therefore carries
  // over to vehicles unchanged.
  VEHICLES_READ: 'fleet.trucks.read',
  VEHICLES_CREATE: 'fleet.trucks.create',
  VEHICLES_UPDATE: 'fleet.trucks.update',
  VEHICLES_DELETE: 'fleet.trucks.delete',
  VEHICLES_ASSIGN: 'fleet.trucks.assign',

  // Truck associations
  ASSOCIATION_READ: 'association.read',
  ASSOCIATION_MANAGE: 'association.manage',
  ASSOCIATION_ALERTS_READ: 'association.alerts.read',
  ASSOCIATION_ALERTS_RESPOND: 'association.alerts.respond',

  // Travel & mobility provider
  PROVIDER_READ: 'provider.read',
  PROVIDER_MANAGE: 'provider.manage',
  TRAVEL_PACKAGES_READ: 'travel.packages.read',
  TRAVEL_PACKAGES_MANAGE: 'travel.packages.manage',
  TRAVEL_BROWSE: 'travel.browse',
  BOOKINGS_READ: 'bookings.read',
  BOOKINGS_CREATE: 'bookings.create',
  BOOKINGS_MANAGE: 'bookings.manage',
  BOOKINGS_RATE: 'bookings.rate',

  // Payments
  PAYMENTS_READ: 'payments.read',

  // Hardware devices.
  //
  // `manage` and `assign` are Saarthi-side: a telematics unit is a physical
  // asset Saarthi ships, tracks and supports across its whole life, so
  // registering one and moving it between vehicles stays central.
  DEVICES_READ: 'devices.read',
  DEVICES_MANAGE: 'devices.manage',
  DEVICES_ASSIGN: 'devices.assign',
  /**
   * Connect an app-based device to a vehicle in your own fleet.
   *
   * Deliberately separate from `devices.assign`. That grant covers fitted
   * hardware Saarthi provisions; this one covers a phone somebody already owns
   * running the Saarthi Device app, which a fleet must be able to connect to
   * its own truck without a support ticket — that is the entire point of a test
   * device. The boundary is enforced by device *type*: this permission issues
   * pairing codes for app-based units only, so it cannot be used to fit a
   * Freematics or claim a YC06.
   */
  DEVICES_PAIR: 'devices.pair',

  // Saarthi Terminal.
  //
  // Deliberately its own group rather than folded into `devices.*`. A terminal
  // is a device, but what these grants govern is not hardware — it is who may
  // authorise a person to take a vehicle out. Somebody who can read a fleet's
  // telematics has no automatic business making that call, and a fleet that
  // wants a yard supervisor to approve arrivals should not have to hand them
  // device management to do it.
  TERMINAL_READ: 'terminal.read',
  /**
   * Approve or reject a driver's arrival at a vehicle.
   *
   * The single most consequential grant in this module: it is what puts a
   * person behind a wheel. Held by fleet owners, mobility providers and fleet
   * managers, and by nobody else by default.
   */
  TERMINAL_APPROVE: 'terminal.approve',
  /** Connect a terminal to a vehicle, and configure the pre-trip checklist. */
  TERMINAL_MANAGE: 'terminal.manage',
  /** Ask to be assigned to a vehicle by scanning its QR. A driver's grant. */
  TERMINAL_DRIVE: 'terminal.drive',

  // Telemetry
  TELEMETRY_READ: 'telemetry.read',
  TELEMETRY_ALERTS_READ: 'telemetry.alerts.read',
  TELEMETRY_ALERTS_MANAGE: 'telemetry.alerts.manage',

  // Media library
  MEDIA_READ: 'media.read',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_DELETE: 'media.delete',
  MEDIA_MODERATE: 'media.moderate',

  // Supplier inventory
  INVENTORY_READ: 'inventory.read',
  INVENTORY_MANAGE: 'inventory.manage',

  // Vehicle resale marketplace
  RESALE_BROWSE: 'resale.browse',
  RESALE_MANAGE: 'resale.manage',
  RESALE_OFFER: 'resale.offer',
  RESALE_TRANSFER: 'resale.transfer',
  RESALE_REVIEW: 'resale.review',

  // Internal people / organization directory
  PROFILE_DIRECTORY: 'profile.directory',

  // QR identity
  QR_READ: 'qr.read',
  QR_MANAGE: 'qr.manage',
  QR_AUDIT: 'qr.audit',

  // Return loads / backhaul
  RETURN_LOADS_READ: 'returnloads.read',
  RETURN_LOADS_MANAGE: 'returnloads.manage',

  // City access restrictions
  CITY_ACCESS_READ: 'cityaccess.read',
  CITY_ACCESS_MANAGE: 'cityaccess.manage',

  // Last-mile relay
  RELAY_READ: 'relay.read',
  RELAY_MANAGE: 'relay.manage',
  RELAY_OFFER: 'relay.offer',

  // Route intelligence
  ROUTE_INTEL_READ: 'routeintel.read',
  ROUTE_INTEL_REPORT: 'routeintel.report',
  ROUTE_INTEL_MANAGE: 'routeintel.manage',
  ROUTE_INTEL_VERIFY: 'routeintel.verify',

  // Platform administration
  ADMIN_USERS: 'admin.users',
  ADMIN_ORGANIZATIONS: 'admin.organizations',
  ADMIN_AUDIT: 'admin.audit',
  ADMIN_PLATFORM: 'admin.platform',
  ADMIN_SIMULATOR: 'admin.simulator',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
/** Unique permission strings. Deduplicated because vehicles alias trucks. */
export const ALL_PERMISSIONS = [...new Set(Object.values(Permission))] as Permission[];

const FLEET_MANAGER_PERMISSIONS: Permission[] = [
  Permission.ORG_READ,
  Permission.ORG_MEMBERS_READ,
  Permission.TRUCKS_READ,
  Permission.TRUCKS_CREATE,
  Permission.TRUCKS_UPDATE,
  Permission.TRUCKS_ASSIGN,
  Permission.DRIVERS_READ,
  Permission.DRIVERS_MANAGE,
  Permission.DRIVERS_SCORE_READ,
  Permission.DOCUMENTS_READ,
  Permission.DOCUMENTS_UPLOAD,
  Permission.DOCUMENTS_DELETE,
  Permission.VERIFICATION_READ,
  Permission.VERIFICATION_SUBMIT,
  Permission.ORDERS_READ,
  Permission.ORDERS_MANAGE,
  Permission.ORDERS_QUOTE,
  // The cross-category requirement board. A fleet bids with TRANSPORT scope;
  // which kinds it is shown is decided by its organization type, not here.
  Permission.REQUIREMENTS_READ,
  Permission.REQUIREMENTS_BID,
  Permission.TRIPS_READ,
  Permission.TRIPS_MANAGE,
  Permission.TRACKING_READ,
  Permission.TRACKING_HISTORY,
  Permission.SOS_READ,
  Permission.SOS_MANAGE,
  Permission.MAINTENANCE_READ,
  Permission.MAINTENANCE_MANAGE,
  Permission.FUEL_READ,
  Permission.FUEL_MANAGE,
  Permission.TOLL_READ,
  Permission.TOLL_MANAGE,
  Permission.ANALYTICS_READ,
  Permission.SUBSCRIPTION_READ,
  Permission.NOTIFICATIONS_READ,
  Permission.NEARBY_READ,
  Permission.VEHICLE_LOOKUP,
  Permission.DRIVER_LICENCE_LOOKUP,
  Permission.AI_USE,
  Permission.MATERIALS_READ,
  Permission.SUPPLIERS_READ,
  Permission.DEVICES_READ,
  // Pairing a phone to one of the fleet's own vehicles. Not `devices.assign`:
  // fitted hardware is still provisioned centrally.
  Permission.DEVICES_PAIR,
  Permission.TELEMETRY_READ,
  Permission.TELEMETRY_ALERTS_READ,
  // Saarthi Terminal. A manager runs the yard, so a manager answers the
  // arrival queue — an approval that only an owner could give would leave a
  // driver standing at a truck until somebody woke up.
  Permission.TERMINAL_READ,
  Permission.TERMINAL_APPROVE,
  Permission.TERMINAL_MANAGE,
  Permission.PROVIDER_READ,
  Permission.TRAVEL_PACKAGES_READ,
  Permission.BOOKINGS_READ,
  Permission.MEDIA_READ,
  Permission.MEDIA_UPLOAD,
  Permission.MEDIA_DELETE,
  Permission.INVENTORY_READ,
  Permission.RESALE_BROWSE,
  Permission.RESALE_MANAGE,
  Permission.PROFILE_DIRECTORY,
  Permission.QR_READ,
  Permission.QR_MANAGE,
  Permission.RETURN_LOADS_READ,
  Permission.RETURN_LOADS_MANAGE,
  Permission.CITY_ACCESS_READ,
  Permission.RELAY_READ,
  Permission.RELAY_MANAGE,
  // A small-pickup operator is a fleet with mini trucks, so the supply side of
  // the relay market is the same grant as the demand side.
  Permission.RELAY_OFFER,
  Permission.ROUTE_INTEL_READ,
  Permission.ROUTE_INTEL_REPORT,
];

/**
 * Everything the owner of an operating business holds.
 *
 * Named rather than written inline because two roles need it: a freight fleet
 * owner and a mobility provider. They differ in what they *sell* — tonnes moved
 * against seats filled — but not in what they own. Both hold vehicles, employ
 * drivers, service and insure them, carry the finance, and answer for who is
 * driving what. A permission set that only one of them could hold would be
 * describing the commercial surface, not the responsibility.
 */
const OPERATOR_OWNER_PERMISSIONS: Permission[] = [
  ...FLEET_MANAGER_PERMISSIONS,
  Permission.ORG_UPDATE,
  Permission.ORG_MEMBERS_MANAGE,
  Permission.TRUCKS_DELETE,
  Permission.DRIVERS_SCORE_ADJUST,
  Permission.ANALYTICS_FINANCIAL,
  // Vehicle finance follows the same rule as financial analytics: the person
  // who signed for the loan is the person who sees it.
  Permission.LOANS_READ,
  Permission.LOANS_MANAGE,
  Permission.LOANS_SENSITIVE,
  // The tag id is a payment instrument identifier — owner level, like the
  // loan and mandate references above it.
  Permission.FASTAG_SENSITIVE,
  Permission.SUBSCRIPTION_MANAGE,
  Permission.VEHICLE_LOOKUP_SENSITIVE,
  Permission.DRIVER_LICENCE_LOOKUP_SENSITIVE,
  // Buying, selling and transferring an asset commits money — the owner only.
  Permission.RESALE_OFFER,
  Permission.RESALE_TRANSFER,
  // A fleet may record its own private access rules and hazards.
  Permission.CITY_ACCESS_MANAGE,
  Permission.ROUTE_INTEL_MANAGE,
  // The scan log for the fleet's own codes: who scanned their vehicle, where
  // and when. It carries scanner identity and location, so it sits at owner
  // level rather than with every manager — but withholding a fleet's own
  // operational record from its owner while granting it to Saarthi support
  // would have been backwards.
  Permission.QR_AUDIT,
  Permission.TELEMETRY_ALERTS_MANAGE,
  // Telematics hardware is provisioned and fitted by Saarthi, so an operator
  // reads its devices and works their alerts but cannot register a unit or
  // move one between vehicles — see DEVICES_MANAGE / DEVICES_ASSIGN.
  // Pairing a phone to one of its own vehicles is a lighter grant and comes
  // through FLEET_MANAGER_PERMISSIONS as DEVICES_PAIR.
  Permission.PAYMENTS_READ,
  // Selling travel is gated by organization type, not by role: only a
  // MOBILITY_PROVIDER organization may publish packages. This decides which
  // role inside such an organization may act, and a freight fleet holding it
  // still cannot sell a tour because the type guard refuses first.
  Permission.PROVIDER_MANAGE,
  Permission.TRAVEL_PACKAGES_MANAGE,
  Permission.BOOKINGS_MANAGE,
];

const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.PLATFORM_ADMIN]: [...ALL_PERMISSIONS],

  [RoleName.FLEET_OWNER]: [...OPERATOR_OWNER_PERMISSIONS],

  [RoleName.FLEET_MANAGER]: [...FLEET_MANAGER_PERMISSIONS],

  /**
   * Taxi / travel / tour operator.
   *
   * Runs vehicles and drivers like a fleet, but its commercial surface is
   * passenger journeys rather than freight: provider profile, packages and
   * bookings. Held only by a MOBILITY_PROVIDER organization, so a freight
   * fleet cannot list tour packages.
   */
  [RoleName.MOBILITY_PROVIDER]: [
    /*
     * The same grants as a fleet owner, because it is one.
     *
     * A taxi or tour operator owns vehicles, employs drivers, services and
     * insures them, carries the finance and answers for who is driving what.
     * Every one of those is the same responsibility a freight fleet owner
     * carries, and the earlier narrower list produced results that could not be
     * defended: this role could create a vehicle and read its devices, but
     * never connect one to it — visible hardware it had no way to add.
     *
     * What separates the two is what they sell, and that is enforced by the
     * organization-type guard rather than here. A freight fleet holding
     * TRAVEL_PACKAGES_MANAGE still cannot publish a tour, and a mobility
     * provider holding ORDERS_MANAGE still cannot take a freight consignment,
     * because `requireOrganizationType` refuses before any permission is read.
     */
    ...OPERATOR_OWNER_PERMISSIONS,
  ],

  [RoleName.DISPATCHER]: [
    Permission.ORG_READ,
    Permission.TRUCKS_READ,
    Permission.TRUCKS_ASSIGN,
    Permission.DRIVERS_READ,
    Permission.DOCUMENTS_READ,
    Permission.ORDERS_READ,
    Permission.ORDERS_MANAGE,
    Permission.ORDERS_QUOTE,
    Permission.REQUIREMENTS_READ,
    Permission.REQUIREMENTS_BID,
    Permission.TRIPS_READ,
    Permission.TRIPS_MANAGE,
    Permission.TRACKING_READ,
    Permission.TRACKING_HISTORY,
    Permission.SOS_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.NEARBY_READ,
    Permission.VEHICLE_LOOKUP,
    // Sees the terminal arrival queue but cannot decide it. A dispatcher
    // allocates work; authorising a person to drive is the operator's call.
    Permission.TERMINAL_READ,
    Permission.ANALYTICS_READ,
    Permission.MEDIA_READ,
    Permission.MEDIA_UPLOAD,
    Permission.INVENTORY_READ,
    Permission.RESALE_BROWSE,
    Permission.PROFILE_DIRECTORY,
    Permission.QR_READ,
    Permission.QR_MANAGE,
    Permission.RETURN_LOADS_READ,
    Permission.RETURN_LOADS_MANAGE,
    Permission.CITY_ACCESS_READ,
    Permission.RELAY_READ,
    Permission.RELAY_MANAGE,
    Permission.ROUTE_INTEL_READ,
    Permission.ROUTE_INTEL_REPORT,
    Permission.DEVICES_READ,
    Permission.TELEMETRY_READ,
    Permission.TELEMETRY_ALERTS_READ,
    Permission.BOOKINGS_READ,
    Permission.BOOKINGS_MANAGE,
  ],

  [RoleName.DRIVER]: [
    // Their own licence, and therefore their own personal details.
    Permission.DRIVER_LICENCE_LOOKUP,
    Permission.DRIVER_LICENCE_LOOKUP_SENSITIVE,
    Permission.TRUCKS_READ,
    Permission.DRIVERS_READ,
    Permission.DRIVERS_SCORE_READ,
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.TRIPS_READ,
    Permission.TRIPS_DRIVE,
    Permission.TRACKING_READ,
    Permission.TRACKING_INGEST,
    Permission.SOS_READ,
    Permission.SOS_TRIGGER,
    Permission.SOS_RESPOND,
    Permission.MAINTENANCE_READ,
    Permission.FUEL_READ,
    Permission.FUEL_MANAGE,
    Permission.NOTIFICATIONS_READ,
    Permission.NEARBY_READ,
    Permission.ORDERS_READ,
    Permission.DEVICES_READ,
    Permission.TELEMETRY_READ,
    // Walk up to a vehicle, scan its QR and ask to be assigned to it. Reading
    // is scoped by the service to the driver's own sessions.
    Permission.TERMINAL_READ,
    Permission.TERMINAL_DRIVE,
    Permission.BOOKINGS_READ,
    // A driver photographs damage, odometer readings, handovers and deliveries;
    // withholding upload would make the evidence trail depend on the office.
    Permission.MEDIA_READ,
    Permission.MEDIA_UPLOAD,
    // Read-only: the service scopes a driver to their own subjects.
    Permission.QR_READ,
    Permission.RESALE_BROWSE,
    Permission.RETURN_LOADS_READ,
    Permission.CITY_ACCESS_READ,
    Permission.RELAY_READ,
    Permission.ROUTE_INTEL_READ,
    // Crowd reporting is what makes police checking genuinely live.
    Permission.ROUTE_INTEL_REPORT,
  ],

  [RoleName.SUPPLIER]: [
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_MEMBERS_READ,
    Permission.SUPPLIERS_READ,
    Permission.SUPPLIERS_MANAGE,
    Permission.MATERIALS_READ,
    Permission.MATERIALS_MANAGE,
    Permission.ORDERS_READ,
    Permission.ORDERS_MANAGE,
    // A supplier answers material requirements with a priced offer, which is
    // the demand side it previously had no sight of at all.
    Permission.REQUIREMENTS_READ,
    Permission.REQUIREMENTS_BID,
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.ANALYTICS_READ,
    Permission.SUBSCRIPTION_READ,
    Permission.MEDIA_READ,
    Permission.MEDIA_UPLOAD,
    Permission.MEDIA_DELETE,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_MANAGE,
    Permission.RESALE_BROWSE,
    Permission.RESALE_OFFER,
    Permission.PROFILE_DIRECTORY,
    Permission.QR_READ,
    Permission.QR_MANAGE,
    Permission.CITY_ACCESS_READ,
    Permission.ROUTE_INTEL_READ,
  ],

  [RoleName.CUSTOMER]: [
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.SUPPLIERS_READ,
    Permission.MATERIALS_READ,
    Permission.ORDERS_READ,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_RATE,
    // Posting a requirement is the customer's entry point to every category,
    // so it is granted unconditionally — demand is what the marketplace runs
    // on, and gating it would starve the businesses that answer it.
    Permission.REQUIREMENTS_READ,
    Permission.REQUIREMENTS_CREATE,
    Permission.REQUIREMENTS_MANAGE,
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.SUBSCRIPTION_READ,
    Permission.TRAVEL_BROWSE,
    Permission.TRAVEL_PACKAGES_READ,
    Permission.BOOKINGS_READ,
    Permission.BOOKINGS_CREATE,
    Permission.BOOKINGS_RATE,
    Permission.PAYMENTS_READ,
    Permission.MEDIA_READ,
    Permission.MEDIA_UPLOAD,
    Permission.INVENTORY_READ,
    Permission.RESALE_BROWSE,
    Permission.RESALE_OFFER,
    Permission.PROFILE_DIRECTORY,
    Permission.QR_READ,
    // Scoped by the service to the customer's own order legs.
    Permission.RELAY_READ,
    Permission.CITY_ACCESS_READ,
    Permission.ROUTE_INTEL_READ,
  ],

  [RoleName.SUPPORT_AGENT]: [
    Permission.ORG_READ,
    Permission.TRUCKS_READ,
    Permission.DRIVERS_READ,
    Permission.DOCUMENTS_READ,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_REVIEW,
    Permission.ORDERS_READ,
    // Read-only: support explains why a bid was rejected, it does not award.
    Permission.REQUIREMENTS_READ,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.SOS_READ,
    Permission.SOS_MANAGE,
    Permission.NOTIFICATIONS_READ,
    Permission.ADMIN_AUDIT,
    Permission.ASSOCIATION_READ,
    Permission.ASSOCIATION_ALERTS_READ,
    Permission.DEVICES_READ,
    Permission.TELEMETRY_READ,
    Permission.TELEMETRY_ALERTS_READ,
    Permission.BOOKINGS_READ,
    Permission.MEDIA_READ,
    Permission.INVENTORY_READ,
    Permission.RESALE_BROWSE,
    Permission.PROFILE_DIRECTORY,
    Permission.QR_READ,
    // Support investigates disputed scans, so it reads the scan log.
    Permission.QR_AUDIT,
    // "My EMI reminder never arrived" is a support ticket, so support can see
    // the schedule — but LOANS_SENSITIVE is deliberately withheld, so the loan
    // account number and the NACH mandate reference stay masked. Reading a
    // schedule to explain a reminder needs neither.
    Permission.LOANS_READ,
    Permission.RETURN_LOADS_READ,
    Permission.CITY_ACCESS_READ,
    Permission.RELAY_READ,
    Permission.ROUTE_INTEL_READ,
    Permission.ROUTE_INTEL_VERIFY,
  ],

  // ---------------------------------------------------------------------
  // Truck association roles
  //
  // Note what is absent: no order, customer, financial, document or telemetry
  // permission. An association coordinates roadside assistance, so its grant is
  // limited to the alert queue and its own organization profile. Spec section 9
  // requires data minimisation; this is where it is enforced.
  // ---------------------------------------------------------------------
  [RoleName.ASSOCIATION_ADMIN]: [
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_MEMBERS_READ,
    Permission.ORG_MEMBERS_MANAGE,
    Permission.ASSOCIATION_READ,
    Permission.ASSOCIATION_MANAGE,
    Permission.ASSOCIATION_ALERTS_READ,
    Permission.ASSOCIATION_ALERTS_RESPOND,
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.NOTIFICATIONS_READ,
    Permission.NEARBY_READ,
    Permission.ANALYTICS_READ,
    Permission.MEDIA_READ,
    Permission.MEDIA_UPLOAD,
    Permission.RESALE_BROWSE,
    Permission.PROFILE_DIRECTORY,
    Permission.CITY_ACCESS_READ,
    Permission.ROUTE_INTEL_READ,
    Permission.ROUTE_INTEL_REPORT,
  ],

  [RoleName.ASSOCIATION_RESPONDER]: [
    Permission.ORG_READ,
    Permission.ASSOCIATION_READ,
    Permission.ASSOCIATION_ALERTS_READ,
    Permission.ASSOCIATION_ALERTS_RESPOND,
    Permission.NOTIFICATIONS_READ,
    Permission.NEARBY_READ,
    Permission.MEDIA_READ,
    // A responder scans the stricken vehicle to identify it at the roadside.
    Permission.QR_READ,
    Permission.ROUTE_INTEL_READ,
    Permission.ROUTE_INTEL_REPORT,
  ],
};

/** Permissions granted by a single role. */
export function permissionsForRole(role: RoleName): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Union of permissions granted by every supplied role. */
export function permissionsForRoles(roles: readonly RoleName[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of permissionsForRole(role)) set.add(permission);
  }
  return [...set];
}

export function hasPermission(
  granted: readonly Permission[] | readonly string[],
  required: Permission,
): boolean {
  return (granted as readonly string[]).includes(required);
}

export function hasAnyPermission(
  granted: readonly Permission[] | readonly string[],
  required: readonly Permission[],
): boolean {
  return required.some((permission) => hasPermission(granted, permission));
}

export function hasAllPermissions(
  granted: readonly Permission[] | readonly string[],
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasPermission(granted, permission));
}

export { ROLE_PERMISSIONS };

// ---------------------------------------------------------------------------
// Role audiences for organization-wide notifications
// ---------------------------------------------------------------------------

/**
 * Who inside an operating business should hear about something.
 *
 * `notifyOrganization` addresses members by their *membership role*, so a list
 * written as `['FLEET_OWNER', 'FLEET_MANAGER']` reaches nobody in a mobility
 * provider: the person who owns a taxi business holds MOBILITY_PROVIDER, not
 * FLEET_OWNER. Every such list was written before that role existed, and the
 * result was silent — a document expiring, a device pairing, an EMI falling
 * due, and an SOS raised by one of their own drivers, all delivered to an
 * empty set.
 *
 * These three groups exist so the audience is named once. A call site picks
 * the level of responsibility it is addressing; it never enumerates roles.
 */

/** The person who signed for the business: money, finance, subscriptions. */
export const OPERATOR_OWNER_ROLES: readonly RoleName[] = Object.freeze([
  RoleName.FLEET_OWNER,
  RoleName.MOBILITY_PROVIDER,
]);

/** Owners plus the manager who runs the yard — compliance, maintenance, hardware. */
export const OPERATOR_MANAGEMENT_ROLES: readonly RoleName[] = Object.freeze([
  ...OPERATOR_OWNER_ROLES,
  RoleName.FLEET_MANAGER,
]);

/** Management plus the dispatcher who allocates work — anything time-critical. */
export const OPERATOR_OPERATIONS_ROLES: readonly RoleName[] = Object.freeze([
  ...OPERATOR_MANAGEMENT_ROLES,
  RoleName.DISPATCHER,
]);
