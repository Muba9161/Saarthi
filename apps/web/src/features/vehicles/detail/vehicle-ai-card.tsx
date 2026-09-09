import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, Send, Sparkles } from 'lucide-react';
import { Feature, Permission, formatRegistrationNumber } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { CopilotAnswer } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * The copilot, asked about one vehicle.
 *
 * Not a second AI system: it posts to the same `/ai/ask` the Copilot screen
 * uses, behind the same permission and the same entitlement, and shows the same
 * provenance line. What it adds is the subject — every question leaves here
 * naming this vehicle's plate, so the operator does not retype a registration
 * number that is on the screen above them.
 *
 * The prompts are the important part. Each one exists because a tool behind
 * `/ai/ask` can actually answer it — cost, service history, drive summary,
 * loan — and each is offered only when this caller could reach that data by
 * other means anyway: the drive summary needs a fitted device, the loan needs
 * the finance grant. A prompt for a question the copilot has no tool for, or
 * for records this role cannot see, would be a button that produces an apology.
 */

interface VehiclePrompt {
  /** Chip label. */
  label: string;
  /** What the chip is for, under the label. */
  hint: string;
  /** The question sent, with the plate already in it. */
  question: (plate: string) => string;
}

export function VehicleAiCard({
  vehicle,
  /** Mirrors the Loan & finance tab's gate — no loan prompt without it. */
  canSeeFinance,
  className,
}: {
  vehicle: VehicleSummary;
  canSeeFinance: boolean;
  className?: string;
}) {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState('');
  const [answer, setAnswer] = React.useState<CopilotAnswer | null>(null);

  const ask = useMutation({
    mutationFn: (question: string) => api.post<CopilotAnswer>('/ai/ask', { message: question }),
    onSuccess: (result) => {
      setAnswer(result);
      // The Copilot screen shows a request counter off this key.
      void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    onError: (error) =>
      toast.error('The copilot could not answer', { description: errorMessage(error) }),
  });

  /*
   * Gated exactly as the Copilot screen is. Rendering nothing is deliberate:
   * an assistant card that answers every question with "your plan does not
   * include this" is worse than a page that never promised one.
   */
  if (!can(Permission.AI_USE) || !hasFeature(Feature.AI_COPILOT)) return null;

  const plate = formatRegistrationNumber(vehicle.registrationNumber);

  const prompts: VehiclePrompt[] = [
    {
      label: 'Running cost',
      hint: 'Fuel, tolls, workshop',
      question: (subject) =>
        `What has ${subject} cost to run, broken down by fuel, tolls and maintenance?`,
    },
    {
      label: 'Service history',
      hint: 'What has been done',
      question: (subject) => `Summarise the service and maintenance history for ${subject}.`,
    },
    // Only with a unit fitted: the drive summary reads what a device reported,
    // so on a vehicle without one there is nothing for it to summarise.
    ...(vehicle.device
      ? [
          {
            label: 'Recent driving',
            hint: 'From the fitted device',
            question: (subject: string) =>
              `Summarise how ${subject} has been driven recently, including any telemetry alerts.`,
          },
        ]
      : []),
    ...(canSeeFinance
      ? [
          {
            label: 'Loan status',
            hint: 'Outstanding and next due',
            question: (subject: string) =>
              `What is outstanding on the loan for ${subject}, and when is the next instalment due?`,
          },
        ]
      : []),
  ];

  const send = (question: string): void => {
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;
    setMessage('');
    ask.mutate(trimmed);
  };

  return (
    <Card variant="glass" className={cn('flex flex-col rounded-2xl p-5', className)}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-primary/15">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">AI assistant</p>
          <p className="text-xs text-muted-foreground">
            Ask about this {vehicle.typeLabel.toLowerCase()} — answered from your own records.
          </p>
        </div>
      </div>

      {/* The answer replaces the prompts once there is one, so the card does
          not grow taller than the hero it sits beside. */}
      {answer ? (
        <div className="mt-4 min-w-0 space-y-2">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>

          {/*
            Provenance is not decoration. An operator deciding whether to act on
            "this vehicle is overdue a service" needs to see it came from a
            named tool over a known number of records.
          */}
          {answer.provenance ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              <span>{answer.provenance}</span>
            </p>
          ) : null}

          {answer.caveats.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-warning">
              {answer.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => setAnswer(null)}
          >
            Ask something else
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              disabled={ask.isPending}
              onClick={() => send(prompt.question(plate))}
              className="glass-inset surface-interactive rounded-xl px-3 py-2.5 text-left disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="block text-xs font-medium">{prompt.label}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{prompt.hint}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(message);
        }}
      >
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter keeps the newline, as the Copilot does.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(message);
            }
          }}
          placeholder={`Ask about ${plate}…`}
          rows={1}
          className="min-h-10 resize-none py-2"
          aria-label={`Ask the assistant about ${plate}`}
        />
        <Button
          type="submit"
          size="icon"
          shape="pill"
          loading={ask.isPending}
          disabled={!message.trim()}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

export default VehicleAiCard;
