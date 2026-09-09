package com.saarthi.driver.ui.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBackIosNew
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The surfaces the driver app is built from.
 *
 * Three of them carry almost the whole app, and the difference between them is
 * meaning rather than decoration:
 *
 *  * [FleetCard] is *information*. Dark, edged with a hairline, never pressed.
 *  * [EmberCard] is *an outcome* — something that has happened or is about to.
 *    Orange, and used sparingly, because on a screen where one thing is orange
 *    a driver's eye goes to it without being asked.
 *  * [FleetTile] is *an action*. Smaller, with an icon chip, and it moves under
 *    a thumb.
 *
 * A fourth, [FleetSheet], is the detour: a full-height panel that comes up over
 * whatever the driver was doing and puts them back there when it closes.
 */

/**
 * The page.
 *
 * Every driver screen starts here. It owns three things nobody should have to
 * remember per-screen: the ground, the system-bar inset, and the fact that the
 * content scrolls.
 *
 * `scrollable = false` is for screens that manage their own — a camera
 * viewfinder that must not scroll, or a `LazyColumn`, which throws when it is
 * given infinite height by a scrolling parent.
 */
@Composable
fun FleetScreen(
    modifier: Modifier = Modifier,
    scrollable: Boolean = true,
    horizontalPadding: Dp = FleetSpace.roomy,
    /**
     * The fill painted behind the content.
     *
     * `null` leaves it transparent, which is what a screen wants when something
     * has already been drawn underneath it — the map panel on the approval
     * screens is behind this, and an opaque ground would simply cover it.
     */
    ground: Brush? = FleetGround,
    content: @Composable ColumnScope.() -> Unit,
) {
    val base = modifier
        .fillMaxSize()
        .let { if (ground != null) it.background(ground) else it }
        .systemBarsPadding()

    Column(
        modifier = if (scrollable) {
            base
                .verticalScroll(rememberScrollState())
                .padding(horizontal = horizontalPadding)
        } else {
            base.padding(horizontal = horizontalPadding)
        },
        content = content,
    )
}

/**
 * A card.
 *
 * The hairline border matters more than it looks: on an OLED panel at low
 * brightness a 4% lift between card and ground is invisible, and the edge is
 * what tells a driver where one block of information ends. It is not a
 * decoration that could be dropped.
 */
@Composable
fun FleetCard(
    modifier: Modifier = Modifier,
    padding: Dp = FleetSpace.roomy,
    corner: Dp = FleetRadius.card,
    fill: Color = Onyx,
    bordered: Boolean = true,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(corner)
    var surface = modifier
        .clip(shape)
        .background(fill)

    if (bordered) surface = surface.border(1.dp, Hairline, shape)
    if (onClick != null) surface = surface.pressable(onClick = onClick)

    Column(surface.padding(padding), content = content)
}

/**
 * A card that is orange.
 *
 * Reserved for a completed or in-flight *thing* — a shipment, an approval, a
 * trip — never for a container of controls. The rule that keeps it working is
 * that no screen has two of them competing: if everything is emphasised,
 * nothing is.
 *
 * Type on it follows the contrast the fill allows. Large and bold goes white
 * (3:1, which white on this orange clears); anything smaller goes [EmberInk],
 * which clears 4.5:1. That is why the dates and places on a shipment card are
 * dark rather than white, and it is a legibility decision, not a style one.
 */
@Composable
fun EmberCard(
    modifier: Modifier = Modifier,
    padding: Dp = FleetSpace.base,
    corner: Dp = FleetRadius.card,
    brush: Brush = EmberSweep,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(corner)
    var surface = modifier
        .clip(shape)
        .background(brush)

    if (onClick != null) surface = surface.pressable(onClick = onClick)

    Column(surface.padding(padding), content = content)
}

/**
 * An action, as a tile.
 *
 * An icon chip, a strong line and a quiet one — the shape the driver home
 * screen is built from. Sized to the 56dp floor even when its content is
 * shorter, because a tile a thumb misses in a moving cab is a tile that does
 * not work.
 */
