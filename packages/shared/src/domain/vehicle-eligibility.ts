/**
 * Which kinds of vehicle an account may onboard.
 *
 * Checked at the vehicle boundary — when a vehicle is added or its type is
 * changed — rather than by hiding features globally. The rule follows the
 * account's operational context:
 *
 *   • Personal              → normal vehicles, never a truck
 *   • Business fleet owner  → trucks only
 *   • Business mobility     → passenger vehicles, never a truck
 *   • Free, Supplier, …     → no vehicle at all (`accountRunsVehicles`)
 *
 * Any other vehicle-running account (an enterprise fleet) may run any type.
 */

import { OrganizationType, PlanTier, VehicleCapability, VehicleType } from './enums';
import { accountRunsVehicles } from './entitlements';
import { VEHICLE_TYPE_CATALOGUE, vehicleTypeDefinition } from './vehicles';

/**
 * Goods-only carriers — what "truck" means for these rules.
 *
 * A van carries people as well as cargo, so it is not a truck here.
 */
export const TRUCK_VEHICLE_TYPES: readonly VehicleType[] = VEHICLE_TYPE_CATALOGUE.filter(
  (definition) =>
    definition.capabilities.includes(VehicleCapability.FREIGHT) &&
    !definition.capabilities.includes(VehicleCapability.PASSENGER_TRANSPORT),
).map((definition) => definition.type);

const ALL_VEHICLE_TYPES = [...new Set(VEHICLE_TYPE_CATALOGUE.map((definition) => definition.type))];
const NON_TRUCK_VEHICLE_TYPES = ALL_VEHICLE_TYPES.filter(
  (type) => !TRUCK_VEHICLE_TYPES.includes(type),
);

export interface VehicleEligibilityContext {
  tier: PlanTier | null | undefined;
  organizationType: OrganizationType | null | undefined;
}

/** The vehicle types this account may onboard. Empty when it runs none. */
export function allowedVehicleTypes(context: VehicleEligibilityContext): VehicleType[] {
  if (!accountRunsVehicles(context)) return [];
  if (context.tier === PlanTier.PERSONAL) return NON_TRUCK_VEHICLE_TYPES;
  if (context.organizationType === OrganizationType.FLEET_OWNER) return [...TRUCK_VEHICLE_TYPES];
  if (context.organizationType === OrganizationType.MOBILITY_PROVIDER) {
    return NON_TRUCK_VEHICLE_TYPES;
  }
  return ALL_VEHICLE_TYPES;
}

/**
 * Why this account may not onboard this vehicle type, or `null` when it may.
 *
 * Returned as a sentence so the API and the vehicle form refuse with the same
 * words.
 */
export function vehicleTypeRefusal(
  context: VehicleEligibilityContext,
  vehicleType: VehicleType,
): string | null {
  const allowed = allowedVehicleTypes(context);
  if (allowed.includes(vehicleType)) return null;
  if (allowed.length === 0) return 'This account does not run vehicles, so none can be added to it.';

  const label = vehicleTypeDefinition(vehicleType).label.toLowerCase();
  if (context.tier === PlanTier.PERSONAL) {
    return `A ${label} cannot be added on Saarthi Personal. Trucks belong on a Business fleet account.`;
  }
  if (context.organizationType === OrganizationType.FLEET_OWNER) {
    return `A fleet owner account runs trucks. A ${label} belongs on a Personal or mobility account.`;
  }
  return `A ${label} cannot be added to a tour, travel or mobility account. Trucks belong on a fleet owner account.`;
}
