import { z } from 'zod';
import {
  hasAnyPermission,
  Permission,
  REQUIREMENT_KIND_LABELS,
  RequirementKind,
  VerificationStepState,
  type CommerceInterpretation,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { interpret } from '../../commerce/interpret.service';
import { getPayoutAccount } from '../../marketplace-finance/payout-account.service';
import { getCompletion } from '../../profiles/profile.service';
import { getVerificationCenter } from '../../verification-center/verification-center.service';
import { HELP_TOPICS, HELP_TOPIC_KEYS } from '../assistant/help-guide';
import { ResultBasis, type AiTool, type AssistantAction, type ToolResult } from './tool.types';

/**
 * Saarthi Mitra's hands.
 *
 * These tools let Mitra *prepare* work — a requirement read from one line, a
 * product listing, the next verification step — and never do it. Every one
 * answers with an action: a button that opens the real screen, prefilled
 * where there is a draft, where the person reviews and confirms under the
 * screen's own validation and permissions. Nothing here writes a record, and
 * nothing here starts a payment.
 */

function result<T>(
  data: T,
  actions: AssistantAction[],
  options: { basis?: ResultBasis; caveats?: string[]; recordCount?: number } = {},
): ToolResult<T> {
  return {
    data,
    basis: options.basis ?? ResultBasis.RULE_RESULT,
    references: [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 1,
    actions,
  };
}

/** What the engine read, in words the model can relay. */
function describeReading(reading: CommerceInterpretation) {
  const labelOf = (key: string): string =>
    reading.fields.find((field) => field.key === key)?.label ??
    (
      { pricePerUnit: 'price', stock: 'stock', quantity: 'quantity', unit: 'unit' } as Record<
        string,
        string
      >
    )[key] ??
    key;

  return {
    category: reading.category?.isFallback
      ? null
      : (reading.category?.path.map((node) => node.name).join(' > ') ?? null),
    details: Object.fromEntries(
      Object.entries(reading.attributes).map(([key, value]) => [labelOf(key), value]),
    ),
    quantity: reading.commercial.quantity,
    unit: reading.commercial.unit,
    price: reading.commercial.pricePerUnit,
    stock: reading.commercial.stock,
    pickupCity: reading.commercial.pickupCity,
    deliveryCity: reading.commercial.deliveryCity,
    neededWithinDays: reading.commercial.requiredWithinDays,
    stillNeeded: reading.missing.map(labelOf),
  };
}

const requirementKinds = [
  RequirementKind.MATERIAL_SUPPLY,
  RequirementKind.FREIGHT_TRANSPORT,
  RequirementKind.CAB_HIRE,
  RequirementKind.TOUR_PACKAGE,
] as const;

export const ASSISTANT_TOOLS: AiTool[] = [
  {
    name: 'get_help_guide',
    description:
      'How to do something in Saarthi, with the steps and a button to the right screen. Topics: ' +
      Object.entries(HELP_TOPICS)
        .map(([key, topic]) => `${key} (${topic.summary})`)
        .join('; ') +
      '.',
    input: z.object({ topic: z.enum(HELP_TOPIC_KEYS) }),
    permissions: [],
    category: 'assistant',
    cacheTtlSeconds: 0,
    handler: async ({ auth }, input) => {
      const topic = HELP_TOPICS[(input as { topic: keyof typeof HELP_TOPICS }).topic];
      const permissions: readonly Permission[] = topic.permissions;
      if (permissions.length > 0 && !hasAnyPermission(auth.permissions, [...permissions])) {
        return result({ available: false, title: topic.title }, [], {
          caveats: ['This is not something this account can do.'],
          recordCount: 0,
        });
      }
      return result({ available: true, title: topic.title, steps: topic.steps }, [
        { label: topic.screen.label, path: topic.screen.path },
      ]);
    },
  },

  {
    name: 'get_account_setup_status',
    description:
      'What is still left to set up on this account: profile completion, identity and business verification steps, the payout bank account, and plan or trial status with vehicle capacity. Use for "what should I do next", "am I verified", "set up my account".',
    input: z.object({}),
    permissions: [],
    category: 'assistant',
    cacheTtlSeconds: 0,
    handler: async ({ auth, organizationId }) => {
      const caveats: string[] = [];
      const actions: AssistantAction[] = [];

      const [profile, verification, payout, vehicles] = await Promise.all([
        getCompletion(auth).catch(() => {
          caveats.push('Profile completion could not be read.');
          return null;
        }),
        hasAnyPermission(auth.permissions, [Permission.VERIFICATION_READ])
          ? getVerificationCenter(auth, {}).catch(() => {
              caveats.push('Verification status could not be read.');
              return null;
            })
          : Promise.resolve(null),
        hasAnyPermission(auth.permissions, [Permission.PAYOUT_ACCOUNT_MANAGE])
          ? getPayoutAccount(organizationId).catch(() => {
              caveats.push('Bank account status could not be read.');
              return null;
            })
          : Promise.resolve(null),
        prisma.truck.count({ where: { organizationId, archivedAt: null } }),
      ]);

      const pendingSteps =
        verification?.steps.filter(
          (step) => step.actionable && step.state !== VerificationStepState.VERIFIED,
        ) ?? [];

      if (profile && profile.percent < 100)
        actions.push({ label: 'Complete my profile', path: '/settings/profile' });
      if (pendingSteps.length > 0)
        actions.push({ label: 'Continue verification', path: '/verification' });
      if (payout && !payout.usable)
        actions.push({ label: 'Connect bank account', path: '/settings/payouts' });

      const subscription = auth.subscription;
      const vehicleLimit = subscription?.limits.maxTrucks ?? null;

      return result(
        {
          profile: profile
            ? {
                percentComplete: profile.percent,
                missing: profile.sections
                  .filter((section) => section.missingRequired.length > 0)
                  .map((section) => ({ section: section.title, fields: section.missingRequired })),
              }
            : null,
          verification: verification
            ? {
                overall: verification.overall,
                pending: pendingSteps.map((step) => ({
                  step: step.title,
                  state: step.state,
                  reason: step.reason,
                })),
              }
            : null,
          bankAccount: payout ? { status: payout.status, usable: payout.usable } : null,
          plan: subscription
            ? {
                name: subscription.planName,
                onFreeTrial: subscription.trialing,
                active: subscription.active,
                vehicles: { used: vehicles, limit: vehicleLimit },
              }
            : null,
        },
        actions,
        { basis: ResultBasis.SOURCE_DATA, caveats },
      );
    },
  },

  {
    name: 'draft_requirement',
    description:
      'Prepare a customer requirement from what the person said, e.g. "25 tons of river sand to Lucknow in 3 days". Reads the category, details, quantity, places and deadline, and returns a button that opens the requirement form prefilled for them to review and post. It does NOT post anything. kind defaults to MATERIAL_SUPPLY; use FREIGHT_TRANSPORT when they already own the goods and need a truck, CAB_HIRE for a cab, TOUR_PACKAGE for a tour.',
    input: z.object({
      text: z.string().trim().min(2).max(500),
      kind: z.enum(requirementKinds).optional(),
    }),
    permissions: [Permission.REQUIREMENTS_CREATE],
    category: 'assistant',
    cacheTtlSeconds: 0,
    handler: async ({ auth }, input) => {
      const { text, kind = RequirementKind.MATERIAL_SUPPLY } = input as {
        text: string;
        kind?: RequirementKind;
      };
      const action: AssistantAction = {
        label: 'Review & post requirement',
        path: '/requirements/new',
        draft: { text, kind },
      };

      if (kind !== RequirementKind.MATERIAL_SUPPLY) {
        return result({ kind: REQUIREMENT_KIND_LABELS[kind], posted: false }, [action]);
      }
      const reading = await interpret(auth, { text, scope: 'REQUIREMENT' });
      return result(
        { kind: REQUIREMENT_KIND_LABELS[kind], posted: false, ...describeReading(reading) },
        [action],
      );
    },
  },

  {
    name: 'draft_product',
    description:
      'Prepare a seller product listing from what the person said, e.g. "teak 6-seater dining table ₹25,000, 5 in stock". Reads the category, details, price and stock, and returns a button that opens the add-product form prefilled for them to review and publish. It does NOT publish anything.',
    input: z.object({ text: z.string().trim().min(2).max(500) }),
    permissions: [Permission.MATERIALS_MANAGE],
    category: 'assistant',
    cacheTtlSeconds: 0,
    handler: async ({ auth }, input) => {
      const { text } = input as { text: string };
      const reading = await interpret(auth, { text, scope: 'PRODUCT' });
      return result({ published: false, ...describeReading(reading) }, [
        { label: 'Review & publish product', path: '/supplier/materials/new', draft: { text } },
      ]);
    },
  },
];
