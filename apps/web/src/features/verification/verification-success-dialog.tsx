import { BadgeCheck, PartyPopper } from 'lucide-react';
import { ConfettiBurst } from '@/components/common/confetti-burst';
import { motion, useReducedMotion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The celebration after a check lands.
 *
 * Opened only by callers holding a server-reported VERIFIED — a persisted
 * result, not a returned request — so the confetti is never ahead of the
 * database. `complete` is the final "You're verified" once every step is done.
 */
export function VerificationSuccessDialog({
  open,
  onOpenChange,
  label,
  complete = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was verified, e.g. "PAN". Ignored for the final completion. */
  label: string;
  complete?: boolean;
}) {
  const reduced = useReducedMotion();
  const Icon = complete ? BadgeCheck : PartyPopper;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden text-center">
        {open ? <ConfettiBurst /> : null}
        <DialogHeader className="items-center text-center sm:text-center">
          <motion.span
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success"
            initial={reduced ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          >
            <Icon className="size-7" aria-hidden />
          </motion.span>
          <DialogTitle className="text-xl">
            {complete ? 'You’re verified' : 'Verification successful'}
          </DialogTitle>
          <DialogDescription>
            {complete
              ? 'Your Saarthi verification is complete.'
              : `Your ${label} has been successfully verified.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button onClick={() => onOpenChange(false)} autoFocus>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
