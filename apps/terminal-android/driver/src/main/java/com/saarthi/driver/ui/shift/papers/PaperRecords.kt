package com.saarthi.driver.ui.shift.papers

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.core.network.LicenceCardDto
import com.saarthi.core.network.VirtualRcDto
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.topRule
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit

/*
 * What the RTO register holds: the vehicle's virtual RC and the driver's
 * licence. Read as a record rather than a file — there may be no scan at all,
 * and a driver at a check post still needs the numbers and the dates.
 */

/** "12 Mar 2027" in the phone's own date style; null for nothing or nonsense. */
internal fun prettyDate(value: String?): String? {
    val date = parseDate(value) ?: return null
    return date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
}

internal fun parseDate(value: String?): LocalDate? {
    if (value.isNullOrBlank()) return null
    return runCatching { LocalDate.parse(value.take(10)) }.getOrNull()
        ?: runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull()
}

/** Where a register date stands today, for its colour. */
internal fun validityOf(value: String?): FolderStatus? {
    val date = parseDate(value) ?: return null
    val days = ChronoUnit.DAYS.between(LocalDate.now(), date)
    return when {
        days < 0 -> FolderStatus.EXPIRED
        days <= EXPIRING_SOON_DAYS -> FolderStatus.EXPIRING_SOON
        else -> FolderStatus.VALID
    }
}

/** The platform's "expiring soon" window — the same thirty days the web colours by. */
private const val EXPIRING_SOON_DAYS = 30L

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
            Text(stringResource(R.string.papers_register_title), style = SType.caption, color = c.muted)
            Text(stringResource(R.string.papers_valid_till, shown), style = SType.bodyStrong, color = c.fg)
        }
        validityOf(validUntil)?.let { StatusTag(it) }
    }
}

/**
 * The virtual RC, as the RTO register holds it.
 *
 * The owner's name, the chassis and the engine number arrive partly hidden: the
 * driver is not the registered owner, and the card shows them as the server
 * sent them — enough for an officer to match the vehicle, too little to find
 * the person.
 */
@Composable
internal fun VirtualRcCard(rc: VirtualRcDto, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(24.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .brandGradient(shape)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(stringResource(R.string.papers_rc_title), color = Color.White.copy(alpha = 0.75f))
                Spacer(Modifier.weight(1f))
                if (rc.verified) {
                    StatusPill(
                        stringResource(R.string.papers_rc_verified),
                        background = Color.White.copy(alpha = 0.16f),
                        ink = Color.White,
                        dot = false,
                    )
                }
            }
            Text(
                rc.registrationNumber,
                style = SType.hero.copy(fontSize = 30.sp, lineHeight = 32.sp, letterSpacing = 0.04.em),
                color = Color.White,
            )
            listOfNotNull(rc.maker, rc.model, rc.variant).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.bodyStrong, color = Color.White.copy(alpha = 0.9f))
            }
            Text(
                stringResource(R.string.papers_rc_fetched, prettyDate(rc.dataAsOf ?: rc.retrievedAt) ?: "—"),
                style = SType.caption,
                color = Color.White.copy(alpha = 0.7f),
            )
        }

        RecordSection(R.string.papers_rc_validity) {
            ValidityRow(R.string.papers_rc_insurance, rc.insuranceValidUntil, listOfNotNull(rc.insurer, rc.insurancePolicyNumber))
            ValidityRow(R.string.papers_rc_puc, rc.puccValidUntil, listOfNotNull(rc.puccNumber))
            ValidityRow(R.string.papers_rc_fitness, rc.fitnessValidUntil, emptyList())
            ValidityRow(R.string.papers_rc_tax, rc.taxValidUntil, emptyList())
            ValidityRow(R.string.papers_rc_permit, rc.permitValidUntil, listOfNotNull(rc.permitType, rc.permitNumber))
            if (rc.nationalPermitValidUntil != null) {
                ValidityRow(R.string.papers_rc_national_permit, rc.nationalPermitValidUntil, emptyList())
            }
        }

        RecordSection(R.string.papers_rc_details) {
            Field(R.string.papers_rc_owner, rc.ownerName)
            Field(R.string.papers_rc_registered, prettyDate(rc.registrationDate))
            Field(R.string.papers_rc_status, rc.registrationStatus)
            Field(R.string.papers_rc_class, listOfNotNull(rc.vehicleClass, rc.bodyType).joinToString(" · ").ifBlank { null })
            Field(R.string.papers_rc_fuel, listOfNotNull(rc.fuelType, rc.emissionNorms).joinToString(" · ").ifBlank { null })
            Field(R.string.papers_rc_colour, rc.color)
            Field(R.string.papers_rc_made, rc.manufacturedOn)
            Field(R.string.papers_rc_chassis, rc.chassisNumber)
            Field(R.string.papers_rc_engine, rc.engineNumber)
            Field(R.string.papers_rc_rto, rc.rto)
            Field(R.string.papers_rc_seats, rc.seatingCapacity?.toString())
            Field(R.string.papers_rc_weight, rc.grossVehicleWeight?.let { "%,.0f kg".format(it) })
            Field(R.string.papers_rc_financer, rc.financer)
            Field(R.string.papers_rc_blacklist, rc.blacklistStatus)
        }

        Text(stringResource(R.string.papers_rc_note), style = SType.micro, color = c.subtle, modifier = Modifier.padding(horizontal = 4.dp))
    }
}

