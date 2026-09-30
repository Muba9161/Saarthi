package com.saarthi.driver.ui.shift.flow

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.BrandMark
import com.saarthi.driver.ui.design.CircleButton
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi

/**
 * The bar across the top of the safety check and the fuel slip: the mark, the
 * vehicle's plate, what this flow is, and the way out.
 *
 * The check leaves by a close on the right and the slip by a back chevron on the
 * left, exactly as the two designs place them, so both are optional here. The
 * plate is the eyebrow because a driver with two vehicles on one shift should
 * never file a slip against the wrong one; it is left out rather than guessed
 * when the server has not named the vehicle.
 */
@Composable
internal fun FlowTopBar(
    title: String,
    plate: String?,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    onClose: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        onBack?.let { CircleButton(Lucide.chevronLeft, stringResource(R.string.action_back), it) }
        BrandMark(height = 32.dp)
        Column(Modifier.weight(1f)) {
            plate?.let { Eyebrow(it) }
            Text(
                title,
                style = SType.headerTitle,
                color = Saarthi.colors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        onClose?.let {
            CircleButton(Lucide.close, stringResource(R.string.action_close), it, iconSize = 20.dp, stroke = 2f)
        }
    }
}
