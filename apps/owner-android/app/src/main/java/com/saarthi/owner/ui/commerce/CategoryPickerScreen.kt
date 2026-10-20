package com.saarthi.owner.ui.commerce

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.CommerceApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator

/** A category beside the path that leads to it, "Construction Materials › Aggregate". */
private data class PathedCategory(val id: String, val path: String)

/**
 * Every category to choose from, searchable. The top-level groups are left
 * out: "Construction Materials" is too broad to match a seller to a need.
 */
@Composable
fun CategoryPickerScreen(api: CommerceApi, current: String?, onPick: (String) -> Unit) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    var state by remember { mutableStateOf<Loadable<List<PathedCategory>>>(Loadable.Loading) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        state = try {
            val all = api.categories().filter { it.status == "ACTIVE" && !it.isFallback }
            val byId = all.associateBy { it.id }
            fun path(category: CommerceApi.Category): String {
                val names = generateSequence(category) { node -> node.parentId?.let(byId::get) }.map { it.name }.toList()
                return names.reversed().joinToString(" › ")
            }
            Loadable.Ready(all.filter { it.parentId != null }.map { PathedCategory(it.id, path(it)) }.sortedBy { it.path })
        } catch (failure: Exception) {
            Loadable.Failed(failure.readable())
        }
    }

    DetailScreen(eyebrow = stringResource(R.string.market_commerce_choose_category), title = stringResource(R.string.market_commerce_what_is_it)) {
        SaarthiField(value = query, onValueChange = { query = it.take(60) }, leading = Lucide.search, placeholder = stringResource(R.string.market_commerce_search_placeholder))
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> NoticeCard(shown.message, NoticeTone.WARNING)
            is Loadable.Ready -> {
                val needle = query.trim().lowercase()
                val listed = shown.value.filter { needle.isEmpty() || it.path.lowercase().contains(needle) }
                if (listed.isEmpty()) Text(stringResource(R.string.market_commerce_no_match), style = SType.small, color = c.muted)
                if (listed.isNotEmpty()) {
                    Column(Modifier.fillMaxWidth().card(radius = 20.dp)) {
                        listed.forEachIndexed { index, category ->
                            val on = category.id == current
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .bottomRule(c.border, show = index < listed.lastIndex)
                                    .pressable(scale = 0.99f) {
                                        onPick(category.id)
                                        navigator.pop()
                                    }
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    category.path,
                                    style = if (on) SType.bodyStrong else SType.body,
                                    color = if (on) c.fg else c.muted,
                                    modifier = Modifier.weight(1f),
                                )
                                if (on) LineIcon(Lucide.check, size = 16.dp, color = c.primary)
                            }
                        }
                    }
                }
            }
        }
    }
}
