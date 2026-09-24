import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Info, Loader2, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import {
  AADHAAR_ONLINE_LIMITATION,
  IdentityDocumentKind,
  VerificationCheckType,
  VerificationStepState,
  checkTypeForIdentityKind,
  driverCheckForDocumentType,
  identityFormatMessage,
  identityKindDefinition,
  isValidIdentityNumber,
  isValidPan,
  normalizeIdentityNumber,
  type DriverVerificationChecklist,
  type IdentityVerificationSummary,
} from '@saarthi/shared';
import { ApiError, errorMessage } from '@/lib/api-client';
import type { RegistryVerificationResult } from '@/lib/api-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { payLabel, usePayAndVerify, usePriceFor, type PayAndVerifyOutcome } from './use-pay-and-verify';
import { OutcomeAlert } from './verification-step-panel';

/**
 * Verify the number that has just been typed, without leaving the form.
 *
 * A document number is the one field on an upload form that can be checked
 * against something authoritative, and checking it *before* the file is saved
 * is strictly better than after: a wrong number is corrected while the person
 * still has the card in their hand, and a confirmed one means the upload lands
 * already verified instead of joining a queue.
 *
 * Four numbers reach this control, each going to its own authority — the
 * driving licence to the licensing authority, and Aadhaar, PAN and Voter ID to
 * theirs. They are the same four a driver must pass to be verified, which is
 * why they are the four that get a button here.
 *
 * Two of them need one more thing before an answer is possible, and the design
 * rule is that the form asks for it only when it turns out to be needed:
 *
 *  * **Aadhaar** has no public standalone verification. With a linked PAN it
 *    gets a real answer; without one it stops at its checksum. So the PAN field
 *    is offered up front for Aadhaar — hiding it would quietly guarantee the
 *    weaker result.
 *  * **A driving licence** is verified against a date of birth. That normally
 *    comes off the driver's profile, so nothing is asked. The field appears
 *    only when the server says it has none.
 *
 * Every check is paid for through Pay & Verify first — the fee goes through
 * Saarthi's checkout, and only then is the authority asked.
 */

/** What the caller needs back: did this number end up confirmed? */
export interface InlineVerifyOutcome {
  verified: boolean;
  /** Where the driver now stands against all four checks, when known. */
  driverChecklist?: DriverVerificationChecklist | null;
}

export interface InlineNumberVerifyProps {
  /** `DOCUMENT_TYPES` code currently selected in the form. */
  documentType: string;
  subjectType: 'DRIVER' | 'ORGANIZATION';
  subjectId: string;
  /** The number as typed. Normalised here, never mutated in the parent. */
  number: string;
  /** Pre-fills the PAN name check — usually the driver's own name. */
  holderName?: string | undefined;
  /** The document row this check backs, when it already exists. */
  documentId?: string | undefined;
  onOutcome?: (outcome: InlineVerifyOutcome) => void;
}

interface Result {
  kind: 'IDENTITY' | 'REGISTRY';
  outcome: PayAndVerifyOutcome;
}

