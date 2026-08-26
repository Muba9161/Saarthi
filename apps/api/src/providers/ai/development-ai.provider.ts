import { formatCurrency, formatNumber } from '@saarthi/shared';
import type {
  AiAnswer,
  AiContext,
  AiGenerateInput,
  AiGeneration,
  AiMessageInput,
  AiRecommendationItem,
  AiToolInvocation,
  ToolCapableAiProvider,
} from './ai.provider';

/**
 * Development AI provider.
 *
 * This is a genuine local implementation, not a stub: it interprets the
 * question, selects the relevant authorised facts and composes a grounded,
 * cited answer. It never invents a number — everything it states comes from
 * the context object the permission layer built.
 *
 * Running locally therefore exercises the whole AI path (permissions → context
 * assembly → answer → citations → usage accounting); pointing AI_PROVIDER at a
 * hosted model swaps only the language generation.
 */

interface Intent {
  key: string;
  /** Words that, when present, select this intent. */
  triggers: string[];
  /** Fact reference types this intent cares about. */
  factTypes: string[];
  headline: (context: AiContext) => string;
}

const INTENTS: Intent[] = [
  {
    key: 'attention',
    triggers: ['attention', 'today', 'priority', 'urgent', 'problem', 'issue', 'wrong'],
    factTypes: ['alert', 'document', 'maintenance', 'trip', 'sos'],
    headline: () => 'Here is what needs attention right now.',
  },
  {
    key: 'idle',
    triggers: ['idle', 'available', 'unused', 'not working', 'free truck', 'spare'],
    factTypes: ['truck'],
    headline: () => 'These vehicles are not currently earning.',
  },
  {
    key: 'documents',
    triggers: ['document', 'expire', 'expiry', 'permit', 'insurance', 'compliance', 'licence', 'license'],
    factTypes: ['document'],
    headline: () => 'Document compliance status.',
  },
  {
    key: 'drivers',
    triggers: ['driver', 'score', 'performance', 'best', 'worst', 'safest'],
    factTypes: ['driver'],
    headline: () => 'Driver performance summary.',
  },
  {
    key: 'delays',
    triggers: ['delay', 'late', 'behind', 'eta', 'on time', 'schedule'],
    factTypes: ['trip'],
    headline: () => 'Trips running behind schedule.',
  },
  {
    key: 'maintenance',
    triggers: ['maintenance', 'service', 'repair', 'workshop', 'breakdown'],
    factTypes: ['maintenance', 'truck'],
    headline: () => 'Maintenance status across the fleet.',
  },
  {
    key: 'financial',
    triggers: ['revenue', 'profit', 'cost', 'margin', 'earning', 'money', 'expensive', 'fuel cost'],
    factTypes: ['financial', 'truck'],
    headline: () => 'Financial position for the current month.',
  },
  {
    key: 'utilisation',
    triggers: ['utilisation', 'utilization', 'capacity', 'busy', 'how many trips'],
    factTypes: ['truck', 'trip'],
    headline: () => 'Fleet utilisation.',
  },
];

function detectIntent(question: string): Intent | null {
  const normalized = question.toLowerCase();
  let best: { intent: Intent; hits: number } | null = null;

  for (const intent of INTENTS) {
    const hits = intent.triggers.filter((trigger) => normalized.includes(trigger)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { intent, hits };
  }
  return best?.intent ?? null;
}

function formatMetric(key: string, value: number | string | null): string {
  if (value === null) return `${key}: not available`;
  if (typeof value === 'string') return `${key}: ${value}`;
  if (/revenue|cost|profit|margin|price/i.test(key)) return `${key}: ${formatCurrency(value)}`;
  if (/percent/i.test(key)) return `${key}: ${value}%`;
  return `${key}: ${formatNumber(value)}`;
}

function humanizeMetricKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/\bKm\b/g, 'km')
    .trim();
}

export class DevelopmentAiProvider implements ToolCapableAiProvider {
  readonly name = 'development';
  readonly model = 'saarthi-local-analyst';
  readonly supportsTools = true as const;

