package com.saarthi.owner.ui.alerts

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import com.saarthi.owner.R
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.Saarthi

/** The tabs above the list. */
enum class AlertFilter(@StringRes private val labelRes: Int) {
    ALL(R.string.ui_alerts_filter_all),
    URGENT(R.string.ui_alerts_filter_urgent),
    MONEY(R.string.ui_alerts_filter_money),
    PAPERS(R.string.ui_alerts_filter_papers),
    ;

    val label: String get() = Words.get(labelRes)
}

fun AlertsApi.Alert.isUrgent(): Boolean = priority == "CRITICAL" || priority == "HIGH"

private fun AlertsApi.Alert.isMoney(): Boolean =
    type.startsWith("PAYMENT") || type.startsWith("FASTAG") || type.startsWith("WALLET") || type.startsWith("LOAN") ||
        type == "ORDER_QUOTED" || type == "LISTING_OFFER_RECEIVED" || type == "LISTING_SOLD"

private fun AlertsApi.Alert.isPapers(): Boolean =
    type.startsWith("DOCUMENT") || type == "VERIFICATION_RESULT"

fun AlertsApi.Alert.matches(filter: AlertFilter): Boolean = when (filter) {
    AlertFilter.ALL -> true
    AlertFilter.URGENT -> isUrgent()
    AlertFilter.MONEY -> isMoney()
    AlertFilter.PAPERS -> isPapers()
}

/** An alert's icon and the colours of the well it sits in. */
data class AlertLook(val icon: String, val well: Color, val ink: Color)

@Composable
@ReadOnlyComposable
fun AlertsApi.Alert.look(): AlertLook {
    val c = Saarthi.colors
    return when {
        type.startsWith("SOS") || type.startsWith("ASSOCIATION_ALERT") -> AlertLook(Lucide.siren, c.dangerSoft, c.danger)
        type == "SECURITY_ALERT" -> AlertLook(Lucide.shield, c.dangerSoft, c.danger)
        isPapers() -> AlertLook(Lucide.fileText, c.infoSoft, c.info)
        type.startsWith("FASTAG") -> AlertLook(Lucide.creditCard, c.accentSoft, c.accent)
        isMoney() -> AlertLook(Lucide.receipt, c.successSoft, c.success)
        type.startsWith("MAINTENANCE") || type == "DIAGNOSTIC_FAULT" -> AlertLook(Lucide.wrench, c.warningSoft, c.warning)
        type == "ROUTE_DEVIATION" || type.startsWith("TRIP") -> AlertLook(Lucide.route, c.warningSoft, c.warning)
        type.startsWith("RETURN_LOAD") || type == "EMPTY_RETURN_RISK" -> AlertLook(Lucide.refresh, c.successSoft, c.success)
        type.startsWith("REQUIREMENT") || type.startsWith("ORDER") -> AlertLook(Lucide.box, c.primarySoft, c.primary)
        type.startsWith("STOCK") || type.startsWith("LISTING") -> AlertLook(Lucide.box, c.accentSoft, c.accent)
        type.startsWith("BOOKING") -> AlertLook(Lucide.calendar, c.primarySoft, c.primary)
        type.startsWith("DEVICE") || type == "TELEMETRY_ALERT" -> AlertLook(Lucide.cpu, c.warningSoft, c.warning)
        else -> AlertLook(Lucide.bell, c.primarySoft, c.primary)
    }
}
