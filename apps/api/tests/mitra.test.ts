import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, SubscriptionStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { aiProvider, type AiGenerateInput, type AiGeneration } from '../src/providers/ai';
import { buildAuthContext } from '../src/auth/session.service';
import { invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { authorizedTools, executeTool } from '../src/modules/ai/tools/registry';
import { categoriesFor, routeTools } from '../src/modules/ai/tools/tool-routing';
import { TRIAL_AI_QUESTIONS_PER_DAY } from '../src/modules/ai/ai-usage';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Saarthi Mitra's abilities: the product guide, setup status and drafts, the
 * buttons they put under a reply, the tool routing that keeps each question
 * cheap, and the free-trial allowance.
 */

type Generate = (input: AiGenerateInput) => Promise<AiGeneration>;

const reply = (partial: Partial<AiGeneration>): AiGeneration => ({
  content: null,
  toolCalls: [],
  provider: 'test',
  model: 'test',
  tokensIn: 1,
  tokensOut: 1,
  latencyMs: 1,
  finishReason: 'stop',
  ...partial,
});

describe('Saarthi Mitra', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let customerOrg: TestOrganization;
  let customer: TestUser;
  let sellerOrg: TestOrganization;
  let seller: TestUser;

  const provider = aiProvider as unknown as { generate: Generate };
  let original: Generate;

  beforeAll(async () => {
    await getApp();
    original = provider.generate.bind(aiProvider);
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    invalidateEntitlements();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BUSINESS);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
    sellerOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
    seller = await createUser({ role: RoleName.SUPPLIER, organizationId: sellerOrg.id });
  });

  afterEach(() => {
    provider.generate = original;
  });

  const authFor = (user: TestUser) =>
    buildAuthContext(user.id, 'test-session', user.organizationId ?? null);

  describe('tool routing', () => {
    it('matches questions to tool groups in English and Hinglish', () => {
      expect([...categoriesFor(['Which EMIs are due this week?'])]).toEqual(['finance']);
      expect(categoriesFor(['mera truck kahan hai']).has('vehicle')).toBe(true);
      expect(categoriesFor(['diesel ka kharcha kitna hua']).has('cost')).toBe(true);
    });

    it('offers only the matched groups plus the core, and everything when nothing matches', async () => {
      const tools = authorizedTools(await authFor(owner));
      const routed = routeTools(tools, ['Which EMIs are due this week?']);
      const categories = new Set(routed.map((tool) => tool.category));

      expect(categories).toEqual(new Set(['fleet', 'assistant', 'finance']));
      expect(routed.length).toBeLessThan(tools.length);
      expect(routeTools(tools, ['hello there'])).toHaveLength(tools.length);
    });

    it('keeps Mitra’s guide and drafts out of the driver terminal', async () => {
      const seen: AiGenerateInput[] = [];
      provider.generate = async (input) => {
        seen.push(input);
        return reply({ content: 'Next stop is Jaipur.' });
      };
      const { askWithTools } = await import('../src/modules/ai/copilot.service');
      await askWithTools(await authFor(owner), fleet.id, 'Where is my next stop?');
      expect(seen[0]!.tools.map((tool) => tool.name)).not.toContain('get_help_guide');
    });
  });

  describe('guide and setup', () => {
    it('answers "how do I" from the built-in guide with a button to the screen', async () => {
      const { result, record } = await executeTool(
        await authFor(owner),
        fleet.id,
        'get_help_guide',
        {
          topic: 'connect_bank',
        },
      );
      expect(result?.data).toMatchObject({ available: true, title: 'Connect a bank account' });
      expect(record.actions).toEqual([
        { label: 'Payouts & commission', path: '/settings/payouts' },
      ]);
    });

    it('does not offer a guide to something the account cannot do', async () => {
      const { result, record } = await executeTool(
        await authFor(customer),
        customerOrg.id,
        'get_help_guide',
        {
          topic: 'add_truck',
        },
      );
      expect(result?.data).toMatchObject({ available: false });
      expect(record.actions).toEqual([]);
    });

    it('reports what is left to set up, with the next steps as buttons', async () => {
      const { result, record } = await executeTool(
        await authFor(owner),
        fleet.id,
        'get_account_setup_status',
        {},
      );
      const data = result?.data as {
        profile: { percentComplete: number } | null;
        bankAccount: { usable: boolean } | null;
        plan: { onFreeTrial: boolean } | null;
      };
      expect(data.profile?.percentComplete).toBeLessThan(100);
      expect(data.bankAccount?.usable).toBe(false);
      expect(data.plan?.onFreeTrial).toBe(false);
      expect(record.actions.map((action) => action.path)).toEqual(
        expect.arrayContaining(['/settings/profile', '/settings/payouts']),
      );
    });
  });

  describe('drafts', () => {
    it('reads a requirement and opens the form prefilled, without posting it', async () => {
      const { result, record } = await executeTool(
        await authFor(customer),
        customerOrg.id,
        'draft_requirement',
        {
          text: 'I need 25 tons of river sand from Saharanpur to Lucknow within 3 days',
        },
      );
      expect(result?.data).toMatchObject({
        posted: false,
        category: 'Construction Materials > Sand > River Sand',
        quantity: 25,
        deliveryCity: 'Lucknow',
        stillNeeded: ['Grade'],
      });
      expect(record.actions[0]).toMatchObject({
        path: '/requirements/new',
        draft: { kind: 'MATERIAL_SUPPLY' },
      });
      expect(await prisma.requirement.count()).toBe(0);
    });

    it('drafts a product for a seller and refuses one for a fleet owner', async () => {
      const seller_ = await executeTool(await authFor(seller), sellerOrg.id, 'draft_product', {
        text: 'Teak 6-seater dining table ₹25,000, 5 available',
      });
      expect(seller_.result?.data).toMatchObject({ published: false, price: 25000, stock: 5 });
      expect(seller_.record.actions[0]?.path).toBe('/supplier/materials/new');
      expect(await prisma.material.count()).toBe(0);

      const fleet_ = await executeTool(await authFor(owner), fleet.id, 'draft_product', {
        text: 'sand',
      });
      expect(fleet_.record.error).toMatch(/permission/i);
    });

    it('puts the draft’s button under Mitra’s reply', async () => {
      let turn = 0;
      provider.generate = async () => {
        turn += 1;
        return turn === 1
          ? reply({
              toolCalls: [
                {
                  id: 'c1',
                  name: 'draft_requirement',
                  arguments: { text: '400 bags of OPC 53 cement' },
                },
              ],
              finishReason: 'tool_calls',
            })
          : reply({ content: 'I have prepared it - review it with the button below.' });
      };

      const { status, body } = await request<{ actions: { label: string; path: string }[] }>({
        method: 'POST',
        url: '/api/v1/ai/ask',
        user: customer,
        payload: { message: 'Post a requirement for 400 bags of OPC 53 cement' },
      });
      expect(status).toBe(200);
      expect(body.data.actions).toEqual([
        expect.objectContaining({ label: 'Review & post requirement', path: '/requirements/new' }),
      ]);
    });
  });

  describe('free trial allowance', () => {
    beforeEach(async () => {
      await prisma.subscription.updateMany({
        where: { organizationId: fleet.id },
        data: { status: SubscriptionStatus.TRIALING },
      });
      invalidateEntitlements(fleet.id);
      provider.generate = async () => reply({ content: 'All good.' });
    });

    it(`allows ${TRIAL_AI_QUESTIONS_PER_DAY} questions a day, then asks them to choose a plan`, async () => {
      const ask = () =>
        request<{ answer: string }>({
          method: 'POST',
          url: '/api/v1/ai/ask',
          user: owner,
          payload: { message: 'How is the fleet?' },
        });

      for (let index = 0; index < TRIAL_AI_QUESTIONS_PER_DAY; index += 1) {
        expect((await ask()).status).toBe(200);
      }
      const refused = await ask();
      expect(refused.status).toBe(403);
      expect(refused.body.error?.message).toMatch(/free trial includes 5 questions a day/);

      const usage = await request<{
        dailyLimit: number;
        remainingToday: number;
        trialing: boolean;
      }>({
        method: 'GET',
        url: '/api/v1/ai/usage',
        user: owner,
      });
      expect(usage.body.data).toMatchObject({ dailyLimit: 5, remainingToday: 0, trialing: true });
    });
  });
});
