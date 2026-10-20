package com.saarthi.owner.ui.customer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Rating something that is over — a trip, a delivery — as the web asks it:
 * five stars (five to start with), a few words if the customer has them, and
 * one go only. [onRate] sends it; a refusal stays under the card.
 */
@Composable
internal fun RateCard(title: String, prompt: String, maxWords: Int, onRate: suspend (Int, String) -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var stars by remember { mutableIntStateOf(5) }
    var words by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = SType.cardTitle, color = c.fg)
        Stars(stars, onPick = { stars = it })
        NotesField(words, { words = it.take(maxWords) }, label = prompt, minHeight = 72.dp)
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
        SaarthiButton(
            stringResource(R.string.customer_rate_send),
            onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        onRate(stars, words.trim())
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        problem = failure.readable()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy,
            busy = busy,
            busyText = stringResource(R.string.customer_rate_sending),
            height = 48.dp,
        )
    }
}

/** A rating already given, as the web shows it: "You rated this trip 4/5" ([said]), and the words. */
@Composable
internal fun RatedLine(said: String, stars: Int, comment: String?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth().card(radius = 18.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("★".repeat(stars) + "☆".repeat((5 - stars).coerceAtLeast(0)), style = SType.bodyStrong.copy(fontSize = 18.sp), color = c.warning)
            Text(said, style = SType.small, color = c.muted)
        }
        comment?.ifBlank { null }?.let { Text("“$it”", style = SType.body, color = c.fg) }
    }
}

@Composable
private fun Stars(stars: Int, onPick: (Int) -> Unit) {
    val c = Saarthi.colors
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        (1..5).forEach { n ->
            Text(
                if (n <= stars) "★" else "☆",
                style = SType.headerTitle.copy(fontSize = 34.sp),
                color = if (n <= stars) c.warning else c.subtle,
                modifier = Modifier
                    .size(44.dp)
                    .pressable(role = Role.RadioButton, label = pluralStringResource(R.plurals.customer_rate_stars, n, n)) { onPick(n) },
            )
        }
    }
}
