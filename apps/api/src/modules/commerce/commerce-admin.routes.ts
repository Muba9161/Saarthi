import type { FastifyInstance } from 'fastify';
import {
  commerceOtherUsageQuerySchema,
  createCommerceAliasSchema,
  createCommerceAttributeSchema,
  createCommerceCategorySchema,
  idParamSchema,
  updateCommerceAttributeSchema,
  updateCommerceCategorySchema,
} from '@saarthi/shared';
import {
  created,
  noContent,
  ok,
  paginated,
  parseBody,
  parseParams,
  parseQuery,
} from '../../lib/http';
import { requirePlatformAdmin } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as admin from './taxonomy-admin.service';

/**
 * Taxonomy administration. Platform administrators only: the taxonomy is the
 * schema every listing and requirement is validated against.
 */
export async function commerceAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requirePlatformAdmin());

  app.get('/categories', async (_request, reply) => ok(reply, await admin.listAllCategories()));

  app.post('/categories', async (request, reply) => {
    const input = parseBody(createCommerceCategorySchema, request.body);
    const category = await admin.createCategory(input);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_CATEGORY_CREATED,
      entityType: 'CommerceCategory',
      entityId: category.id,
      after: { name: input.name, parentId: input.parentId ?? null },
    });
    return created(reply, category);
  });

  app.patch('/categories/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateCommerceCategorySchema, request.body);
    await admin.updateCategory(id, input);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_CATEGORY_UPDATED,
      entityType: 'CommerceCategory',
      entityId: id,
      after: input,
    });
    return noContent(reply);
  });

  app.post('/categories/:id/attributes', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(createCommerceAttributeSchema, request.body);
    const attribute = await admin.createAttribute(id, input);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_ATTRIBUTE_CREATED,
      entityType: 'CommerceCategoryAttribute',
      entityId: attribute.id,
      after: { categoryId: id, key: input.key, type: input.type, required: input.required },
    });
    return created(reply, attribute);
  });

  app.patch('/attributes/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateCommerceAttributeSchema, request.body);
    await admin.updateAttribute(id, input);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_ATTRIBUTE_UPDATED,
      entityType: 'CommerceCategoryAttribute',
      entityId: id,
      after: input,
    });
    return noContent(reply);
  });

  app.delete('/attributes/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    await admin.deleteAttribute(id);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_ATTRIBUTE_DELETED,
      entityType: 'CommerceCategoryAttribute',
      entityId: id,
    });
    return noContent(reply);
  });

  app.post('/categories/:id/aliases', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(createCommerceAliasSchema, request.body);
    const alias = await admin.addAlias(id, input);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_ALIAS_CREATED,
      entityType: 'CommerceCategoryAlias',
      entityId: alias.id,
      after: { categoryId: id, alias: input.alias },
    });
    return created(reply, alias);
  });

  app.delete('/aliases/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    await admin.deleteAlias(id);
    await auditFromRequest(request, {
      action: AuditAction.COMMERCE_ALIAS_DELETED,
      entityType: 'CommerceCategoryAlias',
      entityId: id,
    });
    return noContent(reply);
  });

  app.get('/other-usage', async (request, reply) => {
    const query = parseQuery(commerceOtherUsageQuerySchema, request.query);
    const result = await admin.otherUsage(query);
    return paginated(reply, result.items, result.pagination);
  });
}
