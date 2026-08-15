import {
  distanceKm,
  formatCurrency,
  type AiChatInput,
  type AiRecommendationInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { aiProvider, type AiAnswer, type AiFact, type AiRecommendationItem } from '../../providers/ai';
import { buildFleetContext, type ContextOptions } from './context.service';
import { matchTransport } from '../orders/order.service';
import { maintenanceRisk } from '../maintenance/maintenance.service';
import type { AuthContext } from '../../auth/context';

/**
 * AI services: copilot chat, recommendations and business intelligence.
 *
 * Every entry point follows the same sequence — authenticate, resolve tenant,
 * build an authorised context, call the provider, record usage. Requests are
 * metered against the plan's daily allowance.
 */

const aiLogger = logger.child({ module: 'ai' });

async function assertWithinDailyQuota(auth: AuthContext, organizationId: string): Promise<void> {
  const limit = auth.subscription?.limits.aiRequestsPerDay ?? 0;
  if (limit <= 0) {
    throw errors.featureNotAvailable(
      'ai.copilot',
      'AI features are not included in your current plan.',
    );
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const used = await prisma.aiUsage.count({
    where: { organizationId, createdAt: { gte: startOfDay } },
  });

  if (used >= limit) {
    throw errors.planLimitReached(
      'aiRequestsPerDay',
      `Your plan allows ${limit} AI requests per day and today's allowance is used up. It resets at midnight.`,
    );
  }
}

async function recordUsage(
  auth: AuthContext,
  organizationId: string | null,
  operation: string,
  answer: { provider: string; model: string; tokensIn: number; tokensOut: number; latencyMs: number },
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

/** Pick the narrowest context that can answer the question. */
function focusFor(question: string): ContextOptions['focus'] {
  const normalized = question.toLowerCase();
  if (/document|expire|permit|insurance|compliance|licen[cs]e/.test(normalized)) return 'documents';
  if (/driver|score|performance|safest/.test(normalized)) return 'drivers';
  if (/trip|delay|late|eta|deliver/.test(normalized)) return 'trips';
  if (/maintenance|service|repair|workshop|breakdown/.test(normalized)) return 'maintenance';
  if (/revenue|profit|cost|margin|money|fuel cost|expensive/.test(normalized)) return 'financial';
  if (/idle|available|truck|vehicle|fleet/.test(normalized)) return 'fleet';
  return 'all';
}

export interface ChatResult {
  conversationId: string;
  messageId: string;
  answer: string;
  references: { type: string; id: string; label: string }[];
  provider: string;
  model: string;
  contextSummary: { factCount: number; focus: string; generatedAt: string };
}

export async function chat(
  auth: AuthContext,
  organizationId: string,
  input: AiChatInput,
): Promise<ChatResult> {
  await assertWithinDailyQuota(auth, organizationId);

  const conversation = input.conversationId
    ? await prisma.aiConversation.findUnique({
        where: { id: input.conversationId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      })
    : null;

  if (input.conversationId && (!conversation || conversation.userId !== auth.user.id)) {
    throw errors.notFound('Conversation');
  }

  const focus = focusFor(input.message);
  const context = await buildFleetContext(auth, organizationId, { focus });

  let answer: AiAnswer;
  try {
    answer = await aiProvider.chat(
      input.message,
      context,
      (conversation?.messages ?? [])
        .filter((message) => message.role !== 'SYSTEM')
        .map((message) => ({
          role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: message.content,
        })),
    );
  } catch (error) {
    aiLogger.error({ err: error, organizationId }, 'AI chat failed');
    await recordUsage(
      auth,
      organizationId,
      'chat',
      { provider: aiProvider.name, model: aiProvider.model, tokensIn: 0, tokensOut: 0, latencyMs: 0 },
      false,
    );
    throw error;
  }

  const record = conversation
    ? conversation
    : await prisma.aiConversation.create({
        data: {
          userId: auth.user.id,
          organizationId,
          // Keep the title short and recognisable in the sidebar.
          title: input.message.length > 60 ? `${input.message.slice(0, 57)}…` : input.message,
        },
      });

  await prisma.aiMessage.create({
    data: { conversationId: record.id, role: 'USER', content: input.message },
  });

  const assistantMessage = await prisma.aiMessage.create({
    data: {
      conversationId: record.id,
      role: 'ASSISTANT',
      content: answer.content,
      contextSummary: {
        factCount: context.facts.length,
        focus,
        generatedAt: context.generatedAt,
      } as never,
      provider: answer.provider,
      model: answer.model,
      tokensUsed: answer.tokensIn + answer.tokensOut,
      latencyMs: answer.latencyMs,
    },
  });

  await prisma.aiConversation.update({
    where: { id: record.id },
    data: { updatedAt: new Date() },
  });

  await recordUsage(auth, organizationId, 'chat', answer);

  return {
    conversationId: record.id,
    messageId: assistantMessage.id,
    answer: answer.content,
    references: answer.references,
    provider: answer.provider,
    model: answer.model,
    contextSummary: {
      factCount: context.facts.length,
      focus: focus ?? 'all',
      generatedAt: context.generatedAt,
    },
  };
}

export async function listConversations(auth: AuthContext) {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    include: { _count: { select: { messages: true } } },
  });

  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation._count.messages,
    updatedAt: conversation.updatedAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
  }));
}

