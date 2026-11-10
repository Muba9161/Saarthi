package com.saarthi.driver.ui.update

import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.saarthi.core.network.UpdateOfferDto
import com.saarthi.core.update.UpdateInstaller
import com.saarthi.core.update.UpdateManager.State
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.update.AppUpdates
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.ProgressRing
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rise
import kotlinx.coroutines.delay

/**
 * Humsafar's updates, over whichever screen is showing.
 *
 * Asks on every return to the app (throttled) and every half hour while it
 * stays open, so a build published from the admin console reaches the phone
 * without anybody reinstalling anything. When one is offered, a card with an
 * Update button; one tap and the app downloads, verifies and installs itself
 * while a progress screen says so. The person can carry on using the app while
 * it downloads.
 */
@Composable
fun BoxScope.AppUpdateHost() {
    val context = LocalContext.current
    val updates = (context.applicationContext as SaarthiDriverApp).updates
    val state by updates.state.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) updates.check()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(AppUpdates.CHECK_EVERY_MS)
            updates.check()
        }
    }
    // Android's answer to the install, including its confirmation when it asks.
    DisposableEffect(context) {
        val receiver = UpdateInstaller.observe(context, updates::installFailed)
        onDispose { runCatching { context.unregisterReceiver(receiver) } }
    }
    // One tap: the verified build installs the moment it is ready.
    LaunchedEffect(state) {
        if (state is State.Ready && updates.installWhenReady) updates.install()
    }

    var hidden by rememberSaveable { mutableStateOf(false) }
    val working = state is State.Downloading || state is State.Installing ||
        (state is State.Ready && updates.installWhenReady)

    when (val current = state) {
        is State.Available -> OfferCard(current.offer, ready = false, onUpdate = updates::start, onDismiss = updates::dismiss)
        is State.Ready -> if (!working) {
            OfferCard(current.offer, ready = true, onUpdate = updates::start, onDismiss = updates::dismiss)
        }
        is State.Failed -> FailedCard(current, onRetry = updates::start, onDismiss = updates::dismiss)
        else -> Unit
    }

    if (working) {
        val (offer, fraction) = when (val current = state) {
            is State.Downloading -> current.offer to current.fraction
            is State.Installing -> current.offer to 1f
            is State.Ready -> current.offer to 1f
            else -> return
        }
        val installing = state !is State.Downloading
        if (hidden && !installing) {
            ProgressPill(fraction, onClick = { hidden = false })
        } else {
            ProgressScreen(offer, fraction, installing, onHide = { hidden = true })
        }
    }
    // Back to the full screen next time an update starts.
    LaunchedEffect(working) { if (!working) hidden = false }
}

/**
 * A floating card at the top: what happened, and the one button.
 *
 * The button sits on its own row so the words keep the card's full width on
 * a narrow phone, in any language.
 */
@Composable
private fun BoxScope.TopCard(
    icon: String,
    well: Color,
    ink: Color,
    title: String,
    body: String,
    action: String,
    onAction: () -> Unit,
    /** Null for a mandatory build, which cannot be put off; the manager refuses it too. */
    onDismiss: (() -> Unit)?,
) {
    val c = Saarthi.colors
    Column(
        Modifier
            .align(Alignment.TopCenter)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .widthIn(max = 520.dp)
            .rise()
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconWell(icon, well = well, ink = ink, size = 40.dp, shape = CircleShape, iconSize = 18.dp)
            Column(Modifier.weight(1f)) {
                Text(title, style = SType.bodyStrong, color = c.fg)
                Text(body, style = SType.small, color = c.muted)
            }
            if (onDismiss != null) {
                CircleButton(Lucide.close, stringResource(R.string.update_dismiss), onDismiss, size = 36.dp, iconSize = 14.dp, elevated = false, background = Color.Transparent, ink = c.subtle)
            }
        }
        SaarthiButton(action, onAction, height = 44.dp, radius = 14.dp, textStyle = SType.buttonSmall, leading = Lucide.download)
    }
}

