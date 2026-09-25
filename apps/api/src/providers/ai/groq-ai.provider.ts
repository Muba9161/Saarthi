import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  AiAnswer,
  AiContext,
  AiGenerateInput,
  AiGeneration,
  AiJsonGeneration,
  AiJsonRequest,
  AiMessageInput,
  AiRecommendationItem,
  AiToolInvocation,
  StructuredOutputAiProvider,
  ToolCapableAiProvider,
} from './ai.provider';
import {
  contextBlock,
  contextReferences,
  groundedSystemPrompt,
  parseJsonObject,
  parseRecommendations,
  recommendationQuestion,
} from './grounded-prompt';

/**
 * Groq adapter — OpenAI-compatible chat completions over REST.
 *
 * One instance serves one model. Resilience is not this class's job: the
 * factory puts several of these (one per configured model) in front of the
 * local analyst inside a `FallbackAiProvider`, so a rate limit, timeout or
 * outage on one model moves the request to the next instead of failing it.
 *
 * The security posture is the same as every provider: the model sees a system
 * prompt, the conversation and tool *descriptions*; every tool call it asks
 * for is executed by Saarthi against the caller's own permissions.
 */

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_OUTPUT_TOKENS = 2048;

interface OpenAiToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments?: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface ChatCompletion {
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A tool call with unreadable arguments is sent to the tool as "no
    // arguments", where the tool's own validation reports what is missing.
    return {};
  }
}

function toMessages(input: AiGenerateInput): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: 'system', content: input.system }];
  for (const turn of input.turns) {
    if (turn.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: turn.toolCallId ?? turn.toolName ?? 'tool',
        content: JSON.stringify(turn.toolResult ?? null),
      });
    } else if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: turn.content ?? null,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      messages.push({ role: 'user', content: turn.content ?? '' });
    }
  }
  return messages;
}

export class GroqAiProvider implements ToolCapableAiProvider, StructuredOutputAiProvider {
  readonly name = 'groq';
  readonly model: string;
  readonly supportsTools = true as const;
  readonly supportsStructuredOutput = true as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly log: ReturnType<typeof logger.child>;

  constructor(model: string = config.ai.model) {
    if (!config.ai.apiKey) {
      // Thrown at construction, so the factory can fall back at boot rather
      // than every request failing at the moment a user asks a question.
      throw new Error('AI_API_KEY is required when AI_PROVIDER=groq.');
    }
    this.apiKey = config.ai.apiKey;
    this.model = model;
    this.baseUrl = (config.ai.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.log = logger.child({ module: 'ai', provider: 'groq', model });
  }

  // -------------------------------------------------------------------------
  // Tool calling
  // -------------------------------------------------------------------------

  async generate(input: AiGenerateInput): Promise<AiGeneration> {
    const startedAt = Date.now();
    const response = await this.complete({
      messages: toMessages(input),
      max_tokens: MAX_OUTPUT_TOKENS,
      // Low, not zero: this is an analyst summarising figures, and the
      // numbers come from tools rather than from sampling.
      temperature: 0.2,
      ...(input.tools.length > 0
        ? {
            tools: input.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: 'auto',
          }
        : {}),
    });

    const choice = response.choices?.[0];
    const text = choice?.message?.content?.trim() ?? '';
    const toolCalls: AiToolInvocation[] = (choice?.message?.tool_calls ?? []).map(
      (call, index) => ({
        id: call.id || `${call.function.name}-${index}`,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      }),
    );

    return {
      content: text.length > 0 ? text : null,
      toolCalls,
      provider: this.name,
      model: this.model,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : choice?.finish_reason === 'stop'
            ? 'stop'
            : choice?.finish_reason === 'length'
              ? 'length'
              : 'other',
    };
  }

  // -------------------------------------------------------------------------
  // Structured output
  // -------------------------------------------------------------------------

  /**
   * JSON mode. The schema travels in the system prompt rather than as a
   * strict response schema, because not every Groq model enforces one; the
   * caller validates the result either way.
   */
  async generateJson(request: AiJsonRequest): Promise<AiJsonGeneration> {
    const startedAt = Date.now();
    const response = await this.complete(
      {
        messages: [
          {
            role: 'system',
            content: `${request.system}\n\nRespond with a single JSON object matching this schema:\n${JSON.stringify(request.schema)}`,
          },
          { role: 'user', content: request.prompt },
        ],
        max_tokens: request.maxOutputTokens,
        temperature: 0,
        response_format: { type: 'json_object' },
      },
      request.timeoutMs,
    );

    return {
      data: parseJsonObject(response.choices?.[0]?.message?.content ?? ''),
      provider: this.name,
      model: this.model,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Context-grounded methods
  // -------------------------------------------------------------------------

  async chat(
    question: string,
    context: AiContext,
    history: AiMessageInput[] = [],
  ): Promise<AiAnswer> {
    const generation = await this.generate({
      system: groundedSystemPrompt(context),
      turns: [
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user' as const, content: `${contextBlock(context)}\n\nQuestion: ${question}` },
      ],
      tools: [],
    });

    return {
      content: generation.content ?? 'I do not have enough verified data to answer that.',
      references: contextReferences(context),
      provider: this.name,
      model: this.model,
      tokensIn: generation.tokensIn,
      tokensOut: generation.tokensOut,
      latencyMs: generation.latencyMs,
    };
  }

  async summarize(context: AiContext, focus: string): Promise<AiAnswer> {
    return this.chat(`Summarise the ${focus} position in five lines or fewer.`, context);
  }

  async recommend(context: AiContext, kind: string): Promise<AiRecommendationItem[]> {
    const answer = await this.chat(recommendationQuestion(kind), context);
    try {
      return parseRecommendations(answer.content);
    } catch (error) {
      this.log.warn({ err: error }, 'Could not parse recommendations from the model');
      return [];
    }
  }

  // -------------------------------------------------------------------------

  private async complete(
    body: Record<string, unknown>,
    timeoutMs = config.ai.timeoutMs,
  ): Promise<ChatCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, ...body }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as ChatCompletion;

      if (!response.ok) {
        const message = payload.error?.message ?? `Groq returned ${response.status}.`;
        if (response.status === 429) throw errors.providerRateLimited('groq');
        if (response.status >= 500) throw errors.providerUnavailable('groq');
        throw errors.provider('groq', message);
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw errors.providerTimeout('groq');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
