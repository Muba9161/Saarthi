import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, RefreshCw, Share2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * The fleet's joining code, ready to hand to a driver.
 *
 * A driver enters it when they register, or later from their own home screen,
 * and from then on works under this fleet. Only somebody who manages the
 * fleet's members sees it — the API refuses anyone else.
 */

export const INVITE_CODE_QUERY_KEY = ['organization', 'invite-code'] as const;

export function useInviteCode(enabled = true) {
  return useQuery({
    queryKey: INVITE_CODE_QUERY_KEY,
    queryFn: () => api.get<{ inviteCode: string }>('/organizations/current/invite-code'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function shareMessage(organizationName: string, code: string): string {
  return `Join ${organizationName} on Saarthi. Register as a driver at ${window.location.origin}/register and enter the joining code ${code}.`;
}

export function InviteCodeDisplay({ code, size = 'default' }: { code: string; size?: 'default' | 'lg' }) {
  const { session } = useAuth();
  const [copied, setCopied] = React.useState(false);
  const organizationName = session?.organization?.name ?? 'our fleet';

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the code and copy it instead.');
    }
  };

  const share = async (): Promise<void> => {
    const text = shareMessage(organizationName, code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Saarthi joining code', text });
        return;
      } catch (error) {
        // Closing the share sheet is not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <output
        aria-label="Joining code"
        className={cn(
          'select-all rounded-lg border border-dashed border-primary/40 bg-primary/5 font-mono font-semibold tracking-[0.18em] text-primary',
          size === 'lg' ? 'px-5 py-3 text-2xl sm:text-3xl' : 'px-3 py-1.5 text-lg',
        )}
      >
        {code}
      </output>
      <Button variant="outline" size="sm" onClick={() => void copy()} aria-label="Copy joining code">
        {copied ? <Check className="mr-1 size-4 text-success" aria-hidden /> : <Copy className="mr-1 size-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button variant="outline" size="sm" onClick={() => void share()}>
        <Share2 className="mr-1 size-4" aria-hidden />
        Share
      </Button>
    </div>
  );
}

/** The card on the Drivers screen: the code, how drivers use it, and a way to replace it. */
export function InviteCodeCard() {
  const queryClient = useQueryClient();
  const code = useInviteCode();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const regenerate = useMutation({
    mutationFn: () => api.post<{ inviteCode: string }>('/organizations/current/invite-code/regenerate'),
    onSuccess: (result) => {
      queryClient.setQueryData(INVITE_CODE_QUERY_KEY, result);
      toast.success('New joining code issued', { description: 'The old code no longer works.' });
      setConfirmOpen(false);
    },
    onError: (error) => toast.error('Could not issue a new code', { description: errorMessage(error) }),
  });

  if (!code.data) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Your fleet joining code
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            Drivers enter this when they register, or later from their home screen, to work under
            your fleet. Drivers you add yourself join automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InviteCodeDisplay code={code.data.inviteCode} />
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
            <RefreshCw className="mr-1 size-4" aria-hidden />
            New code
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue a new joining code?</AlertDialogTitle>
            <AlertDialogDescription>
              The current code stops working straight away. Drivers already in your fleet are not
              affected — only anyone who has not joined yet needs the new code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerate.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={regenerate.isPending}
              onClick={(event) => {
                event.preventDefault();
                regenerate.mutate();
              }}
            >
              {regenerate.isPending ? 'Issuing…' : 'Issue new code'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