export async function getConversation(auth: AuthContext, conversationId: string) {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation || conversation.userId !== auth.user.id) {
    throw errors.notFound('Conversation');
  }

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      contextSummary: message.contextSummary,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export async function deleteConversation(auth: AuthContext, conversationId: string): Promise<void> {
  const conversation = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.userId !== auth.user.id) {
    throw errors.notFound('Conversation');
  }
  await prisma.aiConversation.delete({ where: { id: conversationId } });
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export async function recommend(
  auth: AuthContext,
  organizationId: string,
  input: AiRecommendationInput,
): Promise<AiRecommendationItem[]> {
  await assertWithinDailyQuota(auth, organizationId);

  // Each recommendation kind assembles its own tightly-scoped fact set.
  let facts: AiFact[] = [];
  let scope = '';

  switch (input.kind) {
    case 'TRUCK_ASSIGNMENT':
    case 'DRIVER_ASSIGNMENT': {
      if (!input.orderId) {
        throw errors.validation('An order is required for an assignment recommendation.');
      }
      const order = await prisma.order.findUnique({ where: { id: input.orderId } });
      if (!order) throw errors.notFound('Order');

      const matches = await matchTransport(auth, {
        originLatitude: order.originLatitude,
        originLongitude: order.originLongitude,
        destinationLatitude: order.destinationLatitude,
        destinationLongitude: order.destinationLongitude,
        requiredCapacityTons: order.requiredCapacityTons,
        ...(order.requiredTruckType ? { requiredTruckType: order.requiredTruckType } : {}),
        radiusKm: 300,
        limit: 5,
      });

      scope = `assignment options for ${order.reference}`;
      facts = matches.map((match) => ({
        reference: { type: 'truck', id: match.truckId, label: match.registrationNumber },
        statement:
          `${match.registrationNumber} (${match.capacityTons}T) with ${match.driver?.name ?? 'assigned driver'} ` +
          `is ${match.distanceToPickupKm} km from pickup, reaching it in about ${match.estimatedPickupMinutes} min, ` +
          `estimated price ${formatCurrency(match.estimatedPrice)}. Match score ${match.matchScore}/100. ${match.reasons.join(' ')}`,
        basis: 'calculated',
      }));
      break;
    }

    case 'MAINTENANCE': {
      const risks = await maintenanceRisk(organizationId);
      scope = 'maintenance priorities';
      facts = risks
        .filter((risk) => risk.level !== 'LOW')
        .slice(0, 8)
        .map((risk) => ({
          reference: { type: 'truck', id: risk.truckId, label: risk.registrationNumber },
          statement: `${risk.registrationNumber}: risk ${risk.riskScore}/100 (${risk.level}). ${risk.reasons.join(' ')}`,
          basis: 'calculated',
        }));
      break;
    }

    case 'ROUTE':
    case 'FUEL':
    case 'REST_STOP': {
      if (!input.tripId) {
        throw errors.validation('A trip is required for this recommendation.');
      }
      const trip = await prisma.trip.findUnique({ where: { id: input.tripId } });
      if (!trip || trip.organizationId !== organizationId) throw errors.notFound('Trip');

      const category =
        input.kind === 'FUEL' ? 'FUEL' : input.kind === 'REST_STOP' ? 'REST_AREA' : 'PARKING';

      const truck = await prisma.truck.findUnique({ where: { id: trip.truckId } });
      const origin = {
        latitude: truck?.lastLatitude ?? trip.originLatitude,
        longitude: truck?.lastLongitude ?? trip.originLongitude,
      };

      const places = await prisma.nearbyPlace.findMany({
        where: { category, active: true },
        take: 400,
      });

      scope = `${input.kind.toLowerCase().replace(/_/g, ' ')} options for ${trip.reference}`;
      facts = places
        .map((place) => ({
          place,
          distance: distanceKm(origin, { latitude: place.latitude, longitude: place.longitude }),
        }))
        .filter((entry) => entry.distance <= 120)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6)
        .map((entry) => ({
          reference: { type: 'place', id: entry.place.id, label: entry.place.name },
          statement:
            `${entry.place.name} is ${entry.distance.toFixed(1)} km ahead` +
            `${entry.place.open24Hours ? ', open 24 hours' : ''}` +
            `${entry.place.rating ? `, rated ${entry.place.rating}/5` : ''}.`,
          basis: 'recorded',
        }));
      break;
    }
  }

  const context = await buildFleetContext(auth, organizationId, { focus: 'fleet' });
  const recommendations = await aiProvider.recommend(
    { ...context, scope, facts },
    input.kind,
  );

  await recordUsage(auth, organizationId, `recommend:${input.kind}`, {
    provider: aiProvider.name,
    model: aiProvider.model,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
  });

  return recommendations;
}

