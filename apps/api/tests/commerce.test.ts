import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type CommerceInterpretation,
  MaterialUnit,
  OrganizationType,
  PlanTier,
  RequirementKind,
  RoleName,
} from '@saarthi/shared';
import { config } from '../src/config/env';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import { aiProvider, type AiJsonGeneration, type AiJsonRequest } from '../src/providers/ai';
import { invalidateTaxonomy } from '../src/modules/commerce/taxonomy.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Smart commerce engine, end to end against the seeded starter taxonomy:
 * one line of text in, a schema-valid proposal out; the save endpoints
 * validate it again; fleet owners match requirements to seller listings; and
 * only platform administrators change the taxonomy.
 */

const JAIPUR = {
  addressLine: 'Bassi Industrial Area, Jaipur',
  latitude: 26.8351,
  longitude: 75.9843,
};
const LUCKNOW = { addressLine: 'Gomti Nagar, Lucknow', latitude: 26.8467, longitude: 80.9462 };
const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/** The per-user AI budget, which config otherwise keeps read-only. */
function setUserBudget(limit: number): void {
  (config.commerce as { aiDailyLimitPerUser: number }).aiDailyLimitPerUser = limit;
}

async function categoryId(slug: string): Promise<string> {
  return (await prisma.commerceCategory.findUniqueOrThrow({ where: { slug } })).id;
}

