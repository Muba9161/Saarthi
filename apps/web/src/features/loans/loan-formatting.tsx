import * as React from 'react';
import { Info } from 'lucide-react';
import {
  FinanceDataSource,
  FinanceVerificationStatus,
  InstallmentStatus,
  LoanStatus,
  humanizeEnum,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Shared presentation for vehicle finance.
 *
 * The two things this file exists to get right, everywhere finance is shown:
 *
 *   • **UNKNOWN reads as unknown.** An installment whose payment state a lender
 *     did not disclose must never be styled like a settled one. It gets its own
 *     neutral treatment and an explanation, because the honest answer to "was
 *     this paid?" is sometimes "nobody told us".
 *   • **A masked value is labelled as masked.** A partially disclosed loan
 *     number is shown with a marker, so it is never mistaken for the reference
 *     you would quote to a lender.
 */

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'muted' | 'default' | 'secondary';

const INSTALLMENT_TONE: Record<InstallmentStatus, { label: string; variant: BadgeVariant }> = {
  [InstallmentStatus.UPCOMING]: { label: 'Upcoming', variant: 'muted' },
  [InstallmentStatus.DUE_SOON]: { label: 'Due soon', variant: 'warning' },
  [InstallmentStatus.DUE_TODAY]: { label: 'Due today', variant: 'warning' },
  [InstallmentStatus.PAID]: { label: 'Paid', variant: 'success' },
  [InstallmentStatus.OVERDUE]: { label: 'Overdue', variant: 'destructive' },
  [InstallmentStatus.PARTIALLY_PAID]: { label: 'Part paid', variant: 'warning' },
  [InstallmentStatus.WAIVED]: { label: 'Waived', variant: 'muted' },
  [InstallmentStatus.UNKNOWN]: { label: 'Not disclosed', variant: 'secondary' },
};

const LOAN_TONE: Record<LoanStatus, { label: string; variant: BadgeVariant }> = {
  [LoanStatus.DRAFT]: { label: 'Draft', variant: 'muted' },
  [LoanStatus.ACTIVE]: { label: 'Active', variant: 'success' },
  [LoanStatus.ON_HOLD]: { label: 'On hold', variant: 'warning' },
  [LoanStatus.CLOSED]: { label: 'Closed', variant: 'muted' },
  [LoanStatus.FORECLOSED]: { label: 'Foreclosed', variant: 'muted' },
  [LoanStatus.DEFAULTED]: { label: 'Defaulted', variant: 'destructive' },
  [LoanStatus.CANCELLED]: { label: 'Cancelled', variant: 'muted' },
};

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }): React.ReactElement {
  const tone = INSTALLMENT_TONE[status] ?? { label: humanizeEnum(status), variant: 'muted' as const };

  if (status === InstallmentStatus.UNKNOWN) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={tone.variant} size="sm" className="cursor-help gap-1">
            {tone.label}
            <Info className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          The statement this row came from did not say whether it was paid. VorldX Saarthi will not guess
          either way, so it is counted in neither the paid nor the outstanding total.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge variant={tone.variant} size="sm">
      {tone.label}
    </Badge>
  );
}

export function LoanStatusBadge({ status }: { status: LoanStatus }): React.ReactElement {
  const tone = LOAN_TONE[status] ?? { label: humanizeEnum(status), variant: 'muted' as const };
  return (
    <Badge variant={tone.variant} size="sm">
      {tone.label}
    </Badge>
  );
}

/** Where a figure came from. Shown wherever it is not first-hand data. */
export function SourceBadge({
  source,
  verificationStatus,
}: {
  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
}): React.ReactElement | null {
  if (source === FinanceDataSource.SIMULATED) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" size="sm" className="cursor-help">
            Simulated
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          These figures were generated locally for development. They are not a real lender balance.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (verificationStatus === FinanceVerificationStatus.CONFLICT) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" size="sm" className="cursor-help">
            Disputed
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Your records and the lender statement disagree. Neither has been treated as correct —
          review the differences before relying on either figure.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (verificationStatus === FinanceVerificationStatus.PENDING_REVIEW) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" size="sm" className="cursor-help">
            Needs review
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Extracted from a document and not yet confirmed by a person. Check it against the
          original before treating it as accurate.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (source === FinanceDataSource.PROVIDER_SYNC) {
    return (
      <Badge variant="secondary" size="sm">
        From lender
      </Badge>
    );
  }

  return null;
}

/** A value the caller is only allowed to see part of. */
export function MaskedValue({
  value,
  masked,
  fallback = 'Not shown',
}: {
  value: string | null;
  masked: boolean;
  fallback?: string;
}): React.ReactElement {
  if (value === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help text-muted-foreground">{fallback}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          This field is withheld at your access level. A fleet owner can see it in full.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!masked) return <span className="tabular-nums">{value}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help tabular-nums">{value}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Partly hidden at your access level — this is not the full reference.
      </TooltipContent>
    </Tooltip>
  );
}

export function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "in 4 days" / "3 days ago" / "today", from a whole-day offset. */
export function relativeDueLabel(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? '' : 's'} ago`;
}
