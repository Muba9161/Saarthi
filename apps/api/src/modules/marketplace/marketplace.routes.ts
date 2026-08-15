import type { FastifyInstance } from 'fastify';
import {
  Permission,
  createMaterialSchema,
  customerProfileSchema,
  idParamSchema,
  materialListQuerySchema,
  supplierProfileSchema,
  updateMaterialSchema,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { created, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { requireAuth, requireOrganizationId, requirePermission } from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as materialService from './material.service';

/**
 * Supplier catalogue and the public marketplace browse surface.
 */
export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // --- Browse (any authenticated user) ----------------------------------
  app.get(
    '/materials',
    { preHandler: requirePermission(Permission.MATERIALS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(materialListQuerySchema, request.query);
      const result = await materialService.listMaterials(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/materials/categories',
    { preHandler: requirePermission(Permission.MATERIALS_READ) },
    async (_request, reply) => ok(reply, await materialService.materialCategories()),
  );

  app.get(
    '/materials/:id',
    { preHandler: requirePermission(Permission.MATERIALS_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await materialService.getMaterial(id));
    },
  );

  // --- Supplier's own catalogue ------------------------------------------
  app.get(
    '/my-materials',
    { preHandler: requirePermission(Permission.MATERIALS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      requireOrganizationId(request);
      const query = parseQuery(materialListQuerySchema, request.query);
      const result = await materialService.listMaterials(auth, query, { ownOnly: true });
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.post(
    '/materials',
    { preHandler: requirePermission(Permission.MATERIALS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createMaterialSchema, request.body);
      const material = await materialService.createMaterial(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.MATERIAL_CREATED,
        entityType: 'Material',
        entityId: material.id,
        after: { name: material.name, pricePerUnit: material.pricePerUnit },
      });

      return created(reply, material);
    },
  );

  app.patch(
    '/materials/:id',
    { preHandler: requirePermission(Permission.MATERIALS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateMaterialSchema, request.body);
      const material = await materialService.updateMaterial(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.MATERIAL_UPDATED,
        entityType: 'Material',
        entityId: id,
        after: input,
      });

      return ok(reply, material);
    },
  );

  app.delete(
    '/materials/:id',
    { preHandler: requirePermission(Permission.MATERIALS_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      await materialService.archiveMaterial(auth, id);

      await auditFromRequest(request, {
        action: AuditAction.MATERIAL_DELETED,
        entityType: 'Material',
        entityId: id,
      });

      return noContent(reply);
    },
  );

  // --- Supplier / customer profiles --------------------------------------
  app.get(
    '/supplier/profile',
    { preHandler: requirePermission(Permission.SUPPLIERS_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const supplier = await prisma.supplier.findUnique({ where: { organizationId } });
      if (!supplier) throw errors.notFound('Supplier profile');

      const [materialCount, orderCount] = await Promise.all([
        prisma.material.count({ where: { organizationId, archivedAt: null } }),
        prisma.order.count({ where: { supplierOrganizationId: organizationId } }),
      ]);

      return ok(reply, { ...supplier, counts: { materials: materialCount, orders: orderCount } });
    },
  );

  app.patch(
    '/supplier/profile',
    { preHandler: requirePermission(Permission.SUPPLIERS_MANAGE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const input = parseBody(supplierProfileSchema, request.body);
      const supplier = await prisma.supplier.update({
        where: { organizationId },
        data: {
          ...(input.businessDescription !== undefined
            ? { businessDescription: input.businessDescription }
            : {}),
          ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        },
      });
      return ok(reply, supplier);
    },
  );

  app.get(
    '/customer/profile',
    { preHandler: requirePermission(Permission.CUSTOMERS_READ, Permission.ORDERS_CREATE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const customer = await prisma.customer.findUnique({ where: { organizationId } });
      if (!customer) throw errors.notFound('Customer profile');
      return ok(reply, customer);
    },
  );

  app.patch(
    '/customer/profile',
    { preHandler: requirePermission(Permission.ORDERS_CREATE, Permission.CUSTOMERS_MANAGE) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const input = parseBody(customerProfileSchema, request.body);
      const customer = await prisma.customer.update({
        where: { organizationId },
        data: {
          ...(input.businessType !== undefined ? { businessType: input.businessType } : {}),
          ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        },
      });
      return ok(reply, customer);
    },
  );

  // --- Supplier directory -------------------------------------------------
  app.get(
    '/suppliers',
    { preHandler: requirePermission(Permission.SUPPLIERS_READ) },
    async (_request, reply) => {
      const suppliers = await prisma.supplier.findMany({
        where: { archivedAt: null },
        orderBy: { rating: 'desc' },
        take: 100,
      });

      const organizations = await prisma.organization.findMany({
        where: { id: { in: suppliers.map((supplier) => supplier.organizationId) } },
        select: { id: true, name: true, city: true, state: true, verificationStatus: true },
      });
      const orgMap = new Map(organizations.map((organization) => [organization.id, organization]));

      const materialCounts = await prisma.material.groupBy({
        by: ['supplierId'],
        where: { archivedAt: null, status: 'ACTIVE' },
        _count: { _all: true },
      });
      const countMap = new Map(
        materialCounts.map((entry) => [entry.supplierId, entry._count._all]),
      );

      return ok(
        reply,
        suppliers.map((supplier) => ({
          id: supplier.id,
          organizationId: supplier.organizationId,
          name: orgMap.get(supplier.organizationId)?.name ?? 'Supplier',
          city: supplier.city ?? orgMap.get(supplier.organizationId)?.city ?? null,
          state: supplier.state ?? orgMap.get(supplier.organizationId)?.state ?? null,
          verificationStatus: supplier.verificationStatus,
          rating: supplier.rating,
          ratingCount: supplier.ratingCount,
          businessDescription: supplier.businessDescription,
          activeMaterials: countMap.get(supplier.id) ?? 0,
        })),
      );
    },
  );
}
