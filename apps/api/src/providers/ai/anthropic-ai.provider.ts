import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  AiAnswer,
  AiContext,
  AiMessageInput,
  AiProvider,
  AiRecommendationItem,
} from './ai.provider';

/**
 * Production AI adapter (Anthropic Messages API).
 *
 * The model receives only the pre-authorised context object assembled by the
 * permission layer — it has no database access, no tools and no ability to
 * widen its own scope. Responses are treated as untrusted text: they are
 * rendered as content, never executed, and citations are taken from the
 * context we supplied rather than from anything the model claims.
 */

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const MAX_TOKENS = 1200;
const TIMEOUT_MS = 30_000;

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

function systemPrompt(context: AiContext): string {
  return [
    'You are the Saarthi Fleet Copilot, an analyst embedded in a fleet management platform.',
    '',
    'Rules you must follow:',
    '1. Answer ONLY from the CONTEXT block. Never invent a number, a vehicle, a driver or a date.',
    '2. If the context does not contain the answer, say so plainly and suggest what data would be needed.',
    '3. Distinguish clearly between recorded facts, calculated metrics and projections.',
    '4. Be concise and operational. A fleet owner is reading this between phone calls.',
    '5. Never suggest an action that would put a driver at risk to save time or money.',
    '6. Use Indian number formatting for currency (₹) and refer to vehicles by registration number.',
    '',
    `The user is a ${context.role} operating in scope: ${context.scope}.`,
  ].join('\n');
}

function contextBlock(context: AiContext): string {
  const facts = context.facts
    .map((fact) => `- [${fact.basis}] ${fact.statement}`)
    .join('\n');
  const metrics = Object.entries(context.metrics)
    .map(([key, value]) => `- ${key}: ${value ?? 'not available'}`)
    .join('\n');

  return [
    '<context>',
    `generated_at: ${context.generatedAt}`,
    '',
    'FACTS:',
    facts || '(none)',
    '',
    'METRICS:',
    metrics || '(none)',
    '</context>',
  ].join('\n');
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    if (!config.ai.apiKey) {
      throw new Error('AI_PROVIDER=anthropic requires AI_API_KEY to be configured.');
    }
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.baseUrl = (config.ai.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async call(
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{ text: string; tokensIn: number; tokensOut: number; latencyMs: number }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        logger.error(
          { status: response.status, detail: detail.slice(0, 500) },
          'AI provider request failed',
        );
        throw errors.provider(
          this.name,
          'The AI service is temporarily unavailable. Please try again shortly.',
        );
      }

      const body = (await response.json()) as AnthropicResponse;
      const text = body.content
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text!)
        .join('\n')
        .trim();

      return {
        text,
        tokensIn: body.usage?.input_tokens ?? 0,
        tokensOut: body.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw errors.provider(this.name, 'The AI service did not respond in time.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async chat(
    question: string,
    context: AiContext,
    history: AiMessageInput[] = [],
  ): Promise<AiAnswer> {
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      ...history.slice(-8).map((entry) => ({ role: entry.role, content: entry.content })),
      { role: 'user' as const, content: `${contextBlock(context)}\n\nQuestion: ${question}` },
    ];

    const result = await this.call(systemPrompt(context), messages);

    return {
      content: result.text,
      // Citations come from our own context, never from model output.
      references: context.facts
        .map((fact) => fact.reference)
        .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
        .slice(0, 12),
      provider: this.name,
      model: this.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
    };
  }

  async summarize(context: AiContext, focus: string): Promise<AiAnswer> {
    return this.chat(`Summarise the following for a fleet operator: ${focus}`, context);
  }

  async recommend(context: AiContext, kind: string): Promise<AiRecommendationItem[]> {
    const result = await this.call(
      `${systemPrompt(context)}\n\nRespond ONLY with a JSON array of objects shaped: ` +
        `{"title": string, "detail": string, "reasoning": string[], "confidence": "LOW"|"MEDIUM"|"HIGH"}. ` +
        `No prose outside the JSON.`,
      [
        {
          role: 'user',
          content: `${contextBlock(context)}\n\nProduce up to 5 ranked recommendations for: ${kind}`,
        },
      ],
    );

    try {
      const start = result.text.indexOf('[');
      const end = result.text.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error('no JSON array in response');

      const parsed = JSON.parse(result.text.slice(start, end + 1)) as AiRecommendationItem[];
      return parsed
        .filter((item) => item && typeof item.title === 'string')
        .slice(0, 5)
        .map((item) => ({
          title: item.title,
          detail: item.detail ?? '',
          reasoning: Array.isArray(item.reasoning) ? item.reasoning : [],
          confidence: ['LOW', 'MEDIUM', 'HIGH'].includes(item.confidence)
            ? item.confidence
            : 'MEDIUM',
        }));
    } catch (error) {
      logger.warn({ err: error }, 'AI recommendation response was not valid JSON');
      throw errors.provider(this.name, 'The AI service returned an unexpected response.');
    }
  }
}
