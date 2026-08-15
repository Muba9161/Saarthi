import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  aiChatSchema,
  aiRecommendationSchema,
  idParamSchema,
} from '@saarthi/shared';
import { created, noContent, ok, parseBody, parseParams } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as aiService from './ai.service';

/**
 * AI Fleet Copilot.
 *
 * Every route requires both the `ai.use` permission and the plan entitlement,
 * and the service layer meters usage against the plan's daily allowance.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/chat',
    {
      preHandler: [requirePermission(Permission.AI_USE), requireFeature(Feature.AI_COPILOT)],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(aiChatSchema, request.body);
      const result = await aiService.chat(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.AI_QUERY,
        entityType: 'AiConversation',
        entityId: result.conversationId,
        after: { focus: result.contextSummary.focus, factCount: result.contextSummary.factCount },
      });

      return ok(reply, result);
    },
  );

  app.get(
    '/conversations',
    { preHandler: [requirePermission(Permission.AI_USE), requireFeature(Feature.AI_COPILOT)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      return ok(reply, await aiService.listConversations(auth));
    },
  );

  app.get(
    '/conversations/:id',
    { preHandler: [requirePermission(Permission.AI_USE), requireFeature(Feature.AI_COPILOT)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await aiService.getConversation(auth, id));
    },
  );

  app.delete(
    '/conversations/:id',
    { preHandler: [requirePermission(Permission.AI_USE), requireFeature(Feature.AI_COPILOT)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await aiService.deleteConversation(auth, id);
      return noContent(reply);
    },
  );

  app.post(
    '/recommendations',
    {
      preHandler: [
        requirePermission(Permission.AI_USE),
        requireFeature(Feature.AI_RECOMMENDATIONS),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(aiRecommendationSchema, request.body);
      return created(reply, await aiService.recommend(auth, organizationId, input));
    },
  );

  app.get(
    '/insights',
    {
      preHandler: [
        requirePermission(Permission.AI_USE),
        requireFeature(Feature.AI_BUSINESS_INTELLIGENCE),
      ],
    },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await aiService.listInsights(organizationId));
    },
  );

  app.post(
    '/insights/generate',
    {
      preHandler: [
        requirePermission(Permission.AI_USE),
        requireFeature(Feature.AI_BUSINESS_INTELLIGENCE),
      ],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return created(reply, await aiService.generateInsights(auth, organizationId));
    },
  );

  app.post(
    '/insights/:id/dismiss',
    { preHandler: [requirePermission(Permission.AI_USE)] },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      await aiService.dismissInsight(organizationId, id);
      return ok(reply, { dismissed: true });
    },
  );

  app.get(
    '/usage',
    { preHandler: requirePermission(Permission.AI_USE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await aiService.aiUsageSummary(organizationId));
    },
  );
}
