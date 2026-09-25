import { type Prisma, prisma } from '../../database/prisma';
import type { AuthContext } from '../../auth/context';

/**
 * AI usage metering, shared by every feature that calls a model.
 *
 * One `ai_usage` table records every call — provider, tokens, latency — so
 * cost is observable in one place. Budgets differ by feature, though: the
 * copilot is metered against the plan's daily allowance, while background
 * commerce classification has its own limits (see `commerce-ai.service.ts`).
 */

/**
 * Operations metered on their own budget rather than the plan's copilot
 * allowance. A seller's product line classified in the background is not a
 * question they asked the copilot, and must not use up the answers they can.
 */
export const COMMERCE_AI_OPERATION_PREFIX = 'commerce.';

/** Usage rows that count against the plan's copilot allowance. */
export const COPILOT_USAGE_FILTER = {
  NOT: { operation: { startsWith: COMMERCE_AI_OPERATION_PREFIX } },
} satisfies Prisma.AiUsageWhereInput;

/**
 * A question a person typed to Saarthi Mitra — on its chat screen or a
 * vehicle's AI card. The only thing the free-trial allowance counts.
 */
export const MITRA_QUESTION_OPERATION = 'copilot.tools';

/**
 * The driver's in-cab assistant. Recorded under its own name so a driver
 * asking the terminal never uses up the owner's Mitra questions.
 */
export const TERMINAL_ASSISTANT_OPERATION = 'terminal.assistant';

/**
 * Questions a free trial may ask Saarthi Mitra in a day.
 *
 * Enough to find out what Mitra can do, not enough to run a business on
 * before paying — and every question costs a hosted model call.
 */
export const TRIAL_AI_QUESTIONS_PER_DAY = 5;

/** The day's AI allowance for this caller's plan, trial cap included. */
export function dailyAiAllowance(auth: AuthContext): number {
  const planLimit = auth.subscription?.limits.aiRequestsPerDay ?? 0;
  return auth.subscription?.trialing ? Math.min(planLimit, TRIAL_AI_QUESTIONS_PER_DAY) : planLimit;
}

export async function recordUsage(
  auth: AuthContext,
  organizationId: string | null,
  operation: string,
  answer: {
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
  },
  success = true,
): Promise<void> {
  await prisma.aiUsage.create({
    data: {
      organizationId,
      userId: auth.user.id,
      provider: answer.provider,
      model: answer.model,
      operation,
      tokensIn: answer.tokensIn,
      tokensOut: answer.tokensOut,
      latencyMs: answer.latencyMs,
      success,
    },
  });
}
