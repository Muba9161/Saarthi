package com.saarthi.driver.ride

import com.saarthi.driver.data.IndianMobile
import com.saarthi.driver.network.RideSharesApi
import java.time.Instant

/**
 * The rules riding along follows, with no Android in them.
 *
 * Riding along is sharing a ride with family: the vehicle's number, who should
 * see, and the phone's position until the rider stops. Kept apart from the
 * screens and the reporting service so each rule can be tested properly — who
 * is offered riding along at all, which screen a share belongs on, which
 * numbers are sent, when the rider's own owner app is offered, which fixes are
 * worth sending, and what to do when the server refuses them. Each looks obviously right and can be quietly wrong
 * without anything on screen saying so.
 */
object RideSharePolicy {

    /** Family named at once — the server's own limit. */
    const val MAX_CONTACTS = 5

    /** The server's bounds on a vehicle number. */
    const val PLATE_MIN = 2
    const val PLATE_MAX = 20

    /** Fixes in one upload — the server's own limit. */
    const val MAX_POINTS = 100

    /** The server's own limits on a fix. One reading outside them refuses the whole upload. */
    private const val MAX_SPEED_KPH = 200.0
    private const val MAX_ACCURACY_METRES = 5_000.0

    // -----------------------------------------------------------------------
    // Who is asked "How are you travelling?"
    // -----------------------------------------------------------------------

    /** Where a signed-in person with nothing open starts. */
    enum class Home {
        /** "How are you travelling?" — driving, or riding along. */
        CHOOSE_ROLE,

        /** The vehicle screen, exactly as before riding along existed. */
        CHOOSE_VEHICLE,
    }

    /**
     * Where to start, from whether this account may ride along.
     *
     * The server decides who may — the app never guesses from the account
     * type. Only a clear yes asks the question: a no, and no answer at all —
     * offline, or a server that does not know the question — go straight to
     * the vehicle screen, which is always right for a driver.
     */
    fun homeFor(rideAlong: Boolean?): Home = if (rideAlong == true) Home.CHOOSE_ROLE else Home.CHOOSE_VEHICLE

    /**
     * Whether a refused share says this account may not ride along (any more)
     * — after which the person is a driver, on the vehicle screen, with the
     * server's reason in front of them.
     */
    fun notAllowed(status: Int): Boolean = status == FORBIDDEN

    // -----------------------------------------------------------------------
    // Setting a share up
    // -----------------------------------------------------------------------

    /** Which screen a share belongs on. */
    enum class Phase { SHARING, OVER }

    /**
     * Whether this share is live. Null is over — the server answers "nothing"
     * once a share has been stopped or has run out of time — and so is a status
     * this build has never heard of, which cannot be a share it knows how to show.
     */
    fun phaseOf(share: RideSharesApi.ShareView?): Phase =
        if (share?.status == SHARING) Phase.SHARING else Phase.OVER

    /**
     * The vehicle number to send — trimmed — or null while it is not one the
     * server takes. Free text: nothing is looked up, it only tells family
     * which vehicle to look for.
     */
    fun plateOf(typed: String): String? = typed.trim().takeIf { it.length in PLATE_MIN..PLATE_MAX }

    /**
     * The numbers to send, from what was typed — ten digits each, blanks left
     * out, each number once — or null when any of them is not a mobile number
     * or there are more than the server takes.
     *
     * All or nothing, because the server refuses the whole list for one bad
     * number, and a share started without the person meant to be told is worse
     * than a field asking for the number again.
     */
    fun contactsOf(typed: List<String>): List<String>? {
        val numbers = typed.map(IndianMobile::digits).filter { it.isNotEmpty() }
        if (numbers.any { !IndianMobile.isValid(it) }) return null
        return numbers.distinct().takeIf { it.size <= MAX_CONTACTS }
    }

    // -----------------------------------------------------------------------
    // The rider's own owner app
    // -----------------------------------------------------------------------

    /** What the Sharing screen says about the rider's own owner app. */
    enum class SelfShare {
        /** Nothing: this login holds no owner account. */
        HIDDEN,