export function InlineNumberVerify({
  documentType,
  subjectType,
  subjectId,
  number,
  holderName,
  documentId,
  onOutcome,
}: InlineNumberVerifyProps) {
  const { run } = usePayAndVerify();
  const check = driverCheckForDocumentType(documentType);

  const [linkedPan, setLinkedPan] = React.useState('');
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [result, setResult] = React.useState<Result | null>(null);

  // A different type, or a re-typed number, invalidates the answer on screen —
  // leaving a green tick above a number it was not about would be a lie.
  React.useEffect(() => {
    setResult(null);
  }, [documentType, number]);

  const identityKind = check?.identityKind;
  const definition = identityKind ? identityKindDefinition(identityKind) : undefined;
  const isAadhaar = identityKind === IdentityDocumentKind.AADHAAR;
  const isLicence = check?.key === 'DRIVING_LICENCE';
  const price = usePriceFor(
    isLicence
      ? VerificationCheckType.DRIVING_LICENCE
      : identityKind
        ? checkTypeForIdentityKind(identityKind)
        : null,
  );

  const normalized = identityKind ? normalizeIdentityNumber(number) : number.trim().toUpperCase();
  const numberUsable = identityKind
    ? normalized.length > 0 && isValidIdentityNumber(identityKind, normalized)
    : normalized.length >= 8;

  const linkedPanNormalized = normalizeIdentityNumber(linkedPan);
  const linkedPanUsable = linkedPanNormalized.length === 0 || isValidPan(linkedPanNormalized);

  const verify = useMutation({
    mutationFn: async (): Promise<Result> => {
      if (isLicence) {
        const body: Record<string, unknown> = {
          kind: VerificationCheckType.DRIVING_LICENCE,
          subjectType: 'DRIVER',
          subjectId,
          licenceNumber: normalized,
        };
        if (dateOfBirth) body.dateOfBirth = dateOfBirth;
        return { kind: 'REGISTRY', outcome: await run(body) };
      }

      if (!identityKind) throw new Error('This document type cannot be verified online.');
      const body: Record<string, unknown> = {
        kind: identityKind,
        subjectType,
        subjectId,
        number: normalized,
      };
      if (documentId) body.documentId = documentId;
      if (identityKind === IdentityDocumentKind.PAN && holderName?.trim()) {
        body.holderName = holderName.trim();
      }
      if (isAadhaar && linkedPanNormalized) body.linkedPan = linkedPanNormalized;

      return { kind: 'IDENTITY', outcome: await run(body) };
    },
    onSuccess: (next) => {
      // Every surface the answer changes is refreshed by the hook.
      setResult(next);
      const registry =
        next.kind === 'REGISTRY' ? (next.outcome.detail as RegistryVerificationResult | null) : null;
      onOutcome?.({
        verified: next.outcome.state === VerificationStepState.VERIFIED,
        ...(registry ? { driverChecklist: registry.driverChecklist } : {}),
      });
    },
  });

  // Not one of the four: nothing here can verify it, so nothing is offered.
  if (!check) return null;

  /**
   * A date of birth the server could not find on the driver's profile.
   *
   * Recognised by the field error rather than the message text, so the server
   * wording can change without the prompt vanishing here.
   */
  const needsDateOfBirth =
    verify.error instanceof ApiError && Array.isArray(verify.error.fieldErrors.dateOfBirth);
  const blocked = needsDateOfBirth && !dateOfBirth;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {isLicence
              ? 'Check this licence with the licensing authority'
              : `Check this ${definition?.shortLabel ?? 'number'} with the issuing authority`}
          </p>
          <p className="text-xs text-muted-foreground">
            {numberUsable
              ? 'Takes a few seconds. No reviewer needed.'
              : identityKind && normalized.length >= 6
                ? identityFormatMessage(identityKind)
                : 'Enter the number above to verify it.'}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!numberUsable || !linkedPanUsable || blocked}
          loading={verify.isPending}
          onClick={() => verify.mutate()}
        >
          <ShieldCheck className="size-4" />
          {payLabel(price)}
        </Button>
      </div>

      {isAadhaar ? (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="inline-linked-pan">Linked PAN</Label>
          <Input
            id="inline-linked-pan"
            value={linkedPan}
            onChange={(event) => setLinkedPan(event.target.value)}
            placeholder="ABCPE1234F"
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-wide"
            aria-invalid={!linkedPanUsable}
          />
          <p
            className={linkedPanUsable ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
          >
            {linkedPanUsable
              ? 'Optional, and what turns this from a format check into a real online verification.'
              : 'That is not a valid PAN.'}
          </p>
        </div>
      ) : null}

      {needsDateOfBirth ? (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="inline-dob" required>
            Date of birth
          </Label>
          <Input
            id="inline-dob"
            type="date"
            value={dateOfBirth}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setDateOfBirth(event.target.value)}
            className="w-44"
          />
          <p className="text-xs text-muted-foreground">
            The licensing authority verifies a licence against the holder&rsquo;s date of birth, and
            Saarthi does not hold one for this driver. It is saved to the profile once the check
            succeeds.
          </p>
        </div>
      ) : null}

      {verify.isPending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Contacting the issuing authority…
        </p>
      ) : null}

      {!verify.isPending && verify.error && !needsDateOfBirth ? (
        <Alert variant="destructive">
          <ShieldX className="size-4" />
          <AlertTitle>The check could not run</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            {errorMessage(verify.error)} Nothing was recorded - you can still upload the document
            and verify it from its row later.
          </AlertDescription>
        </Alert>
      ) : null}

      {!verify.isPending && result ? <InlineResult result={result} /> : null}

      {isAadhaar && !result ? (
        <Alert variant="info">
          <Info className="size-4" />
          <AlertDescription className="text-xs leading-relaxed">
            {AADHAAR_ONLINE_LIMITATION}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The answer, in place, with the reason when it is not a clean yes. */
function InlineResult({ result }: { result: Result }) {
  const { outcome } = result;
  // A check that waited on a hosted checkout has no module answer to show.
  if (!outcome.detail) {
    return <OutcomeAlert state={outcome.state} message={outcome.message} label="Number" />;
  }

  if (result.kind === 'IDENTITY') {
    const summary = outcome.detail as IdentityVerificationSummary;
    const verified = summary.outcome === 'VERIFIED';
    const unconfirmed = summary.outcome === 'UNCONFIRMED';

    return (
      <Alert variant={verified ? 'success' : unconfirmed ? 'warning' : 'destructive'}>
        {verified ? <BadgeCheck className="size-4" /> : <TriangleAlert className="size-4" />}
        <AlertTitle>
          {verified ? 'Confirmed' : unconfirmed ? 'Left for review' : 'Not confirmed'}
        </AlertTitle>
        <AlertDescription className="space-y-1 text-xs leading-relaxed">
          <p className="font-mono">{summary.maskedNumber}</p>
          {summary.holderName ? <p>On record as {summary.holderName}.</p> : null}
          {summary.reason ? <p>{summary.reason}</p> : null}
        </AlertDescription>
      </Alert>
    );
  }

  const registry = outcome.detail as RegistryVerificationResult;
  const blocking = registry.findings.filter((finding) => finding.severity === 'BLOCKING');

  return (
    <Alert variant={registry.verified ? 'success' : 'destructive'}>
      {registry.verified ? <BadgeCheck className="size-4" /> : <ShieldX className="size-4" />}
      <AlertTitle>{registry.verified ? 'Confirmed' : 'Not confirmed'}</AlertTitle>
      <AlertDescription className="space-y-1 text-xs leading-relaxed">
        <p>{registry.summary}</p>
        {blocking.map((finding) => (
          <p key={finding.code}>{finding.detail}</p>
        ))}
        {registry.driverChecklist && !registry.driverChecklist.complete ? (
          <p className="text-muted-foreground">{registry.driverChecklist.summary}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
