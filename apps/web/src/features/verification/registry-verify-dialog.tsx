import * as React from 'react';
import {
  BadgeCheck,
  Car,
  CircleAlert,
  IdCard,
  Info,
  ShieldX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { RegistryFinding } from '@saarthi/shared';
import type { RegistryVerificationResult } from '@/lib/api-types';
import { ApiError, errorMessage } from '@/lib/api-client';
import { LoadingState } from '@/components/common/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

/**
 * The registry check, start to finish, in one dialog.
 *
 * It opens already working — the check is fired by the button, not by a second
 * confirmation — because there is nothing for the operator to decide: the
 * registration number and licence number are already on file, and the whole
 * point is that Saarthi asks the RTO rather than asking the operator.
 *
 * The dialog exists for the answer, not the question. A verdict has a reason,
 * often several, and each one names something specific to go and fix; a toast
 * that disappears in four seconds is the wrong place for that. Success is
 * shown here too, with whatever the registry actually said, so the tick mark
 * on the page behind is something the operator has seen the evidence for.
 *
 * One case needs an extra field. The licensing authority verifies a licence
 * *against* a date of birth, and Saarthi may not hold one for the driver — so
 * when the server says that, the dialog asks for exactly that and retries.
 */

/** How the RTO's progress is narrated while the call is in flight. */
const STAGES: Record<'VEHICLE' | 'DRIVER', string[]> = {
  VEHICLE: [
    'Reading the registration number on file…',
    'Checking it with the RTO…',
    'Reviewing the registration record…',
  ],
  DRIVER: [
    'Reading the licence number on file…',
    'Checking it with the licensing authority…',
    'Reviewing the licence record…',
  ],
};

function useStage(active: boolean, kind: 'VEHICLE' | 'DRIVER'): string {
  const [index, setIndex] = React.useState(0);
  const stages = STAGES[kind];

  React.useEffect(() => {
    if (!active) {
      setIndex(0);
      return undefined;
    }
    const timer = setInterval(
      () => setIndex((previous) => Math.min(previous + 1, stages.length - 1)),
      1400,
    );
    return () => clearInterval(timer);
  }, [active, stages.length]);

  return stages[index] ?? stages[0]!;
}

export interface RegistryVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: 'VEHICLE' | 'DRIVER';
  /** What is being verified, for the heading — a plate or a person's name. */
  subjectLabel: string;
  pending: boolean;
  result: RegistryVerificationResult | null;
  error: unknown;
  /** Re-run the check, optionally with a date of birth the server asked for. */
  onRetry: (dateOfBirth?: string) => void;
  /**
   * Offered only when the environment has no registry credentials and is in
   * demo mode — the affordance that keeps a fresh local install walkable.
   */
  onDemoVerify?: (() => void) | undefined;
  demoPending?: boolean;
}

