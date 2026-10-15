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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.saarthi.owner.OwnerApp
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
            Text("RTO register", style = SType.caption, color = c.muted)
            Text("Valid till $shown", style = SType.bodyStrong, color = c.fg)
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
                Eyebrow("Virtual RC", color = Color.White.copy(alpha = 0.75f))
                Spacer(Modifier.weight(1f))
                if (rc.verified) {
                    StatusPill("Verified", background = Color.White.copy(alpha = 0.16f), ink = Color.White, dot = false)
                }
            }
            Text(formatPlate(rc.registrationNumber), style = SType.plate(28.sp, 0.04.em), color = Color.White)
            listOfNotNull(rc.maker, rc.model, rc.variant).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                Text(it, style = SType.bodyStrong, color = Color.White.copy(alpha = 0.9f))
            }
            Text(
                "From the RTO register · as of ${prettyDate(rc.dataAsOf ?: rc.retrievedAt) ?: "an unknown date"}",
                style = SType.caption,
                color = Color.White.copy(alpha = 0.7f),
            )
        }

        RecordSection("Validity") {
            ValidityRow("Insurance", rc.insuranceValidUntil, listOfNotNull(rc.insurer, rc.insurancePolicyNumber))
            ValidityRow("Pollution (PUC)", rc.puccValidUntil, listOfNotNull(rc.puccNumber))
            ValidityRow("Fitness", rc.fitnessValidUntil, emptyList())
            ValidityRow("Road tax", rc.taxValidUntil, emptyList())
            ValidityRow("Permit", rc.permitValidUntil, listOfNotNull(rc.permitType, rc.permitNumber))
            if (rc.nationalPermitValidUntil != null) {
                ValidityRow("National permit", rc.nationalPermitValidUntil, emptyList())
            }
        }

        RecordSection("Details") {
            Field("Owner", rc.ownerName)
            Field("Registered", prettyDate(rc.registrationDate))
            Field("Status", rc.registrationStatus)
            Field("Class", listOfNotNull(rc.vehicleClass, rc.bodyType).joinToString(" · ").ifBlank { null })
            Field("Fuel", listOfNotNull(rc.fuelType, rc.emissionNorms).joinToString(" · ").ifBlank { null })
            Field("Colour", rc.color)
            Field("Made", rc.manufacturedOn)
            Field("Chassis", rc.chassisNumber)
            Field("Engine", rc.engineNumber)
            Field("RTO", rc.rto)
            Field("Seats", rc.seatingCapacity?.toString())
            Field("Gross weight", rc.grossVehicleWeight?.let { "%,.0f kg".format(it) })
            Field("Financer", rc.financer)
            Field("Blacklist", rc.blacklistStatus)
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
            "Owner details are masked because this account has not confirmed it owns the vehicle. " +
                "The RC owner's name has to match a verified PAN, Voter ID or business GSTIN on the account. " +
                "The vehicle's Ownership card on the Saarthi website shows where it stands.",
            NoticeTone.INFO,
            icon = Lucide.lock,
        )
        else -> NoticeCard(
            "Owner details, engine number and chassis number are hidden. Your role does not include access to personal vehicle data.",
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
        Text("Owner details are masked", style = SType.bodyStrong, color = c.fg)
        Text(
            "Enter your Secure PIN to see them in full and download the certificate. It is the same 4-digit PIN you use on the Saarthi website.",
            style = SType.small,
            color = c.muted,
        )
        PasswordField(
            value = pin,
            onValueChange = { typed -> pin = typed.filter(Char::isDigit).take(PIN_LENGTH) },
            label = "Secure PIN",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        SaarthiButton(
            "Show full RC",
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
            busyText = "Checking…",
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
            prettyDate(validUntil)?.let { "Till $it" }
                ?: validUntil?.takeIf { it.isNotBlank() }?.let { if (it.equals("LTT", ignoreCase = true)) "Lifetime tax" else it }
                ?: "Not published",
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
