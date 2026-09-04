import { describe, expect, it } from 'vitest';
import {
  describeFaultCode,
  isManufacturerSpecificFault,
  worstFaultSeverity,
} from './fault-codes';

/**
 * Turning a code into something a person can act on.
 *
 * The cases that matter are the ones where being confidently wrong is worse
 * than saying little: a manufacturer's code that looks generic, an unknown code
 * that could be anything, and a string that is not a code at all. A description
 * sends a mechanic to a system, and the wrong one sends them to the wrong system
 * with the authority of the software behind it.
 */
describe('describeFaultCode', () => {
  it('explains a generic code', () => {
    const meaning = describeFaultCode('P0217');
    expect(meaning?.description).toBe('Engine over-temperature — stop and let it cool');
    expect(meaning?.severity).toBe('CRITICAL');
    expect(meaning?.system).toBe('Cooling');
  });

  it('accepts lower case and surrounding space, as a device might send it', () => {
    expect(describeFaultCode('  p0301 ')?.code).toBe('P0301');
  });

  it('refuses to guess at a manufacturer code', () => {
    /*
     * P1217 is Tata's to define, and it is not P0217. Returning the
     * over-temperature text because the digits are close would send somebody to
     * check a cooling system that may be fine.
     */
    const meaning = describeFaultCode('P1217');
    expect(meaning?.description).toContain("manufacturer");
    expect(meaning?.description).not.toContain('over-temperature');
    expect(meaning?.severity).toBe('ADVISORY');
  });

  it('still names the system for a code it has never seen', () => {
    // "A chassis fault" is more than the raw string, and true by construction —
    // the letter is defined by the standard whatever the digits mean.
    const meaning = describeFaultCode('C0999');
    expect(meaning?.system).toBe('Chassis');
    expect(meaning?.severity).toBe('ADVISORY');
  });

  it('grades an unknown code as advisory rather than guessing', () => {
    // Marking an unknown code critical would teach people to ignore the word,
    // which costs more than the one time it would have been right.
    expect(describeFaultCode('U0999')?.severity).toBe('ADVISORY');
  });

  it('rejects a string that is not a fault code', () => {
    expect(describeFaultCode('hello')).toBeNull();
    expect(describeFaultCode('')).toBeNull();
    expect(describeFaultCode('X0100')).toBeNull();
    // Five characters, and the third is not hex.
    expect(describeFaultCode('P0G12')).toBeNull();
  });

  it('knows which codes belong to the manufacturer', () => {
    // The second digit carries it, not the first.
    expect(isManufacturerSpecificFault('P1217')).toBe(true);
    expect(isManufacturerSpecificFault('P3217')).toBe(true);
    expect(isManufacturerSpecificFault('P0217')).toBe(false);
    expect(isManufacturerSpecificFault('P2002')).toBe(false);
  });
});

describe('worstFaultSeverity', () => {
  it('reports the most serious of a set', () => {
    // A summary line has to lead with the code that stops the vehicle, not the
    // first one the ECU happened to return.
    expect(worstFaultSeverity(['P0143', 'P0217', 'P0420'])).toBe('CRITICAL');
    expect(worstFaultSeverity(['P0143', 'P0420'])).toBe('ADVISORY');
    expect(worstFaultSeverity(['P0171', 'P0143'])).toBe('SERIOUS');
  });

  it('ignores strings that are not codes', () => {
    expect(worstFaultSeverity(['not a code', 'P0217'])).toBe('CRITICAL');
  });

  it('is null when there is nothing to grade', () => {
    expect(worstFaultSeverity([])).toBeNull();
  });
});
