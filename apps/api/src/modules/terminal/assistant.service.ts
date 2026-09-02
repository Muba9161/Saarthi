import {
  TerminalVoiceIntent,
  classifyVoiceUtterance,
  type TerminalAskInput,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { askWithTools } from '../ai/copilot.service';
import { driverAuthForSession } from './terminal.service';
import type { SessionRecord } from './session.view';

/**
 * "Hey Saarthi" — the in-cab assistant.
 *
 * A thin, deliberately boring layer over the existing copilot. It adds four
 * things and no intelligence of its own:
 *
 *  1. **The driver's own authorisation.** The question is answered under an
 *     `AuthContext` built from the driver signed on to this terminal, loaded
 *     fresh from the database. A driver whose account was suspended after they
 *     signed on gets refused by every tool, without this module knowing
 *     anything about suspension.
 *
 *  2. **Emergency short-circuiting.** "Hey Saarthi, SOS" never reaches a
 *     language model. It is classified locally and returned as an intent for
 *     the terminal to act on, because the difference between an emergency
 *     handled in 300 ms and one handled after a model round trip is the whole
 *     point of having the phrase.
 *
 *  3. **A budget.** A tablet with a stuck wake-word detector would otherwise
 *     spend a fleet's AI quota overnight, and the driver would find out when
 *     they asked a real question in the morning.
 *
 *  4. **Length discipline while moving.** A spoken answer to a driver at
 *     80 km/h is not a paragraph.
 *
 * What it deliberately does *not* add is a second tool layer, a second
 * provider, a second prompt system or a way around the permission checks. The
 * assistant can only see what the driver can see.
 */

const assistantLogger = logger.child({ module: 'terminal-assistant' });

/**
 * Questions one session may ask per hour.
 *
 * Generous for a person — nobody asks their truck sixty questions in an hour —
 * and tight enough that a malfunctioning detector cannot run up a bill.
 */
const QUESTIONS_PER_SESSION_PER_HOUR = 60;

export interface TerminalAnswer {
  intent: TerminalVoiceIntent;
  /** Present for ASK. Null when the intent is handled on the device instead. */
  answer: string | null;
  /**
   * What the terminal should do, beyond speaking.
   *
   * `TRIGGER_SOS` is the one that matters: the terminal runs its own emergency
   * workflow against the existing device SOS endpoint rather than waiting for
   * anything here.
   */
  action: 'NONE' | 'TRIGGER_SOS' | 'DISMISS';
  /** Tool calls that produced the answer, for the diagnostics screen. */
  sources: { tool: string; records: number; cached: boolean; error: string | null }[];
  caveats: string[];
  latencyMs: number;
}

/**
 * How long an answer may be, given what the vehicle is doing.
 *
 * Not a formatting preference. A driver reading a screen at speed is a driver
 * not reading the road, so a moving vehicle gets an answer short enough to be
 * spoken and understood in one pass.
 */
function lengthGuidance(moving: boolean, spoken: boolean): string {
  if (moving) {
    return 'The vehicle is MOVING. Answer in one short sentence that can be spoken aloud. Do not list options, do not use formatting, and do not ask the driver to look at the screen.';
  }
  if (spoken) {
    return 'This question was spoken aloud and the answer will be read out. Keep it to two sentences of plain prose with no formatting.';
  }
  return 'Keep the answer to a few short lines. The reader is in a vehicle cab.';
}

/**
 * Answer a question from the terminal.
 *
 * `session` is the *authorised* session — the caller has already established
 * that an approved driver is signed on. This does not re-derive that, but it
 * does rebuild their authorisation from scratch, so a revocation between sign-on
 * and question takes effect immediately.
 */
export async function ask(
  session: SessionRecord,
  input: TerminalAskInput,
): Promise<TerminalAnswer> {
  const startedAt = Date.now();

  // --- Emergency first, before anything expensive -------------------------
  const intent = classifyVoiceUtterance(input.question);

  if (intent === TerminalVoiceIntent.SOS) {
    assistantLogger.warn(
      { sessionId: session.id, vehicleId: session.vehicleId },
      'Emergency intent recognised from a terminal utterance',
    );
    return {
      intent,
      // A fixed sentence, not a generated one. An emergency response must not
      // depend on a model being reachable, and it must say the same thing every
      // time so a frightened person recognises it.
      answer: 'Raising an emergency now. Stay where you are and stay safe.',
      action: 'TRIGGER_SOS',
      sources: [],
      caveats: [],
      latencyMs: Date.now() - startedAt,
    };
  }

  if (intent === TerminalVoiceIntent.CANCEL) {
    return {
      intent,
      answer: null,
      action: 'DISMISS',
      sources: [],
      caveats: [],
      latencyMs: Date.now() - startedAt,
    };
  }

  // --- Budget -------------------------------------------------------------
  const budgetKey = cacheKeys.terminalAssistantBudget(session.id);
  const used = (await cache.get<number>(budgetKey)) ?? 0;
  if (used >= QUESTIONS_PER_SESSION_PER_HOUR) {
    throw errors.rateLimited(
      'The assistant has answered a lot of questions in the last hour. Try again shortly.',
    );
  }
  await cache.set(budgetKey, used + 1, cacheTtl.terminalAssistantBudget);

  // --- The driver's own authorisation, loaded fresh -----------------------
  const auth = await driverAuthForSession({
    id: session.id,
    driverUserId: session.driverUserId,
    organizationId: session.organizationId,
    status: session.status as never,
  });

  /*
   * Context the model cannot get wrong, prepended to the question.
   *
   * Deliberately not "system prompt" material: the copilot owns its own system
   * prompt, and a second one competing with it is how a model ends up ignoring
   * both. This is situational framing on the user turn — where the driver is,
   * what they are in, and how long the answer may be.
   */
  const framing = [
    `[Saarthi Terminal · vehicle ${session.vehicle.registrationNumber}]`,
    input.latitude !== undefined && input.longitude !== undefined
      ? `[Driver position: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}]`
      : '[Driver position: not available]',
    lengthGuidance(input.moving ?? false, input.spokenBy === 'VOICE'),
    'Use the terminal tools for anything about "my vehicle". Never state a live reading that a tool did not return.',
  ].join('\n');

  const answer = await askWithTools(
    auth,
    session.organizationId,
    `${framing}\n\nDriver asks: ${input.question}`,
  );

  assistantLogger.info(
    {
      sessionId: session.id,
      vehicleId: session.vehicleId,
      spokenBy: input.spokenBy,
      tools: answer.toolCalls.map((call) => call.tool),
      latencyMs: answer.latencyMs,
    },
    'Terminal assistant answered',
  );

  return {
    intent,
    answer: answer.answer,
    action: 'NONE',
    sources: answer.toolCalls.map((call) => ({
      tool: call.tool,
      records: call.recordCount,
      cached: call.cached,
      error: call.error,
    })),
    caveats: answer.caveats,
    latencyMs: Date.now() - startedAt,
  };
}
