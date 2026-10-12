package com.saarthi.core.data

import android.content.Context
import com.saarthi.core.network.SaarthiApi
import com.saarthi.core.util.DebugLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The driver's papers, held on the phone.
 *
 * This is the part that matters, and it is the reason the feature is worth
 * building rather than linking to the web app: **a document that needs a signal
 * to show is a document that fails exactly where it is demanded.** A state
 * border at two in the morning, a mine gate, a bypass check post — the places an
 * officer asks for an insurance certificate are disproportionately the places
 * with no bars on the phone.
 *
 * So every paper the driver has looked at once is written to the app's private
 * storage and opened from there afterwards. The network is used to *refresh*,
 * never to display.
 *
 * Private storage, not the gallery or Downloads. These are somebody's licence,
 * address and vehicle registration; they belong to the app that was granted
 * them and must not become files every other app on the phone can read. They go
 * when the app does.
 */
class PaperCache(context: Context, private val api: SaarthiApi) {

    private val root = File(context.filesDir, "papers").apply { mkdirs() }

    /** Vehicle photographs, apart from the papers so [retainOnly] never weighs them as documents. */
    private val photos = File(context.filesDir, "paper-photos").apply { mkdirs() }

    /** The last wallet the server sent — the folders a checkpoint with no signal still needs. */
    private val snapshot = File(root, SNAPSHOT_NAME)

    private val _cached = MutableStateFlow(scanCached())

    /**
     * Which documents are on this phone right now.
     *
     * Observable rather than a function the UI calls, and that is not a
     * refinement — a plain `isCached()` read during composition never sees the
     * download that finishes a second later, so every row stayed showing the
     * "not on this phone" icon until the screen was left and reopened. The one
     * fact this screen exists to convey was the one it got wrong.
     */
    val cached: StateFlow<Set<String>> = _cached.asStateFlow()

    private fun scanCached(): Set<String> =
        root.listFiles()
            ?.filter { it.length() > 0 && !it.name.endsWith(".part") && !it.name.startsWith(PRIVATE_PREFIX) }
            ?.map { it.name.substringBefore('.') }
            ?.toSet()
            ?: emptySet()

    /** Where a document would be, whether or not it has been fetched. */
    fun fileFor(documentId: String, mimeType: String?): File =
        File(root, "$documentId${extensionFor(mimeType)}")

    fun isCached(documentId: String, mimeType: String?): Boolean =
        fileFor(documentId, mimeType).let { it.exists() && it.length() > 0 }

    /**
     * Fetch a document if it is not already here.
     *
     * Written to a temporary name and moved into place only once the whole body
     * has arrived: a connection that dies halfway through must not leave a
     * truncated PDF that looks cached and opens to nothing — which is a worse
     * failure than not having it, because the driver would find out at the
     * barrier.
     */
    suspend fun ensure(documentId: String, mimeType: String?): Result<File> =
        withContext(Dispatchers.IO) {
            val target = fileFor(documentId, mimeType)
            if (target.exists() && target.length() > 0) return@withContext Result.success(target)

            val partial = File(root, "${target.name}.part")
            runCatching {
                api.downloadTo(api.paperPath(documentId), partial)
                if (partial.length() == 0L) error("Saarthi received an empty document.")
                if (target.exists()) target.delete()
                if (!partial.renameTo(target)) error("Could not store the document.")
                DebugLog.debug(TAG, "Cached a paper (${target.length()} bytes)")
                _cached.value = scanCached()
                target
            }.onFailure {
                partial.delete()
                DebugLog.warn(TAG, "Could not cache a paper: ${it.javaClass.simpleName}: ${it.message}")
            }
        }

    /**
     * Forget papers the fleet no longer lists.
     *
     * A document withdrawn or replaced by the office must stop being producible
     * from this phone. Anything whose id is absent from the current list goes,
     * which also keeps a long-lived install from accumulating superseded scans.
     */
    fun retainOnly(documentIds: Set<String>) {
        val keep = documentIds.toSet()
        root.listFiles()?.forEach { file ->
            if (file.name.startsWith(PRIVATE_PREFIX)) return@forEach
            val id = file.name.substringBefore('.')
            if (id !in keep) {
                DebugLog.debug(TAG, "Dropping a paper the fleet no longer lists")
                file.delete()
            }
        }
        _cached.value = scanCached()
    }

    /** Everything, on sign-off. The next driver's phone is not this driver's. */
    fun clear() {
        root.listFiles()?.forEach { it.delete() }
        photos.listFiles()?.forEach { it.delete() }
        _cached.value = emptySet()
    }

    /** Keep the wallet as last listed, written whole or not at all. */
    suspend fun saveSnapshot(json: String): Unit = withContext(Dispatchers.IO) {
        val partial = File(root, "$SNAPSHOT_NAME.part")
        runCatching {
            partial.writeText(json)
            if (!partial.renameTo(snapshot)) {
                snapshot.delete()
                partial.renameTo(snapshot)
            }
        }.onFailure { DebugLog.warn(TAG, "Could not keep the papers list: ${it.message}") }
        Unit
    }

    suspend fun readSnapshot(): String? = withContext(Dispatchers.IO) {
        runCatching { snapshot.takeIf { it.exists() }?.readText() }.getOrNull()
    }

    /**
     * A vehicle photograph on this phone, fetched once.
     *
     * Through [SaarthiApi.downloadTo] like a paper, so the same device credential
     * and the same all-or-nothing write apply.
     */
    suspend fun photo(path: String, name: String): File? = withContext(Dispatchers.IO) {
        val target = File(photos, name)
        if (target.exists() && target.length() > 0) return@withContext target
        val partial = File(photos, "$name.part")
        runCatching {
            api.downloadTo(path, partial)
            if (partial.length() == 0L || !partial.renameTo(target)) error("Could not store the photo.")
            target
        }.onFailure {
            partial.delete()
            DebugLog.warn(TAG, "Could not fetch a vehicle photo: ${it.message}")
        }.getOrNull()
    }

    /** Photos no longer on the vehicle go, as superseded papers do. */
    fun retainPhotos(names: Set<String>) {
        photos.listFiles()?.forEach { if (it.name !in names) it.delete() }
    }

    private fun extensionFor(mimeType: String?): String = when {
        mimeType == null -> ""
        mimeType.contains("pdf") -> ".pdf"
        mimeType.contains("png") -> ".png"
        mimeType.contains("jpeg") || mimeType.contains("jpg") -> ".jpg"
        mimeType.contains("webp") -> ".webp"
        else -> ""
    }

    private companion object {
        const val TAG = "papers"

        /** Files in the papers folder that are not papers, and never counted as one. */
        const val PRIVATE_PREFIX = "_"
        const val SNAPSHOT_NAME = "_wallet.json"
    }
}
