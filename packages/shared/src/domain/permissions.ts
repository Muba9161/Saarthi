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

  // Platform administration
  ADMIN_USERS: 'admin.users',
  ADMIN_ORGANIZATIONS: 'admin.organizations',
  ADMIN_AUDIT: 'admin.audit',
  ADMIN_PLATFORM: 'admin.platform',
  ADMIN_SIMULATOR: 'admin.simulator',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

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
  Permission.ANALYTICS_READ,
  Permission.SUBSCRIPTION_READ,
  Permission.NOTIFICATIONS_READ,
  Permission.NEARBY_READ,
  Permission.AI_USE,
  Permission.MATERIALS_READ,
  Permission.SUPPLIERS_READ,
];

const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.PLATFORM_ADMIN]: [...ALL_PERMISSIONS],

  [RoleName.FLEET_OWNER]: [
    ...FLEET_MANAGER_PERMISSIONS,
    Permission.ORG_UPDATE,
    Permission.ORG_MEMBERS_MANAGE,
    Permission.TRUCKS_DELETE,
    Permission.DRIVERS_SCORE_ADJUST,
    Permission.ANALYTICS_FINANCIAL,
    Permission.SUBSCRIPTION_MANAGE,
  ],

  [RoleName.FLEET_MANAGER]: [...FLEET_MANAGER_PERMISSIONS],

  [RoleName.DISPATCHER]: [
    Permission.ORG_READ,
    Permission.TRUCKS_READ,
    Permission.TRUCKS_ASSIGN,
    Permission.DRIVERS_READ,
    Permission.DOCUMENTS_READ,
    Permission.ORDERS_READ,
    Permission.ORDERS_MANAGE,
    Permission.ORDERS_QUOTE,
    Permission.TRIPS_READ,
    Permission.TRIPS_MANAGE,
    Permission.TRACKING_READ,
    Permission.TRACKING_HISTORY,
    Permission.SOS_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.NEARBY_READ,
    Permission.ANALYTICS_READ,
  ],

  [RoleName.DRIVER]: [
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
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.ANALYTICS_READ,
    Permission.SUBSCRIPTION_READ,
  ],

  [RoleName.CUSTOMER]: [
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.SUPPLIERS_READ,
    Permission.MATERIALS_READ,
    Permission.ORDERS_READ,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_RATE,
    Permission.DOCUMENTS_READ,
    Permission.DOCUMENTS_UPLOAD,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_SUBMIT,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.NOTIFICATIONS_READ,
    Permission.SUBSCRIPTION_READ,
  ],

  [RoleName.SUPPORT_AGENT]: [
    Permission.ORG_READ,
    Permission.TRUCKS_READ,
    Permission.DRIVERS_READ,
    Permission.DOCUMENTS_READ,
    Permission.VERIFICATION_READ,
    Permission.VERIFICATION_REVIEW,
    Permission.ORDERS_READ,
    Permission.TRIPS_READ,
    Permission.TRACKING_READ,
    Permission.SOS_READ,
    Permission.SOS_MANAGE,
    Permission.NOTIFICATIONS_READ,
    Permission.ADMIN_AUDIT,
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