// ---------------------------------------------------------------------------
// Insights (business intelligence)
// ---------------------------------------------------------------------------

export async function generateInsights(auth: AuthContext, organizationId: string) {
  await assertWithinDailyQuota(auth, organizationId);

  const context = await buildFleetContext(auth, organizationId, { focus: 'all' });
  const answer = await aiProvider.summarize(context, 'Fleet operations briefing');

  await recordUsage(auth, organizationId, 'insights', answer);

  // Persist the notable findings so they can be dismissed and tracked.
  const stored = await prisma.aiInsight.create({
    data: {
      organizationId,
      type: 'SUMMARY',
      category: 'operations',
      title: 'Fleet operations briefing',
      body: answer.content,
      references: answer.references as never,
      severity:
        (context.metrics.activeSosIncidents as number) > 0
          ? 'critical'
          : (context.metrics.documentsExpired as number) > 0 ||
              (context.metrics.maintenanceOverdue as number) > 0
            ? 'warning'
            : 'info',
      basis: 'calculated',
      validUntil: new Date(Date.now() + 12 * 3_600_000),
    },
  });

  return {
    id: stored.id,
    title: stored.title,
    body: stored.body,
    severity: stored.severity,
    references: answer.references,
    createdAt: stored.createdAt.toISOString(),
    provider: answer.provider,
    model: answer.model,
  };
}

export async function listInsights(organizationId: string) {
  const insights = await prisma.aiInsight.findMany({
    where: { organizationId, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return insights.map((insight) => ({
    id: insight.id,
    type: insight.type,
    category: insight.category,
    title: insight.title,
    body: insight.body,
    severity: insight.severity,
    basis: insight.basis,
    references: insight.references,
    createdAt: insight.createdAt.toISOString(),
  }));
}

export async function dismissInsight(organizationId: string, insightId: string): Promise<void> {
  const insight = await prisma.aiInsight.findUnique({ where: { id: insightId } });
  if (!insight || insight.organizationId !== organizationId) throw errors.notFound('Insight');
  await prisma.aiInsight.update({ where: { id: insightId }, data: { dismissedAt: new Date() } });
}

export async function aiUsageSummary(organizationId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [today, month, aggregate] = await Promise.all([
    prisma.aiUsage.count({ where: { organizationId, createdAt: { gte: startOfDay } } }),
    prisma.aiUsage.count({ where: { organizationId, createdAt: { gte: startOfMonth } } }),
    prisma.aiUsage.aggregate({
      where: { organizationId, createdAt: { gte: startOfMonth } },
      _sum: { tokensIn: true, tokensOut: true },
      _avg: { latencyMs: true },
    }),
  ]);

  return {
    requestsToday: today,
    requestsThisMonth: month,
    tokensThisMonth: (aggregate._sum.tokensIn ?? 0) + (aggregate._sum.tokensOut ?? 0),
    averageLatencyMs: Math.round(aggregate._avg.latencyMs ?? 0),
    provider: aiProvider.name,
    model: aiProvider.model,
  };
}
