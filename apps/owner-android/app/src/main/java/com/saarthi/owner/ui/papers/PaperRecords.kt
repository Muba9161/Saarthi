package com.saarthi.owner.ui.papers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.formatPlate
import com.saarthi.owner.ui.common.parseDate
import com.saarthi.owner.ui.common.prettyDate
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.PasswordField
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.StatusPill
import com.saarthi.owner.ui.design.brandGradient
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.topRule
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/*
 * What the RTO register holds about the vehicle: the virtual RC. Read as a
 * record rather than a file, because there may be no scan at all and the
 * numbers and dates are still what a check post asks for.
 */

/** The platform's "expiring soon" window, the same thirty days the web colours by. */
private const val EXPIRING_SOON_DAYS = 30L

/** `securePinSchema`: four digits. */
private const val PIN_LENGTH = 4

/** Where a date stands today, for its colour. */
internal fun validityOf(value: String?): FolderStatus? {
    val date = parseDate(value) ?: return null
    val days = ChronoUnit.DAYS.between(LocalDate.now(), date)
    return when {
        days < 0 -> FolderStatus.EXPIRED
        days <= EXPIRING_SOON_DAYS -> FolderStatus.EXPIRING_SOON
        else -> FolderStatus.VALID
    }
}

/** One line from the register: "RTO register · valid till 12 Mar 2027". */
@Composable
internal fun RegisterLine(validUntil: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shown = prettyDate(validUntil) ?: return
    Row(
        modifier
            .fillMaxWidth()
            .card(radius = 16.dp, elevated = false)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.papers_rc_register), style = SType.caption, color = c.muted)
            Text(stringResource(R.string.papers_valid_till, shown), style = SType.bodyStrong, color = c.fg)
        }
        validityOf(validUntil)?.let { StatusTag(it) }
    }
}

/**
 * The virtual RC, as the RTO register holds it and as this account may see it.
 *
 * The owner's name, chassis and engine number arrive masked until the server
 * says otherwise; [RcAccessPanel] below the card says why, and what opens them.
 */
@Composable
internal fun VirtualRcCard(rc: PapersApi.VirtualRc, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(24.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .brandGradient(shape)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(stringResource(R.string.papers_rc_virtual), color = Color.White.copy(alpha = 0.75f))
                Spacer(Modifier.weight(1f))
                if (rc.verified) {
                    StatusPill(stringResource(R.string.papers_rc_verified), background = Color.White.copy(alpha = 0.16f), ink = Color.White, dot = false)
                }
            }
            Text(formatPlate(rc.registrationNumber), style = SType.plate(28.sp, 0.04.em), color = Color.White)
            listOfNotNull(rc.maker, rc.model, rc.variant).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.bodyStrong, color = Color.White.copy(alpha = 0.9f))
            }
            Text(
                prettyDate(rc.dataAsOf ?: rc.retrievedAt)?.let { stringResource(R.string.papers_rc_as_of, it) }
                    ?: stringResource(R.string.papers_rc_as_of_unknown),
                style = SType.caption,
                color = Color.White.copy(alpha = 0.7f),
            )
        }

        RecordSection(stringResource(R.string.papers_rc_validity)) {
            ValidityRow(stringResource(R.string.papers_rc_insurance), rc.insuranceValidUntil, listOfNotNull(rc.insurer, rc.insurancePolicyNumber))
            ValidityRow(stringResource(R.string.papers_rc_pollution), rc.puccValidUntil, listOfNotNull(rc.puccNumber))
            ValidityRow(stringResource(R.string.papers_rc_fitness), rc.fitnessValidUntil, emptyList())
            ValidityRow(stringResource(R.string.papers_rc_road_tax), rc.taxValidUntil, emptyList())
            ValidityRow(stringResource(R.string.papers_rc_permit), rc.permitValidUntil, listOfNotNull(rc.permitType, rc.permitNumber))
            if (rc.nationalPermitValidUntil != null) {
                ValidityRow(stringResource(R.string.papers_rc_national_permit), rc.nationalPermitValidUntil, emptyList())
            }
        }

        RecordSection(stringResource(R.string.papers_rc_details)) {
            Field(stringResource(R.string.papers_rc_owner), rc.ownerName)
            Field(stringResource(R.string.papers_rc_registered), prettyDate(rc.registrationDate))
            Field(stringResource(R.string.papers_rc_status), rc.registrationStatus)
            Field(stringResource(R.string.papers_rc_class), listOfNotNull(rc.vehicleClass, rc.bodyType).joinToString(" · ").ifBlank { null })
            Field(stringResource(R.string.papers_rc_fuel), listOfNotNull(rc.fuelType, rc.emissionNorms).joinToString(" · ").ifBlank { null })
            Field(stringResource(R.string.papers_rc_colour), rc.color)
            Field(stringResource(R.string.papers_rc_made), rc.manufacturedOn)
            Field(stringResource(R.string.papers_rc_chassis), rc.chassisNumber)
            Field(stringResource(R.string.papers_rc_engine), rc.engineNumber)
            Field(stringResource(R.string.papers_rc_rto), rc.rto)
            Field(stringResource(R.string.papers_rc_seats), rc.seatingCapacity?.toString())
            Field(stringResource(R.string.papers_rc_gross_weight), rc.grossVehicleWeight?.let { stringResource(R.string.papers_rc_weight_kg, "%,.0f".format(it)) })
            Field(stringResource(R.string.papers_rc_financer), rc.financer)
            Field(stringResource(R.string.papers_rc_blacklist), rc.blacklistStatus)
        }
    }
}

