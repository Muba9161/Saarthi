import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, Send } from 'lucide-react';
import { Feature, Permission, formatRegistrationNumber } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { CopilotAnswer } from '@/lib/api-types';
import type { VehicleSummary } from '@/lib/mobility-types';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Panel, PanelHeader } from './panel';

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
    <Panel aria-labelledby="vehicle-ai" className={cn('flex flex-col gap-3.5', className)}>
      <PanelHeader
        id="vehicle-ai"
        title="AI assistant"
        description={`Ask about this ${vehicle.typeLabel.toLowerCase()} — answered from your own records.`}
        className="mb-0"
      />

      {/* The answer replaces the prompts once there is one. */}
      {answer ? (
        <div className="min-w-0 space-y-2">
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
        <div className="flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              title={prompt.hint}
              disabled={ask.isPending}
              onClick={() => send(prompt.question(plate))}
              className="inline-flex min-h-9 items-center rounded-full border border-border px-3.5 text-[13px] font-medium transition-colors hover:bg-foreground/[0.04] disabled:pointer-events-none disabled:opacity-60"
            >
              {prompt.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-1.5 rounded-[12px] border border-border bg-card/70 py-1 pl-3.5 pr-1"
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
          className="min-h-10 resize-none border-0 bg-transparent px-0 py-2.5 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label={`Ask the assistant about ${plate}`}
        />
        <Button
          type="submit"
          size="icon"
          className="size-10 shrink-0 rounded-[9px]"
          loading={ask.isPending}
          disabled={!message.trim()}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </Panel>
  );
}

export default VehicleAiCard;
