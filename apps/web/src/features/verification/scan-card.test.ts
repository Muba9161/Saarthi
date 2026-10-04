import { describe, expect, it } from 'vitest';
import { extractCardNumber, IdentityDocumentKind } from '@saarthi/shared';
import { confidentText, type RecognisedBlock } from './scan-card';

/** One block of recognised lines, each word with the confidence OCR gave it. */
function block(...lines: [string, number][][]): RecognisedBlock {
  return {
    paragraphs: [
      { lines: lines.map((words) => ({ words: words.map(([text, confidence]) => ({ text, confidence })) })) },
    ],
  };
}

describe('confidentText', () => {
  it('keeps the words read with confidence, line by line', () => {
    const text = confidentText([
      block(
        [['INCOME', 95], ['TAX', 96], ['DEPARTMENT', 96]],
        [['JrepR', 0], ['Permanent', 95], ['Account', 94]],
        [['ABCPE1234F', 89]],
      ),
    ]);
    expect(text).toBe('INCOME TAX DEPARTMENT\nPermanent Account\nABCPE1234F');
    expect(extractCardNumber(IdentityDocumentKind.PAN, text)).toBe('ABCPE1234F');
  });

  it('keeps a number OCR split across two confident words', () => {
    const text = confidentText([block([['ABCPE1', 89], ['234F', 91]])]);
    expect(extractCardNumber(IdentityDocumentKind.PAN, text)).toBe('ABCPE1234F');
  });

  it('offers no PAN from a card read the wrong way up', () => {
    // What OCR made of an upside-down PAN card. Joined together, these
    // fragments once formed the well-shaped but wrong PAN "EUDLS0661I".
    const blocks = [
      block(
        [['aineudls', 22], ['LIv0I2', 0], ['yuig', 32]],
        [['BRIE', 41], ['ALNVHOW', 83]],
        [['Hs3rvd', 42], ['s.J2yied', 5]],
        [['13408V', 64], ['pied', 0]],
      ),
    ];
    expect(extractCardNumber(IdentityDocumentKind.PAN, confidentText(blocks))).toBeNull();
  });

  it('reads nothing from nothing', () => {
    expect(confidentText(null)).toBe('');
  });
});
