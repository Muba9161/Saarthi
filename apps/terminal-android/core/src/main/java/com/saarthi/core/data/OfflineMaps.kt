package com.saarthi.core.data

import android.content.Context
import com.saarthi.core.CoreConfig
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition
import kotlin.math.cos

/**
 * The map, kept for where there is no signal.
 *
 * Saarthi already survives a dead zone for everything else: telemetry queues in
 * the outbox and sends later, papers are cached on the phone, the trip stays
 * open. The map was the exception — the one part of the app that went blank in
 * exactly the places a driver most needs to know where they are, which made the
 * offline-first stance the rest of the codebase takes look like an accident
 * rather than a decision.
 *
 * Two deliberate limits, both about respecting a driver's phone and their data:
 *
 *  * **Zoom 6 to 13.** Enough to see a district, a national highway, a town and
 *    its main roads — which is what "where am I and which way is the trunk
 *    road" needs. Street-level zoom over a whole district would be hundreds of
 *    megabytes for detail a driver on a highway never looks at.
 *  * **Nothing downloads without being asked.** A driver on a metered
 *    connection decides, having been shown roughly what it will cost them.
 */
class OfflineMaps(context: Context) {

    /**
     * What the download is doing.
     *
     * A sealed set rather than a bag of booleans: "downloading and also failed"
     * is not a state, and every screen that reads this has to render exactly one
     * of these.
     */
    sealed interface Status {
        data object Idle : Status
        data class Working(
            val completedResources: Long,
            val expectedResources: Long,
            /**
             * Whether [expectedResources] is a count or an estimate.
             *
             * MapLibre says so itself, and passing it on is the difference
             * between a progress bar and a lie: early in a download the total is
             * a guess, and a bar that jumps backwards when the guess is revised
             * is worse than one that admits it does not know yet.
             */
            val expectedIsPrecise: Boolean,
            val bytes: Long,
        ) : Status {
            /** Null until the total is both known and precise. */
            val fraction: Float?
                get() = if (expectedIsPrecise && expectedResources > 0) {
                    (completedResources.toFloat() / expectedResources).coerceIn(0f, 1f)
                } else {
                    null
                }
        }

        data class Ready(val bytes: Long, val resources: Long) : Status
        data class Failed(val reason: String) : Status
    }

    private val manager = OfflineManager.getInstance(context.applicationContext)
    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    /** Held so a download can be paused when the driver deletes or replaces it. */
    private var current: OfflineRegion? = null

    /**
     * Save the area around a point.
     *
     * @param radiusKm half the width of the square kept. Sixty kilometres is
     *   about an hour and a half of highway, which is the scale of a gap between
     *   towers rather than a whole state.
     */
    fun saveAround(latitude: Double, longitude: Double, radiusKm: Double = 60.0) {
        /*
         * A square in degrees, corrected for latitude.
         *
         * A degree of longitude is only a full 111 km at the equator and narrows
         * with the cosine of the latitude — so without the correction a "sixty
         * kilometre" box over northern India would be almost seventy wide and
         * the tile count, which is what a driver pays for, would be a third
         * larger than the figure they were shown.
         */
        val latSpan = radiusKm / 111.0
        val lonSpan = radiusKm / (111.0 * cos(Math.toRadians(latitude)).coerceAtLeast(0.2))

        val bounds = LatLngBounds.Builder()
            .include(LatLng(latitude + latSpan, longitude + lonSpan))
            .include(LatLng(latitude - latSpan, longitude - lonSpan))
            .build()

        save(bounds)
    }

    /** Save the corridor a route runs through, framed to its extent. */
    fun saveAlong(route: List<Pair<Double, Double>>) {
        if (route.size < 2) {
            _status.value = Status.Failed("There is no route to save yet.")
            return
        }
        val builder = LatLngBounds.Builder()
        // Every tenth point is plenty for an extent, and a polyline can hold
        // several thousand.
        route.filterIndexed { index, _ -> index % 10 == 0 || index == route.lastIndex }
            .forEach { (lat, lon) -> builder.include(LatLng(lat, lon)) }
        save(builder.build())
    }

