package com.saarthi.owner.ui.payments

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.ui.common.dayOf
import com.saarthi.owner.ui.common.rupees
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import kotlinx.coroutines.launch

/**
 * The receipts for what this person paid: one row each, "Download" saving
 * the PDF, then "Open" and "Share" for the saved file. [labelFor] names each
 * payment ("30% advance"), [forWhat] the thing paid for.
 */
@Composable
fun ReceiptsCard(
    receipts: List<PaymentsApi.Receipt>,
    forWhat: String,
    modifier: Modifier = Modifier,
    labelFor: (PaymentsApi.Receipt) -> String = { "Payment" },
) {
    if (receipts.isEmpty()) return
    val c = Saarthi.colors
    Column(modifier.fillMaxWidth().card(radius = 22.dp).padding(vertical = 6.dp)) {
        Eyebrow("Receipts", Modifier.padding(start = 18.dp, top = 12.dp, bottom = 4.dp))
        receipts.forEachIndexed { index, receipt ->
            ReceiptRow(receipt, labelFor(receipt), forWhat, divider = index < receipts.lastIndex)
        }
    }
}

@Composable
private fun ReceiptRow(receipt: PaymentsApi.Receipt, label: String, forWhat: String, divider: Boolean) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<SavedReceipt?>(null) }
    var failed by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .bottomRule(c.border, show = divider)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.receipt, well = c.successSoft, ink = c.success, size = 38.dp, radius = 12.dp, iconSize = 17.dp)
        Column(Modifier.weight(1f)) {
            Text(label, style = SType.bodyStrong, color = c.fg)
            Text(
                when {
                    failed -> "Could not save it. Try again."
                    saved?.inDownloads == true -> "Saved to Downloads › Saarthi"
                    else -> listOfNotNull(rupees(receipt.amount), dayOf(receipt.paidAt)).joinToString(" · ")
                },
                style = SType.caption,
                color = if (failed) c.danger else c.muted,
            )
        }
        val done = saved
        when {
            saving -> RingSpinner(track = c.track, head = c.primary, size = 18.dp, stroke = 2.dp)
            done != null -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                LinkButton("Open", onClick = { context.openReceipt(done) }, style = SType.smallStrong)
                LinkButton("Share", onClick = { context.shareReceipt(done) }, style = SType.smallStrong)
            }
            else -> LinkButton(
                "Download",
                onClick = {
                    saving = true
                    failed = false
                    scope.launch {
                        val result = runCatching { saveReceipt(context, receipt, label, forWhat) }
                        saved = result.getOrNull()
                        failed = result.isFailure
                        saving = false
                    }
                },
                style = SType.smallStrong,
            )
        }
    }
}
