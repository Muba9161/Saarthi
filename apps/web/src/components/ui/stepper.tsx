import * as React from 'react';
import { Check } from 'lucide-react';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * Step indicators for a multi-step form.
 *
 * Purely presentational — it is told which step is current and what each
 * step's state is, and knows nothing about validation or form state. The
 * wizard in `@/components/common/form-wizard` owns all of that.
 *
 * Two layouts of the same data: a vertical rail with room for a one-line
 * description, and a horizontal strip for narrow viewports where the rail
 * would eat the width the fields need.
 */

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepDescriptor {
  /** Stable across renders — used as the animation key. */
  id: string;
  title: string;
  /** One line on the rail. Dropped on the narrow layout. */
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Marks the step "optional" on the rail; does not change validation. */
  optional?: boolean;
}

interface SharedProps {
  steps: StepDescriptor[];
  current: number;
  statusOf: (index: number) => StepStatus;
  /** Omit to make the indicators inert. */
  onSelect?: (index: number) => void;
  /** Whether a given step can be jumped to directly. */
  canSelect?: (index: number) => boolean;
  className?: string;
}

const DOT_CLASS: Record<StepStatus, string> = {
  complete: 'wizard-dot-done',
  current: 'wizard-dot-current',
  upcoming: 'wizard-dot-upcoming',
  error: 'wizard-dot-error',
};

/** Percentage of the track that should read as covered. */
function progressPercent(current: number, total: number): number {
  if (total <= 1) return 100;
  return (current / (total - 1)) * 100;
}

function StepMarker({
  status,
  index,
  icon: Icon,
  size = 'default',
}: {
  status: StepStatus;
  index: number;
  icon?: React.ComponentType<{ className?: string }>;
  size?: 'default' | 'sm';
}) {
  const complete = status === 'complete';

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums',
        'transition-all duration-300 ease-smooth',
        size === 'sm' ? 'size-7 text-2xs' : 'size-8 text-xs',
        DOT_CLASS[status],
      )}
      aria-hidden
    >
      {complete ? (
        <Check className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={3} />
      ) : Icon ? (
        <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      ) : (
        index + 1
      )}
    </span>
  );
}

/**
 * Vertical rail. The gradient spine behind the markers fills to the current
 * step, so progress is legible from the shape alone.
 */
export function StepRail({
  steps,
  current,
  statusOf,
  onSelect,
  canSelect,
  className,
}: SharedProps) {
  const t = useT();

  return (
    <ol
      className={cn('relative space-y-1', className)}
      style={
        { '--wizard-progress': `${progressPercent(current, steps.length)}%` } as React.CSSProperties
      }
    >
      {/*
        Runs behind the markers, through their centres. Each marker sits 24px
        below the top of its own row (8px of button padding plus half of a
        32px dot), so the track starts exactly on the first centre. It ends
        24px off the bottom, which lands on the last centre when rows are of
        equal height and a little past it when the last row is taller — an
        overshoot the dots cover, where stopping short would read as broken.
      */}
      {steps.length > 1 ? (
        <span className="wizard-spine left-[23px] top-6 h-[calc(100%-3rem)]" aria-hidden />
      ) : null}

      {steps.map((step, index) => {
        const status = statusOf(index);
        const selectable = Boolean(onSelect) && (canSelect?.(index) ?? false);

        return (
          <li key={step.id} className="relative">
            <button
              type="button"
              disabled={!selectable}
              onClick={selectable ? () => onSelect?.(index) : undefined}
              aria-current={status === 'current' ? 'step' : undefined}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors duration-200',
                selectable
                  ? 'cursor-pointer hover:bg-white/45 dark:hover:bg-white/[0.05]'
                  : 'cursor-default',
              )}
            >
              <StepMarker status={status} index={index} icon={step.icon} />

              <span className="min-w-0 flex-1 pt-0.5">
                <span
                  className={cn(
                    'block truncate text-sm font-medium transition-colors',
                    status === 'current'
                      ? 'text-foreground'
                      : status === 'error'
                        ? 'text-destructive'
                        : status === 'complete'
                          ? 'text-foreground/80'
                          : 'text-muted-foreground',
                  )}
                >
                  {step.title}
                  {step.optional ? (
                    <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                      {t('optional')}
                    </span>
                  ) : null}
                </span>
                {step.description ? (
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {step.description}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Narrow-viewport layout: a filling track, the position in words, and a
 * scrollable strip of markers. The words matter — on a phone the strip can be
 * scrolled out of view, and "Step 2 of 5" still answers the question.
 */
export function StepStrip({
  steps,
  current,
  statusOf,
  onSelect,
  canSelect,
  className,
}: SharedProps) {
  const active = steps[current];
  const stripRef = React.useRef<HTMLOListElement>(null);
  const t = useT();

  // Keep the current marker in view when the step changes.
  React.useEffect(() => {
    const marker = stripRef.current?.children[current];
    if (marker instanceof HTMLElement) {
      marker.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [current]);

  return (
    <div
      className={cn('space-y-2.5', className)}
      style={
        { '--wizard-progress': `${progressPercent(current, steps.length)}%` } as React.CSSProperties
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{active?.title}</p>
        <p className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {t('Step {current} of {total}', { current: current + 1, total: steps.length })}
        </p>
      </div>

      <div className="wizard-track" role="presentation" />

      {active?.description ? (
        <p className="text-xs leading-snug text-muted-foreground">{active.description}</p>
      ) : null}

      <ol
        ref={stripRef}
        className="fade-edge-r -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-none"
      >
        {steps.map((step, index) => {
          const status = statusOf(index);
          const selectable = Boolean(onSelect) && (canSelect?.(index) ?? false);

          return (
            <li key={step.id} className="shrink-0">
              <button
                type="button"
                disabled={!selectable}
                onClick={selectable ? () => onSelect?.(index) : undefined}
                aria-current={status === 'current' ? 'step' : undefined}
                aria-label={`Step ${index + 1}: ${step.title}`}
                className={cn(
                  'block rounded-full transition-transform duration-200',
                  selectable ? 'cursor-pointer active:scale-95' : 'cursor-default',
                )}
              >
                <StepMarker status={status} index={index} icon={step.icon} size="sm" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export { StepMarker };
