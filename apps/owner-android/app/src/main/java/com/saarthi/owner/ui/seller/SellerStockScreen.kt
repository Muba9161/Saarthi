package com.saarthi.owner.ui.seller

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.CommerceApi
import com.saarthi.owner.network.MaterialsApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.ui.commerce.CommerceDetails
import com.saarthi.owner.ui.commerce.CommerceEntry
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.PlaceField
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.common.unitPrice
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CompactField
import com.saarthi.owner.ui.design.NotesField
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.jobs.Pill
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.launch

/**
 * "Stock & prices" — what fleets bidding nearby see of this seller, kept
 * current here: the price, the stock, and whether a listing is shown at all.
 */
@Composable
fun SellerStockScreen(app: OwnerApp, account: SessionStore.Account) {
    val model = viewModel { SellerModel(app.orders, app.materials) }
    val state by model.state.collectAsStateWithLifecycle()
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    val navigator = LocalNavigator.current
    val openListing: (MaterialsApi.Listing) -> Unit = { listing ->
        navigator.push("listing-${listing.id}") {
            ListingScreen(app, account, listing) { changed -> if (changed == null) model.dropListing(listing.id) else model.replaceListing(changed) }
        }
    }
    val scope = rememberCoroutineScope()
    val c = Saarthi.colors
    val top = headerClearance()
    val bottom = tabBarClearance()

    Box(Modifier.fillMaxSize()) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
            is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
            is Loadable.Ready -> {
                val listings = shown.value.listings
                val categories = listings.mapNotNull { it.category?.ifBlank { null } }.distinct()
                val listed = listings.filter { category == null || it.category == category }
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "note") {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .rise()
                                .clip(RoundedCornerShape(20.dp))
                                .background(c.primaryWash)
                                .border(1.dp, c.primaryRing, RoundedCornerShape(20.dp))
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            IconWell(Lucide.eye, well = c.primarySoft, ink = c.primary, size = 36.dp, shape = CircleShape, iconSize = 16.dp)
                            Text(
                                stringResource(R.string.market_stock_note),
                                style = SType.body,
                                color = c.fg,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                    if (categories.size > 1) {
                        item(key = "chips") {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                ChoiceChip(stringResource(R.string.market_stock_all, listings.size), selected = category == null, onClick = { category = null })
                                categories.forEach { name ->
                                    ChoiceChip(name, selected = category == name, onClick = { category = name })
                                }
                            }
                        }
                    }
                    item(key = "add") {
                        SaarthiButton(
                            stringResource(R.string.market_stock_add_listing),
                            onClick = {
                                navigator.push("new-listing") {
                                    NewListingScreen(app) { created ->
                                        model.replaceListing(created)
                                        // Straight on to its photos, in the listing's own page.
                                        navigator.replace("listing-${created.id}") {
                                            ListingScreen(app, account, created) { changed -> if (changed == null) model.dropListing(created.id) else model.replaceListing(changed) }
                                        }
                                    }
                                }
                            },
                            leading = Lucide.plus,
                            height = 50.dp,
                            tone = com.saarthi.owner.ui.design.ButtonTone.SECONDARY,
                        )
                    }
                    items(listed, key = { it.id }) { listing ->
                        ListingCard(
                            listing,
                            onOpen = { openListing(listing) },
                            onShownChange = { shownNow ->
                                scope.launch {
                                    runCatching { app.materials.update(listing.id, shown = shownNow) }
                                        .getOrNull()?.let(model::replaceListing)
                                }
                            },
                        )
                    }
                }
            }
        }

    }
}

