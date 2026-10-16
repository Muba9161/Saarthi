import * as React from 'react';
import { BadgeCheck, IdCard } from 'lucide-react';
import { IdentityDocumentKind } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import {
  IdentityVerifyDialog,
  type IdentityVerifyTarget,
} from '@/features/verification/identity-verify-dialog';
import { OwnershipReviewRequest } from './ownership-review-request';

/**
 * Why a plate another account holds was not handed over, with the fixes beside it.
 *
 * Two ways out, both on top of the form so nothing typed is lost. When the
 * account has no verified name to match, the PAN check (the same one the
 * vehicle's Ownership card uses); and always, asking the Saarthi team to
 * review it, for the owner whose name will never match automatically.
 *
 * Inline rather than buttons on the error toast: a click on a toast counts as
 * a click outside the dialog, which would close it and the form with it.
 */
export function ClaimRefusalNotice({
  message,
  registrationNumber,
  needsVerifiedName,
}: {
  message: string;
  registrationNumber: string;
  /** The account has no verified name yet, so a PAN would settle it. */
  needsVerifiedName: boolean;
}) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [target, setTarget] = React.useState<IdentityVerifyTarget | null>(null);
  const [verified, setVerified] = React.useState(false);

  return (
    <div className="mx-4 mt-3 space-y-2 sm:mx-6">
      {verified ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm"
        >
          <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
          <span>Your PAN is verified. Press Add vehicle to try again.</span>
        </p>
      ) : (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1">{message}</p>
            {needsVerifiedName && userId ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  setTarget({ kind: IdentityDocumentKind.PAN, subjectType: 'USER', subjectId: userId })
                }
              >
                <IdCard className="size-4" aria-hidden />
                <span>Verify your PAN</span>
              </Button>
            ) : null}
          </div>
          <OwnershipReviewRequest subject={{ registrationNumber }} />
        </div>
      )}

      {/* Mounted throughout, so it can show its result after the PAN verifies. */}
      <IdentityVerifyDialog
        target={target}
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onVerified={() => setVerified(true)}
      />
    </div>
  );
}
