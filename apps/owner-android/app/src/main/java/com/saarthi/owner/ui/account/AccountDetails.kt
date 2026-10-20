package com.saarthi.owner.ui.account

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AccountApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.SkeletonCards
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.topRule
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * The account beyond its name: the plan, where verification stands, the
 * profile as the web's profile page holds it, and where to get help. The
 * profile is changed here, a section at a time; the plan and verification
 * are changed on the web, and each says so.
 */

/** Public pages, served from the site itself whichever API a build talks to. */
private const val SITE = "https://vorldxsaarthi.com"
private const val SUPPORT_EMAIL = "vx.saarthi@gmail.com"

/** Values that would only be noise in a list of words: photos are shown as photos, map pins not at all. */
private val UNSHOWN_KINDS = setOf("GEO", "IMAGE")
private val COORDINATE_KEYS = setOf("latitude", "longitude", "lat", "lng")
private const val LONG_WORD = 16

/** One panel's answer: loading, failed with a reason, or held. Each panel stands alone. */
private class AccountData(
    val profile: Loadable<AccountApi.Profile?>,
    val plan: Loadable<AccountApi.Plan?>?,
    val verification: Loadable<AccountApi.Verification?>?,
)

private suspend fun <T> read(block: suspend () -> T): Loadable<T> =
    try {
        Loadable.Ready(block())
    } catch (failure: Exception) {
        Loadable.Failed(failure.readable())
    }

@Composable
internal fun AccountDetails(
    account: SessionStore.Account,
    api: OwnerApi,
    places: PlacesApi,
    reload: Int,
    onReload: () -> Unit,
    onAvatar: (String?) -> Unit,
) {
    val navigator = LocalNavigator.current
    val accountApi = remember(api) { AccountApi(api) }
    // A panel this role could not open on the web is not asked for at all.
    val showsPlan = account.can(AccountApi.SUBSCRIPTION_READ)
    val showsVerification = account.can(AccountApi.VERIFICATION_READ)
    var data by remember {
        mutableStateOf(
            AccountData(Loadable.Loading, if (showsPlan) Loadable.Loading else null, if (showsVerification) Loadable.Loading else null),
        )
    }

    LaunchedEffect(account.organizationId, reload) {
        data = coroutineScope {
            val profile = async { read { accountApi.profile() } }
            val plan = async { if (showsPlan) read { accountApi.plan() } else null }
            val verification = async { if (showsVerification) read { accountApi.verification() } else null }
            AccountData(profile.await(), plan.await(), verification.await())
        }
        (data.profile as? Loadable.Ready)?.value?.let { onAvatar(it.avatarId()) }
    }

    data.plan?.let { plan ->
        GroupLabel(stringResource(R.string.people_account_plan))
        Panel(plan) { PlanCard(it) }
    }
    data.verification?.let { verification ->
        GroupLabel(stringResource(R.string.people_account_verification))
        Panel(verification) { VerificationCard(it) }
    }
    GroupLabel(stringResource(R.string.people_account_profile))
    Panel(data.profile) { profile ->
        ProfileCards(accountApi, profile) { section ->
            navigator.push("profile-${section.key}") {
                ProfileSectionScreen(accountApi, places, profile, section, PhotoOwners(account.userId, profile.organizationId), onSaved = onReload)
            }
        }
    }
}

/** The person's own photo, wherever this account's blueprint keeps it. */
private fun AccountApi.Profile.avatarId(): String? = sections.firstNotNullOfOrNull { section ->
    section.fields.firstOrNull { it.mediaPurpose == "AVATAR" }?.let { (valueOf(section, it) as? JsonPrimitive)?.contentOrNull }
}

/** A placeholder while loading, the reason when it failed, otherwise [content]. */
@Composable
private fun <T> Panel(state: Loadable<T?>, content: @Composable (T) -> Unit) {
    when (state) {
        Loadable.Loading -> SkeletonCards(count = 1)
        is Loadable.Failed -> NoticeCard(state.message, NoticeTone.WARNING, icon = Lucide.cloudOff)
        is Loadable.Ready -> state.value?.let { content(it) } ?: Hint(stringResource(R.string.people_account_nothing_on_file))
    }
}

