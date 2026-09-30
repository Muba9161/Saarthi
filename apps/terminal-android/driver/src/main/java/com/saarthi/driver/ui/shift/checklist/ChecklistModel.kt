package com.saarthi.driver.ui.shift.checklist

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.saarthi.core.network.ChecklistItemDto
import com.saarthi.core.network.ChecklistResultDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.Saarthi

/**
 * The answers a driver can give, each with the status the server records.
 *
 * `OK`, `ATTENTION` and `CRITICAL` are the only verdicts a person can give in
 * the API's own vocabulary; `UNAVAILABLE` is what the view model sends for an
 * item nobody answered, and never something the driver picks.
 */
internal enum class CheckAnswer(val status: String, @StringRes val label: Int, val icon: String) {
    GOOD("OK", R.string.checklist_answer_good, Lucide.check),
    ATTENTION("ATTENTION", R.string.checklist_answer_attention, Lucide.alertTriangle),
    FAULTY("CRITICAL", R.string.checklist_answer_faulty, Lucide.close),
    ;

    companion object {
        fun of(status: String?): CheckAnswer? = entries.firstOrNull { it.status == status }

        /**
         * Faulty is offered only where it can stop a trip. On a non-blocking
         * item it would read as a fault that grounds the vehicle when it does
         * not, and teach drivers the button means nothing.
         */
        fun offeredFor(item: ChecklistItemDto): List<CheckAnswer> =
            if (item.blocking) entries else listOf(GOOD, ATTENTION)
    }
}

/** Soft ground and ink for an answer, in the current theme. */
@Composable
internal fun CheckAnswer?.tone(): Pair<Color, Color> {
    val c = Saarthi.colors
    return when (this) {
        CheckAnswer.GOOD -> c.successSoft to c.success
        CheckAnswer.ATTENTION -> c.warningSoft to c.warning
        CheckAnswer.FAULTY -> c.dangerSoft to c.danger
        null -> c.sunken to c.muted
    }
}

/**
 * Answered by the vehicle itself — a sensor reading, the document register —
 * so the driver is shown the verdict and offered nothing to press. A sensor
 * cannot be overruled from the cab, and a toggle would suggest it can.
 */
internal val ChecklistItemDto.automatic: Boolean
    get() = !manualInputRequired && status != null

/** The server's roll-up for a check with a blocking fault: the trip may not start. */
private const val OUTCOME_FAILED = "FAILED"

/** Passed, but something was marked as needing attention or could not be read. */
private const val OUTCOME_WARNINGS = "PASSED_WITH_WARNINGS"

/** Where the check stands once it has been loaded. */
internal sealed interface CheckPhase {
    data object Items : CheckPhase
    data object Submitting : CheckPhase
    data class Done(val warnings: Boolean) : CheckPhase

    /** The vehicle must not be driven: [reasons] as the server names them, [codes] to find them again. */
    data class Blocked(val reasons: List<String>, val codes: Set<String>) : CheckPhase

    /** No answer came back at all — offline, or refused before a verdict. */
    data object SendFailed : CheckPhase

    companion object {
        fun of(result: ChecklistResultDto?): CheckPhase {
            if (result == null) return SendFailed
            if (result.outcome != OUTCOME_FAILED) return Done(warnings = result.outcome == OUTCOME_WARNINGS)
            val faults = result.items.filter { it.blocking && it.status == CheckAnswer.FAULTY.status }
            return Blocked(
                reasons = result.blockedBy.ifEmpty { faults.map { it.label } },
                codes = faults.map { it.code }.toSet(),
            )
        }
    }
}

/** A reading as a driver says it: "64 %", "27.4 V" — whole numbers without the ".0". */
internal fun reading(value: Double, unit: String?): String {
    val number = if (value % 1.0 == 0.0) value.toLong().toString() else "%.1f".format(value)
    return if (unit.isNullOrBlank()) number else "$number $unit"
}

/**
 * The picture on a check card, by the catalogue's item code.
 *
 * Codes rather than labels, because a fleet may rename "Brakes" to anything it
 * likes and the brake card should still show the brake. A code this app has
 * never heard of — fleets add their own — gets the shield.
 */
internal fun itemIcon(code: String): String = when (code) {
    "TYRES" -> Lucide.tyreCheck
    "LIGHTS" -> Lucide.bulb
    "BRAKES" -> Lucide.clock
    "LOAD" -> Lucide.box
    "FUEL" -> Lucide.fuel
    "DOCUMENTS" -> Lucide.fileText
    "MIRRORS" -> Lucide.eye
    "EMERGENCY_EQUIPMENT" -> Lucide.siren
    "COOLANT" -> THERMOMETER
    "ENGINE_OIL" -> DROPLET
    "BATTERY" -> BATTERY
    else -> Lucide.shieldCheck
}

private const val THERMOMETER = "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"
private const val DROPLET =
    "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"
private const val BATTERY = "M4 7h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM22 11v2"
