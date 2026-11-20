package com.saarthi.driver.festive

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.saarthi.core.festive.FestiveBandStyle
import com.saarthi.core.festive.rememberFestiveLook
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.Saarthi

/**
 * What Home's header wears on a festival day: the wish addressed to the driver
 * in the festival's colour, and the garland above it ([band] null when this
 * build cannot draw the festival's motif).
 */
class HomeFestive(val greeting: String, val color: Color, val band: FestiveBandStyle?)

/**
 * Today's festival for Home, or null.
 *
 * Null whenever festive looks is off, on an ordinary day, and wherever the
 * caller says it must step aside ([shown] false): the ride and SOS screens
 * stay exactly as they are. Static: nothing here moves.
 *
 * @param name the driver's name; only the first word is used.
 */
@Composable
fun rememberHomeFestive(name: String?, shown: Boolean): HomeFestive? {
    val looks = (LocalContext.current.applicationContext as SaarthiDriverApp).festiveLooks
    val on by looks.on.collectAsState()
    val look = rememberFestiveLook(enabled = on) ?: return null
    if (!shown) return null
    val ink = if (Saarthi.colors.dark) look.wishOnDark else look.wishOnLight
    return HomeFestive(look.greeting(name), Color(ink), look.band)
}
