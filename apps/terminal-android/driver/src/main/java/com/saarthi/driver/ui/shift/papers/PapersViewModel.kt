package com.saarthi.driver.ui.shift.papers

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.data.ShiftRepository
import com.saarthi.core.network.PapersWalletDto
import com.saarthi.core.network.VehiclePhotoDto
import com.saarthi.core.network.vehiclePhotoPath
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * The papers wallet: folders, files, the RTO's virtual RC, the licence and the
 * vehicle's photographs — and every file kept on the phone on the way past.
 *
 * The fetch of the *list* needs a signal; showing a paper afterwards must not.
 * So the wallet is refreshed opportunistically, kept on the phone whole, and
 * every document in it pulled down in the background — which is what makes it
 * work at a border post where nothing else does. Papers the fleet has withdrawn
 * are dropped in the same pass, because a superseded certificate that can still
 * be produced from a phone is worse than none.
 */
class PapersViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SaarthiDriverApp
    private val shift = ShiftRepository(application, app.repository)
    private val cache = app.papers

    data class Ui(
        val wallet: PapersWalletDto? = null,
        val loading: Boolean = false,
        /** Why the wallet or one of its files could not be fetched or kept. */
        val problem: String? = null,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            val kept = cache.readSnapshot()?.let { json ->
                runCatching { Wallets.decodeFromString(PapersWalletDto.serializer(), json) }.getOrNull()
            }
            if (kept != null && _ui.value.wallet == null) _ui.update { it.copy(wallet = kept) }
        }
    }

    fun refresh() {
        if (_ui.value.loading) return
        _ui.update { it.copy(loading = true, problem = null) }
        viewModelScope.launch {
            shift.papersWallet()
                .onSuccess { wallet ->
                    _ui.update { it.copy(wallet = wallet, loading = false) }
                    cache.saveSnapshot(Wallets.encodeToString(PapersWalletDto.serializer(), wallet))
                    keepOnPhone(wallet)
                }
                .onFailure { problem ->
                    DebugLog.warn("papers", "Could not list papers: ${problem.message}")
                    _ui.update {
                        it.copy(
                            loading = false,
                            problem = problem.message ?: "Saarthi could not reach your fleet for the paper list.",
                        )
                    }
                }
        }
    }

    private suspend fun keepOnPhone(wallet: PapersWalletDto) {
        cache.retainOnly(wallet.documents.map { it.id }.toSet())
        cache.retainPhotos(wallet.photos.flatMap { listOf(photoName(it, true), photoName(it, false)) }.toSet())

        var failures = 0
        var lastProblem: String? = null
        for (paper in wallet.documents) {
            cache.ensure(paper.id, paper.mimeType).onFailure { problem ->
                failures += 1
                lastProblem = problem.message
            }
        }
        if (failures > 0) {
            _ui.update {
                it.copy(
                    problem = "$failures of ${wallet.documents.size} could not be saved to this phone. " +
                        (lastProblem ?: "Saarthi could not say why."),
                )
            }
        }
    }

    /** A vehicle photograph as a bitmap, fetched once and kept on the phone. */
    suspend fun photo(photo: VehiclePhotoDto, thumbnail: Boolean): Bitmap? {
        val file = cache.photo(vehiclePhotoPath(photo.id, thumbnail), photoName(photo, thumbnail)) ?: return null
        return withContext(Dispatchers.IO) { BitmapFactory.decodeFile(file.absolutePath) }
    }

    /** The vehicle's QR sticker, from the PNG the server rendered for it. */
    suspend fun qrBitmap(dataUri: String): Bitmap? = withContext(Dispatchers.Default) {
        runCatching {
            val bytes = Base64.decode(dataUri.substringAfter("base64,"), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }

    private fun photoName(photo: VehiclePhotoDto, thumbnail: Boolean): String =
        "${photo.id}${if (thumbnail && photo.hasThumbnail) "-thumb" else ""}"

    private companion object {
        val Wallets = Json { ignoreUnknownKeys = true }
    }
}
