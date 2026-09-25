import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type CommerceAttributeValues,
  type CommerceRecordScope,
  type CommerceTaxonomyIndex,
  CommerceAttributeType,
  MEDIUM_CONFIDENCE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
  categoryPath,
  effectiveAttributes,
  isCategoryActive,
  normalizeCommerceText,
  validateAttributeValues,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { logger } from '../../lib/logger';
import { aiProvider, supportsStructuredOutput } from '../../providers/ai';
import type { AuthContext } from '../../auth/context';
import { recordUsage } from '../ai/ai-usage';

/**
 * The AI half of the commerce engine — consulted only when the taxonomy alone
 * is unsure, and never trusted.
 *
 * What goes out is the minimum that can answer the question: the product line
 * (with anything that looks like a phone number or e-mail removed), a short
 * list of candidate categories under opaque references, and the attribute keys
 * of the likeliest few. No user, organization, price history or database row.
 *
 * What comes back is validated before it is used: the category must be one of
 * the candidates offered and still active, attribute values must pass the same
 * schema check a human's would, and the confidence is capped below "high" —
 * a model's guess is always shown as a suggestion for the user to confirm.
 *
 * Every failure mode — no provider, budget spent, timeout, malformed output —
 * returns null, and the caller carries on with the deterministic result.
 */

const OPERATION = 'commerce.classify';
const MAX_CANDIDATES = 40;
const MIN_OVERLAP_CANDIDATES = 8;
const CANDIDATES_WITH_ATTRIBUTES = 5;
const MAX_TEXT_CHARS = 300;
const MAX_OUTPUT_TOKENS = 256;
/** A model's answer is a suggestion, so it never reaches the prefill band. */
const AI_CONFIDENCE_CEILING = HIGH_CONFIDENCE_THRESHOLD - 0.01;

const log = logger.child({ module: 'commerce', component: 'ai' });

export interface AiCategorySuggestion {
  categoryId: string;
  score: number;
  attributes: CommerceAttributeValues;
}

/** What the cache holds. A null category means "asked, and nothing fitted". */
type CachedSuggestion = {
  categoryId: string | null;
  score: number;
  attributes: CommerceAttributeValues;
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ref: {
      type: 'STRING',
      nullable: true,
      description: 'Reference of the best category, or null.',
    },
    confidence: { type: 'NUMBER', description: 'Between 0 and 1.' },
    attributes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { key: { type: 'STRING' }, value: { type: 'STRING' } },
        required: ['key', 'value'],
      },
    },
  },
  required: ['ref', 'confidence'],
} as const;

const responseSchema = z.object({
  ref: z.string().max(10).nullable(),
  confidence: z.number().min(0).max(1),
  attributes: z
    .array(z.object({ key: z.string().max(40), value: z.string().max(200) }))
    .max(20)
    .default([]),
});

const SYSTEM_PROMPT = [
  'You classify one product or purchase line from an Indian business marketplace into a fixed catalogue.',
  'Choose only a reference from the CATEGORIES list, or null when nothing fits.',
  'Return attribute values only for the keys listed for the chosen category, and only when the text states or',
  'plainly implies them. For keys with options, return one of the options exactly.',
  'Never invent prices, quantities, places, brands or values that are not in the text.',
  'The text may be in English, Hindi or Hinglish.',
].join(' ');

function stripContactDetails(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
    .slice(0, MAX_TEXT_CHARS);
}

function wordsOf(text: string): Set<string> {
  return new Set(
    normalizeCommerceText(text)
      .split(/[\s/-]+/)
      .filter((word) => word.length > 2),
  );
}

/**
 * The categories worth showing the model: those sharing a word with the text,
 * padded with the top of the tree so a synonym the taxonomy lacks ("almari")
 * still has somewhere sensible to land.
 */
function candidatesFor(index: CommerceTaxonomyIndex, text: string): string[] {
  const words = wordsOf(text);
  const scored = index.nodes
    .filter((node) => isCategoryActive(index, node.id))
    .map((node) => {
      const vocabulary = wordsOf([node.name, ...node.aliases].join(' '));
      const overlap = [...vocabulary].filter((word) =>
        [...words].some(
          (typed) => typed.startsWith(word.slice(0, 4)) || word.startsWith(typed.slice(0, 4)),
        ),
      ).length;
      return { id: node.id, overlap, depth: categoryPath(index, node.id).length };
    });

  const matched = scored
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.depth - a.depth)
    .map((entry) => entry.id);

  const padding =
    matched.length >= MIN_OVERLAP_CANDIDATES
      ? []
      : scored
          .filter((entry) => entry.depth <= 2 && !matched.includes(entry.id))
          .map((entry) => entry.id);

  const fallback = index.fallback ? [index.fallback.id] : [];
  return [...new Set([...matched, ...padding, ...fallback])].slice(0, MAX_CANDIDATES);
}

