package com.saarthi.owner.ui.drivers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.PlateChip
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.dial
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.common.shortCount
import com.saarthi.owner.ui.design.Avatar
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.GroupLabel
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger
import com.saarthi.owner.ui.fleet.VehicleScreen
import com.saarthi.owner.ui.papers.PaperOpening
import com.saarthi.owner.ui.papers.StickerPanel
import com.saarthi.owner.ui.papers.UploadPaperSheet
import com.saarthi.owner.ui.papers.openPaper
import com.saarthi.owner.ui.papers.paperFile
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A paper a driver carries, from the shared catalogue's `DRIVER` types. */
internal class DriverPaperType(val code: String, val label: String, val expiryRequired: Boolean, val mandatory: Boolean = false)

/** The web's driver document types, in its order; retired ones are left out, as there. Read afresh each time, in the app's language. */
internal val DRIVER_PAPERS: List<DriverPaperType>
    get() = listOf(
        DriverPaperType("DRIVING_LICENCE", Words.get(R.string.people_driver_paper_licence), expiryRequired = true, mandatory = true),
        DriverPaperType("DRIVER_IDENTITY_PROOF", Words.get(R.string.people_driver_paper_identity), expiryRequired = false, mandatory = true),
        DriverPaperType("DRIVER_ADDRESS_PROOF", Words.get(R.string.people_driver_paper_address), expiryRequired = false),
        DriverPaperType("DRIVER_AADHAAR", Words.get(R.string.people_driver_paper_aadhaar), expiryRequired = false),
        DriverPaperType("DRIVER_PAN", Words.get(R.string.people_driver_paper_pan), expiryRequired = false),
        DriverPaperType("DRIVER_VOTER_ID", Words.get(R.string.people_driver_paper_voter_id), expiryRequired = false),
        DriverPaperType("DRIVER_PHOTO", Words.get(R.string.people_driver_paper_photo), expiryRequired = false),
        DriverPaperType("DRIVER_MEDICAL_CERTIFICATE", Words.get(R.string.people_driver_paper_medical), expiryRequired = true),
        DriverPaperType("DRIVER_POLICE_VERIFICATION", Words.get(R.string.people_driver_paper_police), expiryRequired = true),
    )

/**
 * One driver, as the web's driver page shows them: how they drive, the vehicle
 * they are on, their licence, their papers — uploaded and read here as every
 * paper is — their QR badge, and, for an account that may, taking them off
 * the fleet. Their account and record stay theirs.
 */
