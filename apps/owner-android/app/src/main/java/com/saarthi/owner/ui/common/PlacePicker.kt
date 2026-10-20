package com.saarthi.owner.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay

/**
 * A place field: shows what was chosen, and opens a search to choose it.
 *
 * A requirement's places need real coordinates — fleets are matched to it by
 * distance — so the place always comes from the search, never free text.
 */
@Composable
fun PlaceField(
    label: String,
    place: PlacesApi.Place?,
    places: PlacesApi,
    onPick: (PlacesApi.Place) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = stringResource(R.string.ui_place_search_address),
    icon: String = Lucide.mapPin,
) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = SType.fieldLabel, color = c.muted)
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 60.dp)
                .card(radius = 16.dp, color = c.elevated, ring = c.input, elevated = false)
                .pressable(scale = 0.99f, label = label) {
                    navigator.push("place-$label") {
                        PlaceSearchScreen(title = label, places = places) { chosen ->
                            onPick(chosen)
                            navigator.pop()
                        }
                    }
                }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            LineIcon(icon, size = 20.dp, color = if (place != null) c.primary else c.muted)
            Column(Modifier.weight(1f)) {
                if (place == null) {
                    Text(placeholder, style = SType.field, color = c.subtle, maxLines = 1)
                } else {
                    Text(place.name, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(place.address, style = SType.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            LineIcon(Lucide.chevronRight, size = 16.dp, color = c.subtle)
        }
    }
}

/** Type a place; pick it from what OpenStreetMap knows. */
@Composable
fun PlaceSearchScreen(title: String, places: PlacesApi, onPick: (PlacesApi.Place) -> Unit) {
    val c = Saarthi.colors
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<PlacesApi.Place>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val focusManager = LocalFocusManager.current
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    // A short pause after typing, so each letter is not a request.
    LaunchedEffect(query) {
        if (query.trim().length < 3) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(350)
        searching = true
        error = null
        try {
            results = places.search(query)
        } catch (failure: Exception) {
            error = failure.readable()
        }
        searching = false
    }

    DetailScreen(eyebrow = stringResource(R.string.ui_place_choose), title = title) {
        CurrentLocationRow(places, onPick)
        SaarthiField(
            value = query,
            onValueChange = { query = it },
            leading = Lucide.search,
            placeholder = stringResource(R.string.ui_place_query_placeholder),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // Results come as the place is typed; the key only puts the keyboard away to read them.
            keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
            focus = focus,
            trailing = if (searching) {
                { RingSpinner(track = c.track, head = c.primary, size = 20.dp, stroke = 2.5.dp, modifier = Modifier.padding(end = 10.dp)) }
            } else {
                null
            },
        )
        error?.let { NoticeCard(it, NoticeTone.WARNING) }
        if (results.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().card(radius = 20.dp)) {
                results.forEachIndexed { index, place ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .pressable(scale = 0.99f) { onPick(place) }
                            .bottomRule(c.border, show = index < results.lastIndex)
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        IconWell(Lucide.mapPin, well = c.primarySoft, ink = c.primary, size = 36.dp, radius = 12.dp, iconSize = 16.dp)
                        Column(Modifier.weight(1f)) {
                            Text(place.name, style = SType.rowTitle, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(place.address, style = SType.caption, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        } else if (query.trim().length >= 3 && !searching && error == null) {
            Text(stringResource(R.string.ui_place_nothing_found), style = SType.small, color = c.muted)
        } else if (query.isBlank()) {
            Text(stringResource(R.string.ui_place_type_three), style = SType.small, color = c.subtle)
        }
    }
}