/**
 * Why the RC is masked, in words the owner can act on, and the Secure PIN when
 * that is all that stands in the way. The same reasons the web gives, so the
 * two never send the owner in different directions.
 */
@Composable
internal fun RcAccessPanel(app: OwnerApp, rc: PapersApi.VirtualRc, onUnlocked: suspend () -> Unit) {
    when (rc.access) {
        PapersApi.ACCESS_FULL -> Unit
        PapersApi.ACCESS_LOCKED -> PinUnlock(app, onUnlocked)
        PapersApi.ACCESS_OWNERSHIP_REQUIRED -> NoticeCard(
            stringResource(R.string.papers_rc_masked_ownership),
            NoticeTone.INFO,
            icon = Lucide.lock,
        )
        else -> NoticeCard(
            stringResource(R.string.papers_rc_masked_role),
            NoticeTone.INFO,
            icon = Lucide.lock,
        )
    }
}

/** The Secure PIN: the web's own unlock, for this sign-in only. */
@Composable
private fun PinUnlock(app: OwnerApp, onUnlocked: suspend () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.papers_pin_title), style = SType.bodyStrong, color = c.fg)
        Text(
            stringResource(R.string.papers_pin_body),
            style = SType.small,
            color = c.muted,
        )
        PasswordField(
            value = pin,
            onValueChange = { typed -> pin = typed.filter(Char::isDigit).take(PIN_LENGTH) },
            label = stringResource(R.string.papers_pin_label),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        SaarthiButton(
            stringResource(R.string.papers_pin_show),
            onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        app.papers.unlock(pin)
                        onUnlocked()
                    } catch (failure: Exception) {
                        problem = failure.readable()
                    } finally {
                        pin = ""
                        busy = false
                    }
                }
            },
            enabled = pin.length == PIN_LENGTH,
            busy = busy,
            busyText = stringResource(R.string.papers_checking),
            leading = Lucide.lock,
            tone = ButtonTone.SECONDARY,
        )
        problem?.let { NoticeCard(it, NoticeTone.DANGER) }
    }
}

@Composable
internal fun RecordSection(title: String, rows: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Eyebrow(title, Modifier.padding(top = 10.dp, bottom = 4.dp))
        rows()
    }
}

/** A labelled value, left out when the register gave nothing: never a dash pretending to be data. */
@Composable
internal fun Field(label: String, value: String?) {
    val shown = value?.takeIf { it.isNotBlank() } ?: return
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .topRule(c.border)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = SType.small, color = c.muted, modifier = Modifier.weight(0.42f))
        Text(shown, style = SType.smallStrong, color = c.fg, textAlign = TextAlign.End, modifier = Modifier.weight(0.58f))
    }
}

/** A paper's date from the register, coloured by how long it has left. */
@Composable
private fun ValidityRow(label: String, validUntil: String?, detail: List<String>) {
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .topRule(c.border)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = SType.smallStrong, color = c.fg)
            detail.joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.caption, color = c.muted, maxLines = 1)
            }
        }
        Text(
            // The register sometimes holds words rather than a date: "LTT" is a
            // tax paid for the vehicle's lifetime, which never lapses.
            prettyDate(validUntil)?.let { stringResource(R.string.papers_rc_till, it) }
                ?: validUntil?.takeIf { it.isNotBlank() }?.let { if (it.equals("LTT", ignoreCase = true)) stringResource(R.string.papers_rc_lifetime_tax) else it }
                ?: stringResource(R.string.papers_rc_not_published),
            style = SType.smallStrong,
            color = when (validityOf(validUntil)) {
                FolderStatus.EXPIRED -> c.danger
                FolderStatus.EXPIRING_SOON -> c.warning
                FolderStatus.VALID -> c.success
                else -> c.muted
            },
        )
    }
}
