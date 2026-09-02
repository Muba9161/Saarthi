import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, Lock, SearchX, ShieldAlert, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
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
      <div className="rounded-2xl bg-gradient-to-br from-muted to-secondary p-3.5 ring-1 ring-border">
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
export function FeatureLockedState({
  feature,
  requiredPlan,
  description,
}: {
  feature: string;
  requiredPlan?: string | null;
  description?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="glass-panel glass-sheen flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl p-10 text-center"
    >
      <div className="rounded-2xl bg-gradient-to-br from-accent/20 to-primary/15 p-3.5 ring-1 ring-accent/25">
        <Sparkles className="size-6 text-accent" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{feature} is not part of your plan</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {description ??
            (requiredPlan
              ? `Upgrade to Saarthi ${requiredPlan} to unlock this.`
              : 'Upgrade your subscription to unlock this feature.')}
        </p>
      </div>
      <Button size="sm" variant="gradient" asChild>
        <Link to="/settings/subscription">View plans</Link>
      </Button>
    </motion.div>
  );
}
