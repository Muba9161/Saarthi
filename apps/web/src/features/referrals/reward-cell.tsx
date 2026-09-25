import { WalletEntryStatus, formatCurrency, formatDate } from '@saarthi/shared';
import { StatusBadge } from '@/components/common/status-badge';

export interface RewardState {
  amount: number;
  status: WalletEntryStatus;
  availableAt: string;
}

/**
 * One referral's reward, for a history table — Refer & Earn and a
 * salesperson's customers alike. Null means the referral earned nothing,
 * because the account started on the Free plan.
 */
export function RewardCell({ reward }: { reward: RewardState | null }) {
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
