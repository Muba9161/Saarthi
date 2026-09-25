import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { aiProvider } from '../../providers/ai';
import { supportsTools, type AiTurn } from '../../providers/ai/ai.provider';
import { authorizedTools, executeTool, toolSpecifications } from './tools/registry';
import { routeTools } from './tools/tool-routing';
import { MITRA_QUESTION_OPERATION, TERMINAL_ASSISTANT_OPERATION } from './ai-usage';
import type { AssistantAction, RecordedToolCall } from './tools/tool.types';
import type { AuthContext } from '../../auth/context';

/**
 * The tool-calling copilot.
 *
 * The loop is: ask the model, run whatever authorised tools it requested, hand
 * the results back, repeat until it answers or the budget runs out. Three
 * limits bound it, and each exists for a different failure:
 *
 *   • **Iterations** stop a model that keeps asking for one more thing. Without
 *     a cap, a single question can cost twenty round trips.
 *   • **Tool calls per turn** stop a model that requests forty tools at once.
 *   • **The daily quota**, checked before any of this starts, is the plan's.
 *
 * What the model never gets is a way around the permission layer. Every tool it
 * can see was filtered against the caller's own grants before the conversation
 * began, and every call is re-checked at execution.
 */

const copilotLogger = logger.child({ module: 'ai:copilot' });

const MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS_PER_TURN = 5;

