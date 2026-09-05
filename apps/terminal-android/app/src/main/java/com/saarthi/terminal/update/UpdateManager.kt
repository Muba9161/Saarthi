package com.saarthi.terminal.update

import android.content.Context
import com.saarthi.terminal.BuildConfig
import com.saarthi.terminal.network.SaarthiApi
import com.saarthi.terminal.network.UpdateOfferDto
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/**
 * Keeping a fitted terminal current.
 *
 * The whole point is that nobody has to visit the truck. Saarthi publishes a
 * build, the terminal notices, and the driver taps a button at a moment that
 * suits them — which is never mid-trip, and is why this is a button rather than
 * something automatic.
 *
 * Four things it is careful about, each of which is a way a naive version
 * strands a vehicle:
 *
 *  * **It verifies before it installs.** The server publishes a SHA-256 and the
 *    download is hashed as it arrives. A tunnel that dies halfway through a
 *    level crossing produces a plausible-looking file, and handing that to the
 *    package installer is how an app half-replaces itself.
 *
 *  * **It never downloads twice.** A finished, verified APK stays in the cache
 *    until it is installed. A driver who taps Update, gets the confirmation
 *    dialog and dismisses it by accident should not spend another eighty
 *    megabytes of a fleet SIM to try again.
 *
 *  * **It gives up the space afterwards.** Old APKs are deleted whenever a check
 *    runs. These tablets are 16 GB and full of map tiles.
 *
 *  * **It stays quiet when there is nothing to say.** No offer means no card,
 *    no banner and no state change — which is the answer nearly every time.
 */