describe('smart commerce', () => {
  let customerOrg: TestOrganization;
  let customer: TestUser;
  let sellerOrg: TestOrganization;
  let seller: TestUser;
  let fleetOrg: TestOrganization;
  let fleetOwner: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();

    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BUSINESS);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
    sellerOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
    seller = await createUser({ role: RoleName.SUPPLIER, organizationId: sellerOrg.id });
    fleetOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    fleetOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetOrg.id });
    admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
  });

  const interpret = (
    user: TestUser,
    text: string,
    scope: 'PRODUCT' | 'REQUIREMENT',
    locked?: object,
  ) =>
    request<CommerceInterpretation>({
      method: 'POST',
      url: '/api/v1/commerce/interpret',
      user,
      payload: { text, scope, ...(locked ? { locked } : {}) },
    });

  const createListing = (payload: Record<string, unknown>) =>
    request<{
      id: string;
      commerceCategory: { path: { name: string }[] } | null;
      attributes: Record<string, unknown>;
    }>({
      method: 'POST',
      url: '/api/v1/marketplace/materials',
      user: seller,
      payload: { unit: MaterialUnit.PIECE, pricePerUnit: 25000, availableQuantity: 5, ...payload },
    });

  const postMaterialNeed = (materialDetail: Record<string, unknown>) =>
    request<{ id: string; category: { name: string } | null; attributes: Record<string, unknown> }>(
      {
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.MATERIAL_SUPPLY,
          title: '25 tons of river sand to Lucknow',
          origin: JAIPUR,
          destination: LUCKNOW,
          startAt: soon(6),
          bidsCloseAt: soon(2),
          materialDetail,
        },
      },
    );

  // -------------------------------------------------------------------------

  describe('taxonomy', () => {
    it('serves the active tree to sellers and customers, without classifier aliases', async () => {
      const { status, body } = await request<{ name: string; aliases: string[] }[]>({
        method: 'GET',
        url: '/api/v1/commerce/categories',
        user: seller,
      });
      expect(status).toBe(200);
      expect(body.data.map((node) => node.name)).toEqual(
        expect.arrayContaining(['Furniture', 'Dining Table', 'River Sand', 'Other']),
      );
      expect(body.data.every((node) => node.aliases.length === 0)).toBe(true);

      const asCustomer = await request({
        method: 'GET',
        url: '/api/v1/commerce/categories',
        user: customer,
      });
      expect(asCustomer.status).toBe(200);
    });

    it('is not served to an account that neither sells nor asks', async () => {
      const driver = await createUser({
        role: RoleName.DRIVER,
        organizationId: fleetOrg.id,
        driver: true,
      });
      const { status } = await interpret(driver, 'river sand', 'PRODUCT');
      expect(status).toBe(403);
    });
  });

  describe('interpreting one line', () => {
    it('reads a seller line completely and asks for nothing more', async () => {
      const { status, body } = await interpret(
        seller,
        'Teak 6-seater dining table ₹25,000, 5 available',
        'PRODUCT',
      );
      expect(status).toBe(200);
      expect(body.data.category?.path.map((node) => node.name)).toEqual([
        'Furniture',
        'Tables',
        'Dining Table',
      ]);
      expect(body.data.attributes).toMatchObject({ material: 'Teak', seating_capacity: 6 });
      expect(body.data.commercial).toMatchObject({
        pricePerUnit: 25000,
        stock: 5,
        unit: MaterialUnit.PIECE,
      });
      expect(body.data.missing).toEqual([]);
      expect(body.data.confidence).toBe('HIGH');
    });

    it('asks a seller only for the price and stock it did not give', async () => {
      const { body } = await interpret(seller, 'Wooden dining table', 'PRODUCT');
      expect(body.data.category?.name).toBe('Dining Table');
      expect(body.data.attributes.material).toBe('Wood');
      expect(body.data.missing).toEqual(['pricePerUnit', 'stock']);
    });

    it('reads a customer need and asks only for the grade', async () => {
      const { body } = await interpret(
        customer,
        'I need 25 tons of river sand from Saharanpur to Lucknow within 3 days.',
        'REQUIREMENT',
      );
      expect(body.data.category?.name).toBe('River Sand');
      expect(body.data.commercial).toMatchObject({
        quantity: 25,
        unit: MaterialUnit.TON,
        pickupCity: 'Saharanpur',
        deliveryCity: 'Lucknow',
        requiredWithinDays: 3,
      });
      expect(body.data.missing).toEqual(['grade']);
    });

    it('falls back to Other without AI when nothing is recognised', async () => {
      const { body } = await interpret(seller, 'A specialised industrial item', 'PRODUCT');
      expect(body.data.category?.name).toBe('Other');
      expect(body.data.confidence).toBe('LOW');
    });

    it('keeps what the user corrected', async () => {
      const { body } = await interpret(seller, 'Teak dining table', 'PRODUCT', {
        attributes: { material: 'Sheesham' },
      });
      expect(body.data.attributes.material).toBe('Sheesham');
    });

    it('never exposes how the answer was reached', async () => {
      const { body } = await interpret(seller, 'river sand', 'PRODUCT');
      const serialized = JSON.stringify(body.data);
      expect(serialized).not.toMatch(/gemini|provider|token/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('AI assistance', () => {
    type Handler = (request: AiJsonRequest) => Promise<AiJsonGeneration>;
    const provider = aiProvider as unknown as Record<string, unknown>;
    let calls = 0;

    function stubModel(handler: Handler): void {
      calls = 0;
      provider.supportsStructuredOutput = true;
      provider.generateJson = async (input: AiJsonRequest) => {
        calls += 1;
        return handler(input);
      };
    }

    const usage = (data: unknown): AiJsonGeneration => ({
      data,
      provider: 'test',
      model: 'test-model',
      tokensIn: 40,
      tokensOut: 12,
      latencyMs: 5,
    });

    /** Answers with whichever candidate reference the prompt gave "Wardrobe". */
    const picksWardrobe: Handler = async (input) => {
      const ref = /(c\d+) \| [^\n]*Wardrobe/.exec(input.prompt)?.[1] ?? null;
      return usage({
        ref,
        confidence: 0.97,
        attributes: [
          { key: 'material', value: 'Metal' },
          { key: 'invented', value: 'x' },
        ],
      });
    };

    afterEach(() => {
      delete provider.supportsStructuredOutput;
      delete provider.generateJson;
      setUserBudget(50);
    });

    it('uses a validated suggestion when the taxonomy is unsure, capped below high confidence', async () => {
      stubModel(picksWardrobe);
      const { body } = await interpret(seller, 'Godrej almira for clothes', 'PRODUCT');
      expect(calls).toBe(1);
      expect(body.data.category?.name).toBe('Wardrobe');
      expect(body.data.confidence).toBe('MEDIUM');
      expect(body.data.attributes).toEqual({ material: 'Metal' });

      const recorded = await prisma.aiUsage.findMany({ where: { userId: seller.id } });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.operation).toBe('commerce.classify');
    });

    it('sends the product line, not contact details', async () => {
      let prompt = '';
      stubModel(async (input) => {
        prompt = input.prompt;
        return usage({ ref: null, confidence: 0 });
      });
      await interpret(seller, 'Odd gadget, call 9876543210 or a@b.com', 'PRODUCT');
      expect(prompt).not.toContain('9876543210');
      expect(prompt).not.toContain('a@b.com');
    });

    it('reuses a cached classification instead of asking again', async () => {
      stubModel(picksWardrobe);
      await interpret(seller, 'Godrej almira for clothes', 'PRODUCT');
      await interpret(seller, 'Godrej almira for clothes', 'PRODUCT');
      expect(calls).toBe(1);
    });

    it('does not consult AI when the taxonomy is already confident', async () => {
      stubModel(picksWardrobe);
      await interpret(seller, 'river sand 40 tons', 'PRODUCT');
      expect(calls).toBe(0);
    });

    it('ignores malformed output and categories it was not offered', async () => {
      stubModel(async () => usage({ something: 'else' }));
      const malformed = await interpret(seller, 'Unknown gizmo one', 'PRODUCT');
      expect(malformed.body.data.category?.name).toBe('Other');

      stubModel(async () => usage({ ref: 'c999', confidence: 0.99 }));
      const invented = await interpret(seller, 'Unknown gizmo two', 'PRODUCT');
      expect(invented.body.data.category?.name).toBe('Other');
    });

    it('keeps the form working when the model fails', async () => {
      stubModel(async () => {
        throw new Error('timeout');
      });
      const { status, body } = await interpret(seller, 'Unknown gizmo three', 'PRODUCT');
      expect(status).toBe(200);
      expect(body.data.category?.name).toBe('Other');

      const recorded = await prisma.aiUsage.findFirstOrThrow({ where: { userId: seller.id } });
      expect(recorded.success).toBe(false);
    });

    it('stops asking once the daily budget is spent', async () => {
      setUserBudget(0);
      stubModel(picksWardrobe);
      const { body } = await interpret(seller, 'Godrej almira for clothes', 'PRODUCT');
      expect(calls).toBe(0);
      expect(body.data.category?.name).toBe('Other');
    });
  });

  // -------------------------------------------------------------------------

  describe('seller listings', () => {
    it('files a confirmed product under its category with validated details', async () => {
      const { status, body } = await createListing({
        name: 'Teak 6-seater dining table',
        categoryId: await categoryId('dining-tables'),
        attributes: { material: 'teak', seating_capacity: '6', not_in_schema: 'dropped' },
      });
      expect(status).toBe(201);
      expect(body.data.commerceCategory?.path.map((node) => node.name)).toEqual([
        'Furniture',
        'Tables',
        'Dining Table',
      ]);
      expect(body.data.attributes).toEqual({ material: 'Teak', seating_capacity: 6 });
    });

    it('lets one seller list across many categories', async () => {
      expect(
        (
          await createListing({
            name: 'Dining table',
            categoryId: await categoryId('dining-tables'),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await createListing({
            name: 'River sand',
            unit: MaterialUnit.TON,
            categoryId: await categoryId('river-sand'),
            attributes: { grade: 'Fine' },
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await createListing({
            name: 'Marine ply 18mm',
            categoryId: await categoryId('plywood'),
            attributes: { thickness: 18 },
          })
        ).status,
      ).toBe(201);
    });

    it('refuses a product missing a required detail', async () => {
      const { status, body } = await createListing({
        name: 'River sand',
        unit: MaterialUnit.TON,
        categoryId: await categoryId('river-sand'),
      });
      expect(status).toBe(400);
      expect(JSON.stringify(body.error)).toContain('attributes.grade');
    });

    it('refuses a value outside the allowed options', async () => {
      const { status } = await createListing({
        name: 'River sand',
        unit: MaterialUnit.TON,
        categoryId: await categoryId('river-sand'),
        attributes: { grade: 'Golden' },
      });
      expect(status).toBe(400);
    });

    it('refuses a second identical listing', async () => {
      const dining = await categoryId('dining-tables');
      expect((await createListing({ name: 'Teak dining table', categoryId: dining })).status).toBe(
        201,
      );
      expect((await createListing({ name: 'Teak Dining Table', categoryId: dining })).status).toBe(
        409,
      );
    });
  });

  describe('customer requirements', () => {
    it('stores the confirmed category and details', async () => {
      const { status, body } = await postMaterialNeed({
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
        categoryId: await categoryId('river-sand'),
        attributes: { grade: 'Fine' },
      });
      expect(status).toBe(201);
      expect(body.data.category?.name).toBe('River Sand');
      expect(body.data.attributes).toEqual({ grade: 'Fine' });
    });

    it('refuses the same open need posted twice', async () => {
      const detail = {
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
        categoryId: await categoryId('river-sand'),
        attributes: { grade: 'Fine' },
      };
      expect((await postMaterialNeed(detail)).status).toBe(201);
      expect((await postMaterialNeed(detail)).status).toBe(409);
      // A different grade is a different need.
      expect((await postMaterialNeed({ ...detail, attributes: { grade: 'Coarse' } })).status).toBe(
        201,
      );
    });
  });

  // -------------------------------------------------------------------------

  describe('seller matching', () => {
    async function listing(
      name: string,
      slug: string,
      attributes: Record<string, unknown>,
      availableQuantity: number,
    ) {
      const { body } = await createListing({
        name,
        unit: MaterialUnit.TON,
        pricePerUnit: 2000,
        availableQuantity,
        categoryId: await categoryId(slug),
        attributes,
        pickupLatitude: LUCKNOW.latitude + 0.2,
        pickupLongitude: LUCKNOW.longitude,
      });
      return body.data.id;
    }

    it('ranks listings for a fleet owner on structured data', async () => {
      const exact = await listing('Fine river sand', 'river-sand', { grade: 'Fine' }, 40);
      const short = await listing('River sand, small lot', 'river-sand', { grade: 'Fine' }, 10);
      const wrongGrade = await listing('Coarse river sand', 'river-sand', { grade: 'Coarse' }, 40);
      await createListing({ name: 'Dining table', categoryId: await categoryId('dining-tables') });

      const { body: need } = await postMaterialNeed({
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
        categoryId: await categoryId('river-sand'),
        attributes: { grade: 'Fine' },
      });

      const { status, body } = await request<
        {
          materialId: string;
          sellerName: string;
          stockSufficient: boolean | null;
          procurementReference: number | null;
        }[]
      >({
        method: 'GET',
        url: `/api/v1/commerce/requirements/${need.data.id}/matches`,
        user: fleetOwner,
      });

      expect(status).toBe(200);
      expect(body.data.map((match) => match.materialId)).toHaveLength(3);
      expect(body.data[0]?.materialId).toBe(exact);
      expect(body.data[0]?.sellerName).toBe(sellerOrg.name);
      expect(body.data[0]?.procurementReference).toBe(50000);
      expect(body.data.find((match) => match.materialId === short)?.stockSufficient).toBe(false);
      expect(body.data.findIndex((match) => match.materialId === wrongGrade)).toBeGreaterThan(0);
    });

    it('never serves seller matches to the customer or the seller', async () => {
      const { body: need } = await postMaterialNeed({
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
      });
      const url = `/api/v1/commerce/requirements/${need.data.id}/matches`;
      expect((await request({ method: 'GET', url, user: customer })).status).toBe(403);
      expect((await request({ method: 'GET', url, user: seller })).status).toBe(403);
    });

    it('still matches a requirement posted before it was classified', async () => {
      const exact = await listing('River sand', 'river-sand', { grade: 'Fine' }, 40);
      const { body: need } = await postMaterialNeed({
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
      });

      const { body } = await request<{ materialId: string }[]>({
        method: 'GET',
        url: `/api/v1/commerce/requirements/${need.data.id}/matches`,
        user: fleetOwner,
      });
      expect(body.data[0]?.materialId).toBe(exact);
    });
  });

  // -------------------------------------------------------------------------

  describe('communication boundary', () => {
    it('hides a seller’s contact details from a customer, and not from a fleet owner', async () => {
      await prisma.organizationProfile.create({
        data: {
          organizationId: sellerOrg.id,
          publicSlug: unique('seller').toLowerCase(),
          supportPhone: '+919811112222',
          supportEmail: 'sales@seller.test',
        },
      });
      const { publicSlug } = await prisma.organizationProfile.findUniqueOrThrow({
        where: { organizationId: sellerOrg.id },
      });

      const asCustomer = await request<{
        organization: { supportPhone: string | null; supportEmail: string | null };
      }>({
        method: 'GET',
        url: `/api/v1/profile/${publicSlug}`,
        user: customer,
      });
      expect(asCustomer.status).toBe(200);
      expect(asCustomer.body.data.organization.supportPhone).toBeNull();
      expect(asCustomer.body.data.organization.supportEmail).toBeNull();

      const asFleet = await request<{ organization: { supportPhone: string | null } }>({
        method: 'GET',
        url: `/api/v1/profile/${publicSlug}`,
        user: fleetOwner,
      });
      expect(asFleet.body.data.organization.supportPhone).toBe('+919811112222');
    });
  });

  // -------------------------------------------------------------------------

  describe('administration', () => {
    const created: string[] = [];
    const reactivate: string[] = [];

    afterEach(async () => {
      // The taxonomy is reference data that survives resetDatabase(), so every
      // test here puts back what it changed.
      for (const id of created.reverse()) {
        await prisma.material.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
        await prisma.commerceCategory.delete({ where: { id } });
      }
      created.length = 0;
      for (const id of reactivate) {
        await prisma.commerceCategory.update({ where: { id }, data: { status: 'ACTIVE' } });
      }
      reactivate.length = 0;
      await invalidateTaxonomy();
    });

    it('is closed to sellers and customers', async () => {
      for (const user of [seller, customer, fleetOwner]) {
        const { status } = await request({
          method: 'POST',
          url: '/api/v1/admin/commerce/categories',
          user,
          payload: { name: 'Solar Panels' },
        });
        expect(status).toBe(403);
      }
    });

    it('adds a category, an attribute and an alias that the engine then understands', async () => {
      const parent = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/admin/commerce/categories',
        user: admin,
        payload: {
          parentId: await categoryId('electronics'),
          name: 'Solar Panels',
          defaultUnit: MaterialUnit.PIECE,
        },
      });
      expect(parent.status).toBe(201);
      created.push(parent.body.data.id);

      const attribute = await request({
        method: 'POST',
        url: `/api/v1/admin/commerce/categories/${parent.body.data.id}/attributes`,
        user: admin,
        payload: { key: 'wattage', label: 'Wattage', type: 'NUMBER', unit: 'watt', required: true },
      });
      expect(attribute.status).toBe(201);

      const alias = await request({
        method: 'POST',
        url: `/api/v1/admin/commerce/categories/${parent.body.data.id}/aliases`,
        user: admin,
        payload: { alias: 'PV module' },
      });
      expect(alias.status).toBe(201);

      const { body } = await interpret(
        seller,
        'PV module 540 watt ₹11,000, 20 available',
        'PRODUCT',
      );
      expect(body.data.category?.name).toBe('Solar Panels');
      expect(body.data.attributes).toEqual({ wattage: 540 });
      expect(body.data.missing).toEqual([]);
    });

    it('disables a category so nothing new can be filed under it', async () => {
      const cement = await categoryId('cement');
      reactivate.push(cement);

      const patch = await request({
        method: 'PATCH',
        url: `/api/v1/admin/commerce/categories/${cement}`,
        user: admin,
        payload: { status: 'INACTIVE' },
      });
      expect(patch.status).toBe(200);

      const { body } = await interpret(seller, 'OPC 53 cement', 'PRODUCT');
      expect(body.data.category?.name).not.toBe('Cement');

      const listingAttempt = await createListing({
        name: 'OPC 53',
        unit: MaterialUnit.BAG,
        categoryId: cement,
        attributes: { cement_type: 'OPC 53' },
      });
      expect(listingAttempt.status).toBe(400);
    });

    it('refuses to disable the Other fallback', async () => {
      const { status } = await request({
        method: 'PATCH',
        url: `/api/v1/admin/commerce/categories/${await categoryId('other')}`,
        user: admin,
        payload: { status: 'INACTIVE' },
      });
      expect(status).toBe(422);
    });

    it('lists what people filed under Other', async () => {
      await createListing({
        name: 'Hydraulic press spares',
        categoryId: await categoryId('other'),
      });

      const { status, body } = await request<{ items: { name: string; kind: string }[] }>({
        method: 'GET',
        url: '/api/v1/admin/commerce/other-usage',
        user: admin,
      });
      expect(status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({ name: 'Hydraulic press spares', kind: 'PRODUCT' }),
      ]);
    });
  });
});
