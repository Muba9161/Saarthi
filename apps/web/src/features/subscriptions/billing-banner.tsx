import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, X } from 'lucide-react';
import { DATA_PURGE_AFTER_DAYS, Permission, archiveDateFor } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BillingStatus } from './billing-card';
import { isAutopayAwaiting, isAutopayConfirmed } from './use-billing-actions';

const DISMISS_KEY = 'saarthi:trial-banner-dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

function inrDate(value: Date): string {
  return value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The plan's billing state, above every screen, for whoever can pay.
 *
 *   • In the free trial with no autopay — days left, and a way to set it up.
 *     Dismissible for the session: it is a reminder, not an alarm. On a phone
 *     it floats above the tab bar instead of pushing every screen down under
 *     the header; from `lg` up it is a slim strip.
 *   • Unpaid, in the 3-day grace — the date the account is archived. Not
 *     dismissible and never floating, because missing it costs the account.
 */
export function BillingBanner() {
  const { can, session } = useAuth();
  const canPay = can(Permission.SUBSCRIPTION_MANAGE) && Boolean(session?.organization);
  const [dismissed, setDismissed] = React.useState(readDismissed);

  const billing = useQuery({
    queryKey: ['subscription', 'billing'],
    queryFn: () => api.get<BillingStatus | null>('/subscriptions/billing'),
    enabled: canPay,
    staleTime: 5 * 60_000,
  });

  const status = billing.data;
  if (!canPay || !status?.billable) return null;

  if (status.status === 'PAST_DUE') {
    const periodEnd = status.periodEndsAt ?? status.trialEndsAt;
    const archiveOn = periodEnd ? archiveDateFor(new Date(periodEnd)) : null;
    return (
      <Banner tone="danger" icon={AlertTriangle} action="Renew now">
        {status.planName} has not been renewed.{' '}
        {archiveOn ? <>Renew by <strong>{inrDate(archiveOn)}</strong> or</> : 'Renew now or'} your account is
        archived, and deleted {DATA_PURGE_AFTER_DAYS} days after that.
      </Banner>
    );
  }

  if (status.status === 'TRIALING' && !isAutopayConfirmed(status.autopay) && !dismissed) {
    const days = status.trialDaysLeft ?? 0;
    const awaiting = isAutopayAwaiting(status.autopay);
    return (
      <Banner
        tone="info"
        floating
        icon={CalendarClock}
        action={awaiting ? 'Complete autopay setup' : 'Set up autopay'}
        onDismiss={() => {
          setDismissed(true);
          try {
            window.sessionStorage.setItem(DISMISS_KEY, 'true');
          } catch {
            // Storage blocked: it simply shows again next visit.
          }
        }}
      >
        <strong>
          {days} day{days === 1 ? '' : 's'} left
        </strong>{' '}
        in your free trial.{' '}
        {awaiting
          ? 'Your autopay has not been approved yet - finish it on Cashfree so'
          : 'Set up autopay so'}{' '}
        {status.planName} carries on without a break - nothing is charged until the trial ends.
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  icon: Icon,
  action,
  onDismiss,
  floating = false,
  children,
}: {
  tone: 'info' | 'danger';
  icon: typeof AlertTriangle;
  action: string;
  onDismiss?: () => void;
  /** Float above the mobile tab bar rather than taking a row under the header. */
  floating?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 text-sm',
        tone === 'danger' ? 'border-destructive/30 bg-destructive/10' : 'border-primary/20 bg-primary/[0.06]',
        floating
          ? [
              // Phone and tablet: a card resting just above the tab bar.
              'fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-xl border bg-background/95 p-3 text-xs shadow-lg backdrop-blur',
              'animate-in fade-in slide-in-from-bottom-4',
              // Desktop: back to a slim strip under the header.
              'lg:static lg:z-auto lg:rounded-none lg:border-x-0 lg:border-t-0 lg:bg-primary/[0.06] lg:px-8 lg:py-2.5 lg:text-sm lg:shadow-none lg:backdrop-blur-none lg:animate-none',
            ]
          : 'border-b px-4 py-2.5 sm:px-6 lg:px-8',
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', tone === 'danger' ? 'text-destructive' : 'text-primary')}
        aria-hidden
      />
      <p className="min-w-0 flex-1 leading-snug">{children}</p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant={tone === 'danger' ? 'destructive' : 'default'} asChild>
          <Link to="/settings/subscription">{action}</Link>
        </Button>
        {onDismiss ? (
          <Button size="icon" variant="ghost" className="size-8" aria-label="Dismiss" onClick={onDismiss}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
