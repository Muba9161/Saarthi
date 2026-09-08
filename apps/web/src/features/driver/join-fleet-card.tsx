import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ticket } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * The invite-code box a driver with no employer needs.
 *
 * Registration no longer demands a fleet invite code: a driver who finds
 * Saarthi before their owner does still gets an account, seated alone in an
 * organization of their own. This is where that account becomes an employee,
 * and it is on the home screen because that is where such a driver lands with
 * nothing else to do — no trips are coming, and no vehicle will accept them.
 *
 * Renders nothing for a driver who already has a fleet, which is the ordinary
 * case: the server decides that (`session.driver.awaitingFleet`) using the
 * same rule that governs whether the join is allowed at all.
 */
export function JoinFleetCard() {
  const { session, joinFleet } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);

  const awaiting = session?.driver?.awaitingFleet ?? false;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length === 0 || joining) return;

    setError(null);
    setJoining(true);

    void (async () => {
      try {
        const next = await joinFleet(trimmed);
        /*
         * The cache is tenant-scoped and the tenant has just changed, so it is
         * dropped rather than left to serve the empty seat's answers — the
         * same thing the organization switcher does after a switch.
         */
        queryClient.clear();
        toast.success(`You have joined ${next.organization?.name ?? 'your fleet'}`, {
          description: 'Your trips and vehicle assignments will appear here.',
        });
        setCode('');
      } catch (caught) {
        // The server answers on `fleetInviteCode`, so a wrong code is shown
        // under the box that holds it rather than as a passing toast.
        const fields = caught instanceof ApiError ? caught.fieldErrors : {};
        setError(fields.fleetInviteCode?.[0] ?? errorMessage(caught));
      } finally {
        setJoining(false);
      }
    })();
  };

  if (!awaiting) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Ticket className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-medium">Join your fleet</p>
            <p className="text-sm text-muted-foreground">
              Your account is ready, but no fleet has you yet — so there are no trips to show.
              Ask your truck owner for their Saarthi invite code and enter it here.
            </p>
            <p className="text-xs text-muted-foreground">
              Your licence, documents and the SOS button work without one.
            </p>
          </div>
        </div>

        <form className="flex flex-wrap gap-2" onSubmit={submit}>
          <Input
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              if (error) setError(null);
            }}
            placeholder="SR-XXXXXX"
            className="min-w-40 flex-1 font-mono uppercase tracking-wider"
            autoComplete="off"
            spellCheck={false}
            aria-label="Fleet invite code"
            aria-invalid={error !== null}
            disabled={joining}
          />
          <Button type="submit" loading={joining} disabled={code.trim().length === 0}>
            <Ticket className="size-4" />
            Join fleet
          </Button>
        </form>

        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

export default JoinFleetCard;