@Composable
fun FleetTile(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
    enabled: Boolean = true,
) {
    val shape = RoundedCornerShape(FleetRadius.tile)

    Row(
        modifier
            .sizeIn(minHeight = 72.dp)
            .clip(shape)
            .background(if (accent) OnyxRaised else Onyx)
            .border(1.dp, if (accent) Ember.copy(alpha = 0.35f) else Hairline, shape)
            .pressable(enabled = enabled, onClick = onClick)
            .padding(horizontal = FleetSpace.snug, vertical = FleetSpace.snug),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        IconChip(icon = icon, tinted = accent)
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                color = Chalk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = Ash,
                /*
                 * Two lines, because one truncated them.
                 *
                 * Four of these sit two-abreast, so each gets under half the
                 * screen minus a 44dp chip. On a 720px-wide handset that turned
                 * "Map and engine" into "Map and en..." and a registration into
                 * "UP32RU69..." - which is the one string on the tile a driver
                 * actually needs to read. The tile is already `sizeIn`, not a
                 * fixed height, so it grows rather than clipping.
                 */
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The round chip an icon sits in.
 *
 * Never a bare icon on a card. The chip is what gives a 20dp glyph enough
 * visual weight to be found at a glance, and it keeps every icon in the app at
 * one size inside one shape.
 */
@Composable
fun IconChip(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    tinted: Boolean = false,
    size: Dp = 44.dp,
    contentDescription: String? = null,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(if (tinted) Ember.copy(alpha = 0.16f) else OnyxRaised)
            .border(1.dp, if (tinted) Ember.copy(alpha = 0.4f) else Hairline, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = if (tinted) EmberBright else Ash,
            modifier = Modifier.size(size * 0.45f),
        )
    }
}

/**
 * A state, said three ways.
 *
 * Colour, a dot and a word together — never colour alone. A driver with
 * red-green colour blindness reading a status at dusk through a polarised
 * windscreen is the case this exists for, and it is not a rare one.
 *
 * [live] makes the dot breathe, which is the difference between "in transit"
 * and "was in transit when this screen last loaded".
 */
@Composable
fun StatusPill(
    label: String,
    tint: Color = LiveGreen,
    modifier: Modifier = Modifier,
    live: Boolean = false,
    onSurface: Color = Color.Transparent,
) {
    val breath by rememberBreath(1_500, restingAt = 1f)
    val dotAlpha = if (live) 0.45f + breath * 0.55f else 1f

    Row(
        modifier
            .clip(RoundedCornerShape(FleetRadius.pill))
            .background(if (onSurface == Color.Transparent) tint.copy(alpha = 0.14f) else onSurface)
            .padding(horizontal = FleetSpace.snug, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(tint.copy(alpha = dotAlpha)),
        )
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = tint,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * The white pill on an orange card.
 *
 * The reverse of [StatusPill], for the one place the ground is already the
 * accent colour: a badge on a shipment card. Solid white rather than a tint,
 * because a translucent pill on orange is a slightly different orange.
 */
@Composable
fun EmberBadge(
    label: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(FleetRadius.pill))
            .background(Color.White)
            .padding(horizontal = FleetSpace.snug, vertical = 5.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = EmberInk,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/**
 * A section, and the one thing you can do to it.
 *
 * The trailing action is optional and is the only place in the app where a text
 * button sits at the end of a heading — everywhere else an action is a control
 * a thumb can find without reading.
 */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = Chalk,
        )
        if (actionLabel != null && onAction != null) {
            Text(
                actionLabel,
                style = MaterialTheme.typography.labelLarge,
                color = EmberBright,
                modifier = Modifier
                    .clip(RoundedCornerShape(FleetRadius.pill))
                    .pressable(onClick = onAction)
                    .padding(horizontal = FleetSpace.snug, vertical = 6.dp),
            )
        }
    }
}

/**
 * A label above a block, in the app's quietest voice.
 *
 * Upper case and widely tracked. It is deliberately hard to read quickly, which
 * is correct: it names a thing the driver is already looking at, and it must
 * not compete with the value underneath it.
 */
@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier, tint: Color = Slate) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = tint,
        maxLines = 1,
        modifier = modifier,
    )
}

/**
 * The driver, as two letters.
 *
 * A monogram rather than a photograph. The only picture the app holds of a
 * driver is the arrival selfie, which belongs to one shift and one vehicle
 * rather than to a person — putting it here would be quietly repurposing it.
 */
