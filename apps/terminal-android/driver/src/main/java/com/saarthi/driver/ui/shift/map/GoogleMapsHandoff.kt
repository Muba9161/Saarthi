package com.saarthi.driver.ui.shift.map

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.saarthi.core.domain.GoogleMapsLink
import com.saarthi.core.ui.TerminalViewModel

/**
 * Hand the route on the map to Google Maps and open it there.
 *
 * Aimed at the Google Maps app, so a browser or another map app does not answer
 * first; on a phone without it the link still opens — a browser shows the same
 * route — because a driver asked to be shown the way must be shown something.
 * Saarthi keeps recording either way.
 */
internal fun Context.navigateInGoogleMaps(cockpit: TerminalViewModel) {
    val link = cockpit.handOffToGoogleMaps() ?: return
    val uri = Uri.parse(link)
    try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(GoogleMapsLink.PACKAGE))
    } catch (_: ActivityNotFoundException) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }
}
