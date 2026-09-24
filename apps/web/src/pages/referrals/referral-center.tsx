import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Gift, Link2, Share2 } from 'lucide-react';
import {
  WalletEntryStatus,
  canJoinReferralProgram,
  formatCurrency,
  formatDate,
  type ReferralProgramSummary,
  type UserReferralView,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { EarningsBanner } from '@/features/referrals/earnings-banner';
import { ShareLinks } from '@/features/referrals/share-links';
import { WalletPanel } from '@/features/wallet/wallet-panel';
import { useWallet } from '@/features/wallet/use-wallet';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Refer & Earn — the Referral Center.
 *
 * Reached from the profile menu, deliberately not from the dashboard or the
 * public site: it is something an existing user looks for, not something that
 * should compete with the work they came to do.
 *
 * The reward figure and hold come from the API, which reads them from
 * configuration, so this screen always states the rule actually in force.
 */

function copyToClipboard(value: string, label: string): void {
  void navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copied.`))
    .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
}

/** Most phones have a system share sheet, which reaches apps the row below cannot — Instagram, say. */
const canUseShareSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function openShareSheet(summary: ReferralProgramSummary): void {
  navigator.share({ title: 'Saarthi', text: summary.shareText }).catch((error: unknown) => {
    // Closing the sheet is a choice, not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    toast.error('Could not open sharing on this device.');
  });
}

function RewardCell({ reward }: { reward: UserReferralView['reward'] }) {
  if (!reward) {
    return <span className="text-sm text-muted-foreground">No reward (Free plan)</span>;
  }
  const note =
    reward.status === WalletEntryStatus.HELD
      ? `Unlocks ${formatDate(reward.availableAt)}`
      : reward.status === WalletEntryStatus.AVAILABLE
        ? 'In your wallet'
        : 'Trial ended early';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium tabular-nums">{formatCurrency(reward.amount)}</span>
      <StatusBadge status={reward.status} />
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

const columns: Column<UserReferralView>[] = [
  {
    key: 'account',
    header: 'Referred account',
    cell: (row) => <span className="font-medium">{row.organizationName ?? '-'}</span>,
  },
  {
    key: 'signedUp',
    header: 'Joined',
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.signedUpAt)}</span>
    ),
  },
  {
    key: 'reward',
    header: 'Reward',
    cell: (row) => <RewardCell reward={row.reward} />,
  },
  {
    key: 'subscribed',
    header: 'Subscribed on',
    hideOnMobile: true,
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.qualifiedAt ? formatDate(row.qualifiedAt) : '-'}
      </span>
    ),
  },
];

export function ReferralCenterPage(): React.ReactElement {
  const { session } = useAuth();
  const eligible = canJoinReferralProgram(session?.user.roles ?? []);
  const [page, setPage] = React.useState(1);

  const summary = useQuery({
    queryKey: ['referral-program', 'me'],
    queryFn: () => api.get<ReferralProgramSummary>('/referral-program/me'),
    enabled: eligible,
  });

  const referrals = useQuery({
    queryKey: ['referral-program', 'referrals', page],
    queryFn: () =>
      api.get<Paginated<UserReferralView>>('/referral-program/me/referrals', {
        page,
        pageSize: 20,
      }),
    enabled: eligible,
    placeholderData: keepPreviousData,
  });

  const wallet = useWallet();

  const amount = summary.data ? formatCurrency(summary.data.reward.amount) : null;

  const header = (
    <PageHeader
      eyebrow="Account"
      title="Refer & earn"
      description={
        amount
          ? `Share Saarthi with your network. Earn ${amount} for every friend who starts a paid Saarthi trial with your code.`
          : 'Share Saarthi with your network and earn for every friend who joins.'
      }
    />
  );

  if (!eligible) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <AlertDescription className="text-sm">
            As a Saarthi salesperson you refer customers through your GODID link, which is credited
            to your sales commission.{' '}
            <Link to="/sales/referrals" className="font-medium underline underline-offset-2">
              Open my referral link
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = summary.data;

  return (
    <div className="space-y-6">
      {header}

      {summary.isLoading ? (
        <LoadingState label="Loading your referral code…" />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : data ? (
        <>
          <EarningsBanner
            earned={data.stats.earned}
            available={wallet.data?.available ?? null}
            held={wallet.data?.held ?? null}
            rewarded={data.stats.rewarded}
            referrals={data.stats.total}
            rewardAmount={data.reward.amount}
          />

          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="space-y-2">
                <p className="section-label">Your referral code</p>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 py-2 pl-4 pr-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-wider">
                    {data.code}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(data.code, 'Code')}
                    aria-label="Copy referral code"
                  >
                    <Copy className="size-4" />
                    Copy
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="section-label">Share with friends</p>
                {/* One row on a wide screen: the platforms, then the two
                    general-purpose actions. Wraps on smaller ones. */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <ShareLinks url={data.url} text={data.shareText} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => copyToClipboard(data.url, 'Link')}>
                      <Link2 className="size-4" />
                      Copy link
                    </Button>
                    {canUseShareSheet ? (
                      <Button onClick={() => openShareSheet(data)}>
                        <Share2 className="size-4" />
                        More apps
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {amount} lands in your wallet the moment your friend starts a paid-plan trial. They
                don&apos;t have to pay first, and it unlocks for cash-out after{' '}
                {data.reward.holdDays} days.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

      <WalletPanel />

      <section className="space-y-3">
        <SectionHeader
          title="Referral history"
          description="Everyone who created a Saarthi account with your code."
        />
        <DataTable
          columns={columns}
          rows={referrals.data?.items}
          rowKey={(row) => row.id}
          isLoading={referrals.isLoading}
          error={referrals.error}
          onRetry={() => void referrals.refetch()}
          {...(referrals.data?.pagination ? { pagination: referrals.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No referrals yet"
          emptyDescription="Share your code or link. People who sign up with it will appear here."
        />
      </section>

      <p className="text-xs text-muted-foreground">
        A referral counts once, for the first code a new account signs up with. Free-plan signups
        earn no reward. A reward is cancelled if your friend&apos;s trial or plan ends before it
        unlocks.
      </p>
    </div>
  );
}

export default ReferralCenterPage;
