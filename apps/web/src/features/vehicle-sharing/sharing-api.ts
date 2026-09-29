import { useQuery } from '@tanstack/react-query';
import {
  Feature,
  type SharedFuelView,
  type SharedMaintenanceView,
  type SharedTripView,
  type SharedVehicleView,
  type SharedWithMe,
  type VehicleShareView,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';

/**
 * Client side of vehicle sharing. Everything a shared person reads goes through
 * `/fleet/sharing/shares/:id/…` — never the owner's own endpoints — so these
 * are the only requests a shared screen makes.
 */

export const SHARED_WITH_ME_KEY = ['vehicle-sharing', 'shared-with-me'] as const;
export const sharesOfVehicleKey = (vehicleId: string) =>
  ['vehicle-sharing', 'vehicle', vehicleId] as const;
export const sharedVehicleKey = (shareId: string) => ['vehicle-sharing', 'share', shareId] as const;

/** Sharing is part of Personal and Business; everyone else sees none of it. */
export function useSharingAvailable(): boolean {
  const { hasFeature } = useAuth();
  return hasFeature(Feature.VEHICLE_SHARING);
}

export function useSharedWithMe(enabled = true) {
  return useQuery({
    queryKey: SHARED_WITH_ME_KEY,
    queryFn: () => api.get<SharedWithMe>('/fleet/sharing/shared-with-me'),
    enabled,
    staleTime: 30_000,
  });
}

export function useVehicleShares(vehicleId: string, enabled = true) {
  return useQuery({
    queryKey: sharesOfVehicleKey(vehicleId),
    queryFn: () => api.get<VehicleShareView[]>(`/fleet/sharing/vehicles/${vehicleId}/shares`),
    enabled,
  });
}

/** The shared vehicle itself, refreshed while open so its position keeps moving. */
export function useSharedVehicle(shareId: string) {
  return useQuery({
    queryKey: sharedVehicleKey(shareId),
    queryFn: () => api.get<SharedVehicleView>(`/fleet/sharing/shares/${shareId}/vehicle`),
    refetchInterval: 15_000,
  });
}

type Activity = 'trips' | 'fuel' | 'maintenance';
type ActivityView = {
  trips: SharedTripView;
  fuel: SharedFuelView;
  maintenance: SharedMaintenanceView;
};

export const sharedActivityKey = (shareId: string, activity: Activity) =>
  ['vehicle-sharing', 'share', shareId, activity] as const;

export function useSharedActivity<A extends Activity>(shareId: string, activity: A) {
  return useQuery({
    queryKey: sharedActivityKey(shareId, activity),
    queryFn: () => api.get<ActivityView[A][]>(`/fleet/sharing/shares/${shareId}/${activity}`),
  });
}

export function addSharedActivity(shareId: string, activity: Activity, payload: unknown) {
  return api.post(`/fleet/sharing/shares/${shareId}/${activity}`, payload);
}

export const shareVehicle = (vehicleId: string, email: string) =>
  api.post<VehicleShareView>(`/fleet/sharing/vehicles/${vehicleId}/shares`, { email });

export const respondToShare = (shareId: string, accept: boolean) =>
  api.post(`/fleet/sharing/shares/${shareId}/${accept ? 'accept' : 'decline'}`);

export const endShare = (shareId: string) => api.delete(`/fleet/sharing/shares/${shareId}`);
