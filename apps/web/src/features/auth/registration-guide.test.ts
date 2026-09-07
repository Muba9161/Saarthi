import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_NAME_REQUIRED_ROLES,
  RoleName,
  registerSchema,
  registrableRoleSchema,
} from '@saarthi/shared';
import { ACCOUNT_GUIDES, guideForRole } from './registration-guide';

/**
 * The guided flow is only as good as its coverage and its wiring.
 *
 * Coverage: a role added to `registrableRoleSchema` without a guide beside it
 * would silently fall back to the fleet owner's questions, and somebody
 * registering as whatever the new type is would be asked the wrong ones with
 * nothing anywhere reporting a problem.
 *
 * Wiring: each question names the form fields it owns, and the flow refuses to
 * advance until `form.trigger` passes for exactly those. A question that named
 * no field would wave any answer through; a required field named by no
 * question would never be asked at all and would fail only on the final
 * submit, ten screens from the box that should have caught it.
 */

const REGISTRABLE_ROLES = registrableRoleSchema.options;

/** Fields the guided flow is not responsible for asking. */
const ASKED_ELSEWHERE = new Set([
  // Their own screens, before the per-role questions begin.
  'preferredLanguage',
  'role',
  // The review screen owns the terms.
  'acceptedTerms',
]);

describe('registration guides', () => {
  it('covers every role the registration form offers', () => {
    const covered = new Set(ACCOUNT_GUIDES.map((guide) => guide.role));
    const missing = REGISTRABLE_ROLES.filter((role) => !covered.has(role));

    expect(missing, `roles with no guide: ${missing.join(', ')}`).toEqual([]);
  });

  it('holds exactly one guide per role', () => {
    expect(ACCOUNT_GUIDES).toHaveLength(REGISTRABLE_ROLES.length);

    for (const role of REGISTRABLE_ROLES) {
      expect(guideForRole(role).role).toBe(role);
    }
  });

  it('asks for every field the registration schema requires', () => {
    // Walking the schema rather than a list transcribed from it: a
    // transcribed list is exactly what goes stale when a field is added.
    const required = Object.entries(registerSchema._def.schema.shape)
      .filter(([name, field]) => !ASKED_ELSEWHERE.has(name) && !field.isOptional())
      .map(([name]) => name);

    for (const guide of ACCOUNT_GUIDES) {
      const asked = new Set(guide.questions.flatMap((question) => question.fields));
      const unasked = required.filter((name) => !asked.has(name as never));

      expect(unasked, `${guide.role} never asks for: ${unasked.join(', ')}`).toEqual([]);
    }
  });

  it('gives a driver the invite code and licence, and nobody else', () => {
    for (const guide of ACCOUNT_GUIDES) {
      const ids = guide.questions.map((question) => question.id);
      const driverOnly = ids.filter((id) => id === 'fleet-code' || id === 'licence');

      expect(driverOnly, `${guide.role} asks ${driverOnly.join(' and ')}`).toEqual(
        guide.role === RoleName.DRIVER ? ['fleet-code', 'licence'] : [],
      );
    }
  });

  it('marks the organization question optional for exactly the roles the schema lets off', () => {
    // The one field whose requirement genuinely differs between account types
    // — and the one a customer is most likely to invent an answer for if the
    // flow insists on it when the schema does not.
    for (const guide of ACCOUNT_GUIDES) {
      const question = guide.questions.find((entry) => entry.id === 'organization');
      if (guide.role === RoleName.DRIVER) {
        expect(question, 'a driver creates no organization').toBeUndefined();
        continue;
      }

      const mandatory = ORGANIZATION_NAME_REQUIRED_ROLES.includes(guide.role);
      expect(Boolean(question?.optional), `${guide.role} organization question`).toBe(!mandatory);
    }
  });

  it('never asks a required question that can be skipped', () => {
    for (const guide of ACCOUNT_GUIDES) {
      for (const question of guide.questions) {
        // A Skip button beside a field the resolver will reject is a dead end:
        // it walks somebody to the review screen and fails there instead.
        if (!question.optional) continue;
        const owned = question.fields.map(String);
        const stillRequired = owned.filter(
          (name) =>
            !ASKED_ELSEWHERE.has(name) &&
            !registerSchema._def.schema.shape[
              name as keyof typeof registerSchema._def.schema.shape
            ]?.isOptional(),
        );

        expect(
          stillRequired,
          `${guide.role}/${question.id} can be skipped but ${stillRequired.join(', ')} is required`,
        ).toEqual([]);
      }
    }
  });

  it('gives every guide something to say in each section', () => {
    for (const guide of ACCOUNT_GUIDES) {
      expect(guide.chooseIf.length, `${guide.role} chooseIf`).toBeGreaterThan(0);
      expect(guide.prepare.length, `${guide.role} prepare`).toBeGreaterThan(0);
      expect(guide.unlocks.length, `${guide.role} unlocks`).toBeGreaterThan(0);
      expect(guide.questions.length, `${guide.role} questions`).toBeGreaterThan(0);

      for (const question of guide.questions) {
        expect(question.question, `${guide.role}/${question.id} question`).not.toBe('');
        expect(question.help, `${guide.role}/${question.id} help`).not.toBe('');
      }
    }
  });
});