    private fun save(bounds: LatLngBounds) {
        val definition = OfflineTilePyramidRegionDefinition(
            CoreConfig.mapStyleUrl,
            bounds,
            MIN_ZOOM,
            MAX_ZOOM,
            // The phone's density, so tiles match the screen they are drawn on
            // rather than being fetched twice.
            android.content.res.Resources.getSystem().displayMetrics.density,
        )

        _status.value = Status.Working(0, 0, expectedIsPrecise = false, bytes = 0)

        manager.createOfflineRegion(
            definition,
            // Metadata is opaque to MapLibre. A fixed marker is enough: Saarthi
            // keeps one region, replacing it rather than accumulating them.
            REGION_NAME.toByteArray(Charsets.UTF_8),
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(region: OfflineRegion) {
                    current = region
                    region.setObserver(observer(region))
                    region.setDownloadState(OfflineRegion.STATE_ACTIVE)
                }

                override fun onError(error: String) {
                    DebugLog.warn(TAG, "Could not begin an offline region: $error")
                    _status.value = Status.Failed("Saarthi could not start the download.")
                }
            },
        )
    }

    private fun observer(region: OfflineRegion) = object : OfflineRegion.OfflineRegionObserver {
        override fun onStatusChanged(status: OfflineRegionStatus) {
            if (status.isComplete) {
                // Stopped explicitly. An active region keeps a network callback
                // alive for the life of the process otherwise.
                region.setDownloadState(OfflineRegion.STATE_INACTIVE)
                _status.value = Status.Ready(
                    bytes = status.completedResourceSize,
                    resources = status.completedResourceCount,
                )
                return
            }

            _status.value = Status.Working(
                completedResources = status.completedResourceCount,
                expectedResources = status.requiredResourceCount,
                expectedIsPrecise = status.isRequiredResourceCountPrecise,
                bytes = status.completedResourceSize,
            )
        }

        override fun onError(error: OfflineRegionError) {
            DebugLog.warn(TAG, "Offline region error: ${error.reason} ${error.message}")
            _status.value = Status.Failed(
                // The driver's own words for it, not MapLibre's.
                "The download stopped. Try again where the signal is better.",
            )
        }

        override fun mapboxTileCountLimitExceeded(limit: Long) {
            /*
             * The tile ceiling, hit rather than predicted.
             *
             * MapLibre will not say in advance how many tiles a box needs, so
             * the honest response is to say what happened and suggest the one
             * thing that helps — a smaller area — rather than silently keeping a
             * partial region that would look complete.
             */
            DebugLog.warn(TAG, "Offline tile limit exceeded at $limit")
            _status.value = Status.Failed(
                "That area is too large to keep. Try again with a smaller one.",
            )
        }
    }

    /** What is already kept, if anything. */
    fun refresh() {
        manager.listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
            override fun onList(regions: Array<OfflineRegion>?) {
                val region = regions?.firstOrNull()
                if (region == null) {
                    _status.value = Status.Idle
                    return
                }
                current = region
                region.getStatus(object : OfflineRegion.OfflineRegionStatusCallback {
                    // Nullable: this callback's parameters are declared nullable
                    // in MapLibre 11, unlike the observer's next door.
                    override fun onStatus(status: OfflineRegionStatus?) {
                        if (status == null) {
                            _status.value = Status.Idle
                            return
                        }
                        _status.value = if (status.isComplete) {
                            Status.Ready(
                                status.completedResourceSize,
                                status.completedResourceCount,
                            )
                        } else {
                            Status.Working(
                                completedResources = status.completedResourceCount,
                                expectedResources = status.requiredResourceCount,
                                expectedIsPrecise = status.isRequiredResourceCountPrecise,
                                bytes = status.completedResourceSize,
                            )
                        }
                    }

                    override fun onError(error: String?) {
                        _status.value = Status.Idle
                    }
                })
            }

            override fun onError(error: String) {
                _status.value = Status.Idle
            }
        })
    }

    /** Give the storage back. */
    fun delete() {
        val region = current
        if (region == null) {
            _status.value = Status.Idle
            return
        }
        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
        region.delete(object : OfflineRegion.OfflineRegionDeleteCallback {
            override fun onDelete() {
                current = null
                _status.value = Status.Idle
            }

            override fun onError(error: String) {
                DebugLog.warn(TAG, "Could not delete an offline region: $error")
            }
        })
    }

    private companion object {
        const val TAG = "offline-maps"
        const val REGION_NAME = "saarthi.corridor"

        /**
         * District down to town and main roads.
         *
         * Chosen against what a driver actually reads on a highway. Zoom 13 is
         * where a town's arterial roads appear; going to 15 for house numbers
         * would multiply the tiles roughly sixteen-fold for detail nobody uses
         * at speed.
         */
        const val MIN_ZOOM = 6.0
        const val MAX_ZOOM = 13.0
    }
}