        /** "Show on my owner app" — the login has one, and the ride is not on it yet. */
        OFFERED,

        /** "Showing on your owner app". */
        SHOWING,
    }

    /**
     * Whether to offer, or confirm, the ride on the rider's own owner app.
     *
     * The share's own word wins: one already showing there says so even before
     * this session has heard whether the login holds an owner account.
     */
    fun selfShareOf(hasOwnerAccount: Boolean, share: RideSharesApi.ShareView): SelfShare = when {
        share.sharedWithSelf -> SelfShare.SHOWING
        hasOwnerAccount -> SelfShare.OFFERED
        else -> SelfShare.HIDDEN
    }

    /**
     * Whether a new share asks to be shown on the rider's own owner app — only
     * when the login holds one, whatever the switch was left at, since the
     * server cannot show a ride on an account that is not there.
     */
    fun shareWithSelf(hasOwnerAccount: Boolean, chosen: Boolean): Boolean = hasOwnerAccount && chosen

    /** Why "Show on my owner app" was refused. */
    enum class SelfRefusal {
        /** The login holds no owner account after all — stop offering it. */
        NO_OWNER_ACCOUNT,

        /** The share is over — say so, as running out of time would. */
        SHARE_ENDED,

        /** Anything else: the server's words, and the offer stays. */
        OTHER,
    }

    fun afterSelfRefusal(status: Int): SelfRefusal = when (status) {
        UNPROCESSABLE -> SelfRefusal.NO_OWNER_ACCOUNT
        CONFLICT -> SelfRefusal.SHARE_ENDED
        else -> SelfRefusal.OTHER
    }

    // -----------------------------------------------------------------------
    // Sending the phone's position
    // -----------------------------------------------------------------------

    /**
     * One fix, in the shape the server accepts, or null when it is not a place.
     *
     * Readings outside the server's limits are pulled back inside them rather
     * than sent as they are: the server refuses a whole upload for one bad
     * value, and a single GPS glitch reading 240 km/h would otherwise cost the
     * fixes either side of it. Speed and heading are left out when the phone
     * did not measure them, never sent as zero.
     */
    fun pointOf(
        latitude: Double,
        longitude: Double,
        speedMps: Float?,
        bearingDegrees: Float?,
        accuracyMetres: Float?,
        atMillis: Long,
    ): RideSharesApi.Point? {
        if (latitude.isNaN() || longitude.isNaN()) return null
        if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return null
        return RideSharesApi.Point(
            latitude = latitude,
            longitude = longitude,
            speedKph = speedMps?.takeIf { it.isFinite() }?.let { (it * MPS_TO_KPH).coerceIn(0.0, MAX_SPEED_KPH) },
            heading = bearingDegrees?.takeIf { it.isFinite() }?.toDouble()?.coerceIn(0.0, 360.0),
            accuracy = accuracyMetres?.takeIf { it.isFinite() }?.toDouble()?.coerceIn(0.0, MAX_ACCURACY_METRES),
            recordedAt = Instant.ofEpochMilli(atMillis).toString(),
        )
    }

    /** What to do with fixes the server would not take. */
    enum class Refusal {
        /** Keep them and try again on the next upload. */
        RETRY,

        /** Drop them: the server will refuse them again however often they are sent. */
        DISCARD,

        /** Stop reporting altogether — the share is over, or its key is wrong. */
        STOP,
    }

    /**
     * The answer to a refused upload, from its HTTP status — null when there
     * was no connection at all.
     *
     * 409 is the important one: the share is no longer on, so the phone stops
     * reporting for it rather than asking again every few seconds until the
     * battery runs out.
     */
    fun afterRefusal(status: Int?): Refusal = when {
        status == null -> Refusal.RETRY
        status == 401 || status == 403 || status == 404 || status == 409 -> Refusal.STOP
        status == 408 || status == 429 || status >= 500 -> Refusal.RETRY
        else -> Refusal.DISCARD
    }

    private const val SHARING = "SHARING"
    private const val FORBIDDEN = 403
    private const val CONFLICT = 409
    private const val UNPROCESSABLE = 422
    private const val MPS_TO_KPH = 3.6
}
