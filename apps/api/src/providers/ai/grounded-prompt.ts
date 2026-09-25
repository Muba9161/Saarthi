import type { AiContext, AiFact, AiRecommendationItem } from './ai.provider';

/**
 * The context-grounded copilot prompt, shared by every hosted provider that
 * answers from a pre-authorised context block rather than through tools.
 */

export function groundedSystemPrompt(context: AiContext): string {
  return [
    'You are the Saarthi Fleet Copilot, an analyst embedded in a fleet management platform.',
    '',
    'Rules you must follow:',
    '1. Answer ONLY from the CONTEXT block. Never invent a number, a vehicle, a driver or a date.',
    '2. If the context does not contain the answer, say so plainly and say what data would be needed.',
    '3. Distinguish recorded facts from calculated metrics and from projections.',
    '4. Be concise and operational. A fleet owner is reading this between phone calls.',
    '5. Never suggest an action that would put a driver at risk to save time or money.',
    '6. Use Indian number formatting for currency and refer to vehicles by registration number.',
    '',
    `The user is a ${context.role} operating in scope: ${context.scope}.`,
  ].join('\n');
}

export function contextBlock(context: AiContext): string {
  const facts = context.facts.map((fact) => `- [${fact.basis}] ${fact.statement}`).join('\n');
  const metrics = Object.entries(context.metrics)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');

  return [
    'CONTEXT',
    `Generated at: ${context.generatedAt}`,
    '',
    'Facts:',
    facts,
    '',
    'Metrics:',
    metrics,
  ].join('\n');
}

/**
 * References come from the context Saarthi assembled, never from what the
 * model claims to have cited.
 */
export function contextReferences(context: AiContext): NonNullable<AiFact['reference']>[] {
  return context.facts
    .map((fact) => fact.reference)
    .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
    .slice(0, 8);
}

export function recommendationQuestion(kind: string): string {
  return (
    `Give up to three ${kind} recommendations. For each: a title, one sentence of detail, ` +
    'and the specific facts from the context that justify it. Return JSON matching ' +
    '[{"title":"","detail":"","reasoning":[""],"confidence":"LOW|MEDIUM|HIGH"}].'
  );
}

/**
 * Pull the recommendation list out of a model answer. Anything malformed is
 * dropped rather than shown: a recommendation without its reasoning is
 * downgraded, and an answer with no parseable list yields none.
 */
export function parseRecommendations(content: string): AiRecommendationItem[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start === -1 || end === -1) return [];

  const parsed = JSON.parse(content.slice(start, end + 1)) as AiRecommendationItem[];
  return parsed
    .filter((item) => item && typeof item.title === 'string')
    .map((item) => ({
      title: item.title,
      detail: item.detail ?? '',
      reasoning: Array.isArray(item.reasoning) ? item.reasoning : [],
      confidence: item.confidence ?? 'LOW',
      ...(item.reference ? { reference: item.reference } : {}),
    }))
    .slice(0, 3);
}

/**
 * The first JSON object in a model's text. JSON mode normally returns exactly
 * one; this also survives a model that wraps it in prose or a code fence.
 */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    // Malformed output is the caller's to treat as "no answer".
    return null;
  }
}
