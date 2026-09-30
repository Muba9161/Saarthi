package com.saarthi.driver.ui.shift.papers

import androidx.annotation.StringRes
import com.saarthi.core.network.DriverPaperDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.shift.humanised

/** The platform's "expiring soon" window — `DEFAULT_EXPIRING_SOON_DAYS` in `@saarthi/shared`. */
private const val EXPIRING_SOON_DAYS = 30

/** How the server marks whose paper it is. */
internal const val OWNER_VEHICLE = "TRUCK"
internal const val OWNER_DRIVER = "DRIVER"

/**
 * Where a paper stands against its expiry date.
 *
 * Judged from the server's own day count, never from the phone's clock, so
 * the pill and the fleet's dashboard cannot disagree about which paper lapses first.
 */
internal enum class Expiry {
    EXPIRED,
    SOON,
    VALID,
    UNKNOWN,
    ;

    val needsAttention: Boolean get() = this == EXPIRED || this == SOON
}

internal val DriverPaperDto.expiry: Expiry
    get() {
        val days = daysToExpiry ?: return Expiry.UNKNOWN
        return when {
            days < 0 -> Expiry.EXPIRED
            days <= EXPIRING_SOON_DAYS -> Expiry.SOON
            else -> Expiry.VALID
        }
    }

/** The design's three chips: everything, the vehicle's papers, the driver's own. */
internal enum class PaperFilter(@StringRes val label: Int) {
    ALL(R.string.papers_filter_all),
    VEHICLE(R.string.papers_owner_vehicle),
    YOURS(R.string.papers_owner_yours),
    ;

    fun admits(paper: DriverPaperDto): Boolean = when (this) {
        ALL -> true
        VEHICLE -> paper.ownerType == OWNER_VEHICLE
        YOURS -> paper.ownerType == OWNER_DRIVER
    }
}

/** The paper's own title, or its type made readable — "Insurance certificate". */
internal val DriverPaperDto.displayTitle: String
    get() = title?.takeIf { it.isNotBlank() } ?: documentType.humanised()

internal val DriverPaperDto.isPdf: Boolean
    get() = mimeType?.contains("pdf") == true
