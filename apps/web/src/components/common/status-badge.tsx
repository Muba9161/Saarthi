import { humanizeEnum } from '@saarthi/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * A single place that decides what colour every operational status is, so the
 * fleet board, the map, the tables and the driver app never disagree about
 * what "ON_TRIP" looks like.
 */

type Variant = NonNullable<BadgeProps['variant']>;

const STATUS_VARIANTS: Record<string, Variant> = {
  // Trucks
  AVAILABLE: 'success',
  ASSIGNED: 'info',
  ON_TRIP: 'default',
  LOADING: 'info',
  UNLOADING: 'info',
  IDLE: 'muted',
  MAINTENANCE: 'warning',
  OFFLINE: 'muted',
  EMERGENCY: 'destructive',
  SUSPENDED: 'destructive',

  // Trips
  DRAFT: 'muted',
  STARTED: 'default',
  IN_TRANSIT: 'default',
  DELAYED: 'warning',
  ARRIVED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'muted',

  // Orders
  REQUESTED: 'info',
  QUOTED: 'accent',
  CONFIRMED: 'info',
  PICKUP: 'info',
  DELIVERED: 'success',
  FAILED: 'destructive',

  // Verification & documents
  PENDING: 'muted',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
  PENDING_VERIFICATION: 'warning',
  EXPIRING_SOON: 'warning',
  VALID: 'success',
  NO_EXPIRY: 'muted',

  // SOS
  TRIGGERED: 'destructive',
  BROADCASTING: 'destructive',
  ACKNOWLEDGED: 'warning',
  HELP_ASSIGNED: 'warning',
  ASSISTANCE_ARRIVED: 'info',
  RESOLVED: 'success',
  NOTIFIED: 'info',
  DECLINED: 'muted',

  // Drivers
  OFF_DUTY: 'muted',
  ON_LEAVE: 'muted',

  // Maintenance
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',

  // Materials / subscriptions
  ACTIVE: 'success',
  INACTIVE: 'muted',
  OUT_OF_STOCK: 'warning',
  TRIALING: 'info',
  PAST_DUE: 'warning',
};

export function StatusBadge({
  status,
  className,
  size,
}: {
  status: string | null | undefined;
  className?: string;
  size?: BadgeProps['size'];
}) {
  if (!status) return <span className="text-muted-foreground">—</span>;

  const variant = STATUS_VARIANTS[status] ?? 'secondary';
  const pulses = status === 'TRIGGERED' || status === 'BROADCASTING' || status === 'EMERGENCY';

  return (
    <Badge variant={variant} size={size} className={cn(pulses && 'animate-pulse', className)}>
      {humanizeEnum(status)}
    </Badge>
  );
}

/** Coloured dot for dense tables where a full badge is too heavy. */
export function StatusDot({ status, className }: { status: string; className?: string }) {
  const variant = STATUS_VARIANTS[status] ?? 'secondary';
  const colours: Record<Variant, string> = {
    default: 'bg-primary',
    secondary: 'bg-secondary-foreground',
    outline: 'bg-foreground',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-info',
    muted: 'bg-muted-foreground',
    accent: 'bg-accent',
  };

  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', colours[variant], className)}
      title={humanizeEnum(status)}
      aria-label={humanizeEnum(status)}
    />
  );
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const variant: Variant =
    score >= 90 ? 'success' : score >= 75 ? 'info' : score >= 60 ? 'warning' : 'destructive';

  return (
    <Badge variant={variant} className="tabular">
      {score}
    </Badge>
  );
}
