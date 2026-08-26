import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Info, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Feature, Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { CopilotAnswer, RecordedToolCall } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

/**
 * A thread entry.
 *
 * `provenance` and `toolCalls` ride along with the answer because the copilot's
 * credibility rests on them: an operator deciding whether to act on "three
 * vehicles need service" should be able to see that it came from a named tool
 * over a known number of records, not from a model's impression of the fleet.
 */
interface ThreadEntry {
  role: 'user' | 'assistant';
  content: string;
  references?: { type: string; id: string; label: string }[];
  provenance?: string;
  toolCalls?: RecordedToolCall[];
  caveats?: string[];
}

const SUGGESTIONS = [
  'What needs my attention today?',
  'Which vehicles need service?',
  'Which EMIs are due this week?',
  'Which documents expire soon?',
  'How much did we spend on fuel this month?',
  'Can I add another vehicle to my plan?',
];

/** Fleet Copilot. Answers are grounded in records the caller may already see. */
export function CopilotPage() {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState('');
  const [thread, setThread] = React.useState<ThreadEntry[]>([]);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const usage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => api.get<{ requestsToday: number; provider: string; model: string }>('/ai/usage'),
    enabled: can(Permission.AI_USE) && hasFeature(Feature.AI_COPILOT),
  });

  const ask = useMutation({
    // The tool-calling endpoint: the model asks Saarthi for what it needs, one
    // authorised call at a time, and the answer arrives with the record of it.
    mutationFn: (question: string) => api.post<CopilotAnswer>('/ai/ask', { message: question }),
    onSuccess: (result) => {
      setThread((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: result.answer,
          references: result.references,
          provenance: result.provenance,
          toolCalls: result.toolCalls,
          caveats: result.caveats,
        },
      ]);
      void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    onError: (error) => toast.error('The copilot could not answer', { description: errorMessage(error) }),
  });

  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread]);

  const send = (question: string) => {
    if (!question.trim()) return;
    setThread((previous) => [...previous, { role: 'user', content: question }]);
    setMessage('');
    ask.mutate(question);
  };

  if (!can(Permission.AI_USE)) return <UnauthorizedState />;
  if (!hasFeature(Feature.AI_COPILOT)) {
    return (<div className="space-y-5"><PageHeader title="AI Fleet Copilot" /><FeatureLockedState feature="AI Fleet Copilot" requiredPlan="Intelligence" /></div>);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <PageHeader
        title="AI Fleet Copilot"
        description="Answers built only from records your role can already access."
        actions={usage.data ? <Badge variant="secondary">{usage.data.provider} · {usage.data.requestsToday} today</Badge> : null}
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {thread.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="rounded-full bg-primary/10 p-4"><Bot className="size-7 text-primary" /></span>
                <div className="space-y-1">
                  <p className="font-medium">Ask about your fleet</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    The copilot reads only your organization's data, and tells you which records an answer came from.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <Button key={suggestion} variant="outline" size="sm" onClick={() => send(suggestion)}>
                      <Sparkles className="size-3.5" />{suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              thread.map((entry, index) => (
                <div key={index} className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${entry.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    <p className="whitespace-pre-wrap">{entry.content}</p>
                    {entry.references && entry.references.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {entry.references.slice(0, 8).map((reference) => (
                          <Badge key={`${reference.type}-${reference.id}`} variant="outline" size="sm">{reference.label}</Badge>
                        ))}
                      </div>
                    ) : null}

                    {/*
                      Caveats are shown, never folded into the prose. "Excludes
                      three unconfirmed installments" is the difference between
                      a figure someone can plan against and one they cannot.
                    */}
                    {entry.caveats && entry.caveats.length > 0 ? (
                      <ul className="mt-2.5 space-y-1 border-t border-border/60 pt-2">
                        {entry.caveats.map((caveat) => (
                          <li key={caveat} className="flex items-start gap-1.5 text-2xs text-muted-foreground">
                            <Info className="mt-0.5 size-3 shrink-0" />
                            {caveat}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {entry.provenance ? (
                      <details className="mt-2.5 border-t border-border/60 pt-2">
                        <summary className="cursor-pointer text-2xs text-muted-foreground">
                          {entry.provenance}
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {(entry.toolCalls ?? []).map((call, callIndex) => (
                            <li key={`${call.tool}-${callIndex}`} className="text-2xs text-muted-foreground">
                              <span className="font-mono">{call.tool}</span>
                              {call.error
                                ? ` — ${call.error}`
                                : ` — ${call.recordCount} record${call.recordCount === 1 ? '' : 's'}` +
                                  (call.basis ? `, ${call.basis.toLowerCase().replace('_', ' ')}` : '') +
                                  (call.cached ? ', cached' : '')}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {ask.isPending ? <p className="text-sm text-muted-foreground">Thinking…</p> : null}
            <div ref={endRef} />
          </div>

          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); send(message); }}>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(message); } }}
              placeholder="Ask about trucks, drivers, documents, trips or costs…"
              rows={2}
              className="resize-none"
            />
            <Button type="submit" size="icon-lg" disabled={!message.trim()} loading={ask.isPending} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default CopilotPage;
