package com.saarthi.owner.ui.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable

/**
 * One tab of an account's shell, as its feature declares it.
 *
 * Each kind of business — fleet, customer, seller, travel, association,
 * personal — lists its own tabs; the shell draws the header, the floating
 * bar, the alerts and the Account tab around them, the same for all.
 */
@Immutable
class TabSpec(
    /** Stable across launches: it is what a restored shell reselects. */
    val key: String,
    val label: String,
    val icon: String,
    /** The fixed header over the tab, or null for a tab that draws edge to edge (a map). */
    val header: TabHeader?,
    val content: @Composable (ShellActions) -> Unit,
)

/** The two lines of the header over a tab. */
@Immutable
data class TabHeader(val eyebrow: String, val title: String)

/** What a tab can ask of the shell around it. */
@Immutable
class ShellActions(
    val openAlerts: () -> Unit,
    /** Switch to another tab by its [TabSpec.key]. */
    val selectTab: (String) -> Unit,
)
