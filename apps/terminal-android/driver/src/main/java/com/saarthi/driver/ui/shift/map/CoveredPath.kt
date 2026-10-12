package com.saarthi.driver.ui.shift.map

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.saarthi.core.SaarthiApp
import com.saarthi.core.data.CoveredPathFeed
import com.saarthi.core.data.ShiftRepository
import com.saarthi.core.domain.TrailPoint
import com.saarthi.core.network.TerminalTripDto
import com.saarthi.core.ui.TerminalViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/**
 * The covered path for the map, kept for the whole shift.
 *
 * Activity-scoped, so the Map tab and the full-screen map draw one trail and
 * switching between them never re-downloads it.
 */
class CoveredPathViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SaarthiApp
    private val shift = ShiftRepository(application, app.repository)
    private var feed: CoveredPathFeed? = null

    /** The trail, starting the feed on first use; later calls reuse it. */
    fun trail(dispatch: StateFlow<TerminalTripDto?>): StateFlow<List<TrailPoint>> {
        val existing = feed
        if (existing != null) return existing.trail
        return CoveredPathFeed(
            scope = viewModelScope,
            positions = app.telemetry.snapshot.map { it.position },
            dispatch = dispatch,
            fetch = shift::trail,
        ).also {
            feed = it
            it.start()
        }.trail
    }
}

/** The path this vehicle has covered, coloured by trip state. */
@Composable
fun rememberCoveredPath(cockpit: TerminalViewModel): List<TrailPoint> {
    val model: CoveredPathViewModel = viewModel()
    val trail by model.trail(cockpit.dispatch).collectAsState()
    return trail
}
