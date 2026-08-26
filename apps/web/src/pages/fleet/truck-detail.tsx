/**
 * Goods-vehicle detail route (`/fleet/trucks/:id`).
 *
 * Trucks, taxis, buses and cars are one row in one table, so they get one
 * detail screen: `vehicle-detail.tsx`, which reads the vehicle's capabilities
 * and presents it as what it actually is. This module keeps the truck route —
 * and every link that already points at it, from the fleet map, a trip and a
 * driver's profile — working unchanged, while a car reached through it is no
 * longer described as a truck.
 *
 * Kept as a re-export rather than a second copy of the screen: two passports
 * drifting apart is exactly how a car ends up showing a payload in tonnes.
 */
export { VehicleDetailPage as TruckDetailPage } from './vehicle-detail';
export { default } from './vehicle-detail';
