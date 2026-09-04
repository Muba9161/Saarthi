/**
 * What a diagnostic trouble code actually means.
 *
 * A vehicle reports `P0217` and nothing else. That string is exact, permanent
 * and completely opaque: a driver cannot act on it, a fleet manager cannot
 * triage it, and the workshop is the first place anyone finds out whether the
 * truck should have kept driving. Saarthi has been storing these faithfully and
 * showing them raw, which is data collection rather than a feature.
 *
 * This is the generic set — the codes every manufacturer must use for the same
 * meaning, defined by the OBD-II standard and free of licensing. Two things
 * follow from that, and both are limits worth stating:
 *
 * **Manufacturer codes are not here and cannot be.** A code whose first digit
 * is `1` (`P1xxx`, `C1xxx`) is the manufacturer's own, and the same string means
 * different things on a Tata and an Ashok Leyland. Those are returned untouched
 * rather than guessed at — a plausible-sounding wrong description would send a
 * mechanic to the wrong system, which is worse than sending them to a manual.
 *
 * **A description is not a diagnosis.** `P0217` is "engine over-temperature",
 * which is a symptom with a dozen causes. The text says what the ECU observed,
 * never what to replace.
 */

/** How urgently a fault needs attention, for triage rather than for repair. */
export type FaultSeverity = 'CRITICAL' | 'SERIOUS' | 'ADVISORY';

export interface FaultCodeMeaning {
  code: string;
  /** One line, in the words a person would use. */
  description: string;
  severity: FaultSeverity;
  /** Which vehicle system it belongs to, for grouping a list of faults. */
  system: string;
}

/**
 * Which family a code belongs to, from its first letter.
 *
 * Useful even for a code with no entry: "a chassis fault, code C0123" is more
 * than a fleet manager had before, and it is true of every code by construction.
 */
function familyOf(code: string): { letter: string; system: string } | null {
  switch (code.charAt(0).toUpperCase()) {
    case 'P':
      return { letter: 'P', system: 'Powertrain' };
    case 'C':
      return { letter: 'C', system: 'Chassis' };
    case 'B':
      return { letter: 'B', system: 'Body' };
    case 'U':
      return { letter: 'U', system: 'Network' };
    default:
      return null;
  }
}

/**
 * Whether this code is the manufacturer's rather than the standard's.
 *
 * The second digit carries it: `0` and `2` are generic, `1` and `3` are the
 * manufacturer's own. `P0217` is over-temperature on every vehicle ever built;
 * `P1217` is whatever Tata decided it should be.
 */
export function isManufacturerSpecificFault(code: string): boolean {
  const digit = code.charAt(1);
  return digit === '1' || digit === '3';
}

/**
 * The generic powertrain codes a commercial vehicle actually reports.
 *
 * Not the full four thousand. This is the set that turns up on diesel fleets —
 * fuel system, air metering, injection, emissions, cooling, transmission — plus
 * the network and chassis codes common enough to matter. Anything absent falls
 * back to the family description, which is honest and still useful.
 *
 * Severity is Saarthi's judgement, not the standard's: the standard has no such
 * field. `CRITICAL` means stop driving, `SERIOUS` means book it in this week,
 * `ADVISORY` means mention it at the next service.
 */