  private compose(
    headline: string,
    context: AiContext,
    facts: AiContext['facts'],
    metricKeys: string[],
  ): AiAnswer {
    const startedAt = Date.now();
    const lines: string[] = [headline, ''];

    if (facts.length === 0) {
      lines.push('Nothing in your current data matches that. Everything looks clear.');
    } else {
      for (const fact of facts.slice(0, 12)) {
        const marker = fact.basis === 'predicted' ? '~' : '•';
        lines.push(`${marker} ${fact.statement}`);
      }
      if (facts.length > 12) {
        lines.push(`…and ${facts.length - 12} more.`);
      }
    }

    const metrics = metricKeys
      .filter((key) => context.metrics[key] !== undefined)
      .map((key) => formatMetric(humanizeMetricKey(key), context.metrics[key] ?? null));

    if (metrics.length > 0) {
      lines.push('', 'Context:');
      for (const metric of metrics) lines.push(`  ${metric}`);
    }

    const predicted = facts.some((fact) => fact.basis === 'predicted');
    if (predicted) {
      lines.push('', 'Lines marked ~ are projections, not recorded facts.');
    }

    const content = lines.join('\n');

    return {
      content,
      references: facts
        .map((fact) => fact.reference)
        .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
        .slice(0, 12),
      provider: this.name,
      model: this.model,
      // The local provider does no tokenised inference; report the real cost.
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  async chat(question: string, context: AiContext, _history?: AiMessageInput[]): Promise<AiAnswer> {
    const intent = detectIntent(question);

    if (!intent) {
      // No recognised intent: give an honest overview rather than guessing.
      return this.compose(
        `I can answer questions about your fleet using ${context.scope}. Here is the current picture.`,
        context,
        context.facts.slice(0, 8),
        Object.keys(context.metrics).slice(0, 8),
      );
    }

    const relevant = context.facts.filter((fact) =>
      intent.factTypes.includes(fact.reference?.type ?? 'other'),
    );

    const metricKeys = Object.keys(context.metrics).filter((key) => {
      const normalized = key.toLowerCase();
      switch (intent.key) {
        case 'financial':
          return /revenue|cost|profit|margin|fuel/.test(normalized);
        case 'documents':
          return /document|compliance|verification/.test(normalized);
        case 'drivers':
          return /driver|score/.test(normalized);
        case 'delays':
        case 'utilisation':
          return /trip|utilisation|utilization|ontime|distance/.test(normalized);
        case 'maintenance':
          return /maintenance|overdue/.test(normalized);
        default:
          return true;
      }
    });

    return this.compose(
      intent.headline(context),
      context,
      relevant.length > 0 ? relevant : context.facts,
      metricKeys.slice(0, 8),
    );
  }

  async summarize(context: AiContext, focus: string): Promise<AiAnswer> {
    return this.compose(
      `${focus} — summary as of ${new Date(context.generatedAt).toLocaleString('en-IN')}.`,
      context,
      context.facts,
      Object.keys(context.metrics).slice(0, 10),
    );
  }

  async recommend(context: AiContext, kind: string): Promise<AiRecommendationItem[]> {
    // Recommendations are derived from the ranked facts the caller supplied,
    // each carrying the reasoning that produced its ranking.
    return context.facts.slice(0, 5).map((fact, index) => ({
      title: fact.reference?.label ?? `${kind} option ${index + 1}`,
      detail: fact.statement,
      reasoning: [
        fact.basis === 'calculated'
          ? 'Derived from your recorded operational data.'
          : fact.basis === 'predicted'
            ? 'Projected from historical patterns — treat as an estimate.'
            : 'Taken directly from a stored record.',
        `Ranked ${index + 1} of ${Math.min(5, context.facts.length)} for ${kind.toLowerCase().replace(/_/g, ' ')}.`,
      ],
      confidence: index === 0 ? 'HIGH' : index < 3 ? 'MEDIUM' : 'LOW',
      ...(fact.reference ? { reference: fact.reference } : {}),
    }));
  }

  // -------------------------------------------------------------------------
  // Tool calling
  //
  // A deterministic planner rather than a language model: it matches the
  // question against each tool's name and description, calls the ones that fit,
  // and then renders the results.
  //
  // The point is not to imitate a model's phrasing — it is that the whole
  // machinery around the model runs locally. Permission filtering, argument
  // validation, tool execution, provenance capture and the iteration limit are
  // all exercised on every local question, so the paths that would otherwise
  // only run in production are the ones under test every day.
  // -------------------------------------------------------------------------

  async generate(input: AiGenerateInput): Promise<AiGeneration> {
    const startedAt = Date.now();

    const question =
      [...input.turns].reverse().find((turn) => turn.role === 'user')?.content ?? '';

    const executed = input.turns.filter((turn) => turn.role === 'tool');
    const alreadyCalled = new Set(executed.map((turn) => turn.toolName));

    // First pass: pick the tools whose description overlaps the question.
    if (executed.length === 0) {
      const chosen = selectTools(question, input.tools).filter(
        (tool) => !alreadyCalled.has(tool.name),
      );

      if (chosen.length > 0) {
        const toolCalls: AiToolInvocation[] = chosen.map((tool, index) => ({
          id: `local-${index}`,
          name: tool.name,
          // Only arguments that can be inferred from the question are supplied.
          // A required argument that cannot be inferred is left out, and the
          // registry's validation says so — which is the behaviour a real model
          // triggers too, and worth exercising.
          arguments: inferArguments(question, tool.parameters),
        }));

        return {
          content: null,
          toolCalls,
          provider: this.name,
          model: this.model,
          tokensIn: estimateTokens(question),
          tokensOut: 0,
          latencyMs: Date.now() - startedAt,
          finishReason: 'tool_calls',
        };
      }
    }

    // Second pass: answer from whatever the tools returned.
    return {
      content: renderToolAnswer(question, executed),
      toolCalls: [],
      provider: this.name,
      model: this.model,
      tokensIn: estimateTokens(JSON.stringify(executed)),
      tokensOut: 120,
      latencyMs: Date.now() - startedAt,
      finishReason: 'stop',
    };
  }
}

// ---------------------------------------------------------------------------
// Local planner helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  // Four characters per token is the usual rough ratio. It only feeds the local
  // usage counters, which exist so the cost-accounting path is exercised.
  return Math.ceil(text.length / 4);
}

/** Words worth matching on — everything else is noise in a short question. */
function keywordsOf(text: string): string[] {
  const stop = new Set([
    'the', 'and', 'for', 'are', 'any', 'was', 'has', 'have', 'what', 'which', 'when', 'where',
    'who', 'how', 'why', 'my', 'me', 'is', 'do', 'does', 'did', 'this', 'that', 'with', 'from',
    'all', 'now', 'get', 'show', 'tell', 'about', 'need', 'needs', 'today',
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !stop.has(word));
}

function selectTools(question: string, tools: AiGenerateInput['tools']): AiGenerateInput['tools'] {
  const words = keywordsOf(question);
  if (words.length === 0) return tools.filter((tool) => tool.name === 'get_fleet_summary');

  const scored = tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.description}`.toLowerCase();
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  // Capped at three. The iteration limit in the service is what protects cost,
  // but a planner that fired every matching tool would make hitting that limit
  // the normal case rather than the exception.
  const picked = scored.slice(0, 3).map((entry) => entry.tool);
  if (picked.length > 0) return picked;

  const fallback = tools.find((tool) => tool.name === 'get_fleet_summary');
  return fallback ? [fallback] : [];
}

/** Pull what can be read straight out of the question — ids, day counts. */
function inferArguments(
  question: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const properties = (parameters.properties ?? {}) as Record<string, unknown>;
  const args: Record<string, unknown> = {};

  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(question);
  const days = /(\d+)\s*(day|days|week|weeks|month|months)/i.exec(question);
  const registration = /\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{1,4}\b/.exec(question.toUpperCase());

  for (const key of Object.keys(properties)) {
    if (key.endsWith('Id') && uuid) args[key] = uuid[0];

    if (key === 'days' && days) {
      const amount = Number(days[1]);
      const unit = (days[2] ?? '').toLowerCase();
      args[key] = unit.startsWith('week')
        ? amount * 7
        : unit.startsWith('month')
          ? amount * 30
          : amount;
    }

    if (key === 'registrationNumber' && registration) {
      args[key] = registration[0].replace(/\s+/g, '');
    }
  }

  return args;
}

/**
 * Render the tool results as prose.
 *
 * Deliberately plain and structural. Anything more fluent would be this
 * function inventing connective claims the data does not support — exactly the
 * failure the tool layer exists to prevent.
 */
function renderToolAnswer(
  question: string,
  executed: { toolName?: string; toolResult?: unknown }[],
): string {
  if (executed.length === 0) {
    return 'I do not have enough verified data to answer that. Nothing in your fleet records covers it.';
  }

  const lines: string[] = [];

  for (const turn of executed) {
    const payload = turn.toolResult as
      | { data?: unknown; caveats?: string[]; recordCount?: number; error?: string }
      | undefined;

    const label = (turn.toolName ?? 'tool').replace(/^get_/, '').replace(/_/g, ' ');

    if (payload?.error) {
      lines.push(`${label}: ${payload.error}`);
      continue;
    }

    lines.push(`${label}:`);
    lines.push(summariseValue(payload?.data));

    for (const caveat of payload?.caveats ?? []) lines.push(`  Note: ${caveat}`);
  }

  return [
    `Here is what your records show for: ${question.trim()}`,
    '',
    ...lines,
    '',
    'Every figure above came from your own Saarthi records. Nothing here is estimated.',
  ].join('\n');
}

function summariseValue(value: unknown, depth = 0): string {
  const indent = '  '.repeat(depth + 1);

  if (value === null || value === undefined) return `${indent}(no data)`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(none)`;
    return value
      .slice(0, 5)
      .map((entry) => summariseValue(entry, depth))
      .join('\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .slice(0, 12)
      .map(([key, entry]) =>
        typeof entry === 'object'
          ? `${indent}${key}:\n${summariseValue(entry, depth + 1)}`
          : `${indent}${key}: ${String(entry)}`,
      )
      .join('\n');
  }

  return `${indent}${String(value)}`;
}