@Composable
private fun ListingCard(listing: MaterialsApi.Listing, onOpen: () -> Unit, onShownChange: (Boolean) -> Unit) {
    val c = Saarthi.colors
    val unit = RequirementsApi.unitWord(listing.unit)
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (listing.low) c.warningRing else c.ring)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(listing.name, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (listing.shown) (if (listing.low) stringResource(R.string.market_stock_shown_low) else stringResource(R.string.market_stock_shown)) else stringResource(R.string.market_stock_hidden),
                    style = SType.caption,
                    color = c.muted,
                )
            }
            SaarthiSwitch(checked = listing.shown, onCheckedChange = onShownChange, label = stringResource(R.string.market_listing_show_named, listing.name))
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Text(unitPrice(listing.pricePerUnit), style = SType.headerTitle.copy(fontSize = 22.sp), color = c.fg)
            Text(" / ${RequirementsApi.unitSingular(listing.unit)}", style = SType.small, color = c.muted, modifier = Modifier.padding(bottom = 3.dp))
            Box(Modifier.weight(1f))
            Pill(
                listing.availableQuantity.let { if (it % 1.0 == 0.0) "%,d".format(it.toLong()) else it.toString() }.let { quantity ->
                    if (listing.low) stringResource(R.string.market_stock_left, quantity, unit) else "$quantity $unit"
                },
                if (listing.low) c.warningBg else c.successBg,
                if (listing.low) c.warning else c.success,
            )
        }
        val fill = if (listing.minimumOrderQty > 0) (listing.availableQuantity / (listing.minimumOrderQty * 40)).toFloat().coerceIn(0.03f, 1f) else 1f
        Box(Modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(c.track)) {
            Box(Modifier.fillMaxWidth(fill).height(5.dp).clip(CircleShape).background(if (listing.low) c.warning else c.success))
        }
    }
}

/** A new listing: what it is, its price and stock, and where trucks collect it. */
@Composable
private fun NewListingScreen(app: OwnerApp, onCreated: (MaterialsApi.Listing) -> Unit) {
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    val entry = remember { CommerceEntry(app.commerce, CommerceApi.SCOPE_PRODUCT) }
    var unit by rememberSaveable { mutableStateOf("TON") }
    var price by rememberSaveable { mutableStateOf("") }
    var stock by rememberSaveable { mutableStateOf("") }
    var minimum by rememberSaveable { mutableStateOf("1") }
    var pickup by remember { mutableStateOf<PlacesApi.Place?>(null) }
    var description by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // The category is what fleets' searches find it by, so it is needed like the price is.
    val ready = !busy && name.trim().length >= 2 && entry.ready && (price.toDoubleOrNull() ?: 0.0) > 0 && stock.toDoubleOrNull() != null

    DetailScreen(
        eyebrow = stringResource(R.string.market_seller_what_fleets_see),
        title = stringResource(R.string.market_stock_new_listing),
        footer = {
            SaarthiButton(
                stringResource(R.string.market_stock_show_to_fleets),
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            app.materials.create(
                                MaterialsApi.NewListing(
                                    name = name.trim(),
                                    category = null,
                                    categoryId = entry.categoryId,
                                    attributes = entry.attributesJson,
                                    unit = unit,
                                    price = price.toDouble(),
                                    stock = stock.toDouble(),
                                    minimumOrder = minimum.toDoubleOrNull() ?: 1.0,
                                    pickup = pickup,
                                    description = description.trim(),
                                ),
                            )?.let(onCreated) ?: navigator.pop()
                        } catch (failure: Exception) {
                            busy = false
                            error = failure.readable()
                        }
                    }
                },
                enabled = ready,
                busy = busy,
            )
        },
    ) {
        SaarthiField(value = name, onValueChange = { name = it.take(120) }, label = stringResource(R.string.market_listing_what_you_sell), leading = Lucide.box, placeholder = stringResource(R.string.market_stock_name_placeholder))
        CommerceDetails(entry, name, app.commerce)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ListingUnits.forEach { (value, label) -> ChoiceChip(label, selected = unit == value, onClick = { unit = value }, height = 36.dp) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactField(price, { price = it.filter { ch -> ch.isDigit() || ch == '.' }.take(10) }, stringResource(R.string.market_stock_price), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            CompactField(stock, { stock = it.filter { ch -> ch.isDigit() || ch == '.' }.take(10) }, stringResource(R.string.market_listing_in_stock), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            CompactField(minimum, { minimum = it.filter { ch -> ch.isDigit() || ch == '.' }.take(8) }, stringResource(R.string.market_listing_min_order), Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        }
        PlaceField(label = stringResource(R.string.market_listing_pickup), place = pickup, places = app.places, onPick = { pickup = it })
        NotesField(description, { description = it.take(2000) }, label = stringResource(R.string.market_stock_notes_optional), minHeight = 80.dp)
        Text(stringResource(R.string.market_stock_photos_next), style = SType.caption, color = Saarthi.colors.subtle)
        entry.missing.firstOrNull()?.let { field ->
            Text(stringResource(R.string.market_stock_add_field, field.label.lowercase()), style = SType.caption, color = Saarthi.colors.subtle)
        }
        error?.let { RevealedNotice(it, NoticeTone.DANGER) }
    }
}
