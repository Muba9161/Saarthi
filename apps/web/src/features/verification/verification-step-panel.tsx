import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Clock3, FileCheck2, Loader2, Lock, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react';
import {
  DocumentOwnerType,
  IdentityDocumentKind,
  VerificationCheckType,
  VerificationStepState,
  identityFormatMessage,
  identityKindDefinition,
  identityKindForCheckType,
  isValidIdentityNumber,
  isValidPan,
  normalizeIdentityNumber,
  type VerificationStepView,
} from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import { FileDropzone } from '@/components/common/file-dropzone';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatFee, payLabel, usePayAndVerify, type PayAndVerifyOutcome } from './use-pay-and-verify';

/**
 * One focused verification step.
 *
 * Shows only what this step needs: the fields for its own check, its final
 * price, and one action. Every state it renders comes from the server — the
 * panel never decides that something is verified.
 */

const STATE_BADGE: Record<VerificationStepState, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'muted' }> = {
  NOT_STARTED: { label: 'Not started', variant: 'muted' },
  PAYMENT_REQUIRED: { label: 'Payment required', variant: 'warning' },
  PAYMENT_PROCESSING: { label: 'Awaiting payment', variant: 'info' },
  VERIFYING: { label: 'Verifying', variant: 'info' },
  UNDER_REVIEW: { label: 'Under review', variant: 'info' },
  VERIFIED: { label: 'Verified', variant: 'success' },
  FAILED: { label: 'Not verified', variant: 'destructive' },
  RETRY_REQUIRED: { label: 'Retry free', variant: 'warning' },
};

export function StepStateBadge({ state }: { state: VerificationStepState }) {
  const badge = STATE_BADGE[state];
  return (
    <Badge variant={badge.variant} dot>
      {badge.label}
    </Badge>
  );
}

