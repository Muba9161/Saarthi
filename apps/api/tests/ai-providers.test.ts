import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@saarthi/shared';
import { config } from '../src/config/env';
import { AppError, errors } from '../src/lib/errors';
import {
  type AiContext,
  type AiProvider,
  supportsStructuredOutput,
  supportsTools,
} from '../src/providers/ai/ai.provider';
import { DevelopmentAiProvider } from '../src/providers/ai/development-ai.provider';
import { FallbackAiProvider } from '../src/providers/ai/fallback-ai.provider';
import { GroqAiProvider } from '../src/providers/ai/groq-ai.provider';

/**
 * Hosted AI providers and the fallback chain, against a mocked HTTP layer.
 * Nothing here reaches the network.
 */

const context: AiContext = {
  scope: 'Fleet of 3 trucks',
  organizationId: null,
  role: 'FLEET_OWNER',
  facts: [{ statement: 'RJ14 AB 1234 is on a trip to Jaipur.', basis: 'recorded' }],
  metrics: { activeTrips: 1 },
  generatedAt: new Date().toISOString(),
};

function setApiKey(key: string | undefined): void {
  (config.ai as { apiKey?: string }).apiKey = key;
}

function completion(message: Record<string, unknown>, finish = 'stop'): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message, finish_reason: finish }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A provider that answers, or fails with the given error, and counts calls. */
function fake(name: string, failWith?: Error): AiProvider & { calls: number } {
  const provider = {
    name,
    model: `${name}-model`,
    calls: 0,
    async chat() {
      provider.calls += 1;
      if (failWith) throw failWith;
      return {
        content: `${name} answered`,
        references: [],
        provider: name,
        model: name,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
      };
    },
    async summarize() {
      return provider.chat();
    },
    async recommend() {
      provider.calls += 1;
      if (failWith) throw failWith;
      return [];
    },
  };
  return provider;
}

describe('fallback chain', () => {
  it('moves to the next provider when one fails', async () => {
    const primary = fake('primary', errors.providerUnavailable('groq'));
    const secondary = fake('secondary');
    const chain = new FallbackAiProvider([primary, secondary]);

    const answer = await chain.chat('Where is RJ14?', context);
    expect(answer.content).toBe('secondary answered');
    expect(primary.calls).toBe(1);
  });

  it('skips a rate-limited provider until its cooldown passes', async () => {
    let now = 1_000_000;
    const limited = fake('limited', errors.providerRateLimited('groq'));
    const backup = fake('backup');
    const chain = new FallbackAiProvider([limited, backup], () => now);

    await chain.chat('one', context);
    await chain.chat('two', context);
    expect(limited.calls).toBe(1);
    expect(backup.calls).toBe(2);

    now += 61_000;
    await chain.chat('three', context);
    expect(limited.calls).toBe(2);
  });

  it('always answers when the local analyst ends the chain', async () => {
    const chain = new FallbackAiProvider([
      fake('a', errors.providerTimeout('groq')),
      fake('b', new Error('socket hang up')),
      new DevelopmentAiProvider(),
    ]);

    const answer = await chain.chat('How many trips are active?', context);
    expect(answer.content.length).toBeGreaterThan(0);
    expect(supportsTools(chain)).toBe(true);
  });

  it('reports the last failure when every provider fails', async () => {
    const chain = new FallbackAiProvider([
      fake('a', errors.providerUnavailable('groq')),
      fake('b', errors.providerTimeout('groq')),
    ]);
    await expect(chain.chat('x', context)).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_TIMEOUT,
    });
  });

  it('declares only the capabilities its members have', () => {
    const chain = new FallbackAiProvider([fake('plain'), new DevelopmentAiProvider()]);
    expect(supportsTools(chain)).toBe(true);
    expect(supportsStructuredOutput(chain)).toBe(false);
  });
});

