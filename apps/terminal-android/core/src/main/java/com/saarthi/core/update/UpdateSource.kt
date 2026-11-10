package com.saarthi.core.update

import com.saarthi.core.network.UpdateOfferDto
import java.io.File
import java.security.MessageDigest
import okhttp3.ResponseBody

/**
 * Where an app asks about, and fetches, a newer build of itself.
 *
 * Two answers to the same question. A fitted terminal asks through the device
 * gateway as the device it is; a phone app asks the public release routes,
 * because the person holding it may have no device credential at all.
 * [UpdateManager] does the rest identically for both — including the checksum.
 */
interface UpdateSource {

    /** The newer build on offer for this app, or null when it is current. */
    suspend fun checkForUpdate(): UpdateOfferDto?

    /**
     * Fetch one build to [target], hashing as it streams.
     *
     * Returns the SHA-256 of the bytes actually written, for the caller to
     * compare with the offer's.
     */
    suspend fun downloadUpdate(
        versionCode: Int,
        target: File,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): String
}

/**
 * Stream a response body to [target], hashing the same bytes as they are written.
 *
 * One pass, so there is no window in which the file on disk and the digest
 * could disagree, and nothing the size of an APK is ever held in memory.
 */
internal fun ResponseBody.writeHashed(
    target: File,
    onProgress: (downloaded: Long, total: Long) -> Unit,
): String {
    val total = contentLength().takeIf { it > 0 } ?: 0L
    val digest = MessageDigest.getInstance("SHA-256")
    var downloaded = 0L
    byteStream().use { input ->
        target.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                output.write(buffer, 0, read)
                digest.update(buffer, 0, read)
                downloaded += read
                onProgress(downloaded, total)
            }
        }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
}
