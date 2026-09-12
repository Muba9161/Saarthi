import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, Lock, SearchX, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isTrackerFeature, minimumTierFor, type Feature } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError, errorMessage } from '@/lib/api-client';
import { motion } from '@/components/motion';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * The states every screen must handle — loading, empty, error, unauthorised,
 * not-found and plan-locked — as shared components, so no page invents its own.
 */

export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      className={cn('flex min-h-40 flex-col items-center justify-center gap-3 p-8', className)}
      role="status"
      aria-live="polite"
    >
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <Loader2 className="relative size-6 animate-spin text-primary" aria-hidden />
      </div>
      <p className="text-sm text-muted-foreground">{label ?? t('Loading…')}</p>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-10 text-center',
        className,
      )}
    >
      <div className="rounded-2xl bg-muted p-4 ring-1 ring-foreground/[0.05]">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </motion.div>
  );
}

export function NoResultsState({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No matching results"
      description="Try adjusting your filters or search terms."
      action={
        onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * Renders the right message for the failure that actually happened, rather
 * than a generic "something went wrong".
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();
  const apiError = error instanceof ApiError ? error : null;

  if (apiError?.isForbidden) {
    return (
      <Alert variant="warning" className={className}>
        <Lock className="size-4" />
        <AlertTitle>{t('You do not have access to this')}</AlertTitle>
        <AlertDescription>{apiError.message}</AlertDescription>
      </Alert>
    );
  }

  if (apiError?.isNotFound) {
    return (
      <Alert className={className}>
        <SearchX className="size-4" />
        <AlertTitle>Not found</AlertTitle>
        <AlertDescription>{apiError.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="size-4" />
      <AlertTitle>{t('Something went wrong')}</AlertTitle>
      <AlertDescription className="space-y-3">
        {/* Server messages can carry an unbreakable identifier or URL. */}
        <p className="break-words">{errorMessage(error)}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('Try again')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function UnauthorizedState({ message }: { message?: string }) {
  return (
    <Alert variant="warning">
      <ShieldAlert className="size-4" />
      <AlertTitle>Restricted</AlertTitle>
      <AlertDescription>
        {message ??
          'You do not have permission to view this area. Contact your fleet administrator if you need access.'}
      </AlertDescription>
    </Alert>
  );
}

/** Shown where a feature exists but the tenant's plan does not include it. */
/**
 * A capability the current plan does not include.
 *
 * The plan name is derived from the feature rather than written at the call
 * site, and that is a correctness fix rather than a tidy-up. Twenty screens
 * each carried a hand-typed plan name, and when the four sold tiers collapsed
 * to Personal and Business those strings stayed behind: customers were being
 * told to upgrade to Basic, Pro and Intelligence, none of which Saarthi has
 * sold since. A name that is computed cannot go stale that way.
 *
 * `minimumTierFor` also answers `null` for the tracker-only capabilities, which
 * no plan grants at any price. Telling a Business customer on the top plan to
 * upgrade would be advice they cannot act on, so that case says what to do
 * instead — fit a tracker — and points at the hardware rather than at billing.
 */
export function FeatureLockedState({
  feature,
  featureKey,
  description,
}: {
  /** The human name, for the heading. */
  feature: string;
  /** The catalogue key, which decides the plan named and where the button goes. */
  featureKey?: Feature;
  description?: string;
}) {
  const requiredTier = featureKey ? minimumTierFor(featureKey) : null;
  const needsTracker = featureKey ? isTrackerFeature(featureKey) : false;

  const requiredPlan = requiredTier
    ? `${requiredTier.charAt(0)}${requiredTier.slice(1).toLowerCase()}`
    : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="glass-panel glass-sheen flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl p-10 text-center"
    >
      <div className="rounded-2xl bg-gradient-to-br from-accent/20 to-primary/15 p-3.5 ring-1 ring-accent/25">
        <Sparkles className="size-6 text-accent" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{feature} is not part of your plan</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {description ??
            (needsTracker
              ? 'This reads the vehicle itself, so it needs a Saarthi tracker fitted. No plan includes it, because without the hardware there is nothing to report.'
              : requiredPlan
                ? `Saarthi ${requiredPlan} includes this. Change plan to unlock it.`
                : 'Your current subscription does not include this capability.')}
        </p>
      </div>
      <Button size="sm" variant="gradient" asChild>
        {/* A tracker is bought from the subscription screen too, but the label
            has to match the thing being bought — "View plans" against hardware
            sends somebody looking for a tier that does not exist. */}
        <Link to="/settings/subscription">{needsTracker ? 'Get a tracker' : 'View plans'}</Link>
      </Button>
    </motion.div>
  );
}