describe('Groq provider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    setApiKey('test-groq-key');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setApiKey(undefined);
    vi.unstubAllGlobals();
  });

  it('refuses to start without a key, so the factory can fall back', () => {
    setApiKey(undefined);
    expect(() => new GroqAiProvider('openai/gpt-oss-120b')).toThrow(/AI_API_KEY/);
  });

  it('sends an OpenAI-compatible tool request and reads the tool calls back', async () => {
    fetchMock.mockResolvedValueOnce(
      completion(
        {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'fleet_summary', arguments: '{"days":7}' },
            },
          ],
        },
        'tool_calls',
      ),
    );

    const provider = new GroqAiProvider('openai/gpt-oss-120b');
    const generation = await provider.generate({
      system: 'You are an analyst.',
      turns: [{ role: 'user', content: 'How is the fleet doing?' }],
      tools: [
        { name: 'fleet_summary', description: 'Fleet totals', parameters: { type: 'object' } },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-groq-key');
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'fleet_summary',
          description: 'Fleet totals',
          parameters: { type: 'object' },
        },
      },
    ]);

    expect(generation.finishReason).toBe('tool_calls');
    expect(generation.toolCalls).toEqual([
      { id: 'call_1', name: 'fleet_summary', arguments: { days: 7 } },
    ]);
    expect(generation.tokensIn).toBe(12);
  });

  it('returns tool results to the model in its own format', async () => {
    fetchMock.mockResolvedValueOnce(completion({ content: 'Three trucks, one on a trip.' }));
    const provider = new GroqAiProvider('openai/gpt-oss-20b');

    const generation = await provider.generate({
      system: 'sys',
      turns: [
        { role: 'user', content: 'Status?' },
        { role: 'assistant', toolCalls: [{ id: 'call_1', name: 'fleet_summary', arguments: {} }] },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'fleet_summary',
          toolResult: { trucks: 3 },
        },
      ],
      tools: [],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as {
      messages: Record<string, unknown>[];
    };
    expect(body.messages[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1' }] });
    expect(body.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"trucks":3}',
    });
    expect(generation.content).toBe('Three trucks, one on a trip.');
  });

  it('asks for JSON and parses it, even wrapped in prose', async () => {
    fetchMock.mockResolvedValueOnce(
      completion({ content: 'Here you go: {"ref":"c2","confidence":0.8}' }),
    );
    const provider = new GroqAiProvider('openai/gpt-oss-120b');

    const result = await provider.generateJson({
      system: 'Classify.',
      prompt: 'TEXT: almira',
      schema: { type: 'OBJECT' },
      maxOutputTokens: 128,
      timeoutMs: 5000,
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(result.data).toEqual({ ref: 'c2', confidence: 0.8 });
  });

  it('yields no data for unparseable output instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(completion({ content: 'I cannot help with that.' }));
    const provider = new GroqAiProvider('openai/gpt-oss-120b');
    const result = await provider.generateJson({
      system: 's',
      prompt: 'p',
      schema: {},
      maxOutputTokens: 64,
      timeoutMs: 5000,
    });
    expect(result.data).toBeNull();
  });

  it('maps rate limits, outages and timeouts to provider errors', async () => {
    const provider = new GroqAiProvider('openai/gpt-oss-120b');
    const ask = () => provider.chat('x', context);

    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"slow down"}}', { status: 429 }),
    );
    await expect(ask()).rejects.toMatchObject({ code: ErrorCode.PROVIDER_RATE_LIMITED });

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(ask()).rejects.toMatchObject({ code: ErrorCode.PROVIDER_UNAVAILABLE });

    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });
    const timed = provider.generateJson({
      system: 's',
      prompt: 'p',
      schema: {},
      maxOutputTokens: 8,
      timeoutMs: 20,
    });
    await expect(timed).rejects.toBeInstanceOf(AppError);
    await expect(timed).rejects.toMatchObject({ code: ErrorCode.PROVIDER_TIMEOUT });
  });

  it('falls from one Groq model to the next, then to the local analyst', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));

    const chain = new FallbackAiProvider([
      new GroqAiProvider('openai/gpt-oss-120b'),
      new GroqAiProvider('openai/gpt-oss-20b'),
      new DevelopmentAiProvider(),
    ]);

    const answer = await chain.chat('How many trips are active?', context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(answer.provider).not.toBe('groq');
    expect(answer.content.length).toBeGreaterThan(0);
  });
});
