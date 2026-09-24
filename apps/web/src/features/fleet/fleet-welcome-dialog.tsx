import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, UserPlus } from 'lucide-react';
import { Permission } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { ConfettiBurst } from '@/components/common/confetti-burst';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InviteCodeDisplay, useInviteCode } from './invite-code-card';

/**
 * The welcome a new fleet owner sees the moment their account exists: a
 * celebration, and the one thing they need next — their joining code, to hand
 * to their drivers.
 *
 * Shown once, straight after registration. `markFleetWelcomePending` is called
 * by the registration page, and the flag is cleared as the dialog opens, so a
 * reload never shows it twice.
 */

const WELCOME_KEY = 'saarthi:fleet-welcome';

export function markFleetWelcomePending(): void {
  try {
    window.sessionStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // Storage unavailable: the owner still finds the code on the Drivers screen.
  }
}

function takeFleetWelcome(): boolean {
  try {
    const pending = window.sessionStorage.getItem(WELCOME_KEY) === '1';
    window.sessionStorage.removeItem(WELCOME_KEY);
    return pending;
  } catch {
    return false;
  }
}

export function FleetWelcomeDialog() {
  const { can, session } = useAuth();
  const navigate = useNavigate();
  const canInvite = can(Permission.ORG_MEMBERS_MANAGE);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (canInvite && takeFleetWelcome()) setOpen(true);
  }, [canInvite]);

  const code = useInviteCode(open);
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-hidden text-center">
        <ConfettiBurst />
        <DialogHeader className="items-center text-center sm:text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PartyPopper className="size-6" aria-hidden />
          </span>
          <DialogTitle className="text-xl">
            Welcome to Saarthi{session?.organization?.name ? `, ${session.organization.name}` : ''}!
          </DialogTitle>
          <DialogDescription>
            Your account is ready. Share this joining code with your drivers — they enter it when
            they register, or later from their own account, and they work under your fleet.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center py-2">
          {code.data ? (
            <InviteCodeDisplay code={code.data.inviteCode} size="lg" />
          ) : (
            <p className="text-sm text-muted-foreground">
              {code.isError ? 'Your code is on the Drivers screen.' : 'Loading your code…'}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Drivers you add yourself from the Drivers screen join automatically — no code needed.
        </p>

        <DialogFooter className="gap-2 sm:justify-center">
          {can(Permission.DRIVERS_MANAGE) ? (
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                navigate('/fleet/drivers');
              }}
            >
              <UserPlus className="mr-1 size-4" aria-hidden />
              Add a driver
            </Button>
          ) : null}
          <Button onClick={() => setOpen(false)}>Get started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