const GENERIC_FAULTS: Record<string, Omit<FaultCodeMeaning, 'code'>> = {
  // --- Fuel and air metering ---------------------------------------------
  P0087: { description: 'Fuel rail pressure too low', severity: 'SERIOUS', system: 'Fuel system' },
  P0088: { description: 'Fuel rail pressure too high', severity: 'SERIOUS', system: 'Fuel system' },
  P0089: { description: 'Fuel pressure regulator performance', severity: 'SERIOUS', system: 'Fuel system' },
  P0090: { description: 'Fuel pressure regulator circuit fault', severity: 'SERIOUS', system: 'Fuel system' },
  P0091: { description: 'Fuel pressure regulator circuit, low voltage', severity: 'SERIOUS', system: 'Fuel system' },
  P0093: { description: 'Large fuel leak detected', severity: 'CRITICAL', system: 'Fuel system' },
  P0100: { description: 'Mass air flow sensor circuit fault', severity: 'SERIOUS', system: 'Air intake' },
  P0101: { description: 'Mass air flow sensor out of range', severity: 'SERIOUS', system: 'Air intake' },
  P0102: { description: 'Mass air flow sensor reading too low', severity: 'SERIOUS', system: 'Air intake' },
  P0103: { description: 'Mass air flow sensor reading too high', severity: 'SERIOUS', system: 'Air intake' },
  P0106: { description: 'Manifold pressure sensor out of range', severity: 'SERIOUS', system: 'Air intake' },
  P0107: { description: 'Manifold pressure sensor reading too low', severity: 'SERIOUS', system: 'Air intake' },
  P0108: { description: 'Manifold pressure sensor reading too high', severity: 'SERIOUS', system: 'Air intake' },
  P0112: { description: 'Intake air temperature sensor reading too low', severity: 'ADVISORY', system: 'Air intake' },
  P0113: { description: 'Intake air temperature sensor reading too high', severity: 'ADVISORY', system: 'Air intake' },
  P0116: { description: 'Coolant temperature sensor out of range', severity: 'SERIOUS', system: 'Cooling' },
  P0117: { description: 'Coolant temperature sensor reading too low', severity: 'SERIOUS', system: 'Cooling' },
  P0118: { description: 'Coolant temperature sensor reading too high', severity: 'SERIOUS', system: 'Cooling' },
  P0121: { description: 'Throttle position sensor out of range', severity: 'SERIOUS', system: 'Throttle' },
  P0122: { description: 'Throttle position sensor reading too low', severity: 'SERIOUS', system: 'Throttle' },
  P0123: { description: 'Throttle position sensor reading too high', severity: 'SERIOUS', system: 'Throttle' },
  P0128: { description: 'Engine not reaching operating temperature — thermostat suspect', severity: 'ADVISORY', system: 'Cooling' },

  // --- Oxygen sensors and mixture ----------------------------------------
  P0130: { description: 'Oxygen sensor circuit fault, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0131: { description: 'Oxygen sensor voltage low, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0132: { description: 'Oxygen sensor voltage high, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0133: { description: 'Oxygen sensor responding slowly, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0134: { description: 'Oxygen sensor inactive, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0135: { description: 'Oxygen sensor heater fault, bank 1 sensor 1', severity: 'ADVISORY', system: 'Emissions' },
  P0140: { description: 'Oxygen sensor inactive, bank 1 sensor 2', severity: 'ADVISORY', system: 'Emissions' },
  P0141: { description: 'Oxygen sensor heater fault, bank 1 sensor 2', severity: 'ADVISORY', system: 'Emissions' },
  P0143: { description: 'Oxygen sensor voltage low, bank 1 sensor 3', severity: 'ADVISORY', system: 'Emissions' },
  P0171: { description: 'Fuel mixture too lean, bank 1', severity: 'SERIOUS', system: 'Fuel system' },
  P0172: { description: 'Fuel mixture too rich, bank 1', severity: 'SERIOUS', system: 'Fuel system' },
  P0174: { description: 'Fuel mixture too lean, bank 2', severity: 'SERIOUS', system: 'Fuel system' },
  P0175: { description: 'Fuel mixture too rich, bank 2', severity: 'SERIOUS', system: 'Fuel system' },

  // --- Injection and combustion ------------------------------------------
  P0200: { description: 'Injector circuit fault', severity: 'SERIOUS', system: 'Injection' },
  P0201: { description: 'Injector circuit fault, cylinder 1', severity: 'SERIOUS', system: 'Injection' },
  P0202: { description: 'Injector circuit fault, cylinder 2', severity: 'SERIOUS', system: 'Injection' },
  P0203: { description: 'Injector circuit fault, cylinder 3', severity: 'SERIOUS', system: 'Injection' },
  P0204: { description: 'Injector circuit fault, cylinder 4', severity: 'SERIOUS', system: 'Injection' },
  P0205: { description: 'Injector circuit fault, cylinder 5', severity: 'SERIOUS', system: 'Injection' },
  P0206: { description: 'Injector circuit fault, cylinder 6', severity: 'SERIOUS', system: 'Injection' },
  P0217: { description: 'Engine over-temperature — stop and let it cool', severity: 'CRITICAL', system: 'Cooling' },
  P0219: { description: 'Engine over-speed condition', severity: 'CRITICAL', system: 'Engine' },
  P0234: { description: 'Turbocharger over-boost', severity: 'SERIOUS', system: 'Turbo' },
  P0299: { description: 'Turbocharger under-boost — loss of power', severity: 'SERIOUS', system: 'Turbo' },
  P0300: { description: 'Random misfire across cylinders', severity: 'SERIOUS', system: 'Engine' },
  P0301: { description: 'Misfire, cylinder 1', severity: 'SERIOUS', system: 'Engine' },
  P0302: { description: 'Misfire, cylinder 2', severity: 'SERIOUS', system: 'Engine' },
  P0303: { description: 'Misfire, cylinder 3', severity: 'SERIOUS', system: 'Engine' },
  P0304: { description: 'Misfire, cylinder 4', severity: 'SERIOUS', system: 'Engine' },
  P0305: { description: 'Misfire, cylinder 5', severity: 'SERIOUS', system: 'Engine' },
  P0306: { description: 'Misfire, cylinder 6', severity: 'SERIOUS', system: 'Engine' },

  // --- Emissions after-treatment, the diesel fleet's daily bread ----------
  P0401: { description: 'Exhaust gas recirculation flow insufficient', severity: 'SERIOUS', system: 'Emissions' },
  P0402: { description: 'Exhaust gas recirculation flow excessive', severity: 'SERIOUS', system: 'Emissions' },
  P0403: { description: 'Exhaust gas recirculation circuit fault', severity: 'SERIOUS', system: 'Emissions' },
  P0420: { description: 'Catalytic converter below threshold, bank 1', severity: 'ADVISORY', system: 'Emissions' },
  P0430: { description: 'Catalytic converter below threshold, bank 2', severity: 'ADVISORY', system: 'Emissions' },
  P0480: { description: 'Cooling fan circuit fault', severity: 'SERIOUS', system: 'Cooling' },
  P042E: { description: 'Exhaust gas recirculation valve stuck open', severity: 'SERIOUS', system: 'Emissions' },
  P2002: { description: 'Diesel particulate filter efficiency below threshold', severity: 'SERIOUS', system: 'Emissions' },
  P2003: { description: 'Diesel particulate filter efficiency below threshold, bank 2', severity: 'SERIOUS', system: 'Emissions' },
  P204F: { description: 'Exhaust fluid (AdBlue) system performance', severity: 'SERIOUS', system: 'Emissions' },
  P20EE: { description: 'Selective catalytic reduction efficiency below threshold', severity: 'SERIOUS', system: 'Emissions' },
  P2463: { description: 'Diesel particulate filter soot accumulation', severity: 'SERIOUS', system: 'Emissions' },

  // --- Electrical and charging -------------------------------------------
  P0562: { description: 'System voltage low — charging system suspect', severity: 'SERIOUS', system: 'Electrical' },
  P0563: { description: 'System voltage high — regulator suspect', severity: 'SERIOUS', system: 'Electrical' },
  P0620: { description: 'Alternator control circuit fault', severity: 'SERIOUS', system: 'Electrical' },
  P0625: { description: 'Alternator field terminal, low voltage', severity: 'SERIOUS', system: 'Electrical' },
  P0626: { description: 'Alternator field terminal, high voltage', severity: 'SERIOUS', system: 'Electrical' },

  // --- Transmission -------------------------------------------------------
  P0700: { description: 'Transmission control system fault', severity: 'SERIOUS', system: 'Transmission' },
  P0715: { description: 'Input shaft speed sensor fault', severity: 'SERIOUS', system: 'Transmission' },
  P0720: { description: 'Output shaft speed sensor fault', severity: 'SERIOUS', system: 'Transmission' },
  P0730: { description: 'Incorrect gear ratio', severity: 'SERIOUS', system: 'Transmission' },
  P0741: { description: 'Torque converter clutch stuck off', severity: 'SERIOUS', system: 'Transmission' },

  // --- Speed, idle and sensors -------------------------------------------
  P0500: { description: 'Vehicle speed sensor fault', severity: 'SERIOUS', system: 'Sensors' },
  P0501: { description: 'Vehicle speed sensor out of range', severity: 'SERIOUS', system: 'Sensors' },
  P0505: { description: 'Idle control system fault', severity: 'ADVISORY', system: 'Engine' },
  P0522: { description: 'Oil pressure sensor reading too low', severity: 'CRITICAL', system: 'Lubrication' },
  P0523: { description: 'Oil pressure sensor reading too high', severity: 'SERIOUS', system: 'Lubrication' },
  P0524: { description: 'Engine oil pressure too low — stop the engine', severity: 'CRITICAL', system: 'Lubrication' },

  // --- Brakes and chassis -------------------------------------------------
  C0035: { description: 'Left front wheel speed sensor fault', severity: 'SERIOUS', system: 'Brakes' },
  C0040: { description: 'Right front wheel speed sensor fault', severity: 'SERIOUS', system: 'Brakes' },
  C0045: { description: 'Left rear wheel speed sensor fault', severity: 'SERIOUS', system: 'Brakes' },
  C0050: { description: 'Right rear wheel speed sensor fault', severity: 'SERIOUS', system: 'Brakes' },
  C0110: { description: 'Anti-lock brake pump motor fault', severity: 'CRITICAL', system: 'Brakes' },
  C0265: { description: 'Anti-lock brake relay circuit fault', severity: 'CRITICAL', system: 'Brakes' },

  // --- Network ------------------------------------------------------------
  U0100: { description: 'Lost communication with the engine control module', severity: 'CRITICAL', system: 'Network' },
  U0101: { description: 'Lost communication with the transmission control module', severity: 'SERIOUS', system: 'Network' },
  U0121: { description: 'Lost communication with the anti-lock brake module', severity: 'CRITICAL', system: 'Network' },
  U0155: { description: 'Lost communication with the instrument cluster', severity: 'ADVISORY', system: 'Network' },
  U0401: { description: 'Invalid data received from the engine control module', severity: 'SERIOUS', system: 'Network' },
};

/**
 * Explain a fault code.
 *
 * Returns `null` only for a string that is not a code at all. Everything else
 * gets at least its family, because "a powertrain fault" beats an opaque token
 * and is true by construction.
 */
export function describeFaultCode(rawCode: string): FaultCodeMeaning | null {
  const code = rawCode.trim().toUpperCase();
  if (!/^[PCBU][0-9][0-9A-F]{3}$/.test(code)) return null;

  const known = GENERIC_FAULTS[code];
  if (known) return { code, ...known };

  const family = familyOf(code);
  if (!family) return null;

  /*
   * No entry, so say only what the code itself guarantees.
   *
   * Severity drops to advisory rather than being guessed: an unknown code could
   * be anything, and marking it critical would train people to ignore the word.
   * A manufacturer code says so, because that is the difference between "look it
   * up" and "look it up in the manual for this make".
   */
  return {
    code,
    description: isManufacturerSpecificFault(code)
      ? `${family.system} fault specific to this manufacturer — check the vehicle's manual`
      : `${family.system} fault`,
    severity: 'ADVISORY',
    system: family.system,
  };
}

/** The worst severity in a set of codes, for a summary line. */
export function worstFaultSeverity(codes: readonly string[]): FaultSeverity | null {
  const order: FaultSeverity[] = ['ADVISORY', 'SERIOUS', 'CRITICAL'];
  let worst: FaultSeverity | null = null;
  for (const code of codes) {
    const meaning = describeFaultCode(code);
    if (!meaning) continue;
    if (worst === null || order.indexOf(meaning.severity) > order.indexOf(worst)) {
      worst = meaning.severity;
    }
  }
  return worst;
}
