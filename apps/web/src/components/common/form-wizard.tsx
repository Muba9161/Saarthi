import * as React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepRail, StepStrip, type StepDescriptor, type StepStatus } from '@/components/ui/stepper';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * A long form, broken into named steps.
 *
 * Two things make this worth having as a primitive rather than per-form state.
 *
 * The first is the submit gate. The wizard renders the `<form>` element
 * itself, so pressing Enter in a field runs the *step* validator and advances
 * instead of firing the real submission from step one. Forms that own their
 * own `<form>` and merely hide fields get that wrong, and a half-filled record
 * reaches the API.
 *
 * The second is that nothing here knows how a form validates. `onValidateStep`
 * is asked whether the current step may be left, and answers however the
 * caller likes — `form.trigger()` for the react-hook-form screens, a plain
 * predicate for the ones holding their fields in `useState`. Both patterns
 * exist in this codebase and neither had to change to use this.
 *
 * Hidden steps are not rendered, which is deliberate: react-hook-form keeps
 * values for unmounted fields (`shouldUnregister` defaults to false), so a
 * step can be revisited without losing what was typed, and the final submit
 * still sees every value.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export interface WizardStep extends StepDescriptor {
  /**
   * Field names this step owns. Handed back to `onValidateStep` so a
   * react-hook-form caller can `trigger` exactly these.
   */
  fields?: readonly string[];
  content: React.ReactNode;
}

export interface FormWizardProps {
  steps: WizardStep[];
  /** Runs when the last step is submitted. */
  onSubmit: () => void | Promise<void>;
  /**
   * Gate for leaving a step. Return false to stay put — show the reason
   * yourself, via field errors or a toast. Defaults to always allowing.
   */
  onValidateStep?: (step: WizardStep, index: number) => boolean | Promise<boolean>;
  submitting?: boolean;
  submitLabel?: React.ReactNode;
  nextLabel?: React.ReactNode;
  backLabel?: React.ReactNode;
  /** Step ids currently carrying errors — marked on the rail. */
  erroredStepIds?: readonly string[];
  /** Heading above the rail. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Always-visible content: under the rail on wide screens, above the footer otherwise. */
  aside?: React.ReactNode;
  /** Left-hand footer slot — usually Cancel. */
  footerStart?: React.ReactNode;
  /** Changing this sends the wizard back to the first step. */
  resetKey?: unknown;
  /**
   * Lets any step be opened from the rail without clearing the ones before it.
   *
   * For editing a record that already exists: somebody who only wants to
   * change the asking price should not have to walk past four steps of data
   * they are not touching. Because the gate is then no longer enforced on the
   * way through, the final submit checks *every* step and jumps back to the
   * first that fails.
   */
  allowJumpAhead?: boolean;
  /** `strip` keeps the horizontal layout at every width — for narrow dialogs. */
  variant?: 'rail' | 'strip';
  className?: string;
  /** Extra classes on the step panel, e.g. a max height. */
  panelClassName?: string;
  onStepChange?: (index: number, step: WizardStep) => void;
}