/** The driver's licence, in full — it is their own. */
@Composable
internal fun LicenceCard(licence: LicenceCardDto, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(24.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .brandGradient(shape)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(stringResource(R.string.papers_licence_title), color = Color.White.copy(alpha = 0.75f))
                Spacer(Modifier.weight(1f))
                if (licence.verified) {
                    StatusPill(
                        stringResource(R.string.papers_licence_verified),
                        background = Color.White.copy(alpha = 0.16f),
                        ink = Color.White,
                        dot = false,
                    )
                }
            }
            Text(
                licence.licenceNumber ?: "—",
                style = SType.hero.copy(fontSize = 24.sp, lineHeight = 28.sp, letterSpacing = 0.03.em),
                color = Color.White,
            )
            licence.holderName?.let { Text(it, style = SType.bodyStrong, color = Color.White.copy(alpha = 0.9f)) }
            Text(
                stringResource(if (licence.source == "RTO") R.string.papers_licence_from_rto else R.string.papers_licence_from_profile),
                style = SType.caption,
                color = Color.White.copy(alpha = 0.7f),
            )
        }

        RecordSection(R.string.papers_rc_validity) {
            ValidityRow(R.string.papers_licence_transport, licence.transportValidUntil, emptyList())
            ValidityRow(R.string.papers_licence_non_transport, licence.validUntil, emptyList())
        }

        RecordSection(R.string.papers_rc_details) {
            Field(R.string.papers_licence_classes, licence.vehicleClasses.joinToString(", ").ifBlank { null })
            Field(R.string.papers_licence_issued, prettyDate(licence.issuedOn))
            Field(R.string.papers_licence_authority, listOfNotNull(licence.issuingAuthority, licence.state).joinToString(" · ").ifBlank { null })
            Field(R.string.papers_licence_dob, prettyDate(licence.dateOfBirth))
            Field(R.string.papers_licence_blood, licence.bloodGroup)
        }
    }
}

@Composable
private fun RecordSection(@StringRes title: Int, rows: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .card(radius = 20.dp)
            .padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Eyebrow(stringResource(title), Modifier.padding(top = 10.dp, bottom = 4.dp), color = Saarthi.colors.muted)
        rows()
    }
}

/** A labelled value, left out when the register gave nothing — never a dash pretending to be data. */
@Composable
private fun Field(@StringRes label: Int, value: String?) {
    val shown = value?.takeIf { it.isNotBlank() } ?: return
    val c = Saarthi.colors
    Row(
        Modifier
            .fillMaxWidth()
            .topRule(c.border)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(label), style = SType.small, color = c.muted, modifier = Modifier.weight(0.42f))
        Text(shown, style = SType.smallStrong, color = c.fg, textAlign = TextAlign.End, modifier = Modifier.weight(0.58f))
    }
}

/** A paper's date from the register, coloured by how long it has left. */
@Composable
private fun ValidityRow(@StringRes label: Int, validUntil: String?, detail: List<String>) {
    val c = Saarthi.colors
    val date = prettyDate(validUntil)
    Row(
        Modifier
            .fillMaxWidth()
            .topRule(c.border)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(label), style = SType.smallStrong, color = c.fg)
            detail.joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.caption, color = c.muted, maxLines = 1)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                date?.let { stringResource(R.string.papers_till, it) } ?: stringResource(R.string.papers_not_published),
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
}
