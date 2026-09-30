import { describe, expect, it } from 'vitest';
import { IdentityDocumentKind, extractCardNumber } from '../index';

/**
 * Pulling the number off a photographed card. The inputs are shaped like real
 * phone OCR — headings, a name, a date of birth, misread characters — because
 * that is what the extractor gets, and a confident wrong number is worse than
 * none.
 */

const AADHAAR = '234567890124';
const PAN = 'ABCPE1234F';
const GSTIN = '27ABCPE1234F1ZB';

describe('extractCardNumber', () => {
  it('reads an Aadhaar number printed in groups of four', () => {
    const text = `GOVERNMENT OF INDIA\nSneha Mohanty\nDOB: 12/04/1990\nFEMALE\n2345 6789 0124\nMera Aadhaar, Meri Pehchaan`;
    expect(extractCardNumber(IdentityDocumentKind.AADHAAR, text)).toBe(AADHAAR);
  });

  it('repairs letters OCR put where Aadhaar digits were', () => {
    const text = 'Sneha Mohanty\n2345 67B9 O124';
    expect(extractCardNumber(IdentityDocumentKind.AADHAAR, text)).toBe(AADHAAR);
  });

  it('never cuts an Aadhaar out of a 16-digit Virtual ID', () => {
    const text = 'VID : 9876 5432 1012 3456\n';
    expect(extractCardNumber(IdentityDocumentKind.AADHAAR, text)).toBeNull();
  });

  it('refuses digits that fail the Aadhaar checksum', () => {
    expect(extractCardNumber(IdentityDocumentKind.AADHAAR, '2345 6789 0125')).toBeNull();
  });

  it('reads a PAN from the card text', () => {
    const text = `INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number Card\n${PAN}\nSNEHA MOHANTY`;
    expect(extractCardNumber(IdentityDocumentKind.PAN, text)).toBe(PAN);
  });

  it('repairs PAN characters OCR misread, by the class each position needs', () => {
    // "8" read for "B" among the letters, "Z" read for "2" among the digits.
    expect(extractCardNumber(IdentityDocumentKind.PAN, 'Permanent Account Number\nA8CPE1Z34F')).toBe(
      PAN,
    );
  });

  it('reads a PAN split across a space', () => {
    expect(extractCardNumber(IdentityDocumentKind.PAN, 'Number ABCPE 1234F')).toBe(PAN);
  });

  it('reads a Voter ID (EPIC) number', () => {
    const text = 'ELECTION COMMISSION OF INDIA\nIDENTITY CARD\nABC1234567\nName: Sneha';
    expect(extractCardNumber(IdentityDocumentKind.VOTER_ID, text)).toBe('ABC1234567');
  });

  it('reads a GSTIN and trusts only its check character', () => {
    expect(extractCardNumber(IdentityDocumentKind.GST, `GSTIN: ${GSTIN}\nLegal Name`)).toBe(GSTIN);
    // One character off: the check character no longer agrees.
    expect(extractCardNumber(IdentityDocumentKind.GST, 'GSTIN: 27ABCPE1234F1ZC')).toBeNull();
  });

  it('reads a driving licence however it is spaced', () => {
    const text = 'INDIAN UNION DRIVING LICENCE\nDL No. UP32 2011 0012345\nValid Till 2031';
    expect(extractCardNumber('DRIVING_LICENCE', text)).toBe('UP3220110012345');
    expect(extractCardNumber('DRIVING_LICENCE', 'UP-32-2011-0012345')).toBe('UP3220110012345');
  });

  it('offers nothing rather than a guess when the card holds no such number', () => {
    const text = 'SNEHA MOHANTY\nDOB 12/04/1990\nMALE';
    expect(extractCardNumber(IdentityDocumentKind.PAN, text)).toBeNull();
    expect(extractCardNumber(IdentityDocumentKind.AADHAAR, text)).toBeNull();
    expect(extractCardNumber('DRIVING_LICENCE', text)).toBeNull();
  });
});
