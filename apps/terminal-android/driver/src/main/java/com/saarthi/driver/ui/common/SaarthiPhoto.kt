package com.saarthi.driver.ui.common

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import com.saarthi.driver.SaarthiDriverApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A photo Saarthi serves, such as the driver's profile photo or banner, sized
 * for where it is shown. Null until it has loaded, and null for good when there
 * is none or it cannot be had, so the caller keeps its initials or gradient.
 *
 * Decoded at roughly [edge], not at full size. A photo uploaded from the web
 * can be several thousand pixels across, and decoding that whole for a 44 dp
 * circle is how a header runs a phone out of memory.
 */
@Composable
fun rememberSaarthiPhoto(url: String?, edge: Dp): ImageBitmap? {
    val context = LocalContext.current
    val edgePx = with(LocalDensity.current) { edge.roundToPx() }.coerceAtLeast(1)
    val source = url?.takeIf { it.isNotBlank() }
    val key = source?.let { "$it@$edgePx" }

    val photo by produceState(PhotoCache.get(key), key) {
        // Reset on every new key, so a removed or replaced photo does not linger.
        value = PhotoCache.get(key)
        if (source == null || key == null || value != null) return@produceState
        val api = (context.applicationContext as SaarthiDriverApp).driverApi
        value = withContext(Dispatchers.IO) {
            api.image(source)?.let { decodeSampled(it, edgePx) }?.asImageBitmap()
        }?.also { PhotoCache.put(key, it) }
    }
    return photo
}

/** Photos already decoded this session, so moving between screens does not refetch them. */
private object PhotoCache {
    private val cache = object : LruCache<String, ImageBitmap>(MAX_BYTES) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
    }

    fun get(key: String?): ImageBitmap? = key?.let(cache::get)

    fun put(key: String, photo: ImageBitmap) {
        cache.put(key, photo)
    }

    /** About eight full-screen-width banners; a handful of avatars is negligible beside that. */
    private const val MAX_BYTES = 8 * 1024 * 1024
}

/**
 * Decode at the largest power-of-two reduction that still covers [edgePx].
 *
 * Null for anything that is not a picture Android can read, and for a decode
 * that would not fit in memory, because a missing photo must never be a crash.
 */
private fun decodeSampled(bytes: ByteArray, edgePx: Int): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return@runCatching null
    var sample = 1
    while (longest / (sample * 2) >= edgePx) sample *= 2
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}.getOrNull()
