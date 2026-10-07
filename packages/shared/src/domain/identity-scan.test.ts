import { describe, expect, it } from 'vitest';
import { IdentityDocumentKind, UNREAD_WORD, extractCardDetails, extractCardNumber } from '../index';

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

describe('extractCardDetails', () => {
  // Hindi on a bilingual card comes back from the English model as words read
  // without confidence, which the scanner passes on as UNREAD_WORD.
  const U = UNREAD_WORD;

  it('reads the name under the label on the current PAN card, not the father’s', () => {
    const text = [
      `${U} ${U} INCOME TAX DEPARTMENT ${U} ${U} GOVT. OF INDIA`,
      'Permanent Account Number Card',
      PAN,
      `${U} / Name`,
      'SNEHA MOHANTY',
      `${U} ${U} ${U} / Father's Name`,
      'RAJESH MOHANTY',
      `${U} ${U} / Date of Birth`,
      '12/04/1990',
    ].join('\n');
    expect(extractCardDetails(IdentityDocumentKind.PAN, text)).toEqual({
      number: PAN,
      holderName: 'SNEHA MOHANTY',
    });
  });

  it('reads the name under the heading on the older PAN card', () => {
    const text = [
      'INCOME TAX DEPARTMENT GOVT. OF INDIA',
      'SNEHA MOHANTY',
      'RAJESH MOHANTY',
      '12/04/1990',
      'Permanent Account Number',
      PAN,
    ].join('\n');
    expect(extractCardDetails(IdentityDocumentKind.PAN, text)?.holderName).toBe('SNEHA MOHANTY');
  });

  it('reads a business name from a company PAN', () => {
    const text = [
      'Permanent Account Number Card',
      'AAACS1234K',
      `${U} / Name`,
      'SAARTHI NETWORKS PRIVATE LIMITED',
      `${U} / Date of Incorporation/Formation`,
      '01/04/2015',
    ].join('\n');
    expect(extractCardDetails(IdentityDocumentKind.PAN, text)).toEqual({
      number: 'AAACS1234K',
      holderName: 'SAARTHI NETWORKS PRIVATE LIMITED',
    });
  });

  it('offers no name when a word of it was not read', () => {
    // "SNEHA" alone would fail a check that "SNEHA MOHANTY" passes.
    const text = [`${U} / Name`, `SNEHA ${U}`, PAN].join('\n');
    expect(extractCardDetails(IdentityDocumentKind.PAN, text)).toEqual({ number: PAN });
  });

  it('still reads the number around unread words', () => {
    expect(extractCardDetails(IdentityDocumentKind.PAN, `${U} ABCPE ${U} 1234F`)?.number).toBe(PAN);
  });

  it('reads a licence’s issue date and the earlier of its validities', () => {
    const text = [
      'INDIAN UNION DRIVING LICENCE',
      'DL No. UP32 2011 0012345',
      'DOB: 01-01-1990  Issue Date: 12-03-2015',
      'Validity(NT): 11-03-2035  Validity(TR): 11-03-2018',
    ].join('\n');
    expect(extractCardDetails('DRIVING_LICENCE', text)).toEqual({
      number: 'UP3220110012345',
      issueDate: '2015-03-12',
      expiryDate: '2018-03-11',
    });
  });

  it('reads dates printed in a row under a row of labels', () => {
    const text = ['DL No. UP32 2011 0012345', 'Date of Issue   Valid Till', '12-03-2015  11-03-2035'].join(
      '\n',
    );
    expect(extractCardDetails('DRIVING_LICENCE', text)).toMatchObject({
      issueDate: '2015-03-12',
      expiryDate: '2035-03-11',
    });
  });

  it('takes the issue date from an Aadhaar and never the date of birth', () => {
    const text = [
      'Aadhaar no. issued: 12/04/2012',
      'GOVERNMENT OF INDIA',
      'Sneha Mohanty',
      'DOB: 12/04/1990',
      '2345 6789 0124',
    ].join('\n');
    expect(extractCardDetails(IdentityDocumentKind.AADHAAR, text)).toEqual({
      number: AADHAAR,
      issueDate: '2012-04-12',
    });
  });

  it('ignores a date that is not a real one, and unlabelled dates', () => {
    const text = ['DL No. UP32 2011 0012345', 'Issue Date: 31-02-2015', '11-03-2035'].join('\n');
    expect(extractCardDetails('DRIVING_LICENCE', text)).toEqual({ number: 'UP3220110012345' });
  });

  it('offers nothing at all when the number cannot be read', () => {
    expect(extractCardDetails(IdentityDocumentKind.PAN, `${U} / Name\nSNEHA MOHANTY`)).toBeNull();
  });
});
