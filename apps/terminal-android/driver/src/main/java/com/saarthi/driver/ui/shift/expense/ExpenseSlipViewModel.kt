package com.saarthi.driver.ui.shift.expense

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.SaarthiApp
import com.saarthi.core.data.ShiftRepository
import kotlinx.coroutines.launch

/** Files a slip: fuel as a fuel record, anything else as an expense on the trip under way. */
class ExpenseSlipViewModel(application: Application) : AndroidViewModel(application) {

    private val shift = ShiftRepository(application, (application as SaarthiApp).repository)

    /**
     * `onDone(null)` for success and the message otherwise, rather than a state
     * flow: the screen has to clear its fields on success and keep them on
     * failure, and a driver who mistyped a figure must not lose the photograph
     * they have already taken.
     */
    internal fun save(draft: ExpenseSlipDraft, onDone: (String?) -> Unit) {
        val jpeg = draft.jpeg ?: return
        val amount = draft.amountValue ?: return
        val kind = draft.kind
        val litres = draft.litresValue
        val odometer = draft.odometerValue
        val pump = draft.pump.trim().ifEmpty { null }
        val vendor = draft.vendor.trim().ifEmpty { null }
        val notes = draft.notes.trim().ifEmpty { null }

        viewModelScope.launch {
            val saved = if (kind == ExpenseKind.FUEL) {
                if (litres == null) return@launch
                shift.saveFuelSlip(jpeg, litres, amount, odometer, pump)
            } else {
                shift.saveExpenseSlip(jpeg, kind.server ?: return@launch, amount, vendor, notes)
            }
            saved
                .onSuccess { onDone(null) }
                .onFailure { problem -> onDone(problem.message ?: FALLBACK_REFUSAL) }
        }
    }

    private companion object {
        const val FALLBACK_REFUSAL = "Saarthi could not save that slip."
    }
}
