import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Info, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import {
  AADHAAR_ONLINE_LIMITATION,
  IdentityDocumentKind,
  identityFormatMessage,
  identityKindDefinition,
  isValidIdentityNumber,
  isValidPan,
  normalizeIdentityNumber,
  type IdentityVerificationSummary,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Verify one identity number against its government source.
 *
 * Opened two ways, which is the whole point of the design: automatically the
 * moment a verifiable document finishes uploading, and again from the Verify
 * button on the row if the operator dismissed it the first time. Nothing is
 * lost by saying "not now" — the button stays until the check has run.
 *
 * The number is validated locally before the request is sent, so a typo costs
 * nothing and is reported as a typo rather than as "no record found".
 */

export interface IdentityVerifyTarget {
  kind: IdentityDocumentKind;
  subjectType: 'DRIVER' | 'ORGANIZATION';
  subjectId: string;
  /** The uploaded document this check backs, when started from a row. */
  documentId?: string | undefined;
  /** Pre-filled from the document number, or from a previous check. */
  initialNumber?: string | undefined;
  /** Pre-filled name to match a PAN against — usually the driver's own. */
  initialHolderName?: string | undefined;
  /** A driver's already-verified PAN, offered as the Aadhaar link check. */
  knownPan?: string | undefined;
}

export function IdentityVerifyDialog({
  target,
  open,
  onOpenChange,
  onVerified,
}: {
  target: IdentityVerifyTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified?: (summary: IdentityVerificationSummary) => void;
}) {
  const queryClient = useQueryClient();
  const definition = target ? identityKindDefinition(target.kind) : undefined;

  const [number, setNumber] = React.useState('');
  const [holderName, setHolderName] = React.useState('');
  const [linkedPan, setLinkedPan] = React.useState('');
  const [result, setResult] = React.useState<IdentityVerificationSummary | null>(null);

  // Re-seed whenever a different row opens the dialog, so the Verify button on
  // the PAN row never arrives carrying the Aadhaar number typed a moment ago.
  React.useEffect(() => {
    if (!open || !target) return;
    setNumber(target.initialNumber ?? '');
    setHolderName(target.initialHolderName ?? '');
    setLinkedPan(target.knownPan ?? '');
    setResult(null);
  }, [open, target]);

  const verify = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('Nothing to verify.');
      const body: Record<string, unknown> = {
        kind: target.kind,
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        number: normalizeIdentityNumber(number),
      };
      if (target.documentId) body.documentId = target.documentId;
      if (target.kind === IdentityDocumentKind.PAN && holderName.trim()) {
        body.holderName = holderName.trim();
      }
      if (target.kind === IdentityDocumentKind.AADHAAR && linkedPan.trim()) {
        body.linkedPan = normalizeIdentityNumber(linkedPan);
      }
      return api.post<IdentityVerificationSummary>('/identity/verify', body);
    },
    onSuccess: (summary) => {
      setResult(summary);

      // Both the document list and the identity view change, and so does the
      // subject itself — a verified PAN lands on the driver record.
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['identity'] });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      void queryClient.invalidateQueries({ queryKey: ['driver'] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['organization'] });

      if (summary.outcome === 'VERIFIED') {
        toast.success(`${definition?.label ?? 'Document'} verified`, {
          description: summary.holderName
            ? `Confirmed against the issuing authority - ${summary.holderName}.`
            : 'Confirmed against the issuing authority.',
        });
        onVerified?.(summary);
      } else if (summary.outcome === 'UNCONFIRMED') {
        toast.warning('Left for review', {
          description: summary.reason ?? 'The number is valid but could not be confirmed online.',
        });
      } else {
        toast.error('Not verified', {
          description: summary.reason ?? 'The issuing authority did not confirm this number.',
        });
      }
    },
    onError: (error) =>
      toast.error('Verification failed', { description: errorMessage(error) }),
  });

  if (!target || !definition) return null;

  const normalized = normalizeIdentityNumber(number);
  const numberValid = normalized.length > 0 && isValidIdentityNumber(target.kind, normalized);
  const showFormatError = normalized.length >= 6 && !numberValid;

  const isAadhaar = target.kind === IdentityDocumentKind.AADHAAR;
  const isPan = target.kind === IdentityDocumentKind.PAN;
  const linkedPanNormalized = normalizeIdentityNumber(linkedPan);
  const linkedPanValid = linkedPanNormalized.length === 0 || isValidPan(linkedPanNormalized);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {definition.label}</DialogTitle>
          <DialogDescription>
            {definition.description} Nothing is sent until the number passes its own check digit.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <IdentityResult summary={result} label={definition.label} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label required>{definition.label} number</Label>
              <Input
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder={definition.placeholder}
                autoComplete="off"
                spellCheck={false}
                inputMode={isAadhaar ? 'numeric' : 'text'}
                className="font-mono tracking-wide"
                aria-invalid={showFormatError}
                aria-describedby="identity-number-hint"
              />
              <p
                id="identity-number-hint"
                className={
                  showFormatError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                }
              >
                {showFormatError ? identityFormatMessage(target.kind) : definition.formatHint}
              </p>
            </div>

            {isPan ? (
              <div className="space-y-1.5">
                <Label>Name on the card</Label>
                <Input
                  value={holderName}
                  onChange={(event) => setHolderName(event.target.value)}
                  placeholder="As printed on the PAN"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Optional, and worth filling in: without it the check confirms the PAN exists, not
                  that it belongs to this person.
                </p>
              </div>
            ) : null}

            {isAadhaar ? (
              <>
                <div className="space-y-1.5">
                  <Label>Linked PAN</Label>
                  <Input
                    value={linkedPan}
                    onChange={(event) => setLinkedPan(event.target.value)}
                    placeholder="ABCPE1234F"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono tracking-wide"
                    aria-invalid={!linkedPanValid}
                  />
                  <p
                    className={
                      linkedPanValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'
                    }
                  >
                    {linkedPanValid
                      ? 'Optional. Supplying it turns this from a format check into a real online verification.'
                      : 'That is not a valid PAN.'}
                  </p>
                </div>

                <Alert variant="info">
                  <Info className="size-4" />
                  <AlertTitle>Why Aadhaar is different</AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed">
                    {AADHAAR_ONLINE_LIMITATION}
                  </AlertDescription>
                </Alert>
              </>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              {result.outcome !== 'VERIFIED' ? (
                <Button variant="outline" onClick={() => setResult(null)}>
                  Try again
                </Button>
              ) : null}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              {/* Deliberately "Not now" rather than "Cancel": dismissing this
                  costs nothing, and the row keeps its Verify button. */}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button
                disabled={!numberValid || !linkedPanValid}
                loading={verify.isPending}
                onClick={() => verify.mutate()}
              >
                <ShieldCheck className="size-4" />
                Verify now
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The outcome, in the same dialog rather than behind a toast that vanishes. */
function IdentityResult({
  summary,
  label,
}: {
  summary: IdentityVerificationSummary;
  label: string;
}) {
  const verified = summary.outcome === 'VERIFIED';
  const unconfirmed = summary.outcome === 'UNCONFIRMED';

  return (
    <div className="space-y-3">
      <Alert variant={verified ? 'success' : unconfirmed ? 'warning' : 'destructive'}>
        {verified ? <BadgeCheck className="size-4" /> : <ShieldX className="size-4" />}
        <AlertTitle>
          {verified
            ? `${label} verified`
            : unconfirmed
              ? `${label} awaiting review`
              : `${label} not verified`}
        </AlertTitle>
        <AlertDescription className="space-y-1">
          <p className="font-mono text-xs">{summary.maskedNumber}</p>
          {summary.reason ? <p className="text-xs leading-relaxed">{summary.reason}</p> : null}
        </AlertDescription>
      </Alert>

      {summary.holderName ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <dt className="text-muted-foreground">On record</dt>
          <dd className="font-medium">{summary.holderName}</dd>
          {summary.provider ? (
            <>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-xs text-muted-foreground">
                {summary.provider}
                {summary.providerReference ? ` · ${summary.providerReference}` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