class UpdateManager(
    private val context: Context,
    private val scope: CoroutineScope,
) {

    /** Where the terminal is in the business of updating itself. */
    sealed interface State {
        /** Nothing newer, or not yet asked. The ordinary state. */
        data object Idle : State

        /** A build is available and the driver has not acted on it. */
        data class Available(val offer: UpdateOfferDto) : State

        /** Fetching. `fraction` is null until the server's length is known. */
        data class Downloading(val offer: UpdateOfferDto, val fraction: Float?) : State

        /** Downloaded and verified, waiting to be handed to Android. */
        data class Ready(val offer: UpdateOfferDto) : State

        /** Android has the file and is asking the driver to confirm. */
        data class Installing(val offer: UpdateOfferDto) : State

        /** Something went wrong, in words a driver can act on. */
        data class Failed(val offer: UpdateOfferDto, val reason: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private var work: Job? = null

    /** The directory downloads live in, inside the app's own cache. */
    private val downloads: File
        get() = File(context.cacheDir, "updates").apply { mkdirs() }

    /**
     * Ask the server whether there is anything newer.
     *
     * Called on the heartbeat cadence. Deliberately silent about failure: a
     * terminal that cannot reach Saarthi has bigger problems already on screen,
     * and "could not check for updates" on top of "offline" is noise in a cab.
     */
    fun check(api: SaarthiApi) {
        // A download in flight must not be interrupted by a routine check, and
        // a driver looking at a Ready card must not have it swapped underneath
        // them by the same build being re-offered.
        if (_state.value !is State.Idle && _state.value !is State.Available) return

        scope.launch {
            val offer = try {
                api.checkForUpdate()
            } catch (error: Exception) {
                DebugLog.debug(TAG, "Update check failed: ${error.message}")
                return@launch
            }

            if (offer == null || offer.versionCode <= BuildConfig.VERSION_CODE) {
                _state.value = State.Idle
                sweep(keep = null)
                return@launch
            }

            // Anything cached for a different version is now dead weight.
            sweep(keep = fileFor(offer))

            /*
             * A previous download that finished is honoured.
             *
             * The driver may have declined Android's dialog, or the tablet may
             * have been switched off between downloading and installing. Either
             * way the bytes are already here and already verified, and asking a
             * truck on a fleet SIM to fetch them again is the wrong answer.
             */
            val cached = fileFor(offer)
            _state.value = if (cached.isFile && cached.length() == offer.sizeBytes) {
                State.Ready(offer)
            } else {
                State.Available(offer)
            }
        }
    }

    /**
     * Fetch the build.
     *
     * Only from `Available` or `Failed`: tapping the card twice must not start a
     * second download alongside the first.
     */
    fun download(api: SaarthiApi) {
        val offer = when (val current = _state.value) {
            is State.Available -> current.offer
            is State.Failed -> current.offer
            else -> return
        }

        if (work?.isActive == true) return

        work = scope.launch {
            _state.value = State.Downloading(offer, null)
            val target = fileFor(offer)
            val partial = File(target.path + ".part")

            try {
                val digest = api.downloadUpdate(offer.versionCode, partial) { done, total ->
                    // The server sends a content-length, but a proxy may strip
                    // it. A determinate bar that is a lie is worse than a
                    // spinner, so the fraction stays null when the total is not
                    // known and the card shows megabytes instead.
                    val fraction = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else null
                    _state.value = State.Downloading(offer, fraction)
                }

                /*
                 * The check that makes this safe.
                 *
                 * Everything up to here is ordinary networking, and ordinary
                 * networking on a truck produces truncated files. An APK that is
                 * 90% of an APK will still open as a ZIP; the package installer
                 * is the wrong place to discover otherwise.
                 */
                if (!digest.equals(offer.sha256, ignoreCase = true)) {
                    partial.delete()
                    DebugLog.warn(TAG, "Update ${offer.versionName} failed its checksum")
                    _state.value = State.Failed(
                        offer,
                        "The download was incomplete. Tap to try again.",
                    )
                    return@launch
                }

                // Renamed only once verified, so a file under the final name is
                // always a file that can be trusted.
                partial.renameTo(target)
                _state.value = State.Ready(offer)
            } catch (error: Exception) {
                partial.delete()
                DebugLog.warn(TAG, "Update download failed: ${error.message}")
                _state.value = State.Failed(
                    offer,
                    "The update could not be downloaded. Check the connection and try again.",
                )
            }
        }
    }

    /** Hand the verified file to Android, which asks the driver to confirm. */
    fun install() {
        val offer = (_state.value as? State.Ready)?.offer ?: return

        scope.launch {
            _state.value = State.Installing(offer)
            when (val outcome = UpdateInstaller(context).install(fileFor(offer))) {
                is UpdateInstaller.Outcome.AwaitingUser -> Unit
                is UpdateInstaller.Outcome.Failed ->
                    _state.value = State.Failed(offer, outcome.reason)
            }
        }
    }

    /**
     * Report a failure the installer discovered after the app lost control.
     *
     * The broadcast arrives long after `install` returned — the system was
     * showing its dialog in between — so the state has to be reachable from
     * outside rather than returned.
     */
    fun installFailed(reason: String) {
        val offer = when (val current = _state.value) {
            is State.Installing -> current.offer
            is State.Ready -> current.offer
            else -> return
        }
        _state.value = State.Failed(offer, reason)
    }

    /**
     * Put the card away.
     *
     * A mandatory release cannot be dismissed — that is what mandatory means,
     * and the decision is enforced here rather than only in the UI so that no
     * future screen can quietly opt out of it.
     */
    fun dismiss() {
        val current = _state.value
        val offer = when (current) {
            is State.Available -> current.offer
            is State.Ready -> current.offer
            is State.Failed -> current.offer
            else -> return
        }
        if (offer.mandatory) return
        _state.value = State.Idle
    }

    /** The cache file a given build downloads to. Named by version, not by date. */
    private fun fileFor(offer: UpdateOfferDto): File =
        File(downloads, "saarthi-terminal-${offer.versionCode}.apk")

    /** Delete every cached download except the one still wanted. */
    private fun sweep(keep: File?) {
        downloads.listFiles()?.forEach { file ->
            if (keep == null || file.path != keep.path) file.delete()
        }
    }

    private companion object {
        const val TAG = "UpdateManager"
    }
}
