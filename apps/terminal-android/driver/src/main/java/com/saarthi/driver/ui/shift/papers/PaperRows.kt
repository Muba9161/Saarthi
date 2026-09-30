package com.saarthi.driver.ui.shift.papers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.DriverPaperDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.ChoiceChip
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.Skeleton
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop

/** How far each block on this tab travels as it rises in — the design's 18px. */
internal val PapersRise: Dp = 18.dp

private const val DAYS_IN_YEAR = 365

/** The pill's words: "12 days left", "2 years left", "Expired 3 days ago". */
@Composable
private fun expiryWords(days: Int?): String = when {
    days == null -> stringResource(R.string.papers_no_expiry)
    days < 0 -> pluralStringResource(R.plurals.papers_expired_ago, -days, -days)
    days == 0 -> stringResource(R.string.papers_expires_today)
    days < DAYS_IN_YEAR -> pluralStringResource(R.plurals.papers_days_left, days, days)
    else -> (days / DAYS_IN_YEAR).let { years -> pluralStringResource(R.plurals.papers_years_left, years, years) }
}

/**
 * The red banner over the list when a paper has lapsed or is about to.
 *
 * Its ring swells and settles every two seconds — enough to be noticed on a
 * glance at a check post, not enough to be mistaken for an alarm.
 */
@Composable
internal fun AttentionBanner(count: Int, anyExpired: Boolean, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(18.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.dangerWash)
            .pulsingRing(c.dangerRing, 18.dp)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.alertTriangle, well = c.dangerSoft, ink = c.danger, size = 36.dp, shape = CircleShape, iconSize = 18.dp)
        Text(
            pluralStringResource(
                if (anyExpired) R.plurals.papers_attention_expired else R.plurals.papers_attention_soon,
                count,
                count,
            ),
            style = SType.body,
            color = c.fg,
            modifier = Modifier.weight(1f),
        )
    }
}

/** An inset ring breathing between 1 and 2 dp — the design's `.pp-pulse`. */
@Composable
private fun Modifier.pulsingRing(color: Color, radius: Dp): Modifier {
    val swell by rememberLoop(1_000, Ease.standard, reverse = true, rest = 0f, label = "attention-ring")
    return drawWithContent {
        drawContent()
        val width = (1f + swell).dp.toPx()
        val inset = width / 2f
        drawRoundRect(
            color,
            topLeft = Offset(inset, inset),
            size = Size(size.width - width, size.height - width),
            cornerRadius = CornerRadius(radius.toPx() - inset),
            style = Stroke(width),
        )
    }
}

/** "All · 5", "Vehicle · 4", "Yours · 1" — the chosen one filled, the others ringed. */
@Composable
internal fun PaperChips(
    papers: List<DriverPaperDto>,
    filter: PaperFilter,
    onFilter: (PaperFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PaperFilter.entries.forEach { option ->
            val on = option == filter
            ChoiceChip(
                label = stringResource(R.string.papers_chip, stringResource(option.label), papers.count(option::admits)),
                selected = on,
                onClick = { onFilter(option) },
                offColor = c.elevated,
                modifier = if (on) Modifier else Modifier.border(1.dp, c.border, CircleShape),
            )
        }
    }
}

/**
 * One paper: what it is, whose, how long it has left, and whether it is on
 * this phone. The whole card opens it.
 */
@Composable
internal fun PaperRow(
    paper: DriverPaperDto,
    onPhone: Boolean,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Saarthi.colors
    val attention = paper.expiry.needsAttention
    val owner = when (paper.ownerType) {
        OWNER_VEHICLE -> stringResource(R.string.papers_owner_vehicle)
        OWNER_DRIVER -> stringResource(R.string.papers_owner_yours)
        else -> null
    }
    val number = paper.number?.takeIf { it.isNotBlank() }
    val details = if (owner != null && number != null) stringResource(R.string.papers_sub, owner, number) else owner ?: number

    Row(
        modifier
            .pressable(scale = 0.98f, label = stringResource(R.string.papers_open_action), onClick = onOpen)
            .fillMaxWidth()
            .heightIn(min = 80.dp)
            .card()
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            Lucide.fileText,
            well = if (attention) c.dangerSoft else c.primarySoft,
            ink = if (attention) c.danger else c.primary,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(paper.displayTitle, style = SType.bodyStrong, color = c.fg)
            details?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            ExpiryPill(paper)
        }
        CacheDisc(onPhone)
    }
}

@Composable
private fun ExpiryPill(paper: DriverPaperDto) {
    val c = Saarthi.colors
    val (ground, ink) = when (paper.expiry) {
        Expiry.EXPIRED -> c.dangerBg to c.danger
        Expiry.SOON -> c.warningBg to c.warning
        Expiry.VALID -> c.successBg to c.success
        Expiry.UNKNOWN -> c.sunken to c.muted
    }
    Text(
        expiryWords(paper.daysToExpiry),
        style = SType.microStrong,
        color = ink,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .background(ground)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** A tick when the paper is on this phone; a crossed-out cloud when it is not yet. */
@Composable
private fun CacheDisc(onPhone: Boolean) {
    val c = Saarthi.colors
    val label = stringResource(if (onPhone) R.string.papers_on_phone else R.string.papers_not_on_phone)
    IconWell(
        if (onPhone) Lucide.check else Lucide.cloudOff,
        well = if (onPhone) c.successBg else c.sunken,
        ink = if (onPhone) c.success else c.muted,
        size = 36.dp,
        shape = CircleShape,
        iconSize = 16.dp,
        stroke = 2.2f,
        modifier = Modifier.semantics { contentDescription = label },
    )
}

/** The amber note under the list — what came of a tap, or why papers could not be saved. */
@Composable
internal fun PaperNotice(text: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.warningWash)
            .border(1.dp, c.warningRing, shape)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(c.warning),
        )
        Text(text, style = SType.small.copy(lineHeight = 19.5.sp), color = c.fg, modifier = Modifier.weight(1f))
    }
}

/** The whole-list message when there is nothing to show: none on record, or the list could not be fetched. */
@Composable
internal fun PapersStateCard(
    icon: String,
    well: Color,
    ink: Color,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val c = Saarthi.colors
    Column(
        modifier
            .fillMaxWidth()
            .card()
            .padding(horizontal = 20.dp, vertical = 24.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(icon, well = well, ink = ink)
        Text(title, style = SType.cardTitle, color = c.fg, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        Text(body, style = SType.small, color = c.muted, textAlign = TextAlign.Center)
        onRetry?.let { LinkButton(stringResource(R.string.papers_retry), it) }
    }
}

/** Four rows' worth of grey while the list is on its way, with the shimmer across each card. */
@Composable
internal fun PapersSkeleton(modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val loading = stringResource(R.string.papers_loading)
    Column(
        modifier.clearAndSetSemantics { contentDescription = loading },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(4) {
            Box(Modifier.fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(86.dp)
                        .card()
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(c.sunken),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Bone(0.55f, 12.dp)
                        Bone(0.75f, 10.dp)
                    }
                }
                Skeleton(Modifier.matchParentSize(), color = Color.Transparent, shine = c.shine, radius = 20.dp)
            }
        }
    }
}

/** One grey placeholder line, [fraction] of the width. */
@Composable
private fun Bone(fraction: Float, height: Dp) {
    Box(
        Modifier
            .fillMaxWidth(fraction)
            .height(height)
            .clip(RoundedCornerShape(6.dp))
            .background(Saarthi.colors.sunken),
    )
}