export function FormWizard({
  steps,
  onSubmit,
  onValidateStep,
  submitting = false,
  submitLabel,
  nextLabel,
  backLabel,
  erroredStepIds,
  title,
  description,
  aside,
  footerStart,
  resetKey,
  allowJumpAhead = false,
  variant = 'rail',
  className,
  panelClassName,
  onStepChange,
}: FormWizardProps) {
  const reduced = useReducedMotion();
  const t = useT();

  // Defaulted here rather than in the signature so the fallbacks follow the
  // chosen language instead of being frozen as English at module load.
  const submitText = submitLabel ?? t('Submit');
  const nextText = nextLabel ?? t('Continue');
  const backText = backLabel ?? t('Back');

  const [index, setIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(1);
  const [checking, setChecking] = React.useState(false);
  /** Steps cleared at least once — these stay reachable by clicking the rail. */
  const [visited, setVisited] = React.useState<ReadonlySet<string>>(() => new Set());

  // A caller may drop or add steps between renders (a role change swapping one
  // out, say). Never let the index dangle past the end.
  const safeIndex = Math.min(index, Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  const isLast = safeIndex === steps.length - 1;

  React.useEffect(() => {
    if (safeIndex !== index) setIndex(safeIndex);
  }, [safeIndex, index]);

  // Reopening a dialog should not resume halfway through the previous attempt.
  const firstResetRef = React.useRef(true);
  React.useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    setIndex(0);
    setDirection(1);
    setVisited(new Set());
  }, [resetKey]);

  const errored = React.useMemo(() => new Set(erroredStepIds ?? []), [erroredStepIds]);

  const statusOf = React.useCallback(
    (position: number): StepStatus => {
      const candidate = steps[position];
      if (candidate && errored.has(candidate.id)) return 'error';
      if (position === safeIndex) return 'current';
      if (position < safeIndex || (candidate && visited.has(candidate.id))) return 'complete';
      return 'upcoming';
    },
    [errored, safeIndex, steps, visited],
  );

  // Jumping back is always fine. Jumping forward is only allowed to a step
  // that has already been cleared once, so the gate cannot be walked around.
  const canSelect = React.useCallback(
    (position: number): boolean => {
      if (submitting || checking) return false;
      if (position === safeIndex) return false;
      if (allowJumpAhead || position < safeIndex) return true;
      const candidate = steps[position];
      return Boolean(candidate && visited.has(candidate.id));
    },
    [allowJumpAhead, checking, safeIndex, steps, submitting, visited],
  );

  const moveTo = React.useCallback(
    (position: number) => {
      const target = steps[position];
      if (!target) return;
      setDirection(position > safeIndex ? 1 : -1);
      setIndex(position);
      onStepChange?.(position, target);
    },
    [onStepChange, safeIndex, steps],
  );

  const validateCurrent = React.useCallback(async (): Promise<boolean> => {
    if (!step || !onValidateStep) return true;
    setChecking(true);
    try {
      return await onValidateStep(step, safeIndex);
    } finally {
      setChecking(false);
    }
  }, [onValidateStep, safeIndex, step]);

  /**
   * One path for both the Continue button and the Enter key, so they can never
   * disagree about what pressing Enter on step two ought to do.
   */
  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting || checking || !step) return;

    const ok = await validateCurrent();
    if (!ok) return;

    setVisited((previous) => {
      const next = new Set(previous);
      next.add(step.id);
      return next;
    });

    if (!isLast) {
      moveTo(safeIndex + 1);
      return;
    }

    // Jump-ahead mode never forced the earlier steps through the gate, so the
    // last step is the only place left to catch them.
    if (allowJumpAhead && onValidateStep) {
      for (let position = 0; position < steps.length; position += 1) {
        const candidate = steps[position];
        if (position === safeIndex || !candidate) continue;
        // eslint-disable-next-line no-await-in-loop -- stop at the first failure
        const stepOk = await onValidateStep(candidate, position);
        if (!stepOk) {
          moveTo(position);
          return;
        }
      }
    }

    await onSubmit();
  };

  const goBack = (): void => {
    if (safeIndex > 0) moveTo(safeIndex - 1);
  };

  const railProps = {
    steps,
    current: safeIndex,
    statusOf,
    onSelect: moveTo,
    canSelect,
  };

  if (!step) return null;

  return (
    <form onSubmit={handleSubmit} noValidate className={cn('wizard-shell', className)}>
      <div
        className={cn(
          'relative',
          variant === 'rail' && 'lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]',
        )}
      >
        {/* --- Rail (wide) ------------------------------------------------ */}
        {variant === 'rail' ? (
          <aside className="relative hidden p-5 lg:block">
            {title || description ? (
              <div className="mb-5 space-y-1 px-2">
                {title ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
                {description ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
                ) : null}
              </div>
            ) : null}

            <StepRail {...railProps} />

            {aside ? <div className="mt-5 px-2">{aside}</div> : null}
            <span className="wizard-divider right-0" aria-hidden />
          </aside>
        ) : null}

        <div className="min-w-0">
          {/* --- Strip (narrow, or the strip variant) --------------------- */}
          <div
            className={cn(
              'border-b border-white/40 p-4 dark:border-white/[0.06] sm:px-6',
              variant === 'rail' && 'lg:hidden',
            )}
          >
            {title ? (
              <h2 className="mb-3 text-base font-semibold tracking-tight">{title}</h2>
            ) : null}
            <StepStrip {...railProps} />
          </div>

          {/* --- Step panel ----------------------------------------------- */}
          <StepPanel
            stepId={step.id}
            direction={direction}
            reduced={Boolean(reduced)}
            className={panelClassName}
          >
            {step.content}
          </StepPanel>

          {/* The rail already carries the aside on wide screens. */}
          {aside ? (
            <div className={cn('px-5 pb-2 sm:px-6', variant === 'rail' && 'lg:hidden')}>
              {aside}
            </div>
          ) : null}

          {/* --- Footer ---------------------------------------------------- */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/40 p-4 dark:border-white/[0.06] sm:px-6">
            <div className="flex items-center gap-2">
              {footerStart}
              {safeIndex > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={goBack}
                  disabled={submitting || checking}
                >
                  <ArrowLeft className="size-4" />
                  {backText}
                </Button>
              ) : null}
            </div>

            <Button
              type="submit"
              variant="gradient"
              loading={submitting || checking}
              className="min-w-32"
            >
              {isLast ? (
                submitText
              ) : (
                <>
                  {nextText}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * The animated content area.
 *
 * The height is measured and animated rather than left to reflow, because a
 * step with three fields following one with ten would otherwise snap the
 * footer up the page mid-transition. `popLayout` takes the outgoing step out
 * of flow so the incoming one mounts immediately — with `wait` there is a
 * frame where neither exists and the panel collapses to nothing.
 */
function StepPanel({
  stepId,
  direction,
  reduced,
  className,
  children,
}: {
  stepId: string;
  direction: number;
  reduced: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | 'auto'>('auto');

  React.useLayoutEffect(() => {
    const node = contentRef.current;
    if (reduced || !node || typeof ResizeObserver === 'undefined') return;

    const measure = (): void => setHeight(node.offsetHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  const body = (
    <div ref={contentRef} className="relative">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={stepId}
          custom={direction}
          initial={reduced ? false : 'enter'}
          animate="center"
          exit="exit"
          variants={{
            enter: (towards: number) => ({ opacity: 0, x: towards * 26 }),
            center: { opacity: 1, x: 0 },
            exit: (towards: number) => ({ opacity: 0, x: towards * -26 }),
          }}
          transition={{ duration: 0.28, ease: EASE }}
          className={cn('glass-fields space-y-4 p-5 sm:p-6', className)}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  if (reduced) return body;

  return (
    <motion.div
      className="overflow-hidden"
      animate={{ height }}
      initial={false}
      transition={{ duration: 0.32, ease: EASE }}
    >
      {body}
    </motion.div>
  );
}

/* ---------------------------------------------------------------------------
 * Hosting a wizard inside a Dialog
 *
 * The dialog itself becomes the glass pane, and the wizard drops its own
 * surface so the two do not stack — nested `backdrop-filter` blurs only what
 * is already inside the dialog, which costs a paint and shows nothing.
 *
 * Written as utilities rather than the `.glass-deep` component class on
 * purpose: `cn` merges by utility group, so these can displace DialogContent's
 * own `bg-card` and padding. A component class cannot.
 * ------------------------------------------------------------------------- */

/** For `<DialogContent>`. Pair with a width, e.g. `sm:max-w-3xl`. */
export const WIZARD_DIALOG_CONTENT = [
  'gap-0 overflow-hidden rounded-2xl p-0 sm:p-0',
  'border-white/30 bg-white/75 shadow-overlay backdrop-blur-2xl backdrop-saturate-150',
  'dark:border-white/[0.09] dark:bg-[hsl(226_36%_13%_/_0.82)]',
].join(' ');

/**
 * For `<DialogHeader>` inside the above.
 *
 * `pr-12` restores what the horizontal padding takes away: DialogHeader's own
 * `pr-8` keeps the title clear of the close button, and `cn` merges a later
 * `px-*` over it. Without this the title runs under the X.
 */
export const WIZARD_DIALOG_HEADER =
  'space-y-1 border-b border-white/40 px-5 py-4 pr-12 dark:border-white/[0.06] sm:px-6 sm:pr-12';

/** For the `<FormWizard>` itself when it sits inside a dialog. */
export const WIZARD_IN_DIALOG =
  'rounded-none border-0 bg-transparent shadow-none backdrop-blur-none';

/** Keeps the step rail, header and footer still while long steps scroll. */
export const WIZARD_DIALOG_PANEL = 'max-h-[min(58vh,30rem)] overflow-y-auto';

/**
 * Label, hint and error for one control.
 *
 * The react-hook-form screens get all of this from `<FormItem>`. The screens
 * that hold their fields in `useState` had been hand-rolling a label and a
 * hint per field with no error slot at all; this gives them the same shape
 * without moving them onto a form library they do not otherwise need.
 */
export function WizardField({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  /** Shown in place of the hint when present. */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          'text-sm font-medium leading-none',
          error ? 'text-destructive' : 'text-foreground',
        )}
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Section heading inside a step, for the steps that group two or three
 * related clusters rather than one flat list of fields.
 */
export function WizardSection({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="space-y-0.5">
        <h3 className="section-label">{title}</h3>
        {description ? (
          <p className="text-xs leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
