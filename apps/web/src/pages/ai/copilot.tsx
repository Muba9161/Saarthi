import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Feature, Permission } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface ChatResult {
  conversationId: string;
  answer: string;
  references: { type: string; id: string; label: string }[];
  provider: string;
  model: string;
  contextSummary: { factCount: number; focus: string };
}

const SUGGESTIONS = [
  'What needs my attention today?',
  'Which trucks are idle right now?',
  'Which documents expire soon?',
  'Which trips are running late?',
  'Which driver performed best this month?',
  'Why did fuel cost change?',
];

/** Fleet Copilot. Answers are grounded in records the caller may already see. */
export function CopilotPage() {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState('');
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<{ role: 'user' | 'assistant'; content: string; references?: ChatResult['references'] }[]>([]);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const usage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => api.get<{ requestsToday: number; provider: string; model: string }>('/ai/usage'),
    enabled: can(Permission.AI_USE) && hasFeature(Feature.AI_COPILOT),
  });

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.post<ChatResult>('/ai/chat', { message: question, ...(conversationId ? { conversationId } : {}) }),
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      setThread((previous) => [...previous, { role: 'assistant', content: result.answer, references: result.references }]);
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
