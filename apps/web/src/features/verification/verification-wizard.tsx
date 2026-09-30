import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, FileText, IdCard, Landmark, ShieldCheck } from 'lucide-react';
import {
  VERIFICATION_CHECK_LABELS,
  VERIFICATION_STEP_GROUP_LABELS,
  VerificationOverallState,
  VerificationStepState,
  type VerificationCenterView,
  type VerificationCheckType,
  type VerificationStepGroup,
  type VerificationStepView,
  type VerificationSubjectType,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StepRail, StepStrip, type StepDescriptor, type StepStatus } from '@/components/ui/stepper';
import { useCheckoutReturn } from '@/features/payments/use-checkout';
import type { PayAndVerifyOutcome } from './use-pay-and-verify';
import { VerificationStepPanel } from './verification-step-panel';
import { VerificationSuccessDialog } from './verification-success-dialog';

/**
 * The verification wizard.
 *
 * Built on the app's existing step indicators — the same rail and strip the
 * form wizard uses — with one focused step on screen at a time. Which steps
 * appear is decided by the server from the account type (or, with `driverId`,
 * the driver being looked at), so a customer sees none, a driver sees their
 * four and a business sees its own.
 *
 * The celebration is driven by the server's reply: a step's success popup
 * opens only for a state the API has already persisted as VERIFIED, and the
 * final "You're verified" only once the refreshed view says every step is.
 */

const GROUP_ICON: Record<VerificationStepGroup, React.ComponentType<{ className?: string }>> = {
  IDENTITY: IdCard,
  TAX_BUSINESS: Landmark,
  DOCUMENTS: FileText,
};

/** The steps on screen for this account, or for one driver with `driverId`. */
export function useVerificationCenterView(driverId?: string) {
  return useQuery({
    queryKey: ['verification-center', 'view', driverId ?? 'self'],
    queryFn: () =>
      api.get<VerificationCenterView>('/verification-center', driverId ? { driverId } : undefined),
  });
}

/** One check on one subject, which is what a step and a paid attempt share. */
export interface VerificationStepTarget {
  checkType: VerificationCheckType;
  subjectType: VerificationSubjectType;
  subjectId: string;
}

export function isStepFor(step: VerificationStepView, target: VerificationStepTarget): boolean {
  return (
    step.checkType === target.checkType &&
    step.subjectType === target.subjectType &&
    step.subjectId === target.subjectId
  );
}

function statusFor(state: VerificationStepState, isCurrent: boolean): StepStatus {
  if (state === VerificationStepState.VERIFIED) return 'complete';
  if (isCurrent) return 'current';
  if (state === VerificationStepState.FAILED) return 'error';
  return 'upcoming';
}