@Composable
private fun PlanCard(plan: AccountApi.Plan) {
    val c = Saarthi.colors
    val active = plan.status == "ACTIVE" || plan.status == "TRIALING"
    val ends = prettyDate(plan.endsAt)
    Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(plan.name.replace("Supplier", "Seller"), style = SType.cardTitle, color = c.fg, modifier = Modifier.weight(1f))
            StatusPill(
                humanise(plan.status),
                background = if (active) c.successBg else c.warningBg,
                ink = if (active) c.success else c.warning,
            )
        }
        ends?.let {
            Text(
                when (plan.status) {
                    "ACTIVE" -> stringResource(R.string.people_account_renews_on, it)
                    "TRIALING" -> stringResource(R.string.people_account_trial_ends_on, it)
                    else -> stringResource(R.string.people_account_ends_on, it)
                },
                style = SType.small,
                color = c.muted,
            )
        }
        Text(
            listOf(
                pluralStringResource(R.plurals.people_account_plan_vehicles, plan.usage.vehicles, plan.usage.vehicles),
                pluralStringResource(R.plurals.people_account_plan_members, plan.usage.members, plan.usage.members),
                pluralStringResource(R.plurals.people_account_plan_drivers, plan.usage.drivers, plan.usage.drivers),
            ).joinToString(" · "),
            style = SType.small,
            color = c.muted,
        )
        Text(stringResource(R.string.people_account_plans_on_web), style = SType.caption, color = c.subtle, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun VerificationCard(verification: AccountApi.Verification) {
    val c = Saarthi.colors
    if (verification.steps.isEmpty()) {
        Hint(stringResource(R.string.people_account_nothing_to_verify))
        return
    }
    Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(horizontal = 16.dp, vertical = 6.dp)) {
        verification.steps.forEachIndexed { index, step ->
            Row(
                Modifier.fillMaxWidth().then(if (index > 0) Modifier.topRule(c.border) else Modifier).padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(step.title, style = SType.smallStrong, color = c.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    listOfNotNull(step.reference, prettyDate(step.verifiedAt)?.let { stringResource(R.string.people_account_verified_on, it) })
                        .joinToString(" · ")
                        .takeIf { it.isNotBlank() }
                        ?.let { Text(it, style = SType.caption, color = c.muted, maxLines = 1) }
                }
                StepPill(step.state)
            }
        }
    }
    if (verification.overall != "VERIFIED") {
        Hint(stringResource(R.string.people_account_finish_verifying))
    }
}

@Composable
private fun StepPill(state: String) {
    val c = Saarthi.colors
    val (ground, ink) = when (state) {
        "VERIFIED" -> c.successBg to c.success
        "FAILED", "RETRY_REQUIRED" -> c.dangerBg to c.danger
        "UNDER_REVIEW", "VERIFYING", "PAYMENT_PROCESSING" -> c.infoSoft to c.info
        "PAYMENT_REQUIRED" -> c.warningBg to c.warning
        else -> c.sunken to c.muted
    }
    StatusPill(humanise(state), background = ground, ink = ink, dot = false)
}

/** The profile as the web's profile page holds it, one card per section, each with its way to change it. */
@Composable
private fun ProfileCards(accountApi: AccountApi, profile: AccountApi.Profile, onEdit: (AccountApi.Section) -> Unit) {
    val c = Saarthi.colors
    Text(stringResource(R.string.people_account_profile_complete, profile.completion.percent), style = SType.smallStrong, color = c.muted, modifier = Modifier.padding(start = 4.dp))
    // A section made only of map pins has nothing to show here.
    profile.sections.filter { section -> section.fields.any { it.kind != "GEO" } }.forEach { section ->
        val rows = section.fields
            .filter { it.kind !in UNSHOWN_KINDS }
            .mapNotNull { field -> field.shown(profile.valueOf(section, field))?.let { field.label to it } }
        val photos = section.fields.filter { it.kind == "IMAGE" }
        val editable = section.fields.any { profile.canEdit(it) }
        Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(horizontal = 16.dp, vertical = 6.dp)) {
            Row(Modifier.padding(top = 10.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(section.title, Modifier.weight(1f))
                if (editable) LinkButton(stringResource(R.string.people_account_edit), onClick = { onEdit(section) }, style = SType.smallStrong)
            }
            if (photos.isNotEmpty()) {
                Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    photos.forEach { field ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            RemotePhoto(accountApi, (profile.valueOf(section, field) as? JsonPrimitive)?.contentOrNull, field.label, 56.dp, emptyIcon = Lucide.image)
                            Text(field.label, style = SType.caption, color = c.muted)
                        }
                    }
                }
            }
            if (rows.isEmpty() && photos.isEmpty()) {
                Text(stringResource(R.string.people_account_nothing_added), style = SType.small, color = c.subtle, modifier = Modifier.padding(bottom = 10.dp))
            }
            rows.forEach { (label, value) ->
                if (value.isLongWord()) {
                    // An ID or e-mail would break mid-word beside its label; it gets the full width.
                    Column(Modifier.fillMaxWidth().topRule(c.border).padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(label, style = SType.small, color = c.muted)
                        Text(value, style = SType.smallStrong, color = c.fg)
                    }
                } else {
                    Row(
                        Modifier.fillMaxWidth().topRule(c.border).padding(vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(0.42f))
                        Text(value, style = SType.smallStrong, color = c.fg, textAlign = TextAlign.End, modifier = Modifier.weight(0.58f))
                    }
                }
            }
        }
    }
}

