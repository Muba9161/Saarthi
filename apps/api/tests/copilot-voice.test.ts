import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
import { aiProvider, type AiGenerateInput, type AiGeneration } from '../src/providers/ai';
import { askWithTools } from '../src/modules/ai/copilot.service';
import { buildAuthContext } from '../src/auth/session.service';
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
 * The copilot's voice and memory.
 *
 * The chat screen gets Saarthi's warm companion voice and the conversation so
 * far; the driver's in-cab terminal keeps the brief operational voice. Both
 * keep every grounding rule. The model is stubbed so the system prompt and
 * turns it receives can be inspected.
 */
describe('copilot voice and memory', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  const seen: AiGenerateInput[] = [];
  const provider = aiProvider as unknown as {
    generate: (input: AiGenerateInput) => Promise<AiGeneration>;
  };
  let original: typeof provider.generate;

  beforeAll(async () => {
    await getApp();
    original = provider.generate.bind(aiProvider);
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    seen.length = 0;
    provider.generate = async (input) => {
      seen.push(input);
      return {
        content: 'All three trucks are on the road today.',
        toolCalls: [],
        provider: 'test',
        model: 'test',
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: 1,
        finishReason: 'stop',
      };
    };
  });

  afterEach(() => {
    provider.generate = original;
  });

  it('speaks to the chat screen as a warm companion, with the person’s name', async () => {
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/ai/ask',
      user: owner,
      payload: { message: 'How is the fleet doing?' },
    });
    expect(status).toBe(200);

    const system = seen[0]!.system;
    expect(system).toContain('Your voice:');
    expect(system).toContain('You are Saarthi');
    expect(system).toContain('"Test"');
    expect(system).toContain('Reply in the language they wrote in');
    // Warmth is layered on top of the grounding rules, not in place of them.
    expect(system).toContain('Every fact you state must come from a tool result');
  });

  it('carries the conversation so far, before the new question', async () => {
    await request({
      method: 'POST',
      url: '/api/v1/ai/ask',
      user: owner,
      payload: {
        message: 'And last month?',
        history: [
          { role: 'user', content: 'How much did we spend on fuel this month?' },
          { role: 'assistant', content: 'You spent ₹42,000 on fuel this month.' },
        ],
      },
    });

    expect(seen[0]!.turns.map((turn) => [turn.role, turn.content])).toEqual([
      ['user', 'How much did we spend on fuel this month?'],
      ['assistant', 'You spent ₹42,000 on fuel this month.'],
      ['user', 'And last month?'],
    ]);
  });

  it('refuses an oversized history', async () => {
    const history = Array.from({ length: 11 }, (_, index) => ({
      role: 'user',
      content: `question ${index}`,
    }));
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/ai/ask',
      user: owner,
      payload: { message: 'Hello there', history },
    });
    expect(status).toBe(400);
  });

  it('keeps the driver terminal brief and operational', async () => {
    const auth = await buildAuthContext(owner.id, 'test-session', fleet.id);
    await askWithTools(auth, fleet.id, 'Where is my next stop?');

    const system = seen[0]!.system;
    expect(system).not.toContain('Your voice:');
    expect(system).toContain('Be brief and operational');
  });
});
