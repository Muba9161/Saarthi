import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Clock, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { relativeTimeFrom, type OwnershipReviewView } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Asking the Saarthi team to confirm a vehicle is yours, when the RC owner's
 * name cannot be matched automatically: a name spelt differently, a married
 * name, a vehicle in a relative's name, or no RC to hand.
 *
 * Shown on a vehicle's Ownership card and in the add-vehicle form when a plate
 * another account holds is refused. Says where the latest request stands, and
 * otherwise offers to send one: a message, required, and the RC, optional.
 */

export type OwnershipReviewSubject = { vehicleId: string } | { registrationNumber: string };

const MIN_MESSAGE = 20;
const MAX_MESSAGE = 1000;

function subjectKey(subject: OwnershipReviewSubject): string {
  return 'vehicleId' in subject ? subject.vehicleId : subject.registrationNumber;
}

export function OwnershipReviewRequest({
  subject,
  className,
}: {
  subject: OwnershipReviewSubject;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const latest = useQuery({
    queryKey: ['ownership-review', 'latest', subjectKey(subject)],
    queryFn: () => api.get<OwnershipReviewView | null>('/fleet/ownership-reviews/latest', subject),
  });

  if (latest.isLoading) return null;
  const review = latest.data ?? null;

  const ask = (label: string) => (
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      <MessageSquareText className="size-4" aria-hidden />
      <span>{label}</span>
    </Button>
  );

  return (
    <div className={cn('space-y-2', className)}>
      {review?.status === 'PENDING' ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {`Your request is with the Saarthi team, sent ${relativeTimeFrom(review.createdAt)}. You will be notified when it is decided.`}
          </span>
        </p>
      ) : review?.status === 'APPROVED' ? (
        <p role="status" className="flex items-start gap-2 text-sm">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            {review.kind === 'CLAIM'
              ? 'Approved by the Saarthi team. Add the vehicle again and it moves to your account.'
              : 'Approved by the Saarthi team.'}
          </span>
        </p>
      ) : review?.status === 'REJECTED' ? (
        <div className="space-y-2">
          <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
            {`The Saarthi team declined your last request: ${review.decisionNote ?? 'no reason given.'}`}
          </p>
          {ask('Ask again')}
        </div>
      ) : (
        ask('Ask Saarthi to review')
      )}

      <OwnershipReviewDialog
        subject={subject}
        open={open}
        onOpenChange={setOpen}
        onSent={() => void latest.refetch()}
      />
    </div>
  );
}

function OwnershipReviewDialog({
  subject,
  open,
  onOpenChange,
  onSent,
}: {
  subject: OwnershipReviewSubject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);

  React.useEffect(() => {
    if (!open) {
      setMessage('');
      setFile(null);
    }
  }, [open]);

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('message', message.trim());
      if ('vehicleId' in subject) form.append('vehicleId', subject.vehicleId);
      else form.append('registrationNumber', subject.registrationNumber);
      if (file) form.append('file', file);
      return api.post<OwnershipReviewView>('/fleet/ownership-reviews', form);
    },
    onSuccess: () => {
      toast.success('Request sent', {
        description: 'The Saarthi team will review it and you will be notified.',
      });
      void queryClient.invalidateQueries({ queryKey: ['ownership-review'] });
      onSent();
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not send the request', { description: errorMessage(error) }),
  });

  const length = message.trim().length;
  const ready = length >= MIN_MESSAGE && length <= MAX_MESSAGE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask Saarthi to confirm this vehicle is yours</DialogTitle>
          <DialogDescription>
            A person on the Saarthi team reads this and decides. Tell them why the automatic check
            could not match you - for example a name spelt differently, a married name, or a
            vehicle registered to a family member.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) send.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ownership-review-message" required>
              Your message
            </Label>
            <Textarea
              id="ownership-review-message"
              rows={4}
              maxLength={MAX_MESSAGE}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="The RC is in my name as SMT. BHAWNA PANDEY; my PAN spells it BHAVANA PANDEY."
              aria-describedby="ownership-review-message-hint"
            />
            <p id="ownership-review-message-hint" className="text-xs text-muted-foreground">
              {length < MIN_MESSAGE
                ? `At least ${MIN_MESSAGE} characters (${length} so far).`
                : `${length} / ${MAX_MESSAGE}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ownership-review-file">RC (optional)</Label>
            <Input
              id="ownership-review-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              A photo or PDF of the RC helps if you have one. Without it, your message is enough
              to send.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready} loading={send.isPending}>
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
