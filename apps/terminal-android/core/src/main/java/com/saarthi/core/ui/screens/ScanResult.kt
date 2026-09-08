package com.saarthi.core.ui.screens

import com.saarthi.core.network.TerminalPairingPayload
import kotlinx.serialization.json.Json

/**
 * What a scanned square turned out to be.
 *
 * Saarthi has more than one kind of QR — a terminal pairing payload, a vehicle
 * identity code, a device pairing payload — and to somebody standing at a truck
 * they all look identical. So a refusal carries a sentence rather than a
 * boolean: "that is the wrong code" leaves a driver scanning the same sticker
 * again, while naming which code they found tells them where to look for the
 * right one.
 */
sealed interface ScanResult {
    /** The code this app was looking for. [token] is what to send onwards. */
    data class Accepted(val token: String) : ScanResult

    /** Something else. [reason] is written for the person holding the phone. */
    data class Refused(val reason: String) : ScanResult
}

private val scanJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

/**
 * A terminal pairing code, as a fitter carries it to a tablet.
 *
 * The default the fitted terminal uses, and the behaviour this scanner had
 * before there were two apps.
 */
fun terminalPairingCode(raw: String): ScanResult {
    val payload = runCatching {
        scanJson.decodeFromString(TerminalPairingPayload.serializer(), raw)
    }.getOrNull() ?: return ScanResult.Refused(describeForeignCode(raw))

    if (payload.kind != "saarthi.terminal.pair") {
        return ScanResult.Refused(
            if (payload.kind == "saarthi.device.pair") {
                "That is a Saarthi Device code. In the dashboard, scroll to Saarthi " +
                    "Terminal on the vehicle's Hardware tab and use Connect a terminal " +
                    "instead."
            } else {
                "That is not a Saarthi Terminal pairing code."
            },
        )
    }

    return ScanResult.Accepted(payload.token)
}

/**
 * A vehicle's own identity code — the sticker on the truck.
 *
 * What the driver app scans. The code encodes an absolute URL ending in
 * `/q/<token>`, because it is also meant to work when scanned by an ordinary
 * camera app: a person who is not a Saarthi driver gets a web page about the
 * vehicle, and a driver gets signed on. Only the token matters here.
 *
 * Deliberately tolerant about the host. Stickers are printed once and glued to
 * a truck for years, and a fleet that moves domain — as Saarthi just did — must
 * not strand every vehicle already carrying one.
 */
fun vehicleIdentityCode(raw: String): ScanResult {
    val trimmed = raw.trim()

    // A pairing payload scanned by a driver is the likeliest wrong code, since
    // both are "the Saarthi QR" to anybody who has not been told otherwise.
    if (trimmed.startsWith("{")) {
        return ScanResult.Refused(
            "That is a terminal pairing code from the dashboard. Scan the code stuck " +
                "to the vehicle instead.",
        )
    }

    val token = QR_PATH.find(trimmed)?.groupValues?.getOrNull(1)
        ?: return ScanResult.Refused(describeForeignCode(trimmed))

    return ScanResult.Accepted(token)
}

/**
 * The token inside a vehicle QR's URL.
 *
 * Anchored on `/q/` rather than on a host, and tolerant of a query string —
 * printed codes carry `?utm=print` — so a sticker keeps working across a domain
 * change and through whatever a scanner app appends to it.
 */
private val QR_PATH = Regex("""/q/([A-Za-z0-9_-]{6,64})""")
