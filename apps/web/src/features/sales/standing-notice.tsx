import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { SalesmanStatus } from '@saarthi/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { SalesmanProfileView } from './types';

/**
 * Why this salesperson cannot sell yet.
 *
 * Shown on every Sales screen, unconditionally, whenever the profile is not
 * active. The alternative — hiding the Share button and leaving the rest of the
 * screen looking normal — produces a salesperson who thinks Saarthi is broken
 * and a support ticket that takes a week to reach the right person.
 *
 * The wording comes from the API (`profile.standing`), which knows the one
 * thing the client cannot: whether GODWeb is reachable on this deployment. When
 * it is not, the answer is "an administrator has to verify you", and when it
 * is, the answer is "verification has not run yet" — and those need different
 * people to act.
 */
export function SalesStandingNotice({
  profile,
  godWebVerificationAvailable,
}: {
  profile: SalesmanProfileView | null;
  godWebVerificationAvailable: boolean;
}) {
  if (!profile) return null;
  if (profile.canSell) return null;

  const rejected = profile.status === SalesmanStatus.REJECTED;

  return (
    <Alert variant={rejected ? 'destructive' : 'default'}>
      {rejected ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <ShieldCheck className="h-4 w-4" />
      )}
      <AlertTitle>
        {rejected ? 'GODID not recognised' : 'Your GODID is not verified yet'}
      </AlertTitle>
      <AlertDescription className="space-y-1">
        <p>{profile.standing}</p>
        {!rejected && !godWebVerificationAvailable ? (
          <p className="text-xs">
            GODWeb verification is not enabled on this environment, so Saarthi operations has to
            confirm your GODID by hand. Nothing you record before then is lost — leads and
            handovers are kept, and only the referral link and commission wait.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
