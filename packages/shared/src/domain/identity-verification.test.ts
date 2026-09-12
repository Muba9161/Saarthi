import { describe, expect, it } from 'vitest';
import {
  DocumentOwnerType,
  IdentityDocumentKind,
  documentTypeDefinition,
  gstinCheckCharacter,
  gstStateFromGstin,
  hasValidVerhoeffChecksum,
  identityKindDefinition,
  identityKindForDocumentType,
  identityKindsForSubject,
  identityLastFour,
  isIndividualPan,
  isValidAadhaar,
  isValidGstin,
  isValidIdentityNumber,
  isValidPan,
  isValidVoterId,
  mandatoryDocumentTypes,
  maskIdentityNumber,
  normalizeIdentityNumber,
  panFromGstin,
  panHolderType,
  VerificationSubjectType,
  verifiableDocumentTypes,
} from '../index';

/**
 * The local half of identity verification.
 *
 * Every rule here runs with no network, no database and no API key — which is
 * the point of it existing. This is the gate that stops a mistyped number
 * becoming a billed provider call and a misleading "no record found", so it is
 * the cheapest and most valuable thing to pin down.
 *
 * The numbers below are constructed to satisfy their own check digits and
 * belong to nobody — an Aadhaar carrying a valid Verhoeff digit is not thereby
 * an issued Aadhaar, it is merely one that could have been issued, which is
 * exactly the distinction these rules exist to draw.
 */

describe('normalisation', () => {
  it('collapses the ways a number is printed into one canonical form', () => {
    for (const input of ['2234 5678 9012', '2234-5678-9012', ' 2234567890 12 ']) {
      expect(normalizeIdentityNumber(input)).toBe('223456789012');
    }
    expect(normalizeIdentityNumber('abcde1234f')).toBe('ABCDE1234F');
  });
});

describe('Aadhaar', () => {
  // Built by appending the correct Verhoeff digit to an 11-digit body.
  const VALID = '234567890124';

  it('accepts a twelve-digit number with a correct Verhoeff check digit', () => {
    expect(hasValidVerhoeffChecksum(VALID)).toBe(true);
    expect(isValidAadhaar(VALID)).toBe(true);
  });

  it('accepts it however it was typed', () => {
    expect(isValidAadhaar('2345 6789 0124')).toBe(true);
    expect(isValidAadhaar('2345-6789-0124')).toBe(true);
  });

  it('rejects a single mistyped digit', () => {
    // The property that makes Verhoeff worth the tables: every single-digit
    // error is caught, which is the mistake people actually make.
    for (let position = 0; position < VALID.length; position += 1) {
      for (const digit of '0123456789') {
        if (VALID[position] === digit) continue;
        const mutated = VALID.slice(0, position) + digit + VALID.slice(position + 1);
        expect(isValidAadhaar(mutated), `${mutated} should be rejected`).toBe(false);
      }
    }
  });

  it('rejects adjacent transpositions', () => {
    for (let position = 0; position < VALID.length - 1; position += 1) {
      if (VALID[position] === VALID[position + 1]) continue;
      const swapped =
        VALID.slice(0, position) +
        VALID[position + 1] +
        VALID[position] +
        VALID.slice(position + 2);
      expect(isValidAadhaar(swapped), `${swapped} should be rejected`).toBe(false);
    }
  });

  it('rejects numbers UIDAI never issues', () => {
    // Leading 0 and 1 are not allocated, whatever the check digit says.
    expect(isValidAadhaar('012345678901')).toBe(false);
    expect(isValidAadhaar('112345678901')).toBe(false);
    // Wrong length, and the all-same-digit numbers people use as filler.
    expect(isValidAadhaar('23456789012')).toBe(false);
    expect(isValidAadhaar('2345678901234')).toBe(false);
    expect(isValidAadhaar('222222222222')).toBe(false);
    expect(isValidAadhaar('')).toBe(false);
  });

  it('discloses only the last four digits', () => {
    expect(maskIdentityNumber(IdentityDocumentKind.AADHAAR, VALID)).toBe('XXXX XXXX 0124');
    expect(identityLastFour(VALID)).toBe('0124');
  });
});

