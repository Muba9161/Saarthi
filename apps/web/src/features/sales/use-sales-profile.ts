import { useQuery } from '@tanstack/react-query';
import { Permission } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import type { SalesMeResponse } from './types';

/**
 * The signed-in salesperson's own profile.
 *
 * Every Sales screen needs it, for one reason: an unverified GODID has to be
 * *explained* rather than hidden behind an empty page. A salesperson whose
 * profile is still `PENDING_VERIFICATION` sees their pipeline and a banner
 * saying what Saarthi is waiting on — which is a far better answer than a
 * dashboard of zeros with no cause.
 *
 * Long stale time: verification changes when an administrator acts, not while
 * somebody is looking at a screen.
 */
export function useSalesProfile() {
  const { can } = useAuth();
  const enabled = can(Permission.SALES_READ);

  const query = useQuery({
    queryKey: ['/sales/me'],
    queryFn: () => api.get<SalesMeResponse>('/sales/me'),
    enabled,
    staleTime: 5 * 60_000,
  });

  return {
    ...query,
    /** The profile, or null while loading and for a caller who has none. */
    profile: query.data?.profile ?? null,
    /** True when this profile may share a referral link and earn commission. */
    canSell: query.data?.profile?.canSell ?? false,
    godWebVerificationAvailable: query.data?.godWebVerificationAvailable ?? false,
    attributionWindowDays: query.data?.attributionWindowDays ?? null,
    enabled,
  };
}
