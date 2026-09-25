import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Send, Sparkles } from 'lucide-react';
import { AI_HISTORY_LIMIT, ErrorCode, Feature, Permission } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import type { AssistantAction, CopilotAnswer, MitraDraftState } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { ChatMessage, reactionFor, type ThreadEntry } from '@/features/ai/chat/chat-message';
import { SaarthiAvatar, type SaarthiMood } from '@/features/ai/chat/saarthi-avatar';
import { ThinkingBubble } from '@/features/ai/chat/thinking-bubble';
import { useSaarthiMood } from '@/features/ai/chat/use-saarthi-mood';
import { PageHeader } from '@/components/common/page-header';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

/** What Mitra says under the greeting, by mood. */
const MOOD_LINE: Record<SaarthiMood, string> = {
  idle: 'Ask me anything, or tell me what you want to get done.',
  listening: 'I’m listening…',
  curious: 'Ooh, a question - go on…',
  thinking: 'Let me look into that for you…',
  speaking: 'Here’s what I found.',
  happy: 'Happy to help - what next?',
  excited: 'I’ve got it ready - just review it with the button.',
  love: 'Aww, anytime! 💛',
  waving: 'Hello! Good to see you.',
  wink: 'Ask me anything, or tell me what you want to get done.',
  surprised: 'Oh - we’ve hit today’s limit.',
  concerned: 'Worth a closer look - see the notes under my reply.',
  confused: 'Hmm, I couldn’t get all of that - try asking one thing at a time.',
  sleepy: 'Still here whenever you need me…',
};

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

let entrySequence = 0;
const entryId = (): string => `entry-${Date.now()}-${(entrySequence += 1)}`;
const now = (): string => new Date().toISOString();

/** Only same-app paths, so a button can never leave Saarthi. */
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Saarthi Mitra — a conversation, not a query box.
 *
 * Mitra has a face that reacts, replies that write themselves out, the last
 * few messages as memory, and buttons that open the screen for whatever it
 * prepared. What never changes is where its answers come from — every figure
 * is from a tool the caller is authorised to use — and that it never saves
 * anything itself: its buttons open the real screens to review and confirm.
 */
