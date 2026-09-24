import { useQuery } from '@tanstack/react-query';
import { Permission } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PAYOUT_ACCOUNT_KEY, PayoutAccountCard } from '@/features/marketplace-finance/payout-account-card';
import { CommissionHistory } from '@/features/marketplace-finance/commission-history';
import type { PayoutAccountView } from '@/features/marketplace-finance/types';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';

/**
 * Where marketplace money lands, and what Saarthi took from it.
 *
 * Saarthi never holds the money: customers pay through its Cashfree checkout
 * and each party's share is split straight to their verified bank account.
 */
export function PayoutsPage() {
  const { can } = useAuth();
  const allowed = can(Permission.PAYOUT_ACCOUNT_MANAGE);

  const account = useQuery({
    queryKey: PAYOUT_ACCOUNT_KEY,
    queryFn: () => api.get<PayoutAccountView>('/finance/payout-account'),
    enabled: allowed,
  });

  if (!allowed) return <UnauthorizedState />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Payouts & commission"
        description="Connect the bank account your marketplace payments settle into, and see the commission Saarthi takes on your profit."
      />
      {account.isLoading ? (
        <LoadingState />
      ) : account.error || !account.data ? (
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      ) : (
        <PayoutAccountCard account={account.data} />
      )}
      {can(Permission.MARKETPLACE_FINANCE_READ) ? <CommissionHistory /> : null}
    </div>
  );
}

export default PayoutsPage;
