import type { DeviceProvider, NormalizedTelemetry } from '@saarthi/shared';

/**
 * Device adapter contract.
 *
 * This is the *only* place in Saarthi that is allowed to know how a particular
 * vendor names its fields. An adapter takes whatever the hardware sent and
 * returns `NormalizedTelemetry`; everything downstream — storage, alert rules,
 * driver scoring, the dashboard — sees only the normalised shape.
 *
 * That boundary is the whole reason the architecture holds. Section 47 of the
 * expansion spec asks for GPS trackers, OBD dongles, CAN and J1939 loggers and
 * manufacturer APIs to be addable later; if a single `if (provider === ...)`
 * leaks past this interface, each new vendor becomes a change across the
 * application instead of one new file in this folder.
 *
 * ## The honesty requirement
 *
 * An adapter must populate `metrics` with exactly the values it actually read.
 * It must never default a missing reading to zero. A Freematics ONE+ fitted to
 * a modern OBD-II car reports coolant temperature; the same unit on an older
 * J1939 truck may not, and "0 °C" would send a mechanic looking for a fault
 * that does not exist.
 */

export interface AdapterContext {
  /** Device identifier as authenticated by the gateway. */
  deviceIdentifier: string;
  /** Vehicle resolved from the device's active assignment, if any. */
  vehicleId: string | null;
  /** Server time at which the payload arrived, for clock-skew handling. */
  receivedAt: Date;
}

export interface AdapterResult {
  /** One entry per reading; a batch payload yields several. */
  readings: NormalizedTelemetry[];
  /** Non-fatal problems worth logging, e.g. an unknown field. */
  warnings: string[];
}

export interface DeviceAdapter {
  readonly provider: DeviceProvider;
  readonly name: string;
  /**
   * Turn a vendor payload into normalised readings.
   *
   * Implementations must not throw for merely unexpected content — return the
   * readings they could parse and describe the rest in `warnings`. Throwing is
   * reserved for a payload that is structurally unusable, which the gateway
   * records as a rejection against the device.
   */
  parse(payload: unknown, context: AdapterContext): AdapterResult;
}
