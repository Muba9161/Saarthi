import * as React from 'react';
import { VerificationCheckType, VerificationStepState } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import {
  formatFee,
  usePayAndVerify,
  usePriceFor,
} from '@/features/verification/use-pay-and-verify';

/**
 * Buying a vehicle's full RC details: RC Details Advanced, merged with the
 * basic record, through the same Pay & Verify flow as every ₹10 check.
 *
 * Two places buy it. The add-vehicle form names the plate, because the vehicle
 * does not exist yet; a vehicle's page passes the vehicle, and the plate is
 * read on the server. Either way the record is stored, and the caller reads it
 * back once `buy` resolves true. The price is the server's, never this file's.
 */

export type FullDetailsSubject =
  | { subjectType: 'ORGANIZATION'; subjectId: string; registrationNumber: string }
  | { subjectType: 'TRUCK'; subjectId: string };

/** What to say when a paid attempt ends without details and the server gave no reason. */
const FALLBACK_REASON: Partial<Record<VerificationStepState, string>> = {
  [VerificationStepState.PAYMENT_REQUIRED]: 'The payment did not go through, so nothing was charged.',
  [VerificationStepState.RETRY_REQUIRED]:
    'Full details could not be fetched just now. Your fee is kept, so trying again is free.',
  [VerificationStepState.FAILED]: 'The RTO has no record for this registration number.',
};

export function useFullDetails() {
  const { run, busy } = usePayAndVerify();
  const price = usePriceFor(VerificationCheckType.VEHICLE_RC_DETAILS);
  const [problem, setProblem] = React.useState<string | null>(null);

  /** Pay, fetch and store. Resolves true once the full record is stored. */
  const buy = React.useCallback(
    async (subject: FullDetailsSubject): Promise<boolean> => {
      setProblem(null);
      try {
        const outcome = await run({ kind: VerificationCheckType.VEHICLE_RC_DETAILS, ...subject });
        if (outcome.state === VerificationStepState.VERIFIED) return true;
        setProblem(
          outcome.message ??
            FALLBACK_REASON[outcome.state] ??
            'Full details could not be fetched. Nothing more was charged.',
        );
        return false;
      } catch (error) {
        setProblem(errorMessage(error));
        return false;
      }
    },
    [run],
  );

  const fee = formatFee(price);
  return {
    buy,
    busy,
    problem,
    /** False while the price loads, and where the check is not offered. */
    available: price?.available ?? false,
    fee,
    label: fee ? `Get full details · ${fee}` : 'Get full details',
  };
}
