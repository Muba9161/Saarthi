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
import * as copilot from './copilot.service';
import * as brief from './daily-brief.service';
import { authorizedTools } from './tools/registry';

/**
 * AI Fleet Copilot.
 *
 * Every route requires both the `ai.use` permission and the plan entitlement,
 * and the service layer meters usage against the plan's daily allowance.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * Tool-calling copilot.
   *
   * Distinct from `/chat`, which grounds the model in a context assembled in
   * advance. Here the model asks for what it needs and Saarthi decides, per
   * call, whether this caller may have it — so the answer comes back with the
   * full record of which tools ran and over how many records.
   */
  app.post(
    '/ask',
    {
      preHandler: [requirePermission(Permission.AI_USE), requireFeature(Feature.AI_COPILOT)],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(aiChatSchema, request.body);

      const result = await copilot.askWithTools(auth, organizationId, input.message);

      await auditFromRequest(request, {
        action: AuditAction.AI_QUERY,
        entityType: 'AiCopilot',
        after: {
          tools: result.toolCalls.map((call) => call.tool),
          iterations: result.iterations,
          truncated: result.truncated,
        },
      });

      return ok(reply, {
        ...result,
        // Spec-shaped: "Based on 42 trips, 18 fuel transactions..." — built from
        // the tool record, not from the model's account of what it looked at.
        provenance: copilot.provenanceSummary(result),
      });
    },
  );

  /**
   * What the assistant can look up for *this* caller.
   *
   * Filtered by their permissions and plan, so the list never advertises a
   * capability the person does not have.
   */
  app.get(
    '/tools',
    { preHandler: requirePermission(Permission.AI_USE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      return ok(
        reply,
        authorizedTools(auth).map((tool) => ({
          name: tool.name,
          description: tool.description,
          category: tool.category,
        })),
      );
    },
  );

  /**
   * The morning brief.
   *
   * Not behind the AI entitlement: it is produced by deterministic rules, not
   * by a model, and a fleet without an AI plan still needs to know what is
   * overdue. Only `analytics.read` is required.
   */
  app.get(
    '/daily-brief',
    { preHandler: requirePermission(Permission.ANALYTICS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      return ok(reply, await brief.dailyBriefFor(auth, organizationId));
    },
  );

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
