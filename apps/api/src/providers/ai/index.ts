import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { DevelopmentAiProvider } from './development-ai.provider';
import { AnthropicAiProvider } from './anthropic-ai.provider';
import { GeminiAiProvider } from './gemini-ai.provider';
import { supportsTools, type AiProvider } from './ai.provider';

/**
 * AI provider factory. If a hosted provider is selected but not configured,
 * Saarthi falls back to the local analyst rather than failing the request —
 * the copilot degrades in quality, never in availability.
 */
function createAiProvider(): AiProvider {
  if (config.ai.provider === 'gemini') {
    try {
      return new GeminiAiProvider();
    } catch (error) {
      logger.warn(
        { err: error },
        'Gemini is selected but not configured — falling back to the local analyst',
      );
      return new DevelopmentAiProvider();
    }
  }

  if (config.ai.provider === 'anthropic') {
    try {
      return new AnthropicAiProvider();
    } catch (error) {
      logger.warn(
        { err: error },
        'Hosted AI provider unavailable — falling back to the local analyst',
      );
      return new DevelopmentAiProvider();
    }
  }

  return new DevelopmentAiProvider();
}

export const aiProvider: AiProvider = createAiProvider();

logger.info(
  {
    provider: aiProvider.name,
    model: aiProvider.model,
    tools: supportsTools(aiProvider),
  },
  'AI provider ready',
);

export * from './ai.provider';