function buildPrompt(
  index: CommerceTaxonomyIndex,
  text: string,
  scope: CommerceRecordScope,
  candidateIds: string[],
): string {
  const lines = candidateIds.map(
    (id, position) =>
      `c${position + 1} | ${categoryPath(index, id)
        .map((node) => node.name)
        .join(' > ')}`,
  );

  const attributeLines = candidateIds
    .slice(0, CANDIDATES_WITH_ATTRIBUTES)
    .flatMap((id, position) => {
      const fields = effectiveAttributes(index, id, scope);
      if (fields.length === 0) return [];
      const described = fields.map((field) =>
        field.type === CommerceAttributeType.SELECT
          ? `${field.key} (${field.options.join('|')})`
          : field.unit
            ? `${field.key} (number, ${field.unit})`
            : field.key,
      );
      return [`c${position + 1}: ${described.join(', ')}`];
    });

  return [
    `TEXT: """${stripContactDetails(text)}"""`,
    '',
    'CATEGORIES:',
    ...lines,
    ...(attributeLines.length > 0 ? ['', 'ATTRIBUTE KEYS:', ...attributeLines] : []),
  ].join('\n');
}

async function withinBudget(auth: AuthContext, organizationId: string | null): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byUser, byOrganization] = await Promise.all([
    prisma.aiUsage.count({
      where: { userId: auth.user.id, operation: OPERATION, createdAt: { gte: startOfDay } },
    }),
    organizationId
      ? prisma.aiUsage.count({
          where: { organizationId, operation: OPERATION, createdAt: { gte: startOfDay } },
        })
      : Promise.resolve(0),
  ]);

  return (
    byUser < config.commerce.aiDailyLimitPerUser &&
    byOrganization < config.commerce.aiDailyLimitPerOrganization
  );
}

/** Turn the model's answer into a suggestion the engine can use, or nothing. */
function validateResponse(
  index: CommerceTaxonomyIndex,
  scope: CommerceRecordScope,
  candidateIds: string[],
  raw: unknown,
): CachedSuggestion {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.length }, 'Discarded a malformed classification');
    return { categoryId: null, score: 0, attributes: {} };
  }

  const position = parsed.data.ref ? Number(parsed.data.ref.replace(/^c/, '')) - 1 : -1;
  const categoryId = candidateIds[position];
  if (
    !categoryId ||
    !isCategoryActive(index, categoryId) ||
    parsed.data.confidence < MEDIUM_CONFIDENCE_THRESHOLD
  ) {
    return { categoryId: null, score: 0, attributes: {} };
  }

  const submitted = Object.fromEntries(
    parsed.data.attributes.map((pair) => [pair.key, pair.value]),
  );
  const { values } = validateAttributeValues(
    effectiveAttributes(index, categoryId, scope),
    submitted,
  );

  return {
    categoryId,
    score: Math.min(parsed.data.confidence, AI_CONFIDENCE_CEILING),
    attributes: values,
  };
}

export async function suggestCategory(
  auth: AuthContext,
  input: {
    text: string;
    scope: CommerceRecordScope;
    index: CommerceTaxonomyIndex;
    taxonomyVersion: string;
  },
): Promise<AiCategorySuggestion | null> {
  if (!config.commerce.aiEnabled || !supportsStructuredOutput(aiProvider)) return null;

  const { text, scope, index, taxonomyVersion } = input;
  const textHash = createHash('sha256')
    .update(normalizeCommerceText(text))
    .digest('hex')
    .slice(0, 32);
  const cacheKey = cacheKeys.commerceClassification(scope, taxonomyVersion, textHash);

  const cached = await cache.get<CachedSuggestion>(cacheKey);
  if (cached) return cached.categoryId ? { ...cached, categoryId: cached.categoryId } : null;

  const organizationId = auth.organizationId ?? null;
  if (!(await withinBudget(auth, organizationId))) {
    log.info({ userId: auth.user.id }, 'Commerce AI budget reached; using the taxonomy alone');
    return null;
  }

  const candidateIds = candidatesFor(index, text);
  const startedAt = Date.now();

  try {
    const generation = await aiProvider.generateJson({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(index, text, scope, candidateIds),
      schema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: config.commerce.aiTimeoutMs,
    });

    const suggestion = validateResponse(index, scope, candidateIds, generation.data);
    await recordUsage(auth, organizationId, OPERATION, generation, suggestion.categoryId !== null);
    await cache.set(cacheKey, suggestion, cacheTtl.commerceClassification);

    return suggestion.categoryId ? { ...suggestion, categoryId: suggestion.categoryId } : null;
  } catch (error) {
    // Timeouts, rate limits and outages all end the same way: no suggestion.
    // Not cached, so the next attempt can succeed once the provider recovers.
    log.warn({ err: error }, 'Commerce classification failed; using the taxonomy alone');
    await recordUsage(
      auth,
      organizationId,
      OPERATION,
      {
        provider: aiProvider.name,
        model: aiProvider.model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startedAt,
      },
      false,
    ).catch((recordError: unknown) => log.error({ err: recordError }, 'Could not record AI usage'));
    return null;
  }
}
