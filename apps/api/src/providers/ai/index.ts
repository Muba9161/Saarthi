import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { DevelopmentAiProvider } from './development-ai.provider';
import { AnthropicAiProvider } from './anthropic-ai.provider';
import { GeminiAiProvider } from './gemini-ai.provider';
import { GroqAiProvider } from './groq-ai.provider';
import { FallbackAiProvider } from './fallback-ai.provider';
import { supportsStructuredOutput, supportsTools, type AiProvider } from './ai.provider';

/**
 * AI provider factory.
 *
 * A hosted provider becomes a chain: the primary model, then each of
 * AI_FALLBACK_MODELS, then the local analyst. A failure on one link moves the
 * request to the next, and the local analyst never fails — so the copilot
 * degrades in quality, never in availability. A hosted provider selected but
 * not configured (no key) leaves the local analyst alone.
 */
function hostedChain(): AiProvider[] {
  const models = [...new Set([config.ai.model, ...config.ai.fallbackModels])];

  switch (config.ai.provider) {
    case 'groq':
      return models.map((model) => new GroqAiProvider(model));
    case 'gemini':
      return models.map((model) => new GeminiAiProvider(model));
    case 'anthropic':
      return [new AnthropicAiProvider()];
    default:
      return [];
  }
}

function createAiProvider(): AiProvider {
  const local = new DevelopmentAiProvider();

  let hosted: AiProvider[] = [];
  try {
    hosted = hostedChain();
  } catch (error) {
    logger.warn(
      { err: error, provider: config.ai.provider },
      'Hosted AI provider is selected but not configured — using the local analyst',
    );
  }

  return hosted.length === 0 ? local : new FallbackAiProvider([...hosted, local]);
}

export const aiProvider: AiProvider = createAiProvider();

logger.info(
  {
    provider: aiProvider.name,
    model: aiProvider.model,
    fallbackModels: config.ai.provider === 'development' ? [] : config.ai.fallbackModels,
    tools: supportsTools(aiProvider),
    structuredOutput: supportsStructuredOutput(aiProvider),
  },
  'AI provider ready',
);

export * from './ai.provider';
