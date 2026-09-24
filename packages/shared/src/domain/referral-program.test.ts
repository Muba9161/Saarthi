import { describe, expect, it } from 'vitest';
import { RoleName } from './enums';
import { isPlausibleGodId } from './sales';
import {
  REFERRAL_PROGRAM_CODE_PREFIX,
  canJoinReferralProgram,
  isReferralProgramCode,
  referralProgramUrl,
} from './referral-program';

describe('referral program codes', () => {
  it('recognises a well-formed code however it was typed', () => {
    expect(isReferralProgramCode('SAARTHI-A7K92P')).toBe(true);
    expect(isReferralProgramCode(' saarthi-a7k92p ')).toBe(true);
  });

  it('rejects GODIDs, ambiguous characters and the wrong length', () => {
    expect(isReferralProgramCode('GOD-7F42K')).toBe(false);
    // 0, O, 1 and I are outside the alphabet.
    expect(isReferralProgramCode('SAARTHI-A0K92P')).toBe(false);
    expect(isReferralProgramCode('SAARTHI-AIK92P')).toBe(false);
    expect(isReferralProgramCode('SAARTHI-A7K92')).toBe(false);
  });

  it('fits the registration form, which accepts any plausible referral code', () => {
    // The form carries both channels in one field; a program code that failed
    // this check would be dropped before it ever reached the API.
    expect(isPlausibleGodId(`${REFERRAL_PROGRAM_CODE_PREFIX}A7K92P`)).toBe(true);
  });

  it('links straight to registration with the code attached', () => {
    expect(referralProgramUrl('https://saarthi.vorldx.com/', 'saarthi-a7k92p')).toBe(
      'https://saarthi.vorldx.com/register?ref=SAARTHI-A7K92P',
    );
  });
});

describe('referral program eligibility', () => {
  it('is not decided by plan or account type', () => {
    expect(canJoinReferralProgram([RoleName.CUSTOMER])).toBe(true);
    expect(canJoinReferralProgram([RoleName.DRIVER])).toBe(true);
    expect(canJoinReferralProgram([RoleName.FLEET_OWNER])).toBe(true);
    expect(canJoinReferralProgram([RoleName.SUPPLIER])).toBe(true);
  });

  it('keeps salespeople on their GODID channel', () => {
    expect(canJoinReferralProgram([RoleName.SALESMAN])).toBe(false);
    expect(canJoinReferralProgram([RoleName.PLATFORM_ADMIN, RoleName.SALESMAN])).toBe(false);
  });
});
