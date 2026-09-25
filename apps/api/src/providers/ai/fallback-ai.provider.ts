import { ErrorCode } from '@saarthi/shared';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  type AiAnswer,
  type AiContext,
  type AiGenerateInput,
  type AiGeneration,
  type AiJsonGeneration,
  type AiJsonRequest,
  type AiMessageInput,
  type AiProvider,
  type AiRecommendationItem,
  supportsStructuredOutput,
  supportsTools,
} from './ai.provider';

/**
 * An ordered chain of providers that behaves as one.
 *
 * Each call goes to the first provider in the chain; if it fails — rate limit,
 * timeout, outage, a model that rejects the request — the next one is tried,
 * and so on. The factory ends the chain with the local analyst, which never
 * calls out and never fails, so a copilot question is always answered and an
 * AI outage degrades quality rather than availability.
 *
 * A provider that was rate-limited is skipped for a short cooldown instead of
 * being asked again on every request only to be refused, which would add its
 * latency to every call until the limit resets.
 */

/** How long a rate-limited provider sits out before it is tried again. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const log = logger.child({ module: 'ai', component: 'fallback' });

function isRateLimit(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCode.PROVIDER_RATE_LIMITED;
}

/**
 * Declares tool calling and structured output only when some member of the
 * chain provides them, so the runtime guards (`supportsTools`,
 * `supportsStructuredOutput`) answer truthfully for the chain as a whole.
 */
export class FallbackAiProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsStructuredOutput: boolean;

  private readonly coolingUntil = new Map<AiProvider, number>();

  constructor(
    private readonly chain: AiProvider[],
    private readonly now: () => number = Date.now,
  ) {
    if (chain.length === 0) throw new Error('A fallback chain needs at least one provider.');
    this.name = chain[0]!.name;
    this.model = chain[0]!.model;
    this.supportsTools = chain.some(supportsTools);
    this.supportsStructuredOutput = chain.some(supportsStructuredOutput);
  }

  /**
   * Run `call` against each eligible provider in turn. A cooling provider is
   * still tried if nothing else is left, because a stale answer from it beats
   * no answer.
   */
  private async attempt<P extends AiProvider, T>(
    operation: string,
    eligible: P[],
    call: (provider: P) => Promise<T>,
  ): Promise<T> {
    if (eligible.length === 0) {
      throw new AppError(
        503,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        `No AI provider supports ${operation}.`,
      );
    }

    const now = this.now();
    const ready = eligible.filter((provider) => (this.coolingUntil.get(provider) ?? 0) <= now);
    const ordered = ready.length > 0 ? ready : eligible;

    let lastError: unknown;
    for (const provider of ordered) {
      try {
        return await call(provider);
      } catch (error) {
        lastError = error;
        if (isRateLimit(error))
          this.coolingUntil.set(provider, this.now() + RATE_LIMIT_COOLDOWN_MS);
        log.warn(
          { err: error, operation, provider: provider.name, model: provider.model },
          'AI provider failed; trying the next one',
        );
      }
    }
    throw lastError;
  }

  chat(question: string, context: AiContext, history?: AiMessageInput[]): Promise<AiAnswer> {
    return this.attempt('chat', this.chain, (provider) =>
      provider.chat(question, context, history),
    );
  }

  summarize(context: AiContext, focus: string): Promise<AiAnswer> {
    return this.attempt('summarize', this.chain, (provider) => provider.summarize(context, focus));
  }

  recommend(context: AiContext, kind: string): Promise<AiRecommendationItem[]> {
    return this.attempt('recommend', this.chain, (provider) => provider.recommend(context, kind));
  }

  generate(input: AiGenerateInput): Promise<AiGeneration> {
    return this.attempt('tool calling', this.chain.filter(supportsTools), (provider) =>
      provider.generate(input),
    );
  }

  generateJson(request: AiJsonRequest): Promise<AiJsonGeneration> {
    return this.attempt(
      'structured output',
      this.chain.filter(supportsStructuredOutput),
      (provider) => provider.generateJson(request),
    );
  }
}