@Composable
fun DriverScreen(app: OwnerApp, account: SessionStore.Account, initial: DriversApi.Driver, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var driver by remember { mutableStateOf(initial) }
    var papers by remember { mutableStateOf<List<DriversApi.Paper>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var uploading by remember { mutableStateOf<DriverPaperType?>(null) }
    var opening by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var confirmingRemove by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf(false) }
    val canManage = account.can(DriversApi.CAN_MANAGE)
    val canUpload = account.can(PapersApi.CAN_UPLOAD_PAPERS)
    val isSelf = driver.userId == account.userId

    LaunchedEffect(initial.id, reload) {
        runCatching { app.drivers.get(initial.id) }.getOrNull()?.let { driver = it }
        papers = runCatching { app.drivers.papers(initial.id) }.getOrNull() ?: papers ?: emptyList()
    }

    fun open(paper: DriversApi.Paper) {
        opening = paper.id
        notice = null
        scope.launch {
            notice = try {
                val file = paperFile(context, paper.id, paper.mimeType)
                app.papers.downloadPaper(paper.id, file)
                if (openPaper(context, file, paper.mimeType) == PaperOpening.NO_VIEWER) Words.get(R.string.people_paper_no_viewer) to NoticeTone.WARNING else null
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                failure.readable() to NoticeTone.DANGER
            } finally {
                opening = null
            }
        }
    }

    DetailScreen(
        eyebrow = stringResource(R.string.people_driver),
        title = driver.fullName,
        footer = driver.phone?.let { phone ->
            { SaarthiButton(stringResource(R.string.people_driver_call, driver.fullName.substringBefore(' ')), onClick = { context.dial(phone) }, leading = Lucide.phone) }
        },
    ) {
        DriverHeader(driver, Modifier.rise())
        Figures(driver, Modifier.rise(stagger(1)))

        driver.currentTruck?.let { truck ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .rise(stagger(2))
                    .card(radius = 22.dp)
                    .pressable(scale = 0.98f, label = stringResource(R.string.people_driver_open_vehicle)) {
                        scope.launch {
                            runCatching { app.vehicles.get(truck.id) }.getOrNull()?.let { vehicle ->
                                navigator.push("vehicle-${vehicle.id}") { VehicleScreen(app, account, vehicle) }
                            }
                        }
                    }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Eyebrow(stringResource(R.string.people_driver_drives))
                    PlateChip(truck.registrationNumber, size = 14.sp)
                }
                com.saarthi.owner.ui.design.LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
            }
        }

        LicenceCard(driver, Modifier.rise(stagger(2)))

        GroupLabel(stringResource(R.string.people_papers))
        val shown = papers
        if (shown == null) {
            InlineSpinner(c.primary)
        } else {
            DRIVER_PAPERS.forEach { type ->
                val latest = shown.filter { it.documentType == type.code }.maxByOrNull { it.expiryDate.orEmpty() }
                PaperRow(
                    type,
                    latest,
                    busy = latest != null && opening == latest.id,
                    canUpload = canUpload,
                    onOpen = { latest?.let(::open) },
                    onUpload = { uploading = type },
                )
            }
        }
        notice?.let { (text, tone) -> NoticeCard(text, tone) }

        GroupLabel(stringResource(R.string.people_driver_qr_badge))
        StickerPanel(app, driver.id, subjectType = "DRIVER", caption = stringResource(R.string.people_driver_badge_caption))

        if (canManage && !isSelf) {
            GroupLabel(stringResource(R.string.people_driver_fleet))
            if (confirmingRemove) {
                Column(Modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.people_driver_remove_title, driver.fullName), style = SType.bodyStrong, color = c.fg)
                    Text(
                        stringResource(R.string.people_driver_remove_body),
                        style = SType.small,
                        color = c.muted,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SaarthiButton(stringResource(R.string.people_driver_keep), onClick = { confirmingRemove = false }, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
                        SaarthiButton(
                            stringResource(R.string.people_remove),
                            onClick = {
                                removing = true
                                notice = null
                                scope.launch {
                                    try {
                                        app.drivers.remove(driver.id)
                                        onChanged()
                                        navigator.pop()
                                    } catch (failure: Exception) {
                                        if (failure is CancellationException) throw failure
                                        notice = failure.readable() to NoticeTone.DANGER
                                        confirmingRemove = false
                                    } finally {
                                        removing = false
                                    }
                                }
                            },
                            tone = ButtonTone.DANGER_OUTLINE,
                            busy = removing,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            } else {
                LinkButton(stringResource(R.string.people_driver_remove_from_fleet), onClick = { confirmingRemove = true }, color = c.danger)
            }
        }
    }

    // Beside the page, not in it, so it rises over the whole screen.
    val type = uploading
    UploadPaperSheet(
        visible = type != null,
        folderLabel = type?.label.orEmpty(),
        documentType = type?.code.orEmpty(),
        plate = null,
        onDismiss = { uploading = null },
        expiryRequired = type?.expiryRequired ?: false,
    ) { file, number, issued, expires ->
        val code = type?.code ?: return@UploadPaperSheet
        app.papers.uploadPaper(driver.id, code, number, issued, expires, file, ownerType = PapersApi.OWNER_DRIVER)
        uploading = null
        notice = Words.get(R.string.people_driver_uploaded) to NoticeTone.SUCCESS
        reload++
        onChanged()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DriverHeader(driver: DriversApi.Driver, modifier: Modifier) {
    val c = Saarthi.colors
    Row(
        modifier.fillMaxWidth().card(radius = 24.dp).padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Avatar(driver.fullName, size = 60.dp, background = c.primarySoft, ink = c.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            listOfNotNull(driver.phone, driver.email).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.small, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val verified = driver.verificationStatus == DriversApi.VERIFIED
                StatusPill(stringResource(if (verified) R.string.people_driver_verified else R.string.people_driver_not_verified), background = if (verified) c.successBg else c.warningBg, ink = if (verified) c.success else c.warning)
                val (word, ground, ink) = availabilityLook(driver.availability)
                StatusPill(word, background = ground, ink = ink, dot = false)
            }
        }
    }
}

@Composable
internal fun availabilityLook(availability: String): Triple<String, androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> {
    val c = Saarthi.colors
    return when (availability) {
        "ON_TRIP" -> Triple(stringResource(R.string.people_driver_on_trip), c.successBg, c.success)
        "AVAILABLE" -> Triple(stringResource(R.string.people_driver_available), c.primaryWash, c.primary)
        "OFF_DUTY" -> Triple(stringResource(R.string.people_driver_off_duty), c.sunken, c.muted)
        "ON_LEAVE" -> Triple(stringResource(R.string.people_driver_on_leave), c.sunken, c.muted)
        "SUSPENDED" -> Triple(stringResource(R.string.people_driver_suspended), c.dangerBg, c.danger)
        else -> Triple(availability.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }, c.sunken, c.muted)
    }
}