describe('PAN', () => {
  it('accepts a well-formed PAN', () => {
    expect(isValidPan('ABCPE1234F')).toBe(true);
    expect(isValidPan('abcpe1234f')).toBe(true);
  });

  it('rejects a fourth character that is not a holder class', () => {
    // Worth stating plainly because it catches people out: `ABCDE1234F` is the
    // placeholder PAN used in half the documentation on the internet, and it is
    // not a valid PAN. `D` is not one of the ten entity-type codes the Income
    // Tax Department issues, so no such card exists.
    expect(isValidPan('ABCDE1234F')).toBe(false);
    expect(isValidPan('ABCXE1234F')).toBe(false);
    expect(isValidPan('ABCPE1234')).toBe(false);
    expect(isValidPan('ABCP12345F')).toBe(false);
    expect(isValidPan('')).toBe(false);
  });

  it('reads the holder class off the fourth character', () => {
    expect(panHolderType('ABCPE1234F')).toBe('Individual');
    expect(panHolderType('ABCCE1234F')).toBe('Company');
    expect(isIndividualPan('ABCPE1234F')).toBe(true);
    expect(isIndividualPan('ABCCE1234F')).toBe(false);
    expect(panHolderType('NOTAPAN')).toBeNull();
  });

  it('keeps a wider window than Aadhaar when masking', () => {
    // A PAN is printed on invoices; treating it as an Aadhaar-grade secret
    // would cost recognisability for no real protection.
    expect(maskIdentityNumber(IdentityDocumentKind.PAN, 'ABCPE1234F')).toBe('ABC•••••4F');
  });
});

describe('Voter ID (EPIC)', () => {
  it('accepts the current three-letter form', () => {
    expect(isValidVoterId('ABC1234567')).toBe(true);
    expect(isValidVoterId('abc1234567')).toBe(true);
  });

  it('accepts older cards, which a long-serving driver is most likely to hold', () => {
    // The older forms carry a slash and a longer numeric tail — `MH/09/123/4567`
    // and the like. The separators are gone by the time the rule sees them, so
    // what is accepted is two or three letters followed by 8–13 digits.
    expect(isValidVoterId('AB/12345678')).toBe(true);
    expect(isValidVoterId('MH/09/123/456789')).toBe(true);
    expect(isValidVoterId('ABC123456789')).toBe(true);
  });

  it('rejects what cannot be an EPIC number', () => {
    // Deliberately permissive within the letter/digit shape — refusing a real
    // older card would lock out exactly the drivers this is meant to onboard —
    // but still bounded at both ends.
    expect(isValidVoterId('1234567890')).toBe(false);
    expect(isValidVoterId('ABCDEFG')).toBe(false);
    expect(isValidVoterId('AB1234567')).toBe(false);
    expect(isValidVoterId('ABCD1234567')).toBe(false);
    expect(isValidVoterId('ABC12345678901234')).toBe(false);
    expect(isValidVoterId('')).toBe(false);
  });
});

