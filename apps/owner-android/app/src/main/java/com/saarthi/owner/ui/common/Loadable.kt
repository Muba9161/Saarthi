package com.saarthi.owner.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.Skeleton

/** Something read from Saarthi: on its way, here, or not coming. */
sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>
    data class Ready<T>(val value: T) : Loadable<T>
    data class Failed(val message: String) : Loadable<Nothing>
}

/** The words a screen shows for a failed read. */
fun Throwable.readable(): String = when (this) {
    is OwnerApi.Failure -> message
    else -> "Something went wrong reading from Saarthi."
}

/** Grey blocks where cards will be, shimmering while they load. */
@Composable
fun SkeletonCards(count: Int = 3, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(count) { index ->
            Skeleton(
                Modifier
                    .fillMaxWidth()
                    .height(if (index == 0) 200.dp else 120.dp),
                color = c.sunken,
                shine = c.shine,
                radius = 24.dp,
            )
        }
    }
}

/** A failed read, with the way to try again. */
@Composable
fun FailedCard(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        NoticeCard(message, NoticeTone.WARNING, icon = Lucide.cloudOff)
        SaarthiButton("Try again", onRetry, tone = ButtonTone.SECONDARY, leading = Lucide.refresh, height = 50.dp)
    }
}
