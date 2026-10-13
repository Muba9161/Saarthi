package com.saarthi.driver.ui.shift.papers

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.network.OwnerRcApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * An owner's way past the masked RC: ask, enter the Secure PIN, see it whole,
 * and have it hide itself again.
 *
 * The record is held here and nowhere else — not in the papers snapshot the
 * Papers tab keeps on the phone, which is written to disk for use offline.
 */
class OwnerRcViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SaarthiDriverApp
    private val rc = OwnerRcApi(app.driverApi)

    enum class Stage { IDLE, CHECKING, NEEDS_PIN, SHOWING, NEEDS_OWNERSHIP, NO_PIN }

    data class Ui(
        val stage: Stage = Stage.IDLE,
        val record: OwnerRcApi.RcRecord? = null,
        val busy: Boolean = false,
        val problem: String? = null,
        /** Changes on every wrong PIN, which shakes the dots. */
        val shake: Int = 0,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    /** Whether to offer it at all: only to a person who could ever be shown it. */
    val offered: StateFlow<Boolean> = app.driverApi.seesFullRc

    private var plate: String? = null
    private var hiding: Job? = null

    fun open(registrationNumber: String) {
        plate = registrationNumber
        _ui.value = Ui(stage = Stage.CHECKING)
        viewModelScope.launch { check() }
    }

    fun enterPin(pin: String) {
        if (_ui.value.busy) return
        _ui.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            runCatching { rc.unlock(pin) }
                .onSuccess { check() }
                .onFailure { failure ->
                    val refused = failure as? DriverApi.Failure.Refused
                    when {
                        // No PIN on the account yet: set on the web, which asks for the password.
                        refused?.code == NO_PIN_CODE -> _ui.value = Ui(stage = Stage.NO_PIN)
                        else -> _ui.update {
                            it.copy(busy = false, problem = describe(failure), shake = it.shake + 1)
                        }
                    }
                }
        }
    }

    fun hide() {
        hiding?.cancel()
        _ui.value = Ui()
    }

    private suspend fun check() {
        val registration = plate ?: return
        runCatching { rc.latest(registration) }
            .onSuccess { lookup ->
                _ui.value = when (lookup?.access) {
                    OwnerRcApi.FULL -> Ui(stage = Stage.SHOWING, record = lookup.vehicle).also { hideLater() }
                    OwnerRcApi.LOCKED -> Ui(stage = Stage.NEEDS_PIN)
                    OwnerRcApi.OWNERSHIP_REQUIRED -> Ui(stage = Stage.NEEDS_OWNERSHIP)
                    else -> Ui(problem = text(R.string.owner_rc_unavailable))
                }
            }
            .onFailure { failure -> _ui.value = Ui(problem = describe(failure)) }
    }

    /** The server's unlock lasts five minutes; the record on screen goes with it. */
    private fun hideLater() {
        hiding?.cancel()
        hiding = viewModelScope.launch {
            delay(UNLOCK_MS)
            hide()
        }
    }

    private fun describe(failure: Throwable): String = when (failure) {
        is DriverApi.Failure.Offline -> text(R.string.owner_rc_offline)
        // The server's own words: "2 tries left", "locked for 15 minutes".
        is DriverApi.Failure.Refused -> failure.message
        else -> text(R.string.owner_rc_unavailable)
    }

    private fun text(id: Int): String = getApplication<Application>().getString(id)

    private companion object {
        /** `unlockWithPin` before a PIN was ever set. */
        const val NO_PIN_CODE = "BUSINESS_RULE_VIOLATION"

        /** `SECURE_UNLOCK_SECONDS` on the server. */
        const val UNLOCK_MS = 5 * 60_000L
    }
}