export function VerificationWizard({
  driverId,
  embedded = false,
  focus = null,
}: {
  driverId?: string;
  /**
   * Rendered as one step of another wizard (the profile), which already
   * supplies the card and the side rail — so this drops its own card and uses
   * the horizontal strip rather than a second rail beside the first.
   */
  embedded?: boolean;
  /**
   * A step to open and bring into view — the history's "Retry free". A new
   * object each time, so asking for the same step twice still scrolls to it.
   */
  focus?: VerificationStepTarget | null;
}) {
  const reduced = useReducedMotion();
  const view = useVerificationCenterView(driverId);

  const steps = React.useMemo(() => view.data?.steps ?? [], [view.data]);
  const [current, setCurrent] = React.useState<number | null>(null);
  const [celebrate, setCelebrate] = React.useState<{ label: string } | null>(null);
  const [complete, setComplete] = React.useState(false);
  const wasComplete = React.useRef<boolean | null>(null);
  const anchor = React.useRef<HTMLDivElement>(null);

  // Opened during render rather than in an effect, so the requested step is
  // the first one painted instead of flashing the previous step first.
  const [appliedFocus, setAppliedFocus] = React.useState<VerificationStepTarget | null>(null);
  if (focus && focus !== appliedFocus && steps.length > 0) {
    setAppliedFocus(focus);
    const target = steps.findIndex((entry) => isStepFor(entry, focus));
    if (target !== -1) setCurrent(target);
  }

  React.useEffect(() => {
    if (!focus) return;
    anchor.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    // Keyboard users land in the wizard too, not back on the history table.
    anchor.current?.focus({ preventScroll: true });
  }, [focus, reduced]);

  // Returning from a redirect checkout: confirm, then read the steps again.
  useCheckoutReturn({ onPayment: () => void view.refetch() });

  // Open on the first step still to do.
  const firstOpen = steps.findIndex((step) => step.state !== VerificationStepState.VERIFIED);
  const index = current ?? (firstOpen === -1 ? 0 : firstOpen);
  const step = steps[index];

  // The final celebration fires on the transition into VERIFIED, not on every
  // visit to an already-verified account.
  const overall = view.data?.overall;
  React.useEffect(() => {
    if (!overall) return;
    const isComplete = overall === VerificationOverallState.VERIFIED;
    if (wasComplete.current === false && isComplete) setComplete(true);
    wasComplete.current = isComplete;
  }, [overall]);

  const onOutcome = React.useCallback(
    (outcome: PayAndVerifyOutcome) => {
      if (outcome.state === VerificationStepState.VERIFIED && outcome.mode !== 'ALREADY_VERIFIED') {
        const label = outcome.charge
          ? VERIFICATION_CHECK_LABELS[outcome.charge.checkType]
          : (step?.title ?? 'details');
        setCelebrate({ label });
      }
      void view.refetch();
    },
    [step?.title, view],
  );

  const advance = (): void => {
    setCelebrate(null);
    const next = steps.findIndex(
      (entry, i) => i !== index && entry.state !== VerificationStepState.VERIFIED,
    );
    if (next !== -1) setCurrent(next);
  };

  if (view.isLoading) return <LoadingState label="Loading your verification…" />;
  if (view.error) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) return null;

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No verification needed"
        description="Your account type does not need identity documents verified."
      />
    );
  }

  const descriptors: StepDescriptor[] = steps.map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: VERIFICATION_STEP_GROUP_LABELS[entry.group],
    icon: GROUP_ICON[entry.group],
  }));
  const verifiedCount = steps.filter(
    (entry) => entry.state === VerificationStepState.VERIFIED,
  ).length;
  const allVerified = view.data.overall === VerificationOverallState.VERIFIED;

  const indicatorProps = {
    steps: descriptors,
    current: index,
    statusOf: (i: number) => statusFor(steps[i]!.state, i === index),
    onSelect: setCurrent,
    canSelect: () => true,
  };

  // A single step needs no indicator or tally: a rail with one entry and
  // "0 of 1 complete" only repeat the step's own heading and status badge.
  const showIndicator = steps.length > 1;
  const panel = (
    <AnimatePresence mode="wait" initial={false}>
      {step ? (
        <motion.div
          key={step.id}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="min-w-0"
        >
          <VerificationStepPanel step={step} onOutcome={onOutcome} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const body = (
    <div className="space-y-6">
      {showIndicator ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Verification
            </p>
            <p className="text-sm text-muted-foreground">
              {verifiedCount} of {steps.length} complete
            </p>
          </div>
          {allVerified ? (
            <Badge variant="success" dot>
              <BadgeCheck className="mr-1 size-3.5" aria-hidden />
              Verified
            </Badge>
          ) : null}
        </div>
      ) : null}

      {!showIndicator ? (
        panel
      ) : embedded ? (
        <>
          <StepStrip {...indicatorProps} />
          {panel}
        </>
      ) : (
        <>
          <div className="lg:hidden">
            <StepStrip {...indicatorProps} />
          </div>
          <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
            {/* `lg:block`, not `lg:flex`: the rail is a vertical list, and flex would lay its steps out in a row across the panel. */}
            <StepRail {...indicatorProps} className="hidden lg:block" />
            {panel}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div ref={anchor} tabIndex={-1} className="scroll-mt-24 outline-none">
        {embedded ? (
          body
        ) : (
          <Card>
            <CardContent className="p-5 sm:p-6">{body}</CardContent>
          </Card>
        )}
      </div>

      <VerificationSuccessDialog
        open={celebrate !== null && !complete}
        onOpenChange={(open) => !open && advance()}
        label={celebrate?.label ?? ''}
      />
      <VerificationSuccessDialog
        open={complete}
        onOpenChange={(open) => {
          if (!open) {
            setComplete(false);
            setCelebrate(null);
          }
        }}
        label=""
        complete
      />
    </>
  );
}