@Composable
fun Monogram(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    onClick: (() -> Unit)? = null,
) {
    val initials = name.trim().split(' ')
        .mapNotNull { it.firstOrNull()?.uppercase() }
        .take(2)
        .joinToString("")
        .ifBlank { "?" }

    var surface = modifier
        .size(size)
        .clip(CircleShape)
        .background(EmberGradient)
        .border(2.dp, EmberBright.copy(alpha = 0.45f), CircleShape)

    if (onClick != null) surface = surface.pressable(onClick = onClick)

    Box(surface, contentAlignment = Alignment.Center) {
        Text(
            initials,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            color = Color.White,
        )
    }
}

/**
 * A round icon button.
 *
 * The back and close controls, and nothing else. 44dp of visual inside a 56dp
 * hit area, so it meets the touch floor without looking like a button meant for
 * a fingertip in a glove.
 */
@Composable
fun CircleAction(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = Chalk,
) {
    Box(
        modifier
            .sizeIn(minWidth = FleetTouchTarget, minHeight = FleetTouchTarget)
            .pressable(scaleTo = 0.9f, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(Onyx.copy(alpha = 0.92f))
                .border(1.dp, Hairline, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** The close control, for anything that came up over something else. */
@Composable
fun CloseAction(onClick: () -> Unit, modifier: Modifier = Modifier) =
    CircleAction(Icons.Rounded.Close, "Close", onClick, modifier)

/**
 * A detour, over the top of whatever the driver was doing.
 *
 * Opaque and full-height rather than a translucent panel: a driver opening this
 * has stopped to change something, and a frosted sheet over a moving map is
 * harder to read for no benefit. Closing it must put them back exactly where
 * they were, mid-trip and all — which is why it is drawn over the stage rather
 * than being a stage of its own.
 */
@Composable
fun FleetSheet(
    title: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    scrollable: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(modifier.fillMaxSize().background(Obsidian)) {
        FleetScreen(scrollable = scrollable) {
            Spacer(Modifier.height(FleetSpace.tight))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = Chalk)
                CloseAction(onClose)
            }
            Spacer(Modifier.height(FleetSpace.base))
            content()
            Spacer(Modifier.height(FleetSpace.wide))
        }
    }
}

/**
 * A row of two things, evenly.
 *
 * Used for the tile grid on the home screen. A `Row` of weighted children
 * rather than a grid, because two columns of equal width is what this is and a
 * `LazyVerticalGrid` inside a scrolling column is a crash waiting to happen.
 */
@Composable
fun TileRow(
    modifier: Modifier = Modifier,
    spacing: Dp = FleetSpace.snug,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/**
 * A hairline between two blocks inside one card.
 *
 * Not Material's `HorizontalDivider`: at this contrast its default is invisible
 * through a windscreen reflection, which is the only place it matters.
 */
@Composable
fun FleetRule(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Hairline),
    )
}

/**
 * Something has gone wrong, and here is what to do about it.
 *
 * Never a bare red sentence. An error a driver cannot act on is an error that
 * sends them to telephone an office, so the message goes on a surface with an
 * edge, at a size that survives sunlight, and the caller is expected to have
 * written a sentence that names the next step.
 */
@Composable
fun FleetError(
    message: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FleetRadius.field))
            .background(AlertRed.copy(alpha = 0.12f))
            .border(1.dp, AlertRed.copy(alpha = 0.45f), RoundedCornerShape(FleetRadius.field))
            .padding(FleetSpace.snug),
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 5.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(AlertRed)
                .clearAndSetSemantics { },
        )
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFFFFC9CB),
        )
    }
}

/**
 * A quiet notice: something happened, and it was fine.
 *
 * The counterpart to [FleetError] for confirmations that do not deserve a
 * toast — a PIN saved, a fingerprint enrolled. It stays on screen rather than
 * timing out, because a driver who looked away for ten seconds should still be
 * able to find out whether the thing they just did worked.
 */
@Composable
fun FleetNotice(
    message: String,
    modifier: Modifier = Modifier,
    tint: Color = LiveGreen,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FleetRadius.field))
            .background(tint.copy(alpha = 0.10f))
            .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(FleetRadius.field))
            .padding(FleetSpace.snug),
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.tight),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 5.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(tint)
                .clearAndSetSemantics { },
        )
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = Ash,
        )
    }
}

