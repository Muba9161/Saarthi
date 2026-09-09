package com.saarthi.driver.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URLDecoder

/**
 * Somewhere a driver was sent, arriving from another app.
 *
 * The job this does is small and the reason for it is not. A driver is told
 * where to go by a person, not by a dispatch system: a consignor sends a pin on
 * WhatsApp, a yard manager pastes a Maps link, a customer shares their live
 * location. Until now every one of those ended the same way — the driver opened
 * Google Maps, drove by that, and Saarthi recorded a journey it could not see
 * the destination of. The whole premise of this app is that a driver does not
 * have to leave it to start work.
 *
 * The parsing is deliberately generous about *format* and strict about
 * *plausibility*. There are a dozen shapes a shared location arrives in and no
 * driver should have to know which; but a number that is not a coordinate must
 * never become a destination, because the failure mode there is a truck sent
 * somewhere nobody chose.
 */
data class SharedDestination(
    val latitude: Double,
    val longitude: Double,
    /** What to call it on the map. Often absent, and a coordinate will do. */
    val label: String?,
) {
    companion object {
        /**
         * India, generously bounded, plus the rest of the world.
         *
         * Not restricted to India: a coordinate is a coordinate, and a fleet
         * near a border would be badly served by a parser that refused one. The
         * check exists only to reject numbers that are not coordinates at all.
         */
        private fun plausible(latitude: Double, longitude: Double): Boolean =
            latitude in -90.0..90.0 &&
                longitude in -180.0..180.0 &&
                // 0,0 is in the Atlantic and is what a broken parser produces,
                // never what a person shares.
                !(latitude == 0.0 && longitude == 0.0)

        /** A bare `lat,lng` pair, with or without spaces, signed or not. */
        private val PAIR = Regex("""(-?\d{1,3}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})""")

        /**
         * Google's own place anchor: `/@lat,lng,17z`.
         *
         * Listed before the generic pair because a Maps URL usually contains
         * both this and a viewport centre, and this is the one that is the
         * place rather than the camera.
         */
        private val AT_ANCHOR = Regex("""@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)""")

        /** The pair Google hides in the protobuf-ish tail: `!3d<lat>!4d<lng>`. */
        private val BANG_PAIR = Regex("""!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)""")

        /** `?q=`, `?ll=`, `?daddr=`, `?destination=` — all mean the same thing. */
        private val QUERY_KEYS = listOf("q", "ll", "daddr", "destination", "center", "viewpoint")

        /**
         * Pull a destination out of whatever was shared.
         *
         * Accepts a `geo:` URI, a Maps URL of any of the several shapes Google
         * emits, or a message with a link or a coordinate pair buried in it —
         * which is what a forwarded WhatsApp location actually looks like.
         *
         * Returns null for a short link (`maps.app.goo.gl`), which carries no
         * coordinates at all until it has been followed. See [isShortLink]: that
         * needs the network and so cannot happen here.
         */
        fun parse(raw: String?): SharedDestination? {
            val text = raw?.trim().orEmpty()
            if (text.isEmpty()) return null

            geoUri(text)?.let { return it }
            queryParameter(text)?.let { return it }

            // Google's place anchor beats the generic sweep: in a full Maps URL
            // the `!3d!4d` tail and `@` anchor are the place, and a bare pair
            // elsewhere in the string may be the camera or a plus code.
            BANG_PAIR.find(text)?.let { m -> coordinate(m, label = null)?.let { return it } }
            AT_ANCHOR.find(text)?.let { m -> coordinate(m, label = null)?.let { return it } }
            PAIR.find(text)?.let { m -> coordinate(m, label = null)?.let { return it } }

            return null
        }

        /**
         * Whether this needs a round trip before it means anything.
         *
         * Google's share sheet produces these by default, so it is the commonest
         * form of all — and it is opaque: the coordinates exist only at the far
         * end of a redirect.
         */
        fun isShortLink(raw: String?): Boolean {
            val text = raw?.trim().orEmpty()
            return SHORT_LINK.containsMatchIn(text)
        }

        /** The first URL in a block of text, so a forwarded message still works. */
        fun firstUrl(raw: String?): String? =
            raw?.let { URL_IN_TEXT.find(it)?.value }

        private val SHORT_LINK = Regex(
            """https?://(maps\.app\.goo\.gl|goo\.gl/maps|g\.co/kgs)/\S+""",
            RegexOption.IGNORE_CASE,
        )

        private val URL_IN_TEXT = Regex("""https?://\S+""", RegexOption.IGNORE_CASE)

        /**
         * `geo:lat,lng`, and the `geo:0,0?q=…` form Android prefers.
         *
         * The second exists because the scheme was designed before anyone
         * needed to attach a name, so the coordinates are parked at zero and the
         * real ones go in the query. A parser that reads only the path takes
         * every such share to the middle of the Atlantic.
         */
        private fun geoUri(text: String): SharedDestination? {
            if (!text.startsWith("geo:", ignoreCase = true)) return null

            val body = text.removePrefix("geo:").removePrefix("GEO:")
            val query = body.substringAfter('?', "")
            if (query.isNotEmpty()) {
                queryParameter("?$query")?.let { return it }
            }

            val path = body.substringBefore('?')
            return PAIR.find(path)?.let { coordinate(it, label = null) }
        }

        /** A coordinate, or a place name, sitting in a URL query parameter. */
        private fun queryParameter(text: String): SharedDestination? {
            val query = text.substringAfter('?', "").ifEmpty { return null }
            for (part in query.split('&')) {
                val key = part.substringBefore('=').lowercase()
                if (key !in QUERY_KEYS) continue

                val value = decode(part.substringAfter('=', ""))
                if (value.isBlank()) continue

                // `q=28.61,77.20 (Warehouse 4)` — the name is optional and comes
                // in brackets, which is the convention `geo:` settled on.
                val label = Regex("""\(([^)]+)\)""").find(value)?.groupValues?.get(1)?.trim()
                PAIR.find(value)?.let { m ->
                    coordinate(m, label)?.let { return it }
                }
            }
            return null
        }

        private fun coordinate(match: MatchResult, label: String?): SharedDestination? {
            val latitude = match.groupValues[1].toDoubleOrNull() ?: return null
            val longitude = match.groupValues[2].toDoubleOrNull() ?: return null
            if (!plausible(latitude, longitude)) return null
            return SharedDestination(latitude, longitude, label?.takeIf { it.isNotBlank() })
        }

        private fun decode(value: String): String =
            runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
    }
}

/**
 * The destination waiting to be acted on.
 *
 * A share can arrive at any moment, including while the driver is still signing
 * in or waiting for their fleet to approve them, so it is held rather than
 * applied. The cockpit picks it up when there is a vehicle to route from, and
 * clears it once it has.
 */
class SharedDestinationInbox {
    private val _pending = MutableStateFlow<SharedDestination?>(null)
    val pending: StateFlow<SharedDestination?> = _pending.asStateFlow()

    fun offer(destination: SharedDestination) {
        _pending.value = destination
    }

    /** Take it, exactly once. */
    fun take(): SharedDestination? = _pending.value?.also { _pending.value = null }

    fun clear() {
        _pending.value = null
    }
}
