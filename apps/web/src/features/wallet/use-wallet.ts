import { useQuery } from '@tanstack/react-query';
import type { WalletSummary } from '@saarthi/shared';
import { api } from '@/lib/api-client';

export const WALLET_KEY = ['wallet'] as const;

/**
 * The signed-in person's wallet. One query key, so the earnings banner, the
 * cash-out panel and the profile menu share a single request.
 *
 * A short stale time so opening and closing the profile menu does not refetch
 * every time; a cash-out invalidates the key, so a spent balance never lingers.
 */
export function useWallet({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => api.get<WalletSummary>('/wallet'),
    enabled,
    staleTime: 60_000,
  });
}
