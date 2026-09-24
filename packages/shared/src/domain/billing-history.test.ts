import { describe, expect, it } from 'vitest';
import { describeSubscriptionPayment } from './billing-history';

describe('describeSubscriptionPayment', () => {
  it('reads what a charge was for from its reference prefix', () => {
    expect(describeSubscriptionPayment('AUTOPAY-cf_123')).toEqual({ category: 'PLAN', title: 'Monthly plan — autopay' });
    expect(describeSubscriptionPayment('PLAN-1a2b3c4d-XYZ').category).toBe('PLAN');
    expect(describeSubscriptionPayment('TOPUP-1a2b3c4d-XYZ')).toEqual({ category: 'ADD_ONS', title: 'Extra vehicle' });
    expect(describeSubscriptionPayment('TRACKER-1a2b3c4d-XYZ').title).toBe('Tracker');
    expect(describeSubscriptionPayment('SIGNUP-1a2b3c4d-XYZ').category).toBe('ADD_ONS');
    expect(describeSubscriptionPayment('ADDON-1a2b3c4d-XYZ').category).toBe('ADD_ONS');
  });

  it('falls back to a plain subscription payment for an unknown reference', () => {
    expect(describeSubscriptionPayment('SOMETHING-ELSE')).toEqual({ category: 'PLAN', title: 'Subscription payment' });
  });
});
