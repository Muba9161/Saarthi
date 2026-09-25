import { randomBytes } from 'node:crypto';
import {
  RoleName,
  SALESMAN_SIGNUP_LINK_HOURS,
  SalesmanStatus,
  UserStatus,
  maskEmail,
  normalizeGodId,
  type SalesmanSignupInput,
  type SalesmanSignupStarted,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { passwordHasher } from '../../auth/password';
import { generateOpaqueToken } from '../../auth/tokens';
import { requireGodWebProvider } from '../../providers/godweb';
import { actionEmail } from '../../providers/email/action-email';
import { emailConfigured, sendEmail } from '../../providers/email/smtp-email';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { grantSalesmanRole, recordGodWebOutcome } from './salesman.service';

/**
 * A salesperson signing themselves up with their GODID.
 *
 * No administrator is involved. The salesperson types their GODID; Saarthi
 * asks GODWeb who that is, creates or refreshes their salesman profile from
 * GODWeb's answer, and emails a set-password link to the address **GODWeb**
 * holds for them. Choosing the password on the reset screen completes the
 * signup (see `resetPassword`, which activates a pending account).
 *
 * The email is the whole security model. A GODID is not a secret — it is in
 * every referral link the salesperson has ever shared — so typing one proves
 * nothing, and the account only becomes usable by whoever can read the GODWeb
 * mailbox. The address is never taken from the form.
 */

const signupLogger = logger.child({ module: 'sales:signup' });

const notAvailable = () =>
  errors.providerNotConfigured(
    'godweb',
    'Salesperson signup is not available yet. Please try again later or contact Saarthi.',
  );

/** First word as the first name, the rest as the last — GODWeb gives one display name. */
function splitName(name: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? 'Saarthi', lastName: parts.slice(1).join(' ') || 'Salesperson' };
}

/** The Saarthi login this salesperson will use — their existing one if they have it. */
async function resolveLogin(input: {
  linkedUserId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
}): Promise<{ id: string; email: string; firstName: string }> {
  const select = { id: true, email: true, firstName: true } as const;

  if (input.linkedUserId) {
    const linked = await prisma.user.findUnique({ where: { id: input.linkedUserId }, select });
    if (linked) return linked;
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select });
  if (existing) return existing;

  // A phone GODWeb holds is only kept if no other Saarthi account uses it.
  const phoneTaken = input.phone
    ? Boolean(await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } }))
    : true;

  // No usable password until the salesperson chooses one from the email.
  const passwordHash = await passwordHasher.hash(randomBytes(32).toString('hex'));
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        phone: phoneTaken ? null : input.phone,
        passwordHash,
        ...splitName(input.name),
        status: UserStatus.PENDING,
      },
      select,
    });
  } catch (error) {
    // Two signups for the same person at once — use the account the other made.
    if (isUniqueViolation(error)) {
      const raced = await prisma.user.findUnique({ where: { email: input.email }, select });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function startSalesmanSignup(
  input: SalesmanSignupInput,
  appUrl: string,
): Promise<SalesmanSignupStarted> {
  if (!emailConfigured()) throw notAvailable();
  let provider;
  try {
    provider = requireGodWebProvider();
  } catch {
    throw notAvailable();
  }

  const godId = normalizeGodId(input.godId);
  const outcome = await provider.validateGodId(godId);

  if (!outcome.found || !outcome.salesperson) {
    throw errors.businessRule(
      'GODWeb does not recognise that GODID. Check it and try again, or contact your GODWeb administrator.',
    );
  }
  const person = outcome.salesperson;
  if (!person.active) {
    throw errors.businessRule(
      'GODWeb reports this GODID as not active, so it cannot sign up. Contact your GODWeb administrator.',
    );
  }
  const email = person.email?.trim().toLowerCase();
  if (!email) {
    throw errors.businessRule(
      'GODWeb has no email address for this GODID. Ask your GODWeb administrator to add one, then try again.',
    );
  }

  // The Saarthi mirror of this GODWeb identity, created on first signup.
  const profile =
    (await prisma.salesmanProfile.findUnique({ where: { godId } })) ??
    (await prisma.salesmanProfile
      .create({ data: { godId, status: SalesmanStatus.PENDING_VERIFICATION } })
      .catch(async (error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
        return prisma.salesmanProfile.findUniqueOrThrow({ where: { godId } });
      }));

  const user = await resolveLogin({
    linkedUserId: profile.userId,
    email,
    name: person.name,
    phone: person.phone,
  });

  if (profile.userId !== user.id) {
    try {
      await prisma.salesmanProfile.update({ where: { id: profile.id }, data: { userId: user.id } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw errors.conflict(
          'The Saarthi account for this email is already linked to a different GODID. Contact Saarthi support.',
        );
      }
      throw error;
    }
  }
  await grantSalesmanRole(user.id);

  // GODWeb's answer is the verification — the same handling an administrator's check gets.
  await recordGodWebOutcome(profile, outcome, null);

  const { token, hash } = generateOpaqueToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + SALESMAN_SIGNUP_LINK_HOURS * 3_600_000),
    },
  });

  // The ordinary reset screen, told to word itself as finishing a signup.
  const link = `${appUrl.replace(/\/$/, '')}/reset-password?token=${token}&setup=salesman`;
  await sendEmail(
    actionEmail({
      to: email,
      subject: 'Finish setting up your Saarthi salesperson account',
      greeting: `Hello ${person.name ?? user.firstName},`,
      intro:
        `Your GODID ${godId} is verified. Choose a password to finish setting up your Saarthi ` +
        `salesperson account. You will sign in with ${user.email}.`,
      actionLabel: 'Set my password',
      actionUrl: link,
      footnote:
        `This link works once and expires in ${SALESMAN_SIGNUP_LINK_HOURS} hours. If you did not ` +
        'ask to join Saarthi, you can ignore this email.',
    }),
  );

  await recordAudit({
    action: AuditAction.SALESMAN_SELF_SIGNUP_STARTED,
    entityType: 'SalesmanProfile',
    entityId: profile.id,
    actorUserId: null,
    after: { godId, role: RoleName.SALESMAN, reference: outcome.providerReference },
  });
  signupLogger.info({ godId }, 'Salesperson signup link sent');

  return { maskedEmail: maskEmail(email) ?? email, expiresInHours: SALESMAN_SIGNUP_LINK_HOURS };
}