@Composable
private fun BoxScope.OfferCard(offer: UpdateOfferDto, ready: Boolean, onUpdate: () -> Unit, onDismiss: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    TopCard(
        icon = Lucide.download,
        well = c.primarySoft,
        ink = c.primary,
        title = stringResource(R.string.update_available_title),
        body = if (ready) {
            stringResource(R.string.update_ready_body, offer.versionName)
        } else {
            stringResource(R.string.update_available_body, offer.versionName, Formatter.formatShortFileSize(context, offer.sizeBytes))
        },
        action = stringResource(R.string.update_action),
        onAction = onUpdate,
        onDismiss = onDismiss.takeUnless { offer.mandatory },
    )
}

@Composable
private fun BoxScope.FailedCard(failed: State.Failed, onRetry: () -> Unit, onDismiss: () -> Unit) {
    val c = Saarthi.colors
    TopCard(
        icon = Lucide.alertTriangle,
        well = c.dangerSoft,
        ink = c.danger,
        title = stringResource(R.string.update_failed_title),
        body = failed.reason,
        action = stringResource(R.string.update_retry),
        onAction = onRetry,
        onDismiss = onDismiss.takeUnless { failed.offer.mandatory },
    )
}

/**
 * "Updating Humsafar" — the whole screen, with the ring filling as it downloads.
 *
 * While it downloads the person may step back into the app; once installing,
 * there is nothing to go back to, because Android is about to close it.
 */
@Composable
private fun ProgressScreen(offer: UpdateOfferDto, fraction: Float?, installing: Boolean, onHide: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    Box(
        Modifier
            .fillMaxSize()
            .background(c.canvas.copy(alpha = 0.97f))
            // Swallows taps: nothing underneath should react while this is up.
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = {}),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(32.dp)
                .widthIn(max = 420.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                ProgressRing(
                    track = c.border,
                    fill = c.primary,
                    fraction = if (installing) 1f else fraction ?: 0f,
                    strokeWidth = 6.dp,
                    modifier = Modifier.size(120.dp),
                )
                Text(
                    if (installing || fraction == null) "" else "${(fraction * 100).toInt()}%",
                    style = SType.title,
                    color = c.fg,
                )
                if (installing || fraction == null) {
                    IconWell(Lucide.download, well = Color.Transparent, ink = c.primary, size = 56.dp, iconSize = 30.dp)
                }
            }
            Text(stringResource(R.string.update_progress_title), style = SType.title, color = c.fg, textAlign = TextAlign.Center)
            Text(
                if (installing) {
                    stringResource(R.string.update_installing)
                } else {
                    val done = fraction?.let { (offer.sizeBytes * it).toLong() }
                    stringResource(R.string.update_downloading, offer.versionName) +
                        (done?.let { "\n" + stringResource(R.string.update_progress_size, Formatter.formatShortFileSize(context, it), Formatter.formatShortFileSize(context, offer.sizeBytes)) } ?: "")
                },
                style = SType.body,
                color = c.muted,
                textAlign = TextAlign.Center,
            )
            if (!installing) {
                LinkButton(stringResource(R.string.update_hide), onHide)
            }
        }
    }
}

/** The download carrying on while the person uses the app. Tap to see it again. */
@Composable
private fun BoxScope.ProgressPill(fraction: Float?, onClick: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .align(Alignment.TopCenter)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(top = 10.dp)
            .card(radius = 999.dp)
            .pressable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ProgressRing(track = c.border, fill = c.primary, fraction = fraction ?: 0f, strokeWidth = 3.dp, modifier = Modifier.size(20.dp))
        Text(
            stringResource(R.string.update_progress_title) + (fraction?.let { "  ${(it * 100).toInt()}%" } ?: ""),
            style = SType.smallStrong,
            color = c.fg,
        )
    }
}
