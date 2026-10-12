package com.saarthi.driver.ui.shift.expense

import androidx.annotation.StringRes
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.Lucide

/**
 * What a slip was for.
 *
 * Fuel is its own record on the server — its litres drive fuel economy — and
 * every other kind is an expense filed against the trip under way. [server] is
 * the expense category the API expects; null for fuel, which has its own route.
 */
internal enum class ExpenseKind(val server: String?, @StringRes val label: Int, val icon: String) {
    FUEL(null, R.string.expense_cat_fuel, Lucide.fuel),
    TOLL("TOLL", R.string.expense_cat_toll, Lucide.route),
    PARKING("PARKING", R.string.expense_cat_parking, Lucide.parking),
    REPAIR("REPAIR", R.string.expense_cat_repair, Lucide.wrench),
    FOOD("FOOD", R.string.expense_cat_food, Lucide.food),
    LOADING("LOADING", R.string.expense_cat_loading, Lucide.box),
    CHALLAN("CHALLAN", R.string.expense_cat_challan, Lucide.fileText),
    OTHER("OTHER", R.string.expense_cat_other, Lucide.receipt),
}

/** What the driver has put on this slip so far. Kept across a retake and a failed save. */
@Stable
internal class ExpenseSlipDraft {
    /** The JPEG as taken; not drawn, so not state. */
    var jpeg: ByteArray? = null
    var photo by mutableStateOf<ImageBitmap?>(null)
    var kind by mutableStateOf(ExpenseKind.FUEL)
    var amount by mutableStateOf("")

    // Fuel only.
    var litres by mutableStateOf("")
    var pump by mutableStateOf("")
    var odometer by mutableStateOf("")

    // Every other kind.
    var vendor by mutableStateOf("")
    var notes by mutableStateOf("")

    val amountValue: Double? get() = amount.positiveFigure()
    val litresValue: Double? get() = litres.positiveFigure()
    val odometerValue: Double? get() = odometer.normalised().toDoubleOrNull()?.takeIf { it >= 0.0 }

    /** Everything the server insists on: the photo, the amount, and litres for fuel. */
    val complete: Boolean
        get() = jpeg != null && amountValue != null && (kind != ExpenseKind.FUEL || litresValue != null)

    fun clear() {
        jpeg = null
        photo = null
        amount = ""
        litres = ""
        pump = ""
        odometer = ""
        vendor = ""
        notes = ""
    }
}

/** A comma is a decimal point on half the keyboards in the country. */
private fun String.normalised(): String = trim().replace(',', '.')

private fun String.positiveFigure(): Double? = normalised().toDoubleOrNull()?.takeIf { it > 0.0 }
