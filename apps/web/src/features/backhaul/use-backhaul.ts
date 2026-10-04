import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { BackhaulOffer, BackhaulRequirement } from './types';

const offerKey = (tripId: string) => ['backhaul', 'trip', tripId] as const;
/** Exported so a placed bid can refresh the list it was placed from. */
export const backhaulRequirementsKey = (requestId: string) =>
  ['backhaul', 'requirements', requestId] as const;

export function useBackhaulOffer(tripId: string, enabled: boolean) {
  return useQuery({
    queryKey: offerKey(tripId),
    queryFn: () => api.get<BackhaulOffer>(`/return-loads/trips/${tripId}`),
    enabled: enabled && Boolean(tripId),
  });
}

export function useEnableBackhaul(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { detourToleranceKm: number }) =>
      api.post<BackhaulOffer>(`/return-loads/trips/${tripId}/enable`, {
        acceptCommission: true,
        detourToleranceKm: input.detourToleranceKm,
      }),
    onSuccess: (offer) => queryClient.setQueryData(offerKey(tripId), offer),
  });
}

export function useBackhaulRequirements(requestId: string | null) {
  return useQuery({
    queryKey: backhaulRequirementsKey(requestId ?? ''),
    queryFn: () => api.get<BackhaulRequirement[]>(`/return-loads/${requestId}/requirements`),
    enabled: Boolean(requestId),
  });
}