/** A value with no place to wrap that is too long for the half row beside its label: an ID, an e-mail. */
private fun String.isLongWord(): Boolean = length > LONG_WORD && none { it.isWhitespace() }

/** A field's value in words: an option's label, a date, a list or an address joined up. */
private fun AccountApi.Field.shown(value: JsonElement?): String? = when (value) {
    null -> null
    is JsonPrimitive -> value.contentOrNull?.takeIf { it.isNotBlank() }?.let { raw ->
        when (kind) {
            "SELECT" -> options.firstOrNull { it.value == raw }?.label ?: raw
            "BOOLEAN" -> Words.get(if (value.booleanOrNull == true) R.string.people_account_yes else R.string.people_account_no)
            "DATE" -> prettyDate(raw) ?: raw
            else -> raw
        }
    }
    is JsonArray -> value
        .mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.let { raw -> options.firstOrNull { o -> o.value == raw }?.label ?: raw } }
        .joinToString(", ")
        .ifBlank { null }
    is JsonObject -> value.entries
        .filter { it.key !in COORDINATE_KEYS }
        .mapNotNull { (it.value as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank) }
        .joinToString(", ")
        .ifBlank { null }
}

/** Support, and the terms the account is held under. */
@Composable
internal fun HelpLinks() {
    val context = LocalContext.current
    GroupLabel(stringResource(R.string.people_account_help_legal))
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LinkRow(Lucide.mail, stringResource(R.string.people_account_email_support), SUPPORT_EMAIL) { open(context, "mailto:$SUPPORT_EMAIL") }
        LinkRow(Lucide.fileText, stringResource(R.string.people_account_terms), null) { open(context, "$SITE/terms") }
        LinkRow(Lucide.shieldCheck, stringResource(R.string.people_account_privacy), null) { open(context, "$SITE/privacy") }
    }
}

@Composable
private fun LinkRow(icon: String, title: String, detail: String?, onOpen: () -> Unit) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .pressable(scale = 0.98f, label = title, onClick = onOpen)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(icon, well = c.primarySoft, ink = c.primary, size = 38.dp, radius = 12.dp, iconSize = 17.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = SType.bodyStrong, color = c.fg)
            detail?.let { Text(it, style = SType.caption, color = c.muted) }
        }
        LineIcon(Lucide.externalLink, size = 16.dp, color = c.subtle)
    }
}

/** Hand a link to whatever app handles it; nothing happens if none can. */
private fun open(context: Context, uri: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
    } catch (_: ActivityNotFoundException) {
    }
}

/** `TRIALING` as "Trialing", `UNDER_REVIEW` as "Under review" — in the app's language for the states this screen knows. */
private fun humanise(value: String): String = when (value) {
    "ACTIVE" -> Words.get(R.string.people_account_status_active)
    "TRIALING" -> Words.get(R.string.people_account_status_trialing)
    "VERIFIED" -> Words.get(R.string.people_account_status_verified)
    "FAILED" -> Words.get(R.string.people_account_status_failed)
    "RETRY_REQUIRED" -> Words.get(R.string.people_account_status_retry_required)
    "UNDER_REVIEW" -> Words.get(R.string.people_account_status_under_review)
    "VERIFYING" -> Words.get(R.string.people_account_status_verifying)
    "PAYMENT_PROCESSING" -> Words.get(R.string.people_account_status_payment_processing)
    "PAYMENT_REQUIRED" -> Words.get(R.string.people_account_status_payment_required)
    else -> value.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}
