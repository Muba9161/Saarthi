import * as React from 'react';
import { Link } from 'react-router-dom';
import { Permission, formatCurrency } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import { EarningsBanner } from '@/features/referrals/earnings-banner';
import { WalletPanel } from '@/features/wallet/wallet-panel';
import { useWallet } from '@/features/wallet/use-wallet';
import { PageHeader } from '@/components/common/page-header';
import { UnauthorizedState } from '@/components/common/states';

/**
 * A salesperson's earnings.
 *
 * Every successful referral — a customer who starts on a paid plan through
 * their link — pays a flat reward into their Saarthi wallet. Nobody approves
 * it: it unlocks after the hold and is cashed out to their own verified bank
 * account from here. Each customer's reward is listed on the Referrals screen.
 */
export function SalesEarningsPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable } = useSalesProfile();
  const wallet = useWallet({ enabled: can(Permission.SALES_READ) });

  if (!can(Permission.SALES_READ)) return <UnauthorizedState />;

  const data = wallet.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Earnings"
        description={
          data
            ? `${formatCurrency(data.rewardAmount)} for every customer who starts a paid Saarthi plan through your link.`
            : 'A reward for every customer who starts a paid Saarthi plan through your link.'
        }
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {data ? (
        <EarningsBanner
          earned={data.totalEarned}
          available={data.available}
          held={data.held}
          rewardAmount={data.rewardAmount}
        />
      ) : null}

      <WalletPanel />

      <p className="text-xs text-muted-foreground">
        A reward unlocks {data?.holdDays ?? 7} days after the customer&apos;s trial starts, while
        their trial or plan is still active. See each customer&apos;s reward on{' '}
        <Link to="/sales/referrals" className="font-medium underline underline-offset-2">
          Referrals
        </Link>
        .
      </p>
    </div>
  );
}

export default SalesEarningsPage;
