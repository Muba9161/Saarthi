package com.saarthi.owner.ui.account

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.data.roleLabel
import com.saarthi.owner.ui.common.rememberRemoteImage
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card

/** A cover's shape, as the uploaders crop it: three wide to one high. */
internal const val COVER_RATIO = 3f

private val AvatarSize = 76.dp

/** The card-coloured ring that lifts the photo off the cover. */
private val AvatarRing = 3.dp

/**
 * Who is signed in, as their profile shows them: the cover across the top,
 * their photo over its lower edge, then name, role, plan and email.
 *
 * Both pictures come from the session, so a new one shows here the moment the
 * session is read again. Without a cover the brand's own ground stands in,
 * so the card never looks unfinished.
 */
@Composable
internal fun ProfileHeader(account: SessionStore.Account, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth().card(radius = 24.dp)) {
        Box {
            CoverImage(account.coverUrl, Modifier.fillMaxWidth().aspectRatio(COVER_RATIO))
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = 18.dp, y = AvatarSize / 2 + AvatarRing)
                    .clip(CircleShape)
                    .background(c.card)
                    .padding(AvatarRing),
            ) {
                Avatar(account.fullName, size = AvatarSize, background = c.primarySoft, ink = c.primary, photoUrl = account.avatarUrl)
            }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = 18.dp, end = 18.dp, top = AvatarSize / 2 + AvatarRing + 12.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(account.fullName, style = SType.cardTitle.copy(fontSize = SType.headerTitle.fontSize), color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(roleLabel(account.membershipRole), account.organizationName)
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                style = SType.small,
                color = c.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            account.planName?.let {
                // The plan's real status is in the Plan card below; this only names it.
                StatusPill(
                    it.replace("Supplier", "Seller"),
                    background = c.successBg,
                    ink = c.success,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Text(account.email, style = SType.caption, color = c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * A cover image cropped to fill [modifier]'s box, decoded for that box.
 *
 * While it loads, and when there is none, the box shows the brand ground; or,
 * with [slot], an empty picture slot, where a missing cover is something to
 * add rather than a look.
 */
@Composable
internal fun CoverImage(url: String?, modifier: Modifier = Modifier, slot: Boolean = false) {
    val c = Saarthi.colors
    BoxWithConstraints(
        modifier.then(if (slot) Modifier.background(c.sunken) else Modifier.brandGradient()),
        contentAlignment = Alignment.Center,
    ) {
        val cover = rememberRemoteImage(url, maxWidth, maxHeight)
        if (cover != null) {
            Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else if (slot) {
            LineIcon(Lucide.image, size = 22.dp, color = c.muted)
        }
    }
}
