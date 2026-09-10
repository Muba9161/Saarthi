import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { RegistryVerificationResult } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { RegistryVerifyDialog } from './registry-verify-dialog';

/**
 * The Verify control on a vehicle or a driver.
 *
 * One button, one click, one answer. Nothing is sent to the owner for
 * approval and nothing is queued for a reviewer: the registration number or
 * licence number Saarthi already holds is checked with the authority that
 * issued it, and the answer settles the record's status immediately — a
 * verified tick, or the specific problem the registry reported.
 *
 * Three subject types reach this control and they are not the same:
 *
 *  * a **vehicle** is checked against the RTO's vehicle register;
 *  * a **driver** against the driving licence register;
 *  * an **organization** has no such single record — its equivalent is its
 *    GSTIN, which the identity module already verifies against the GST
 *    portal — so for that one the demo shortcut is all this offers.
 *
 * The demo shortcut is kept, but demoted to where it belongs: it appears only
 * when the environment has no registry credentials at all, in demo mode, so a
 * fresh local install stays walkable without pretending a real check happened.
 */

export type VerifySubjectType = 'driver' | 'truck' | 'organization';

export interface VerifyButtonProps {
  subjectType: VerifySubjectType;
  subjectId: string;
  /** Hides the control — a verified record has nothing to ask the registry. */
  verified: boolean;
  /** What is being verified, for the dialog heading. */
  subjectLabel: string;
  /** Query keys to refresh once the status changes. */
  invalidateKeys?: unknown[][];
  className?: string;
}

export function VerifyButton({
  subjectType,
  subjectId,
  verified,
  subjectLabel,
  invalidateKeys = [],
  className,
}: VerifyButtonProps) {
  const { can, session } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  /** The registry is authoritative for a vehicle and a driver, and only those. */
  const registryBacked = subjectType === 'truck' || subjectType === 'driver';
  const demoAvailable = Boolean(session?.demoMode);

  const refresh = React.useCallback((): void => {
    for (const key of invalidateKeys) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
    void queryClient.invalidateQueries({ queryKey: ['verification'] });
    // The RC and licence tabs read the same stored record this check refreshed.
    void queryClient.invalidateQueries({ queryKey: ['vehicle-lookup'] });
    void queryClient.invalidateQueries({ queryKey: ['licence-lookup'] });
  }, [invalidateKeys, queryClient]);

  const check = useMutation({
    mutationFn: (variables: { dateOfBirth?: string | undefined }) =>
      api.post<RegistryVerificationResult>(
        `/verification/subject/${subjectType}/${subjectId}/registry-verify`,
        variables.dateOfBirth ? { dateOfBirth: variables.dateOfBirth } : {},
      ),
    onSuccess: (result) => {
      // A refusal is a recorded outcome, not a failed request — the subject's
      // status changed either way, so the page behind must be refreshed for
      // both.
      refresh();

      if (result.verified) {
        toast.success('Verified', { description: result.summary });
      } else {
        toast.error('Not verified', { description: result.summary });
      }
    },
    // No toast on failure: an unreachable registry is explained in the dialog,
    // where there is room to say that nothing was recorded.
  });

  const demoVerify = useMutation({
    mutationFn: () => api.post(`/verification/subject/${subjectType}/${subjectId}/demo-verify`, {}),
    onSuccess: () => {
      refresh();
      setOpen(false);
      toast.success('Verified', {
        description: 'Demo mode - no registry was contacted and no documents were reviewed.',
      });
    },
    onError: (error) => toast.error('Could not verify', { description: errorMessage(error) }),
  });

  if (!can(Permission.VERIFICATION_SUBMIT)) return null;
  // Nothing to offer: no registry for this subject type, and no demo mode.
  if (!registryBacked && !demoAvailable) return null;

  /**
   * Whether to offer the button at all.
   *
   * Separate from whether to render *anything*, because a successful check
   * flips `verified` the moment the page behind refetches — and unmounting on
   * that would take the result dialog with it, before the operator had read
   * the answer they just asked for. So the button goes and the dialog stays
   * until it is closed.
   */
  const offer = !verified;
  if (!offer && !open) return null;

  const start = (dateOfBirth?: string): void => {
    setOpen(true);
    check.reset();
    check.mutate({ dateOfBirth });
  };

  if (!registryBacked) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={className}
        loading={demoVerify.isPending}
        onClick={() => demoVerify.mutate()}
        title="Demo mode only - an organization is verified through its GSTIN on the Identity tab"
      >
        <BadgeCheck className="size-4" />
        Verify (demo)
      </Button>
    );
  }

  return (
    <>
      {offer ? (
        <Button
          size="sm"
          variant="outline"
          className={className}
          loading={check.isPending}
          onClick={() => start()}
          title={
            subjectType === 'truck'
              ? 'Check this registration number with the RTO'
              : 'Check this licence number with the licensing authority'
          }
        >
          <BadgeCheck className="size-4" />
          Verify
        </Button>
      ) : null}

      <RegistryVerifyDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) check.reset();
        }}
        kind={subjectType === 'truck' ? 'VEHICLE' : 'DRIVER'}
        subjectLabel={subjectLabel}
        pending={check.isPending}
        result={check.data ?? null}
        error={check.error}
        onRetry={(dateOfBirth) => {
          check.reset();
          check.mutate({ dateOfBirth });
        }}
        onDemoVerify={demoAvailable ? () => demoVerify.mutate() : undefined}
        demoPending={demoVerify.isPending}
      />
    </>
  );
}