@Composable
private fun Figures(driver: DriversApi.Driver, modifier: Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Figure(stringResource(R.string.people_driver_score), driver.overallScore?.toString() ?: "—", Modifier.weight(1f))
        Figure(stringResource(R.string.people_driver_trips), driver.totalTrips.toString(), Modifier.weight(1f))
        Figure(stringResource(R.string.people_driver_driven), stringResource(R.string.common_distance_km, shortCount(driver.totalDistanceKm)), Modifier.weight(1f))
        Figure(stringResource(R.string.people_driver_years), driver.experienceYears.toString(), Modifier.weight(1f))
    }
}

@Composable
private fun Figure(label: String, value: String, modifier: Modifier) {
    val c = Saarthi.colors
    Column(modifier.card(radius = 18.dp).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Eyebrow(label, maxLines = 1)
        Text(value, style = SType.headerTitle.copy(fontSize = 17.sp), color = c.fg, maxLines = 1)
    }
}

@Composable
private fun LicenceCard(driver: DriversApi.Driver, modifier: Modifier) {
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Eyebrow(stringResource(R.string.people_driver_paper_licence))
        Text(driver.licenseNumber ?: stringResource(R.string.people_driver_not_added_yet), style = SType.bodyStrong, color = if (driver.licenseNumber != null) c.fg else c.muted)
        listOfNotNull(prettyDate(driver.licenseExpiryDate)?.let { stringResource(R.string.people_driver_valid_till, it) }, driver.licenseClass?.ifBlank { null })
            .joinToString(" · ")
            .takeIf { it.isNotBlank() }
            ?.let { Text(it, style = SType.small, color = c.muted) }
    }
}

/** One kind of paper: what is on file and how it stands, opening it, and uploading or renewing it. */
@Composable
private fun PaperRow(
    type: DriverPaperType,
    paper: DriversApi.Paper?,
    busy: Boolean,
    canUpload: Boolean,
    onOpen: () -> Unit,
    onUpload: () -> Unit,
) {
    val c = Saarthi.colors
    val (word, ink) = when {
        paper == null -> stringResource(if (type.mandatory) R.string.people_driver_paper_missing else R.string.people_driver_paper_not_added) to (if (type.mandatory) c.warning else c.subtle)
        paper.verificationStatus == "REJECTED" -> stringResource(R.string.people_driver_paper_rejected) to c.danger
        paper.validity == "EXPIRED" -> stringResource(R.string.people_driver_paper_expired) to c.danger
        paper.validity == "EXPIRING_SOON" -> stringResource(R.string.people_driver_paper_expiring) to c.warning
        else -> (
            prettyDate(paper.expiryDate)?.let { stringResource(R.string.people_driver_paper_on_file_till, it) }
                ?: stringResource(R.string.people_driver_paper_on_file)
        ) to c.muted
    }
    Row(
        Modifier
            .fillMaxWidth()
            .card(radius = 18.dp)
            .pressable(enabled = paper != null, scale = 0.99f, label = stringResource(R.string.people_driver_paper_open, type.label), onClick = onOpen)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(type.label, style = SType.bodyStrong, color = c.fg)
            Text(word, style = SType.caption, color = ink)
        }
        if (busy) InlineSpinner(c.primary)
        if (canUpload) {
            LinkButton(
                stringResource(if (paper == null) R.string.people_driver_paper_upload else R.string.people_driver_paper_replace),
                onClick = onUpload,
                style = SType.smallStrong,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
    }
}
