package com.saarthi.driver.data

/**
 * Somebody a ride is shared with, named the way the rider knows them: an
 * Indian mobile number or an email address.
 *
 * Kept in step with `rideShareContactSchema` in
 * `packages/shared/src/validation/ride-shares.ts` — the server stays the
 * authority; this only puts the rejection under the field before anything is
 * sent. A number goes through [IndianMobile], so it is read exactly as every
 * other number in the app is.
 */
object FamilyContact {

    /** Something, an @, something with a dot in it — and no spaces. The server holds the full rule. */
    private val EMAIL = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")

    private const val EMAIL_MAX = 254

    /** An email address on its way: a letter or an @ is in it, which no mobile number has. */
    fun isEmail(typed: String): Boolean = typed.any { it.isLetter() || it == '@' }

    /** What the field keeps as it is typed: a number's ten digits, or an address without spaces. */
    fun typed(raw: String): String = if (isEmail(raw)) raw.filterNot(Char::isWhitespace) else IndianMobile.digits(raw)

    /** What is sent and kept: a number's ten digits, or the address in lower case. */
    fun normalised(typed: String): String =
        if (isEmail(typed)) typed.trim().lowercase() else IndianMobile.digits(typed)

    /** Whether [normalised] — already through [normalised] — is a contact the server will take. */
    fun isValid(normalised: String): Boolean =
        if (isEmail(normalised)) normalised.length <= EMAIL_MAX && EMAIL.matches(normalised) else IndianMobile.isValid(normalised)

    /** How it is read back: "+91 98765 43210", or the address as given. */
    fun shown(normalised: String): String =
        if (isEmail(normalised)) normalised else "+91 ${IndianMobile.spaced(normalised)}"
}