export function RegistryVerifyDialog({
  open,
  onOpenChange,
  kind,
  subjectLabel,
  pending,
  result,
  error,
  onRetry,
  onDemoVerify,
  demoPending = false,
}: RegistryVerifyDialogProps) {
  const stage = useStage(pending, kind);
  const vehicle = kind === 'VEHICLE';

  /**
   * A date of birth the server could not find on the driver's profile.
   *
   * Recognised by the field error rather than by the message text, so the
   * wording can change on the server without the prompt disappearing here.
   */
  const needsDateOfBirth =
    error instanceof ApiError && Array.isArray(error.fieldErrors.dateOfBirth);
  const [dateOfBirth, setDateOfBirth] = React.useState('');

  React.useEffect(() => {
    if (!open) setDateOfBirth('');
  }, [open]);

  const notConfigured =
    error instanceof ApiError && error.code === 'PROVIDER_NOT_CONFIGURED';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {vehicle ? 'Verify with the RTO' : 'Verify with the licensing authority'}
          </DialogTitle>
          <DialogDescription>
            {vehicle
              ? `Checking the registration number Saarthi holds for ${subjectLabel} against the ` +
                'vehicle register. Nothing is sent to you for approval - the RTO answers, and ' +
                'that answer decides it.'
              : `Checking the licence number Saarthi holds for ${subjectLabel} against the ` +
                'driving licence register. Nothing is sent for approval - the register answers, ' +
                'and that answer decides it.'}
          </DialogDescription>
        </DialogHeader>

        {pending ? <LoadingState label={stage} /> : null}

        {!pending && needsDateOfBirth ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (dateOfBirth) onRetry(dateOfBirth);
            }}
          >
            <Alert variant="info">
              <Info className="size-4" />
              <AlertTitle>One more detail</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                The licensing authority verifies a licence number against the holder&rsquo;s date
                of birth, and Saarthi does not hold one for this driver. Enter the date printed on
                the licence - it is saved to the profile once the check succeeds, so this is asked
                only once.
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <Label htmlFor="registry-dob" required>
                Date of birth
              </Label>
              <Input
                id="registry-dob"
                type="date"
                required
                value={dateOfBirth}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDateOfBirth(event.target.value)}
                className="w-44"
              />
            </div>
          </form>
        ) : null}

        {!pending && !needsDateOfBirth && error ? (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>
              {notConfigured ? 'Registry checks are not enabled here' : 'The check could not run'}
            </AlertTitle>
            <AlertDescription className="space-y-1 text-xs leading-relaxed">
              <p>{errorMessage(error)}</p>
              {/* Said explicitly, because "it failed" and "it was refused" are
                  very different facts to an operator waiting on a dispatch. */}
              <p className="text-muted-foreground">
                Nothing was recorded against this{' '}
                {vehicle ? 'vehicle' : 'driver'} - the registry gave no answer either way.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {!pending && result ? <RegistryResult result={result} /> : null}

        <DialogFooter>
          {pending ? null : result ? (
            <>
              {!result.verified ? (
                <Button variant="outline" onClick={() => onRetry()}>
                  Check again
                </Button>
              ) : null}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : needsDateOfBirth ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button disabled={!dateOfBirth} onClick={() => onRetry(dateOfBirth)}>
                <BadgeCheck className="size-4" />
                Verify now
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {notConfigured && onDemoVerify ? (
                <Button
                  variant="outline"
                  loading={demoPending}
                  onClick={onDemoVerify}
                  title="Demo mode only - no registry was contacted"
                >
                  <BadgeCheck className="size-4" />
                  Verify in demo mode
                </Button>
              ) : (
                <Button onClick={() => onRetry()}>Try again</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The verdict, its reasons, and what the registry said.
 *
 * Blocking findings are the reasons a check failed and lead. Advisories are
 * shown under a heading that says plainly they did not stop anything — a
 * verified vehicle with expired insurance must not read as a rejection.
 */
function RegistryResult({ result }: { result: RegistryVerificationResult }) {
  const blocking = result.findings.filter((finding) => finding.severity === 'BLOCKING');
  const advisory = result.findings.filter((finding) => finding.severity === 'ADVISORY');
  const SubjectIcon: LucideIcon = result.source === 'VEHICLE_RC' ? Car : IdCard;

  return (
    <div className="space-y-3">
      <Alert variant={result.verified ? 'success' : 'destructive'}>
        {result.verified ? <BadgeCheck className="size-4" /> : <ShieldX className="size-4" />}
        <AlertTitle>{result.verified ? 'Verified' : 'Not verified'}</AlertTitle>
        <AlertDescription className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-mono text-xs">
            <SubjectIcon className="size-3.5 shrink-0" aria-hidden />
            {result.reference}
          </p>
          <p className="text-xs leading-relaxed">{result.summary}</p>
        </AlertDescription>
      </Alert>

      {blocking.length > 0 ? (
        <FindingList
          heading="What stopped it"
          findings={blocking}
          icon={ShieldX}
          tone="destructive"
        />
      ) : null}

      {advisory.length > 0 ? (
        <FindingList
          heading={
            result.verified
              ? 'Worth knowing - none of this stopped the check'
              : 'Also on the record'
          }
          findings={advisory}
          icon={TriangleAlert}
          tone="warning"
        />
      ) : null}

      {result.registry.details.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            On the registry
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {result.registry.details.map((row) => (
              <React.Fragment key={row.label}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {result.registry.checkedAt ? (
          <span>Registry checked {new Date(result.registry.checkedAt).toLocaleString()}</span>
        ) : null}
        {result.registry.cached ? (
          <Badge variant="muted" size="sm">
            From Saarthi records
          </Badge>
        ) : null}
        {result.registry.providerReference ? (
          <span>· reference {result.registry.providerReference}</span>
        ) : null}
      </p>
    </div>
  );
}

function FindingList({
  heading,
  findings,
  icon: Icon,
  tone,
}: {
  heading: string;
  findings: RegistryFinding[];
  icon: LucideIcon;
  tone: 'destructive' | 'warning';
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <ul className="space-y-2">
        {findings.map((finding) => (
          <li
            key={finding.code}
            className={
              tone === 'destructive'
                ? 'flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-2.5'
                : 'flex gap-2 rounded-lg border border-warning/30 bg-warning/8 p-2.5'
            }
          >
            <Icon
              className={
                tone === 'destructive'
                  ? 'mt-0.5 size-3.5 shrink-0 text-destructive'
                  : 'mt-0.5 size-3.5 shrink-0 text-warning'
              }
              aria-hidden
            />
            <div className="space-y-0.5">
              <p className="text-xs font-medium">{finding.label}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