describe('GSTIN', () => {
  // 27 = Maharashtra; PAN ABCCE1234F (`C` = company, which is what a GST
  // registrant carries); entity number 1; the literal Z; then the check char.
  const BODY = '27ABCCE1234F1Z';
  const VALID = BODY + gstinCheckCharacter(BODY);

  it('accepts a GSTIN whose mod-36 check character is correct', () => {
    expect(isValidGstin(VALID)).toBe(true);
    expect(VALID).toHaveLength(15);
  });

  it('rejects a wrong check character', () => {
    const check = VALID.charAt(14);
    for (const candidate of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (candidate === check) continue;
      expect(isValidGstin(BODY + candidate), `${BODY}${candidate}`).toBe(false);
    }
  });

  it('rejects an unallocated state code', () => {
    // 88 is not a GST state code, so the number cannot be real even though the
    // rest of its shape is right.
    const body = '88ABCCE1234F1Z';
    expect(isValidGstin(body + gstinCheckCharacter(body))).toBe(false);
  });

  it('rejects a GSTIN whose embedded PAN could not have been issued', () => {
    // Everything else about this one is right, including the check character.
    // The `D` in the PAN's entity-type position is what condemns it.
    const body = '27ABCDE1234F1Z';
    expect(isValidGstin(body + gstinCheckCharacter(body))).toBe(false);
  });

  it('rejects the wrong length and a missing literal Z', () => {
    expect(isValidGstin(VALID.slice(0, 14))).toBe(false);
    expect(isValidGstin('27ABCCE1234F1Y2')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });

  it('exposes the PAN and state embedded in the number', () => {
    // Derived from the GSTIN's own characters, which is what makes it a
    // cross-check on the business rather than an echo of the response.
    expect(panFromGstin(VALID)).toBe('ABCCE1234F');
    expect(gstStateFromGstin(VALID)).toBe('Maharashtra');
    expect(panFromGstin('not-a-gstin')).toBeNull();
  });

  it('returns null for a body that is not fourteen characters', () => {
    expect(gstinCheckCharacter('27ABCCE1234F1')).toBeNull();
    expect(gstinCheckCharacter('27ABCCE1234F1Z2')).toBeNull();
  });
});

describe('kind dispatch', () => {
  it('routes each kind to its own rules', () => {
    expect(isValidIdentityNumber(IdentityDocumentKind.AADHAAR, '234567890124')).toBe(true);
    expect(isValidIdentityNumber(IdentityDocumentKind.PAN, 'ABCPE1234F')).toBe(true);
    expect(isValidIdentityNumber(IdentityDocumentKind.VOTER_ID, 'ABC1234567')).toBe(true);

    // A PAN is not an Aadhaar, and each kind refuses the others' numbers.
    expect(isValidIdentityNumber(IdentityDocumentKind.AADHAAR, 'ABCPE1234F')).toBe(false);
    expect(isValidIdentityNumber(IdentityDocumentKind.PAN, '234567890124')).toBe(false);
  });
});

describe('document catalogue wiring', () => {
  it('links each verifiable document type to its check', () => {
    expect(identityKindForDocumentType('DRIVER_AADHAAR')?.kind).toBe(
      IdentityDocumentKind.AADHAAR,
    );
    expect(identityKindForDocumentType('DRIVER_PAN')?.kind).toBe(IdentityDocumentKind.PAN);
    expect(identityKindForDocumentType('DRIVER_VOTER_ID')?.kind).toBe(
      IdentityDocumentKind.VOTER_ID,
    );
    expect(identityKindForDocumentType('GST_CERTIFICATE')?.kind).toBe(IdentityDocumentKind.GST);
    // The account holder's own Aadhaar, which is a different document code and
    // a different subject from the driver's.
    expect(identityKindForDocumentType('USER_AADHAAR')?.kind).toBe(IdentityDocumentKind.AADHAAR);
    expect(identityKindForDocumentType('USER_AADHAAR')?.subjectType).toBe(
      VerificationSubjectType.USER,
    );
    // A driving licence is verified through its own module, not this one.
    expect(identityKindForDocumentType('DRIVING_LICENCE')).toBeUndefined();
  });

  it('marks exactly the five verifiable types', () => {
    expect(verifiableDocumentTypes(DocumentOwnerType.DRIVER).map((entry) => entry.code)).toEqual([
      'DRIVER_AADHAAR',
      'DRIVER_PAN',
      'DRIVER_VOTER_ID',
    ]);
    expect(
      verifiableDocumentTypes(DocumentOwnerType.ORGANIZATION).map((entry) => entry.code),
    ).toEqual(['GST_CERTIFICATE']);
    // The account holder's own. Listed separately from the driver's on purpose
    // — see the identity-subject suite below.
    expect(verifiableDocumentTypes(DocumentOwnerType.USER).map((entry) => entry.code)).toEqual([
      'USER_AADHAAR',
    ]);
    expect(verifiableDocumentTypes()).toHaveLength(5);
  });

  it('leaves the mandatory set alone, so existing subjects stay verifiable', () => {
    // Adding three identity documents must not silently make every driver on
    // the platform incomplete. Requiring Aadhaar *and* PAN *and* Voter ID would
    // also refuse a driver who legitimately holds only one of them.
    const driverMandatory = mandatoryDocumentTypes(DocumentOwnerType.DRIVER).map(
      (entry) => entry.code,
    );
    expect(driverMandatory).toEqual(['DRIVING_LICENCE', 'DRIVER_IDENTITY_PROOF']);
    expect(mandatoryDocumentTypes(DocumentOwnerType.ORGANIZATION).map((e) => e.code)).toEqual([
      'BUSINESS_REGISTRATION',
    ]);
  });

  it('requires no expiry date on any identity document', () => {
    // None of the four expire in a way Saarthi tracks, so the upload form must
    // not demand a date the card does not carry.
    for (const definition of verifiableDocumentTypes()) {
      expect(documentTypeDefinition(definition.code)?.requiresExpiry).toBe(false);
    }
  });
});

/**
 * Account-holder identity against driver verification.
 *
 * These are two different concepts that happen to involve the same card, and
 * the whole point of the catalogue carrying two Aadhaar entries is that neither
 * can stand in for the other. A Personal customer proves who holds the account;
 * a driver proves they may be handed a vehicle, which takes Aadhaar, PAN,
 * Voter ID and a licence. One person may be both, with a row of each.
 */
describe('identity subjects', () => {
  it('offers a person their Aadhaar and nothing else', () => {
    const forUser = identityKindsForSubject(VerificationSubjectType.USER);

    expect(forUser.map((entry) => entry.kind)).toEqual([IdentityDocumentKind.AADHAAR]);
    // Not PAN and not Voter ID: those are part of clearing somebody to drive,
    // and an account holder who never drives is not asked for them.
    expect(forUser[0]?.documentType).toBe('USER_AADHAAR');
    expect(forUser[0]?.ownerType).toBe(DocumentOwnerType.USER);
  });

  it('leaves the driver’s four checks exactly as they were', () => {
    const forDriver = identityKindsForSubject(VerificationSubjectType.DRIVER);

    expect(forDriver.map((entry) => entry.kind)).toEqual([
      IdentityDocumentKind.AADHAAR,
      IdentityDocumentKind.PAN,
      IdentityDocumentKind.VOTER_ID,
    ]);
    // And the driver's Aadhaar still hangs off the driver, with the document
    // code the driver flow has always used.
    expect(forDriver[0]?.documentType).toBe('DRIVER_AADHAAR');
    expect(forDriver[0]?.ownerType).toBe(DocumentOwnerType.DRIVER);
  });

  it('keeps the organization subject to its GSTIN', () => {
    expect(
      identityKindsForSubject(VerificationSubjectType.ORGANIZATION).map((entry) => entry.kind),
    ).toEqual([IdentityDocumentKind.GST]);
  });

  it('resolves Aadhaar per subject, and keeps the driver’s as the default', () => {
    // The unqualified lookup still answers the driver's, which is what every
    // existing one-argument caller depends on.
    expect(identityKindDefinition(IdentityDocumentKind.AADHAAR)?.documentType).toBe(
      'DRIVER_AADHAAR',
    );

    expect(
      identityKindDefinition(IdentityDocumentKind.AADHAAR, VerificationSubjectType.USER)
        ?.documentType,
    ).toBe('USER_AADHAAR');
    expect(
      identityKindDefinition(IdentityDocumentKind.AADHAAR, VerificationSubjectType.DRIVER)
        ?.documentType,
    ).toBe('DRIVER_AADHAAR');

    // A kind a subject is not asked for has no definition for it, which is what
    // stops a person being offered a PAN check they are not asked to pass.
    expect(
      identityKindDefinition(IdentityDocumentKind.PAN, VerificationSubjectType.USER),
    ).toBeUndefined();
    expect(
      identityKindDefinition(IdentityDocumentKind.GST, VerificationSubjectType.USER),
    ).toBeUndefined();
  });

  it('shares the number rules, because it is the same card', () => {
    const driver = identityKindDefinition(
      IdentityDocumentKind.AADHAAR,
      VerificationSubjectType.DRIVER,
    );
    const user = identityKindDefinition(
      IdentityDocumentKind.AADHAAR,
      VerificationSubjectType.USER,
    );

    // What is shared is everything about Aadhaar itself: the format, the
    // checksum, and the honest limit on what can be confirmed online.
    expect(user?.placeholder).toBe(driver?.placeholder);
    expect(user?.formatHint).toBe(driver?.formatHint);
    expect(user?.secondFactor).toBe(driver?.secondFactor);
    expect(user?.hasOnlineSource).toBe(driver?.hasOnlineSource);

    // What differs is whose it is and where the answer is recorded.
    expect(user?.subjectType).not.toBe(driver?.subjectType);
    expect(user?.ownerType).not.toBe(driver?.ownerType);
    expect(user?.documentType).not.toBe(driver?.documentType);
  });
});
