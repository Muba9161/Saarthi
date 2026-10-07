import * as React from 'react';
import { BadgeCheck, IdCard } from 'lucide-react';
import { IdentityDocumentKind } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import {
  IdentityVerifyDialog,
  type IdentityVerifyTarget,
} from '@/features/verification/identity-verify-dialog';

/**
 * Why a plate another account holds was not handed over, with the fix beside it.
 *
 * Shown in the add-vehicle dialog when the only problem is that this account
 * has no verified name to match against the RC. The PAN check opens on top of
 * the form, the same one the vehicle's Ownership card uses, so nothing typed
 * is lost: verify, then press Add vehicle again.
 *
 * Inline rather than a button on the error toast: a click on a toast counts as
 * a click outside the dialog, which would close it and the form with it.
 */
export function ClaimNameNotice({ message }: { message: string }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [target, setTarget] = React.useState<IdentityVerifyTarget | null>(null);
  const [verified, setVerified] = React.useState(false);

  return (
    <div className="mx-4 mt-3 sm:mx-6">
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
          className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm sm:flex-row sm:items-center"
        >
          <p className="min-w-0 flex-1">{message}</p>
          {userId ? (
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
