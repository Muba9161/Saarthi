package com.saarthi.device.ui

/**
 * The app's destinations.
 *
 * A sealed hierarchy rather than loose strings, so a typo in a navigation call
 * is a compile error rather than a screen that silently does not open. None of
 * them take an argument — everything the screens render comes from one view
 * model — which is why there is no argument machinery here at all.
 */
sealed class Route(val path: String) {
    data object Welcome : Route("welcome")
    data object Home : Route("home")
    data object Pair : Route("pair")
    data object Telemetry : Route("telemetry")
    data object TestCenter : Route("test-center")
    data object Camera : Route("camera")
    data object Settings : Route("settings")
    data object Debug : Route("debug")
}
