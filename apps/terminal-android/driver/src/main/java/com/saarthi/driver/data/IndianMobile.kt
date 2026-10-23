package com.saarthi.driver.data

/**
 * An Indian mobile number, the way every form in the app takes one.
 *
 * Shared by registration and by sharing a ride with family, so the two can
 * never disagree about what counts as a mobile number. Kept in step with
 * `phoneSchema` in `packages/shared/src/validation/common.ts` — the server
 * stays the authority; this only puts the rejection under the field before
 * anything is sent.
 */
object IndianMobile {

    /** Ten digits, starting 6 to 9 — `phoneSchema` without the +91 the field shows itself. */
    private val VALID = Regex("""^[6-9]\d{9}$""")

    /** The digits a number is stored and sent as. */
    const val LENGTH = 10

    /** Ten digits, however the number was typed — spaces, a pasted +91, a leading 0. */
    fun digits(raw: String): String {
        val digits = raw.filter(Char::isDigit)
        return when {
            digits.length == 12 && digits.startsWith("91") -> digits.drop(2)
            digits.length == 11 && digits.startsWith("0") -> digits.drop(1)
            else -> digits
        }.take(LENGTH)
    }

    /** Whether [digits] — already through [digits] — is a mobile number the server will take. */
    fun isValid(digits: String): Boolean = VALID.matches(digits)

    /** "98765 43210", the way a person reads a number back. */
    fun spaced(digits: String): String =
        if (digits.length == LENGTH) "${digits.take(5)} ${digits.drop(5)}" else digits
}