export interface CopilotAnswer {
  answer: string;
  /** Every tool that ran, with what it returned. The provenance record. */
  toolCalls: RecordedToolCall[];
  references: { type: string; id: string; label: string }[];
  /** Caveats gathered from the tools, surfaced rather than summarised away. */
  caveats: string[];
  /** Screens Mitra offers to open — prefilled drafts, guides, the next setup step. */
  actions: AssistantAction[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  iterations: number;
  /** True when the loop stopped on a limit rather than on a complete answer. */
  truncated: boolean;
  generatedAt: string;
}

/**
 * How the copilot speaks.
 *
 * `companion` is the chat screen: warm, human, glad about good news and
 * concerned about bad, in the person's own language. `terminal` is a driver's
 * in-cab assistant, where every extra word is attention taken off the road, so
 * it stays brief and plain.
 */
export type CopilotVoice = 'companion' | 'terminal';

export interface AskOptions {
  voice?: CopilotVoice;
  /** Earlier messages, oldest first. Context only — never a source of figures. */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

function voiceGuidance(voice: CopilotVoice, firstName: string): string[] {
  if (voice === 'terminal') {
    return ['- Be brief and operational. The reader is running a business between phone calls.'];
  }
  return [
    '',
    'Your voice:',
    `- You are Saarthi Mitra, a warm and switched-on companion to ${firstName}. Talk like a trusted`,
    '  colleague who genuinely cares how their business is going - never like a report.',
    `- Use their name ("${firstName}") now and then, not in every message.`,
    '- React the way a person would. Celebrate good news ("That is a great week!"), show real',
    '  concern about problems ("A breakdown on the highway is stressful - here is what I can see"),',
    '  and reassure them plainly when everything is fine.',
    '- Reply in the language they wrote in: English, Hindi or Hinglish.',
    '- Keep it conversational and easy to read: short sentences, a short list when there are',
    '  several items, **bold** for the one thing that matters most. At most one emoji, only when',
    '  it fits the mood, and never beside bad news or anything about safety.',
    '- When there is a natural next step, end by offering it in one short line.',
    '- Warmth never outranks accuracy: every rule above still applies in full. You are an AI',
    '  assistant, and you say so honestly if asked.',
    '- Earlier messages in this conversation are context for what they mean. Any figure you give',
    '  must come from a tool result in this turn - check again rather than repeating a number',
    '  from an earlier message.',
    '',
    'What you can do for them:',
    '- "How do I..." questions: use get_help_guide and walk them through the steps it returns.',
    '- "What should I do next / am I verified / set up my account": use get_account_setup_status.',
    '- When they want to post a requirement or list a product, use draft_requirement or',
    '  draft_product with their own words. Tell them what you understood and what is still',
    '  missing, and that the button under your reply opens it ready to review.',
    '- You never save, post, publish, pay or change anything yourself. Every change is made by',
    '  them on the screen your button opens. Never say something was posted or saved.',
    '- You never start a payment. For verification fees, top-ups or trackers, show them the',
    '  steps and the screen, and let them decide there.',
  ];
}

function systemPrompt(
  auth: AuthContext,
  organizationName: string,
  voice: CopilotVoice,
): string {
  return [
    'You are the Saarthi Fleet Copilot, embedded in a fleet management platform used by',
    'transport operators in India.',
    '',
    'How you work:',
    '- You have no database access. Every fact you state must come from a tool result in this',
    '  conversation. If no tool returned it, you do not know it.',
    '- If the tools do not answer the question, say exactly that, and say which record would',
    '  need to exist for you to answer. Never fill a gap with a plausible number.',
    '- Tool results carry a "basis" and sometimes "caveats". Pass caveats on to the user in',
    '  your own words. A total that excludes unconfirmed records is not a complete total, and',
    '  the user must be told so.',
    '- Distinguish what was recorded from what Saarthi calculated from it, and from your own',
    '  reading of the situation. Never present an inference as a record.',
    '- Some vehicles carry a phone running the Saarthi Device app in place of fitted hardware.',
    '  Its position, speed and motion are real measurements; its RPM, fuel, coolant temperature',
    '  and battery voltage are produced by a simulator, because a phone has no connection to the',
    '  engine. Tool results separate the two under "measured" and "simulated". Never merge them,',
    '  never average across them, and always say which one a figure came from. Telling an owner',
    '  their coolant ran at 112 °C, when a test app invented the number, could put a working',
    '  truck in a workshop for a fault that does not exist.',
    '- Use Indian currency formatting and refer to vehicles by registration number.',
    '- Never recommend an action that trades a driver’s safety for time or money.',
    '',
    `The person asking is a ${auth.organization?.membershipRole ?? auth.user.roles[0] ?? 'user'} at ${organizationName}.`,
    'They can only see their own organisation’s data, and so can you.',
    ...voiceGuidance(voice, auth.user.firstName || 'there'),
  ].join('\n');
}

/**
 * Answer a question using authorised tools.
 *
 * Returns the answer *and* the full record of how it was produced. The
 * provenance is not an optional extra: an operator deciding whether to trust
 * "three vehicles need service" needs to see that it came from
 * `get_fleet_service_status` over eleven vehicles, and not from a model's
 * impression of the fleet.
 */
export async function askWithTools(
  auth: AuthContext,
  organizationId: string,
  question: string,
  options: AskOptions = {},
): Promise<CopilotAnswer> {
  const voice = options.voice ?? 'terminal';
  if (!supportsTools(aiProvider)) {
    throw errors.providerNotConfigured(
      'ai',
      'The configured AI provider does not support tool calling on this environment.',
    );
  }

  const startedAt = Date.now();

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  // The chat screen offers only the tool groups the question is about, which
  // keeps each model call small; the terminal keeps its full, fixed set.
  const tools =
    voice === 'companion'
      ? routeTools(authorizedTools(auth), [
          question,
          ...(options.history ?? []).filter((message) => message.role === 'user').slice(-1).map((message) => message.content),
        ])
      : // Mitra's guide and drafts belong to the chat screen, not the cab.
        authorizedTools(auth).filter((tool) => tool.category !== 'assistant');
  const specifications = toolSpecifications(tools);

  const turns: AiTurn[] = [
    ...(options.history ?? []).map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: question },
  ];
  const recorded: RecordedToolCall[] = [];
  const references: CopilotAnswer['references'] = [];
  const actions: AssistantAction[] = [];
  const caveats = new Set<string>();

  let tokensIn = 0;
  let tokensOut = 0;
  let iterations = 0;
  let answer: string | null = null;
  let truncated = false;
  let provider = aiProvider.name;
  let model = aiProvider.model;

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;

    const generation = await aiProvider.generate({
      system: systemPrompt(auth, organization?.name ?? 'your organisation', voice),
      turns,
      tools: specifications,
    });

    tokensIn += generation.tokensIn;
    tokensOut += generation.tokensOut;
    provider = generation.provider;
    model = generation.model;

    if (generation.toolCalls.length === 0) {
      answer = generation.content;
      truncated = generation.finishReason === 'length';
      break;
    }