export function CopilotPage() {
  const { can, hasFeature, session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reduced = useReducedMotion() ?? false;
  const [message, setMessage] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [thread, setThread] = React.useState<ThreadEntry[]>([]);
  const [typingId, setTypingId] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const enabled = can(Permission.AI_USE) && hasFeature(Feature.AI_COPILOT);
  const usage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () =>
      api.get<{
        questionsToday: number;
        dailyLimit: number;
        remainingToday: number;
        trialing: boolean;
      }>('/ai/usage'),
    enabled,
  });

  const suggestions = React.useMemo(() => {
    if (can(Permission.REQUIREMENTS_CREATE)) {
      return [
        'Post a requirement for 25 tons of river sand',
        'Am I fully verified?',
        'How do I compare bids?',
      ];
    }
    if (can(Permission.MATERIALS_MANAGE)) {
      return ['Help me add a product', 'What should I set up next?', 'How do I get paid?'];
    }
    return [
      'What needs my attention today?',
      'Which EMIs are due this week?',
      'How do I add vehicle capacity?',
    ];
  }, [can]);

  const addReply = (entry: Omit<ThreadEntry, 'id' | 'role' | 'at'>): void => {
    const reply: ThreadEntry = { id: entryId(), role: 'assistant', at: now(), ...entry };
    setThread((previous) => [...previous, reply]);
    setTypingId(reply.id);
  };

  const ask = useMutation({
    mutationFn: ({ question, history }: { question: string; history: ThreadEntry[] }) =>
      api.post<CopilotAnswer>('/ai/ask', {
        message: question,
        history: history
          .filter((entry) => !entry.retry && !entry.limitReached)
          .slice(-AI_HISTORY_LIMIT)
          .map((entry) => ({ role: entry.role, content: entry.content })),
      }),
    onSuccess: (result) => {
      addReply({
        content: result.answer,
        references: result.references,
        provenance: result.provenance,
        toolCalls: result.toolCalls,
        caveats: result.caveats,
        actions: result.actions,
        truncated: result.truncated,
      });
      void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    // A person would explain and offer a way forward, not flash an error.
    onError: (error, { question }) => {
      if (error instanceof ApiError && error.code === ErrorCode.PLAN_LIMIT_REACHED) {
        addReply({
          content: error.message,
          limitReached: true,
          actions: [{ label: 'See plans', path: '/settings/subscription' }],
        });
        return;
      }
      addReply({
        content: 'Sorry - I couldn’t get through to your records just now. Shall I try that again?',
        retry: question,
      });
    },
  });

  const { mood, react } = useSaarthiMood({
    thinking: ask.isPending,
    speaking: typingId !== null,
    draft: message,
    focused,
    activity: thread.length,
  });

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  }, [thread, ask.isPending, reduced]);

  const send = (question: string): void => {
    const trimmed = question.trim();
    if (trimmed.length < 2 || ask.isPending) return;
    const history = thread;
    setThread((previous) => [
      ...previous,
      { id: entryId(), role: 'user', content: trimmed, at: now() },
    ]);
    setMessage('');
    ask.mutate({ question: trimmed, history });
  };

  const onTyped = React.useCallback(
    (entry: ThreadEntry, question: string) => {
      setTypingId(null);
      react(reactionFor(entry, question));
    },
    [react],
  );

  const openAction = (action: AssistantAction): void => {
    if (!isInternalPath(action.path)) return;
    const state: MitraDraftState = action.draft ? { mitraDraft: action.draft } : {};
    navigate(action.path, { state });
  };

  if (!can(Permission.AI_USE)) return <UnauthorizedState />;
  if (!hasFeature(Feature.AI_COPILOT)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Saarthi Mitra" />
        <FeatureLockedState feature="Saarthi Mitra" featureKey={Feature.AI_COPILOT} />
      </div>
    );
  }

  const firstName = session?.user.firstName;
  const asked = new Set(
    thread.filter((entry) => entry.role === 'user').map((entry) => entry.content),
  );
  const nextSuggestions = suggestions.filter((suggestion) => !asked.has(suggestion));
  const questionBefore = (index: number): string =>
    [...thread.slice(0, index)].reverse().find((entry) => entry.role === 'user')?.content ?? '';

  return (
    // Fills the screen between the top bar and, below lg, the tab bar - so the
    // message box never hides behind it on a phone.
    <div className="flex h-[calc(100dvh-11rem)] min-h-[26rem] flex-col gap-3 sm:h-[calc(100dvh-12rem)] sm:gap-4 lg:h-[calc(100dvh-8rem)]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <SaarthiAvatar mood={mood} size="md" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-[-0.02em] sm:text-2xl">
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <AnimatePresence mode="wait">
              <motion.p
                key={MOOD_LINE[mood]}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="line-clamp-2 text-xs text-muted-foreground sm:text-sm"
              >
                {MOOD_LINE[mood]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        {usage.data ? (
          <Badge
            variant={usage.data.trialing ? 'info' : 'secondary'}
            className="hidden shrink-0 sm:inline-flex"
          >
            {usage.data.trialing
              ? `${usage.data.remainingToday} of ${usage.data.dailyLimit} free questions left today`
              : `${usage.data.questionsToday} question${usage.data.questionsToday === 1 ? '' : 's'} today`}
          </Badge>
        ) : null}
      </header>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
            {thread.length === 0 ? (
              <Welcome firstName={firstName} mood={mood} suggestions={suggestions} onAsk={send} />
            ) : (
              thread.map((entry, index) => (
                <ChatMessage
                  key={entry.id}
                  entry={entry}
                  typing={entry.id === typingId}
                  mood={mood}
                  onTyped={() => onTyped(entry, questionBefore(index))}
                  onRetry={send}
                  onAction={openAction}
                />
              ))
            )}
            <AnimatePresence>
              {ask.isPending ? <ThinkingBubble key="thinking" /> : null}
            </AnimatePresence>
            <div ref={endRef} />
          </div>

          {usage.data?.trialing ? (
            <p className="text-center text-2xs text-muted-foreground sm:hidden">
              {usage.data.remainingToday} of {usage.data.dailyLimit} free questions left today
            </p>
          ) : null}

          {thread.length > 0 && nextSuggestions.length > 0 && !ask.isPending ? (
            <div
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
              aria-label="Suggested questions"
            >
              {nextSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-full text-xs"
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}

          <form
            className="flex items-end gap-2 rounded-2xl border border-border bg-background p-1.5 transition-shadow focus-within:ring-2 focus-within:ring-primary/20 sm:p-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(message);
            }}
          >
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(message);
                }
              }}
              aria-label="Message Saarthi Mitra"
              placeholder="Message Mitra…"
              rows={1}
              maxLength={2000}
              className="max-h-32 min-h-10 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
            />
            <motion.div whileTap={reduced ? undefined : { scale: 0.9 }}>
              <Button
                type="submit"
                size="icon"
                shape="pill"
                disabled={message.trim().length < 2 || ask.isPending}
                loading={ask.isPending}
                aria-label="Send"
              >
                <Send className="size-4" />
              </Button>
            </motion.div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Welcome({
  firstName,
  mood,
  suggestions,
  onAsk,
}: {
  firstName: string | undefined;
  mood: SaarthiMood;
  suggestions: string[];
  onAsk: (question: string) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-1 py-2 text-center">
      <SaarthiAvatar
        mood={mood === 'idle' ? 'happy' : mood}
        size="lg"
        className="size-16 sm:size-24"
      />
      <div className="space-y-1.5">
        <p className="text-base font-semibold tracking-tight sm:text-lg">
          Hi{firstName ? ` ${firstName}` : ''}, I’m Mitra 👋
        </p>
        <p className="max-w-md text-xs text-muted-foreground sm:text-sm">
          Your Saarthi friend. I can answer questions, prepare requirements and listings for you to
          review, and walk you through anything in Saarthi - in English, Hindi or Hinglish.
        </p>
      </div>
      <motion.div
        className="flex w-full max-w-md flex-col gap-2 sm:w-auto sm:max-w-2xl sm:flex-row sm:flex-wrap sm:justify-center"
        initial={reduced ? false : 'hidden'}
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } },
        }}
      >
        {suggestions.map((suggestion) => (
          <motion.div
            key={suggestion}
            variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
            whileHover={reduced ? undefined : { y: -2 }}
          >
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-full text-xs sm:w-auto"
              onClick={() => onAsk(suggestion)}
            >
              <Sparkles className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{suggestion}</span>
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

export default CopilotPage;
