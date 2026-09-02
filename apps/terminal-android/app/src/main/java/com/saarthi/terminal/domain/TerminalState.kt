package com.saarthi.terminal.domain

/**
 * What the terminal is doing, as one value.
 *
 * A mirror of `TerminalState` in `packages/shared/src/domain/terminal.ts`, and
 * deliberately a mirror rather than an interpretation: the *server* decides
 * which state a terminal is in, and this enum exists so the app can render that
 * decision without reconstructing it from a handful of booleans and getting it
 * subtly wrong on a cold start.
 *
 * Section 8 of the specification is explicit that the lifecycle must not be
 * represented by scattered UI flags. This is that requirement in one type: a
 * screen asks `when (state)` and there is exactly one answer.
 */
enum class TerminalState {
    /** Enrolled, but not connected to a vehicle. The first screen. */
    UNPAIRED,
    PAIRING,
    VEHICLE_PAIRED,

    /** Idle at the vehicle, showing its permanent QR. The resting state. */
    AWAITING_DRIVER,

    DRIVER_IDENTIFIED,
    SELFIE_SUBMITTED,
    PENDING_APPROVAL,
    APPROVED,

    /** Approved, safety check outstanding. */
    CHECKLIST_REQUIRED,

    READY,
    TRIP_ACTIVE,
    TRIP_COMPLETED,
    REJECTED,

    /** Credentials revoked or the terminal suspended. Nothing works until fixed. */
    REVOKED,
    ;

    /** Whether the driver may operate the vehicle. */
    val driverAuthorized: Boolean
        get() = this == READY || this == TRIP_ACTIVE || this == TRIP_COMPLETED

    /** Whether the cockpit — map, services, vehicle screens — is reachable. */
    val cockpitAvailable: Boolean get() = driverAuthorized

    /** Whether this state is waiting on somebody other than the driver. */
    val waitingOnFleet: Boolean get() = this == PENDING_APPROVAL

    companion object {
        /**
         * Parse a state name from the server.
         *
         * Falls back to [UNPAIRED] rather than throwing. A terminal that has not
         * been updated in a year may meet a state this build has never heard of,
         * and a crash in a truck cab is a far worse outcome than a screen that
         * asks somebody to pair the device.
         */
        fun parse(value: String?): TerminalState =
            entries.firstOrNull { it.name == value } ?: UNPAIRED
    }
}

/**
 * The persisted session status, as the server stores it.
 *
 * Distinct from [TerminalState] because they answer different questions.
 * `APPROVED` is one session status but two terminal states — with the safety
 * check outstanding, and with it done — and folding them together is how a
 * driver ends up being shown a cockpit before completing the check.
 */
enum class SessionStatus {
    DRIVER_IDENTIFIED,
    SELFIE_SUBMITTED,
    PENDING_APPROVAL,
    APPROVED,
    READY,
    TRIP_ACTIVE,
    COMPLETED,
    REJECTED,
    CANCELLED,
    EXPIRED,
    ;

    companion object {
        fun parse(value: String?): SessionStatus? = entries.firstOrNull { it.name == value }
    }
}

/** How a checklist ended. */
enum class ChecklistOutcome {
    PASSED,
    PASSED_WITH_WARNINGS,
    FAILED,
    ;

    val blocksTrip: Boolean get() = this == FAILED

    companion object {
        fun parse(value: String?): ChecklistOutcome? = entries.firstOrNull { it.name == value }
    }
}

/** One checklist line's verdict. */
enum class ChecklistItemStatus {
    OK,
    ATTENTION,
    CRITICAL,
    /** No data and no inspection. Recorded as unknown, never as a pass. */
    UNAVAILABLE,
    SKIPPED,
    ;

    companion object {
        fun parse(value: String?): ChecklistItemStatus? = entries.firstOrNull { it.name == value }
    }
}