    // Record what the model asked for before trimming, so an over-eager request
    // is visible in the provenance rather than silently discarded.
    const requested = generation.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
    if (generation.toolCalls.length > requested.length) {
      copilotLogger.debug(
        { requested: generation.toolCalls.length, executed: requested.length },
        'Trimmed tool calls for one turn',
      );
    }

    turns.push({
      role: 'assistant',
      ...(generation.content ? { content: generation.content } : {}),
      toolCalls: requested,
    });

    for (const call of requested) {
      const execution = await executeTool(auth, organizationId, call.name, call.arguments);
      recorded.push(execution.record);

      for (const reference of execution.record.references) {
        if (!references.some((entry) => entry.type === reference.type && entry.id === reference.id)) {
          references.push(reference);
        }
      }
      for (const caveat of execution.record.caveats) caveats.add(caveat);
      for (const action of execution.record.actions) {
        if (!actions.some((entry) => entry.path === action.path)) actions.push(action);
      }

      turns.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        // The error is handed to the model as data, so it can say "I could not
        // check that" rather than producing an answer with a hole in it.
        toolResult: execution.result ?? { error: execution.record.error },
      });
    }
  }

  if (answer === null) {
    truncated = true;
    answer =
      'I could not finish working through that question within the tool budget for a single ' +
      'request. Try asking about one thing at a time — a single vehicle, or a single figure.';
  }

  const result: CopilotAnswer = {
    answer,
    toolCalls: recorded,
    references: references.slice(0, 12),
    caveats: [...caveats],
    // A reply with more than a few buttons is a menu, not an answer.
    actions: actions.slice(0, 3),
    provider,
    model,
    tokensIn,
    tokensOut,
    latencyMs: Date.now() - startedAt,
    iterations,
    truncated,
    generatedAt: new Date().toISOString(),
  };

  await recordProvenance(auth, organizationId, question, result, voice);
  return result;
}

/**
 * Persist how an answer was produced.
 *
 * Written to `AiUsage` (the cost and volume record) and to the conversation
 * message metadata (the audit trail). Someone asking six months later why the
 * assistant said a truck was overdue can see which tools ran, over how many
 * records, and under whose permissions.
 */
async function recordProvenance(
  auth: AuthContext,
  organizationId: string,
  question: string,
  result: CopilotAnswer,
  voice: CopilotVoice,
): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        organizationId,
        userId: auth.user.id,
        provider: result.provider,
        model: result.model,
        operation: voice === 'terminal' ? TERMINAL_ASSISTANT_OPERATION : MITRA_QUESTION_OPERATION,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        success: !result.truncated,
      },
    });
  } catch (error) {
    // Provenance is important, but never important enough to fail the answer
    // the user is waiting for.
    copilotLogger.warn({ err: error }, 'Could not record AI usage');
  }

  copilotLogger.info(
    {
      organizationId,
      userId: auth.user.id,
      question: question.slice(0, 120),
      tools: result.toolCalls.map((call) => call.tool),
      records: result.toolCalls.reduce((sum, call) => sum + call.recordCount, 0),
      iterations: result.iterations,
      latencyMs: result.latencyMs,
    },
    'Copilot answered',
  );
}

/**
 * A short human sentence describing what an answer was built from.
 *
 * Spec-shaped: "Based on 42 trips, 18 fuel transactions, 6 service records."
 * Built from the tool record rather than from the model's own account of what
 * it looked at, which is not evidence of anything.
 */
export function provenanceSummary(result: CopilotAnswer): string {
  const successful = result.toolCalls.filter((call) => call.error === null);
  if (successful.length === 0) return 'No fleet records were available for this answer.';

  const parts = successful
    .filter((call) => call.recordCount > 0)
    .map((call) => `${call.recordCount} ${call.tool.replace(/^get_/, '').replace(/_/g, ' ')}`);

  if (parts.length === 0) {
    return `Checked ${successful.length} source${successful.length === 1 ? '' : 's'}; none held any records.`;
  }

  return `Based on ${parts.join(', ')}.`;
}

export const COPILOT_LIMITS = {
  maxIterations: MAX_ITERATIONS,
  maxToolCallsPerTurn: MAX_TOOL_CALLS_PER_TURN,
} as const;

/** Re-exported so the routes can list what a caller may ask about. */
export { authorizedTools };
