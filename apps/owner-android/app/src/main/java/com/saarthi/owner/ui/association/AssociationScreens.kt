package com.saarthi.owner.ui.association

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AssociationApi
import com.saarthi.owner.network.SosApi
import com.saarthi.owner.ui.common.FacesAlignment
import com.saarthi.owner.ui.common.FailedCard
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.headerClearance
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.tabBarClearance
import com.saarthi.owner.ui.design.Brand
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.jobs.Pill
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.ShellActions
import com.saarthi.owner.ui.shell.TabHeader
import com.saarthi.owner.ui.shell.TabSpec
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val REFRESH_MS = 20_000L

/** An association's tabs: Home and SOS. */
fun associationTabs(app: OwnerApp, account: SessionStore.Account): List<TabSpec> = listOf(
    TabSpec(
        key = "home",
        label = "Home",
        icon = Lucide.home,
        header = TabHeader(account.organizationName, "Namaste, ${account.firstName}"),
        content = { actions -> AssociationHomeScreen(app, account, actions) },
    ),
    TabSpec(
        key = "sos",
        label = "SOS",
        icon = Lucide.siren,
        header = TabHeader("Members on the road", "SOS"),
        content = { AssociationAlertsScreen(app, account) },
    ),
)

/** The association, its alerts and the day's numbers, read together. */
data class AssociationBook(
    val association: AssociationApi.Association?,
    val overview: AssociationApi.Overview?,
    val alerts: List<AssociationApi.Alert>,
) {
    val open: List<AssociationApi.Alert> get() = alerts.filter { it.open }.sortedBy { it.ageMinutes }
}

class AssociationModel(private val association: AssociationApi) : ViewModel() {
    private val _state = MutableStateFlow<Loadable<AssociationBook>>(Loadable.Loading)
    val state: StateFlow<Loadable<AssociationBook>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                coroutineScope {
                    val me = async { runCatching { association.me() }.getOrNull() }
                    val overview = async { runCatching { association.overview() }.getOrNull() }
                    val alerts = async { association.alerts() }
                    Loadable.Ready(AssociationBook(me.await(), overview.await(), alerts.await()))
                }
            } catch (error: Exception) {
                if (silent && _state.value is Loadable.Ready) return@launch
                Loadable.Failed(error.readable())
            }
        }
    }
}

/**
 * The association's home — the design's Association · Home: a member who
 * needs help first, then the association's numbers and recent alerts.
 */
