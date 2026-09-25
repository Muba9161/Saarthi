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
  parseRecommendations,
  recommendationQuestion,
} from './grounded-prompt';

/**
 * Gemini adapter.
 *
 * Written against the REST API with `fetch` rather than the vendor SDK. The
 * surface Saarthi uses is one endpoint and one response shape, and a direct
 * call keeps the dependency out of the tree and the failure modes visible —
 * a timeout is a timeout here, not somewhere inside a retry policy nobody
 * configured.
 *
 * The security posture is identical to every other provider: Gemini receives a
 * question, a system prompt and a list of tool *descriptions*. It never
 * receives a connection, a query or a row it did not ask for through a tool
 * that Saarthi then authorised against the caller's own permissions.
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';
const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 2048;

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

export class GeminiAiProvider implements ToolCapableAiProvider, StructuredOutputAiProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly supportsTools = true as const;
  readonly supportsStructuredOutput = true as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly log = logger.child({ module: 'ai', provider: 'gemini' });

  constructor(model: string = config.ai.model) {
    if (!config.ai.apiKey) {
      // Thrown at construction, so the factory can fall back at boot rather
      // than every request failing at the moment a user asks a question.
      throw new Error('AI_API_KEY is required when AI_PROVIDER=gemini.');
    }
    this.apiKey = config.ai.apiKey;
    this.model = model;
    this.baseUrl = (config.ai.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  // -------------------------------------------------------------------------
  // Tool calling
  // -------------------------------------------------------------------------

  async generate(input: AiGenerateInput): Promise<AiGeneration> {
    const startedAt = Date.now();

    const contents = input.turns.map((turn) => {
      if (turn.role === 'tool') {
        return {
          role: 'user' as const,
          parts: [
            {
              functionResponse: {
                name: turn.toolName ?? 'tool',
                // Gemini requires an object here, so a bare array or scalar is
                // wrapped rather than sent in a shape the API will reject.
                response: normaliseResponse(turn.toolResult),
              },
            },
          ],
        };
      }

      if (turn.role === 'assistant') {
        const parts: GeminiPart[] = [];
        if (turn.content) parts.push({ text: turn.content });
        for (const call of turn.toolCalls ?? []) {
          parts.push({ functionCall: { name: call.name, args: call.arguments } });
        }
        return { role: 'model' as const, parts: parts.length > 0 ? parts : [{ text: '' }] };
      }

      return { role: 'user' as const, parts: [{ text: turn.content ?? '' }] };
    });

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Low, not zero: this is an analyst summarising figures, and the
        // numbers come from tools rather than from sampling.
        temperature: 0.2,
      },
    };

    if (input.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }

    const response = await this.post(`/${API_VERSION}/models/${this.model}:generateContent`, body);

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((part) => part.text)
      .filter((value): value is string => Boolean(value))
      .join('\n')
      .trim();

    const toolCalls: AiToolInvocation[] = parts
      .filter((part) => part.functionCall)
      .map((part, index) => ({
        // Gemini does not issue call ids, so one is synthesised for pairing.
        id: `${part.functionCall!.name}-${index}`,
        name: part.functionCall!.name,
        arguments: part.functionCall!.args ?? {},
      }));

    const rawFinish = response.candidates?.[0]?.finishReason ?? '';

    return {
      content: text.length > 0 ? text : null,
      toolCalls,
      provider: this.name,
      model: this.model,
      tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - startedAt,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : rawFinish === 'STOP'
            ? 'stop'
            : rawFinish === 'MAX_TOKENS'
              ? 'length'
              : 'other',
    };
  }

  // -------------------------------------------------------------------------
  // Context-grounded methods
  //
  // Kept so Gemini is a drop-in for the existing copilot surfaces, which pass a
  // pre-authorised context rather than using tools.
  // -------------------------------------------------------------------------

  async chat(
    question: string,
    context: AiContext,
    history: AiMessageInput[] = [],
  ): Promise<AiAnswer> {
    const generation = await this.generate({
      system: groundedSystemPrompt(context),
      turns: [
        ...history.map((message) => ({
          role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: message.content,
        })),
        { role: 'user' as const, content: `${contextBlock(context)}\n\nQuestion: ${question}` },
      ],
      tools: [],
    });

    return {
      content: generation.content ?? 'I do not have enough verified data to answer that.',
      // References come from the context Saarthi assembled, never from what the
      // model claims to have cited.
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
  // Structured output
  // -------------------------------------------------------------------------

  /**
   * JSON mode with a response schema, so the answer is an object rather than
   * prose that has to be scraped for braces. Temperature zero: this is
   * classification, and the same line should classify the same way twice.
   */
  async generateJson(request: AiJsonRequest): Promise<AiJsonGeneration> {
    const startedAt = Date.now();
    const response = await this.post(
      `/${API_VERSION}/models/${this.model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: request.schema,
        },
      },
      request.timeoutMs,
    );

    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');

    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      // Malformed output is the caller's to handle as "no suggestion".
      this.log.warn({ err: error }, 'Gemini returned JSON that does not parse');
    }

    return {
      data,
      provider: this.name,
      model: this.model,
      tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  // -------------------------------------------------------------------------

  private async post(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<GeminiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header rather than a query parameter: a key in a URL ends up in
          // access logs and proxy caches.
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? `Gemini returned ${response.status}.`;
        if (response.status === 429) throw errors.providerRateLimited('gemini');
        if (response.status >= 500) throw errors.providerUnavailable('gemini');
        throw errors.provider('gemini', message);
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw errors.providerTimeout('gemini');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Wrap a non-object tool result so the API accepts it. */
function normaliseResponse(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value ?? null };
}
