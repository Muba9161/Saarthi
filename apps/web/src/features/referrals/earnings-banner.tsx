import { Clock, Gift, Wallet } from 'lucide-react';
import { formatCurrency, formatNumber } from '@saarthi/shared';
import { AnimatedNumber, motion, useReducedMotion } from '@/components/motion';
import { Card, CardContent } from '@/components/ui/card';

/**
 * What a referrer has earned — including rewards still on hold.
 *
 * The headline is every reward credited and not voided, so ₹100 shows up here
 * the moment a friend's trial starts, days before it can be cashed out. The
 * split beneath says how much of it is withdrawable now and how much is still
 * unlocking.
 */
export function EarningsBanner({
  earned,
  available,
  held,
  rewarded,
  referrals,
  rewardAmount,
}: {
  earned: number;
  /** Null while the wallet is still loading. */
  available: number | null;
  held: number | null;
  /** Omitted where only the money is known. */
  rewarded?: number;
  referrals?: number;
  rewardAmount: number;
}) {
  const reduced = useReducedMotion();

  return (
    <Card className="relative overflow-hidden">
      {/* First child on purpose: CardContent drops its top padding when it is not. */}
      <CardContent className="relative z-10 flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.span
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            {...(reduced
              ? {}
              : {
                  animate: { y: [0, -4, 0], rotate: [0, -6, 6, 0] },
                  transition: { duration: 2.4, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' },
                })}
            aria-hidden
          >
            <Gift className="size-7" />
          </motion.span>
          <div className="min-w-0">
            <p className="section-label">Total earned</p>
            <AnimatedNumber
              value={earned}
              format={(value) => formatCurrency(Math.round(value))}
              className="block text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl"
            />
            <p className="text-sm text-muted-foreground">
              {rewarded && referrals
                ? `From ${formatNumber(rewarded)} rewarded of ${formatNumber(referrals)} referral${referrals === 1 ? '' : 's'}`
                : `Every referral who starts a paid trial adds ${formatCurrency(rewardAmount)}`}
            </p>
          </div>
        </div>

        {available !== null && held !== null ? (
          <dl className="grid grid-cols-2 gap-3 sm:w-72">
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <dt className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Wallet className="size-3.5" aria-hidden />
                Available now
              </dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-success">
                {formatCurrency(available)}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <dt className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                Unlocking soon
              </dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-warning">
                {formatCurrency(held)}
              </dd>
            </div>
          </dl>
        ) : null}
      </CardContent>
      <div
        className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />
    </Card>
  );
}
