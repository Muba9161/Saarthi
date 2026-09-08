import { describe, expect, it } from 'vitest';
import {
  DRIVER_VERIFICATION_CHECKS,
  IdentityDocumentKind,
  driverCheckForDocumentType,
  driverVerificationChecklist,
  isDriverFullyVerified,
} from '../index';

/**
 * The rule that decides whether a driver is verified.
 *
 * Worth pinning down here rather than only through the API, because it is the
 * one rule in the codebase that says "no" to a fleet trying to dispatch
 * somebody — every partial state has to be unambiguous.
 */

const ALL = {
  licenceVerifiedAt: new Date('2026-06-01T00:00:00.000Z'),
  aadhaarVerifiedAt: new Date('2026-06-02T00:00:00.000Z'),
  panVerifiedAt: new Date('2026-06-03T00:00:00.000Z'),
  voterIdVerifiedAt: new Date('2026-06-04T00:00:00.000Z'),
};

describe('driver verification checklist', () => {
  it('covers exactly the four checks, in a stable order', () => {
    expect(DRIVER_VERIFICATION_CHECKS.map((check) => check.key)).toEqual([
      'DRIVING_LICENCE',
      'AADHAAR',
      'PAN',
      'VOTER_ID',
    ]);
  });

  it('is complete only when all four are confirmed', () => {
    const checklist = driverVerificationChecklist(ALL);

    expect(checklist.complete).toBe(true);
    expect(checklist.verifiedCount).toBe(4);
    expect(checklist.outstanding).toEqual([]);
    expect(isDriverFullyVerified(ALL)).toBe(true);
  });

  it('is not complete for a driver with nothing confirmed', () => {
    const checklist = driverVerificationChecklist({});

    expect(checklist.complete).toBe(false);
    expect(checklist.verifiedCount).toBe(0);
    expect(checklist.outstanding).toEqual([
      'Driving licence',
      'Aadhaar',
      'PAN',
      'Voter ID',
    ]);
  });

  it.each([
    ['licenceVerifiedAt', 'Driving licence'],
    ['aadhaarVerifiedAt', 'Aadhaar'],
    ['panVerifiedAt', 'PAN'],
    ['voterIdVerifiedAt', 'Voter ID'],
  ] as const)('is not complete when only %s is missing', (field, label) => {
    const checklist = driverVerificationChecklist({ ...ALL, [field]: null });

    // Three of four is not verified. The whole point of the rule.
    expect(checklist.complete).toBe(false);
    expect(checklist.verifiedCount).toBe(3);
    expect(checklist.outstanding).toEqual([label]);
    expect(checklist.summary).toContain(label);
  });

  it('names what is outstanding, so the summary is actionable on its own', () => {
    const checklist = driverVerificationChecklist({
      licenceVerifiedAt: ALL.licenceVerifiedAt,
      panVerifiedAt: ALL.panVerifiedAt,
    });

    expect(checklist.summary).toBe(
      '2 of 4 checks confirmed. Still needed: Aadhaar, Voter ID.',
    );
  });

  it('accepts an ISO string as readily as a Date, since the API sends strings', () => {
    const checklist = driverVerificationChecklist({
      licenceVerifiedAt: '2026-06-01T00:00:00.000Z',
      aadhaarVerifiedAt: '2026-06-02T00:00:00.000Z',
      panVerifiedAt: '2026-06-03T00:00:00.000Z',
      voterIdVerifiedAt: '2026-06-04T00:00:00.000Z',
    });

    expect(checklist.complete).toBe(true);
    expect(checklist.items[0]?.verifiedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('treats an unparseable timestamp as not confirmed rather than trusting it', () => {
    const checklist = driverVerificationChecklist({ ...ALL, panVerifiedAt: 'not-a-date' });

    expect(checklist.complete).toBe(false);
    expect(checklist.outstanding).toEqual(['PAN']);
  });

  it('reports each check with the timestamp it was confirmed at', () => {
    const items = driverVerificationChecklist(ALL).items;

    expect(items.every((item) => item.verified)).toBe(true);
    expect(items.map((item) => item.verifiedAt)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-02T00:00:00.000Z',
      '2026-06-03T00:00:00.000Z',
      '2026-06-04T00:00:00.000Z',
    ]);
  });

  it('gives every outstanding check something to do about it', () => {
    for (const item of driverVerificationChecklist({}).items) {
      expect(item.hint.length).toBeGreaterThan(20);
    }
  });
});

describe('mapping an uploaded document to its check', () => {
  it.each([
    ['DRIVING_LICENCE', 'DRIVING_LICENCE', undefined],
    ['DRIVER_AADHAAR', 'AADHAAR', IdentityDocumentKind.AADHAAR],
    ['DRIVER_PAN', 'PAN', IdentityDocumentKind.PAN],
    ['DRIVER_VOTER_ID', 'VOTER_ID', IdentityDocumentKind.VOTER_ID],
  ] as const)('maps %s to the %s check', (documentType, key, identityKind) => {
    const check = driverCheckForDocumentType(documentType);

    expect(check?.key).toBe(key);
    // The licence has no identity kind — it goes to the licensing authority,
    // not to an identity source, and the Verify button has to route on that.
    expect(check?.identityKind).toBe(identityKind);
  });

  it.each(['DRIVER_ADDRESS_PROOF', 'DRIVER_PHOTO', 'DRIVER_IDENTITY_PROOF', 'GST_CERTIFICATE'])(
    'offers no check for %s',
    (documentType) => {
      expect(driverCheckForDocumentType(documentType)).toBeUndefined();
    },
  );
});
