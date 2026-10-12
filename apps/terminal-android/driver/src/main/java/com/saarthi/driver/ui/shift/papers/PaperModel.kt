package com.saarthi.driver.ui.shift.papers

import com.saarthi.core.network.DriverPaperDto
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

/** The paper's own title, or its type made readable — "Insurance certificate". */
internal val DriverPaperDto.displayTitle: String
    get() = title?.takeIf { it.isNotBlank() } ?: documentType.humanised()

internal val DriverPaperDto.isPdf: Boolean
    get() = mimeType?.contains("pdf") == true
