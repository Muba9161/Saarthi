import { formatCurrency, formatNumber } from '@saarthi/shared';
import type {
  AiAnswer,
  AiContext,
  AiMessageInput,
  AiProvider,
  AiRecommendationItem,
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

export class DevelopmentAiProvider implements AiProvider {
  readonly name = 'development';
  readonly model = 'saarthi-local-analyst';

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
}