export function VerificationStepPanel({
  step,
  onOutcome,
}: {
  step: VerificationStepView;
  /** Called with the server's answer once a check has run. */
  onOutcome: (outcome: PayAndVerifyOutcome) => void;
}) {
  return (
    <section aria-labelledby={`step-${step.id}-title`} className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={`step-${step.id}-title`} className="text-lg font-semibold tracking-tight">
            {step.title}
          </h3>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </div>
        <StepStateBadge state={step.state} />
      </header>

      {step.state === VerificationStepState.VERIFIED ? (
        <Alert variant="success">
          <BadgeCheck className="size-4" />
          <AlertTitle>{step.title} verified</AlertTitle>
          {step.reference ? (
            <AlertDescription className="font-mono text-xs">{step.reference}</AlertDescription>
          ) : null}
        </Alert>
      ) : !step.actionable ? (
        <Alert variant="info">
          <Lock className="size-4" />
          <AlertDescription>{step.blockedReason}</AlertDescription>
        </Alert>
      ) : step.checkType ? (
        <PaidCheckForm step={step} onOutcome={onOutcome} />
      ) : (
        <DocumentStep step={step} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A billable online check
// ---------------------------------------------------------------------------

function PaidCheckForm({
  step,
  onOutcome,
}: {
  step: VerificationStepView;
  onOutcome: (outcome: PayAndVerifyOutcome) => void;
}) {
  const { run, busy } = usePayAndVerify();
  const checkType = step.checkType!;
  const identityKind = identityKindForCheckType(checkType);
  const definition = identityKind ? identityKindDefinition(identityKind, step.subjectType) : undefined;
  const isAadhaar = identityKind === IdentityDocumentKind.AADHAAR;
  const isPan = identityKind === IdentityDocumentKind.PAN;
  const isLicence = checkType === VerificationCheckType.DRIVING_LICENCE;

  const [number, setNumber] = React.useState('');
  const [holderName, setHolderName] = React.useState('');
  const [linkedPan, setLinkedPan] = React.useState('');
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [needsDob, setNeedsDob] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const normalized = normalizeIdentityNumber(number);
  const numberValid = !identityKind || (normalized.length > 0 && isValidIdentityNumber(identityKind, normalized));
  const showFormatError = Boolean(identityKind) && normalized.length >= 6 && !numberValid;
  const linkedPanNormalized = normalizeIdentityNumber(linkedPan);
  const linkedPanValid = !isAadhaar || isValidPan(linkedPanNormalized);
  const ready = numberValid && linkedPanValid && (!needsDob || Boolean(dateOfBirth));

  const retryFree = step.state === VerificationStepState.RETRY_REQUIRED;
  const price = step.price;
  const available = price?.available ?? false;

  const submit = async (): Promise<void> => {
    setError(null);
    const body: Record<string, unknown> = {
      kind: checkType,
      subjectType: step.subjectType,
      subjectId: step.subjectId,
    };
    if (identityKind) body.number = normalized;
    if (isPan && holderName.trim()) body.holderName = holderName.trim();
    if (isAadhaar) body.linkedPan = linkedPanNormalized;
    if (isLicence && dateOfBirth) body.dateOfBirth = dateOfBirth;

    try {
      onOutcome(await run(body));
    } catch (caught) {
      if (caught instanceof ApiError && Array.isArray(caught.fieldErrors.dateOfBirth)) {
        setNeedsDob(true);
        setError('Enter the date of birth printed on the licence to run the check.');
        return;
      }
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <StateNotice step={step} />

      {identityKind && definition ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${step.id}-number`} required>
            {definition.label} number
          </Label>
          <Input
            id={`${step.id}-number`}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder={definition.placeholder}
            autoComplete="off"
            spellCheck={false}
            inputMode={isAadhaar ? 'numeric' : 'text'}
            className="font-mono tracking-wide"
            aria-invalid={showFormatError}
            aria-describedby={`${step.id}-hint`}
          />
          <p id={`${step.id}-hint`} className={showFormatError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {showFormatError ? identityFormatMessage(identityKind) : definition.formatHint}
          </p>
        </div>
      ) : null}

      {isPan ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${step.id}-name`}>Name on the card</Label>
          <Input
            id={`${step.id}-name`}
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            placeholder="As printed on the PAN"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Optional — confirms the PAN belongs to this name.</p>
        </div>
      ) : null}

      {isAadhaar ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${step.id}-pan`} required>
            PAN linked to this Aadhaar
          </Label>
          <Input
            id={`${step.id}-pan`}
            value={linkedPan}
            onChange={(event) => setLinkedPan(event.target.value)}
            placeholder="ABCPE1234F"
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-wide"
            aria-invalid={linkedPanNormalized.length >= 10 && !linkedPanValid}
          />
          <p className="text-xs text-muted-foreground">
            Aadhaar is verified online through its link with your PAN.
          </p>
        </div>
      ) : null}

      {isLicence ? (
        <p className="text-sm text-muted-foreground">
          The licence number on the driver profile is checked with the licensing authority.
        </p>
      ) : null}

      {isLicence && needsDob ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${step.id}-dob`} required>
            Date of birth
          </Label>
          <Input
            id={`${step.id}-dob`}
            type="date"
            value={dateOfBirth}
            onChange={(event) => setDateOfBirth(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <ShieldX className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {retryFree ? 'Retry' : 'Verification fee'}
          </p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {retryFree ? 'Free' : price ? formatFee(price) : '—'}
          </p>
        </div>
        <Button
          // Explicit, because this panel is also rendered inside the profile
          // wizard's <form>, where a default button would submit it.
          type="button"
          size="lg"
          disabled={!ready || busy || (!retryFree && !available)}
          loading={busy}
          onClick={() => void submit()}
        >
          {retryFree ? <RotateCcw className="size-4" /> : <ShieldCheck className="size-4" />}
          {retryFree ? 'Retry verification' : payLabel(price)}
        </Button>
      </div>
      {!available && !retryFree ? (
        <p className="text-xs text-muted-foreground">This check is not available right now. Please try again later.</p>
      ) : null}
    </div>
  );
}

/**
 * A paid attempt's outcome, for callers that have no module answer to show —
 * a check that waited on a hosted checkout, or one still running.
 */
export function OutcomeAlert({
  state,
  message,
  label,
}: {
  state: VerificationStepState;
  message: string | null;
  label: string;
}) {
  const verified = state === VerificationStepState.VERIFIED;
  const pending =
    state === VerificationStepState.PAYMENT_PROCESSING || state === VerificationStepState.VERIFYING;
  const retry = state === VerificationStepState.RETRY_REQUIRED;
  return (
    <Alert variant={verified ? 'success' : pending ? 'info' : retry ? 'warning' : 'destructive'}>
      {verified ? <BadgeCheck className="size-4" /> : pending ? <Clock3 className="size-4" /> : <ShieldX className="size-4" />}
      <AlertTitle>
        {verified
          ? `${label} verified`
          : state === VerificationStepState.PAYMENT_PROCESSING
            ? 'Payment not completed'
            : state === VerificationStepState.VERIFYING
              ? `${label} is being verified`
              : retry
                ? 'Your fee is kept — retry free'
                : `${label} not verified`}
      </AlertTitle>
      {message && !verified ? <AlertDescription className="text-xs leading-relaxed">{message}</AlertDescription> : null}
    </Alert>
  );
}

/** What happened last time, when something did. */
function StateNotice({ step }: { step: VerificationStepView }) {
  switch (step.state) {
    case VerificationStepState.VERIFYING:
      return (
        <Alert variant="info">
          <Loader2 className="size-4 animate-spin" />
          <AlertDescription>Payment received — verification is in progress.</AlertDescription>
        </Alert>
      );
    case VerificationStepState.PAYMENT_PROCESSING:
      return (
        <Alert variant="info">
          <Clock3 className="size-4" />
          <AlertDescription>
            A payment for this check has not completed yet. Paying again resumes it — you are never charged twice.
          </AlertDescription>
        </Alert>
      );
    case VerificationStepState.RETRY_REQUIRED:
      return (
        <Alert variant="warning">
          <RotateCcw className="size-4" />
          <AlertTitle>Your fee is kept</AlertTitle>
          <AlertDescription>{step.reason ?? 'The check could not be completed. Retry at no charge.'}</AlertDescription>
        </Alert>
      );
    case VerificationStepState.FAILED:
    case VerificationStepState.PAYMENT_REQUIRED:
      return step.reason ? (
        <Alert variant="destructive">
          <ShieldX className="size-4" />
          <AlertDescription>{step.reason}</AlertDescription>
        </Alert>
      ) : null;
    case VerificationStepState.UNDER_REVIEW:
      return (
        <Alert variant="info">
          <Clock3 className="size-4" />
          <AlertDescription>{step.reason ?? 'Waiting for a reviewer.'}</AlertDescription>
        </Alert>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// A document reviewed by a person
// ---------------------------------------------------------------------------

function DocumentStep({ step }: { step: VerificationStepView }) {
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!step.subjectId || !step.documentType) throw new Error('Nothing to upload against.');
      const body = new FormData();
      body.append('ownerType', DocumentOwnerType.ORGANIZATION);
      body.append('ownerId', step.subjectId);
      body.append('documentType', step.documentType);
      body.append('file', file);
      return api.post('/documents', body);
    },
    onSuccess: () => {
      toast.success('Document uploaded', { description: 'The Saarthi team will review it.' });
      void queryClient.invalidateQueries({ queryKey: ['verification-center'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (caught) => toast.error('Upload failed', { description: errorMessage(caught) }),
  });

  if (step.state === VerificationStepState.UNDER_REVIEW) {
    return (
      <Alert variant="info">
        <FileCheck2 className="size-4" />
        <AlertTitle>Under review</AlertTitle>
        <AlertDescription>
          {step.reference ? `${step.reference} was received. ` : ''}No fee is charged for this step.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {step.state === VerificationStepState.FAILED && step.reason ? (
        <Alert variant="destructive">
          <ShieldX className="size-4" />
          <AlertTitle>Please upload it again</AlertTitle>
          <AlertDescription>{step.reason}</AlertDescription>
        </Alert>
      ) : null}
      <FileDropzone
        accept="application/pdf,image/jpeg,image/png"
        maxSizeMb={10}
        busy={upload.isPending}
        busyLabel="Uploading…"
        onFiles={(files) => files[0] && upload.mutate(files[0])}
        onReject={(reason) => toast.error(reason)}
        title="Upload your licence or permit"
        hint="PDF, JPG or PNG, up to 10 MB. Reviewed by a person — no fee."
      />
    </div>
  );
}
