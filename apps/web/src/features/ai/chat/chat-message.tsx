import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Copy, Info, RotateCcw } from 'lucide-react';
import type { AssistantAction, RecordedToolCall } from '@/lib/api-types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RichText } from './rich-text';
import { SaarthiAvatar, type SaarthiMood } from './saarthi-avatar';
import { useTypewriter } from './use-typewriter';

/**
 * One line of the conversation.
 *
 * `provenance`, `toolCalls` and `caveats` ride along with an answer because
 * the copilot's credibility rests on them: an operator deciding whether to act
 * on "three vehicles need service" should be able to see which tool it came
 * from and over how many records — warmth in the wording never replaces that.
 */
export interface ThreadEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  references?: { type: string; id: string; label: string }[];
  provenance?: string;
  toolCalls?: RecordedToolCall[];
  caveats?: string[];
  /** The question to send again when this reply is an apology for a failure. */
  retry?: string;
  /** Screens Mitra offers to open: a prefilled draft, a guide, the next setup step. */
  actions?: AssistantAction[];
  /** The loop stopped on a limit rather than on a complete answer. */
  truncated?: boolean;
  /** Today's allowance is used up; offer plans rather than a retry. */
  limitReached?: boolean;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

const THANKS = /\b(thanks?|thank you|thx|shukriya|dhanyavaa?d|dhanyawad)\b|धन्यवाद|शुक्रिया/i;
const GREETING =
  /^\s*(hi|hii+|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b|नमस्ते/i;

/**
 * How Mitra should look once it has said this, given what it was asked.
 * Trouble first, so a warm "thanks" never paints over a failed check.
 */
export function reactionFor(entry: ThreadEntry, question = ''): SaarthiMood {
  if (entry.limitReached) return 'surprised';
  if (entry.retry || (entry.caveats?.length ?? 0) > 0) return 'concerned';
  if (entry.truncated || (entry.toolCalls ?? []).some((call) => call.error !== null))
    return 'confused';
  if (THANKS.test(question)) return 'love';
  if ((entry.actions?.length ?? 0) > 0) return 'excited';
  if (GREETING.test(question)) return 'waving';
  return 'happy';
}

export function ChatMessage({
  entry,
  typing,
  mood,
  onTyped,
  onRetry,
  onAction,
}: {
  entry: ThreadEntry;
  /** Only the newest reply is written out; older ones render at once. */
  typing: boolean;
  /** The face beside the newest reply follows the page's mood. */
  mood: SaarthiMood;
  onTyped?: () => void;
  onRetry?: (question: string) => void;
  onAction?: (action: AssistantAction) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const mine = entry.role === 'user';
  const { shown, done, skip } = useTypewriter(entry.content, typing && !mine);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (done && typing) onTyped?.();
  }, [done, typing, onTyped]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text is still on screen to select.
    }
  };

  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 14, scale: 0.97, x: mine ? 12 : -12 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className={cn('group flex items-end gap-2.5', mine ? 'justify-end' : 'justify-start')}
    >
      {!mine ? <SaarthiAvatar size="sm" mood={typing ? mood : 'idle'} className="mb-5" /> : null}

      <div className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        <div
          onClick={!done ? skip : undefined}
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm shadow-sm',
            mine
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md border border-border bg-muted/60 text-foreground',
            !done && 'cursor-pointer',
          )}
          title={!done ? 'Click to show the whole reply' : undefined}
        >
          {mine ? (
            <p className="whitespace-pre-wrap">{entry.content}</p>
          ) : (
            <RichText text={shown} />
          )}

          {!mine && done ? <Details entry={entry} onRetry={onRetry} onAction={onAction} /> : null}
        </div>

        <div
          className={cn(
            'flex items-center gap-1 px-1 text-2xs text-muted-foreground',
            mine ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <time dateTime={entry.at}>{timeOf(entry.at)}</time>
          {!mine && done ? (
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded p-1 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={copied ? 'Copied' : 'Copy reply'}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function Details({
  entry,
  onRetry,
  onAction,
}: {
  entry: ThreadEntry;
  onRetry?: (question: string) => void;
  onAction?: (action: AssistantAction) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      {entry.actions && entry.actions.length > 0 && onAction ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {entry.actions.map((action, index) => (
            <motion.div
              key={action.path}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.08 }}
            >
              <Button
                size="sm"
                variant={index === 0 ? 'default' : 'outline'}
                className="w-full justify-between sm:w-auto"
                onClick={() => onAction(action)}
              >
                {action.label}
                <ArrowRight className="size-3.5" />
              </Button>
            </motion.div>
          ))}
        </div>
      ) : null}

      {entry.retry && onRetry ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2.5"
          onClick={() => onRetry(entry.retry!)}
        >
          <RotateCcw className="size-3.5" />
          Try again
        </Button>
      ) : null}

      {entry.references && entry.references.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {entry.references.slice(0, 8).map((reference) => (
            <Badge key={`${reference.type}-${reference.id}`} variant="outline" size="sm">
              {reference.label}
            </Badge>
          ))}
        </div>
      ) : null}

      {/*
        Caveats are shown, never folded into the prose. "Excludes three
        unconfirmed installments" is the difference between a figure someone
        can plan against and one they cannot.
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
            {(entry.toolCalls ?? []).map((call, index) => (
              <li key={`${call.tool}-${index}`} className="text-2xs text-muted-foreground">
                <span className="font-mono">{call.tool}</span>
                {call.error
                  ? ` - ${call.error}`
                  : ` - ${call.recordCount} record${call.recordCount === 1 ? '' : 's'}` +
                    (call.basis ? `, ${call.basis.toLowerCase().replace('_', ' ')}` : '') +
                    (call.cached ? ', cached' : '')}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </motion.div>
  );
}