@Composable
fun AssociationHomeScreen(app: OwnerApp, account: SessionStore.Account, actions: ShellActions) {
    val model = viewModel { AssociationModel(app.association) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors

    LaunchedEffect(Unit) {
        while (true) {
            delay(REFRESH_MS)
            model.refresh(silent = true)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = headerClearance(), bottom = tabBarClearance()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when (val shown = state) {
            Loadable.Loading -> SkeletonCards()
            is Loadable.Failed -> FailedCard(shown.message, { model.refresh() })
            is Loadable.Ready -> {
                val book = shown.value
                val urgent = book.open.firstOrNull()
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(210.dp)
                        .rise()
                        .clip(RoundedCornerShape(28.dp))
                        .then(
                            if (urgent != null) {
                                Modifier.pressable(scale = 0.98f) {
                                    navigator.push("respond-${urgent.id}") { RespondScreen(app, account, urgent) { model.refresh(silent = true) } }
                                }
                            } else {
                                Modifier
                            },
                        ),
                ) {
                    Image(painterResource(R.drawable.photo_role_association), null, contentScale = ContentScale.Crop, alignment = FacesAlignment, modifier = Modifier.fillMaxSize())
                    Box(
                        Modifier.fillMaxSize().background(
                            Brush.verticalGradient(
                                if (urgent != null) listOf(Color(0x338B1E22), Color(0xF23A0B0D)) else listOf(Color(0x1A021D40), Color(0xF2021D40)),
                            ),
                        ),
                    )
                    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.SpaceBetween) {
                        if (urgent != null) {
                            StatusPill(
                                listOfNotNull("SOS", urgent.distanceKm?.let { "%.1f km away".format(it) }).joinToString(" · "),
                                background = Brand.sosBanner,
                                ink = Color.White,
                                dotColor = Color.White,
                                live = true,
                            )
                        } else {
                            StatusPill("All quiet on your roads", background = Color.White.copy(alpha = 0.16f), ink = Color.White, dotColor = Brand.live, ring = Color.White.copy(alpha = 0.2f))
                        }
                        Row(verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                Eyebrow(if (urgent != null) "A member needs help" else "Covering", color = Color.White.copy(alpha = 0.8f))
                                Text(
                                    urgent?.address?.substringBefore(',')
                                        ?: book.association?.coverageAreas?.firstOrNull()?.label
                                        ?: book.association?.district.orEmpty(),
                                    style = SType.title.copy(fontSize = 24.sp, lineHeight = 28.sp),
                                    color = Color.White,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            if (urgent != null) {
                                Row(
                                    Modifier
                                        .height(44.dp)
                                        .clip(CircleShape)
                                        .background(Color.White)
                                        .padding(horizontal = 16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text("Respond", style = SType.bodyStrong, color = Brand.sosBanner)
                                    LineIcon(Lucide.arrowRight, size = 16.dp, color = Brand.sosBanner, stroke = 2.2f)
                                }
                            }
                        }
                    }
                }

                Row(Modifier.fillMaxWidth().rise(stagger(1)), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Figure(Lucide.users, c.primarySoft, c.primary, "Members", "%,d".format(book.association?.memberTruckCount ?: 0), "trucks", Modifier.weight(1f))
                    Figure(Lucide.shieldCheck, c.successSoft, c.success, "Going", "${book.overview?.responding ?: 0}", "right now", Modifier.weight(1f))
                    Figure(Lucide.siren, c.dangerSoft, c.danger, "Open SOS", "${book.overview?.open ?: book.open.size}", "${book.overview?.resolvedToday ?: 0} closed today", Modifier.weight(1f))
                }

                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("On the roads", style = SType.section, color = c.fg, modifier = Modifier.weight(1f))
                    LinkButton("All alerts", { actions.selectTab("sos") }, style = SType.smallStrong)
                }
                if (book.alerts.isEmpty()) {
                    Text("No member has raised an SOS on your roads.", style = SType.small, color = c.muted)
                }
                book.alerts.sortedBy { if (it.open) 0 else 1 }.take(4).forEach { alert ->
                    AlertRow(alert) { navigator.push("respond-${alert.id}") { RespondScreen(app, account, alert) { model.refresh(silent = true) } } }
                }
                book.association?.stats?.avgResponseMinutes?.let {
                    Text("Your average response: ${"%.0f".format(it.coerceAtLeast(1.0))} min", style = SType.caption, color = c.subtle)
                }
            }
        }
    }
}

/** Every alert, open ones first. */
@Composable
fun AssociationAlertsScreen(app: OwnerApp, account: SessionStore.Account) {
    val model = viewModel { AssociationModel(app.association) }
    val state by model.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val c = Saarthi.colors
    val top = headerClearance()
    val bottom = tabBarClearance()
    when (val shown = state) {
        Loadable.Loading -> SkeletonCards(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Failed -> FailedCard(shown.message, { model.refresh() }, Modifier.padding(start = 20.dp, end = 20.dp, top = top))
        is Loadable.Ready -> {
            val (open, closed) = shown.value.alerts.partition { it.open }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (open.isEmpty() && closed.isEmpty()) item { Text("No alerts yet.", style = SType.small, color = c.muted) }
                if (open.isNotEmpty()) item { GroupLabel("Needs a responder") }
                items(open, key = { it.id }) { alert ->
                    AlertRow(alert) { navigator.push("respond-${alert.id}") { RespondScreen(app, account, alert) { model.refresh(silent = true) } } }
                }
                if (closed.isNotEmpty()) item { GroupLabel("Earlier") }
                items(closed, key = { it.id }) { alert ->
                    AlertRow(alert) { navigator.push("respond-${alert.id}") { RespondScreen(app, account, alert) { model.refresh(silent = true) } } }
                }
            }
        }
    }
}

@Composable
internal fun AlertRow(alert: AssociationApi.Alert, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 22.dp, ring = if (alert.open) c.dangerRing else c.ring)
            .pressable(scale = 0.98f, onClick = onOpen)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconWell(
            if (alert.open) Lucide.siren else Lucide.check,
            well = if (alert.open) c.dangerSoft else c.successSoft,
            ink = if (alert.open) c.danger else c.success,
            size = 44.dp,
            radius = 14.dp,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "${SosApi.typeWord(alert.incidentType)} · ${alert.address?.substringBefore(',') ?: alert.reference}",
                style = SType.bodyStrong,
                color = c.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(alert.fleetName, alert.distanceKm?.let { "%.1f km".format(it) }, ageWords(alert.ageMinutes)).joinToString(" · "),
                style = SType.caption,
                color = c.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (alert.open) Pill(if (alert.responderCount > 0) "${alert.responderCount} going" else "No one yet", c.dangerBg, c.danger)
    }
}

internal fun ageWords(minutes: Long): String = when {
    minutes < 1 -> "just now"
    minutes < 60 -> "$minutes min ago"
    minutes < 60 * 24 -> "${minutes / 60} h ago"
    else -> "${minutes / (60 * 24)} d ago"
}

@Composable
private fun Figure(icon: String, well: Color, ink: Color, label: String, value: String, caption: String, modifier: Modifier) {
    val c = Saarthi.colors
    Column(modifier.card().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        IconWell(icon, well = well, ink = ink, size = 30.dp, radius = 10.dp, iconSize = 16.dp)
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.headerTitle.copy(fontSize = 20.sp), color = c.fg, maxLines = 1)
        Text(caption, style = SType.caption, color = c.subtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
