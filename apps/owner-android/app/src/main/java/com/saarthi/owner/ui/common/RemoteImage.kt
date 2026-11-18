package com.saarthi.owner.ui.common

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.network.OwnerApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Pictures the API serves (a profile photo, a cover, a driver's face, an
 * arrival photo), fetched with the session, decoded at the size they are
 * drawn, and kept for the next row that asks.
 *
 * One path for all of them. [OwnerApi.image] carries the token and signs in
 * again once on a 401. The decode reads the picture's bounds first and samples
 * it down to the box it fills, so a twelve-megapixel upload from the web costs
 * a thumbnail's memory in a 48 dp circle. Decoded pictures are kept in an LRU
 * keyed by URL, so a list scrolling back over its rows does not fetch them
 * again. A picture that cannot be fetched or decoded is simply absent, and the
 * caller draws its fallback.
 */
object RemoteImages {

    /** A decoded picture, and whether it is as sharp as it will ever be decoded. */
    private class Held(val image: ImageBitmap, val full: Boolean) {
        /** Sharp enough for a [width] by [height] box. */
        fun serves(width: Int, height: Int): Boolean = full || (image.width >= width && image.height >= height)
    }

    private val cache = object : LruCache<String, Held>(cacheKilobytes()) {
        override fun sizeOf(key: String, value: Held): Int = (value.image.asAndroidBitmap().byteCount / 1024).coerceAtLeast(1)
    }

    /** The picture at [url], if one already decoded is sharp enough for the box. */
    fun cached(url: String, widthPx: Int, heightPx: Int): ImageBitmap? =
        cache.get(url)?.takeIf { it.serves(widthPx, heightPx) }?.image

    /** The picture at [url], decoded for a [widthPx] by [heightPx] box; null when there is none. */
    suspend fun load(api: OwnerApi, url: String, widthPx: Int, heightPx: Int): ImageBitmap? {
        cached(url, widthPx, heightPx)?.let { return it }
        val bytes = api.image(url) ?: return null
        val held = withContext(Dispatchers.Default) { decode(bytes, widthPx, heightPx) } ?: return null
        cache.put(url, held)
        return held.image
    }

    /** Forget every picture: one person's photos are never handed to whoever signs in next. */
    fun clear() = cache.evictAll()

    private fun decode(bytes: ByteArray, widthPx: Int, heightPx: Int): Held? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val sample = sampleSizeFor(bounds.outWidth, bounds.outHeight, widthPx, heightPx)
        // As sharp as any box will ever get: the size limit alone would sample it this far.
        val full = sample == sampleSizeFor(bounds.outWidth, bounds.outHeight, 0, 0)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?.let { Held(it.asImageBitmap(), full) }
    } catch (_: OutOfMemoryError) {
        null
    } catch (_: RuntimeException) {
        null
    }

    /** A sixteenth of the app's heap: a few hundred faces and a cover, and little else. */
    private fun cacheKilobytes(): Int = (Runtime.getRuntime().maxMemory() / 1024 / 16).toInt()
}

/** No decode larger than this many pixels, whatever box asks: about 16 MB at four bytes each. */
private const val MAX_DECODED_PIXELS = 4_000_000L

/**
 * How far to sample a [width] by [height] picture down for a [wantWidth] by
 * [wantHeight] box: the largest power of two that still leaves both sides at
 * least as large as the box (a cropped picture must cover it), then larger
 * still if the result would be unreasonably big. 1 for a picture that is
 * unreadable or already small; a box with no size only applies that limit.
 */
internal fun sampleSizeFor(width: Int, height: Int, wantWidth: Int, wantHeight: Int): Int {
    if (width <= 0 || height <= 0) return 1
    var sample = 1
    if (wantWidth > 0 && wantHeight > 0) {
        while (width / (sample * 2) >= wantWidth && height / (sample * 2) >= wantHeight) sample *= 2
    }
    while ((width.toLong() / sample) * (height.toLong() / sample) > MAX_DECODED_PIXELS) {
        sample *= 2
    }
    return sample
}

/**
 * The picture at [url] for a [width] by [height] box, loading it the first
 * time and from memory after that. Null while it loads, when there is no URL,
 * and when there is no picture to show.
 */
@Composable
fun rememberRemoteImage(url: String?, width: Dp, height: Dp = width): ImageBitmap? {
    // Most initials have no photo behind them: nothing to remember, nothing to start.
    if (url == null) return null
    val density = LocalDensity.current
    val widthPx = with(density) { width.roundToPx() }
    val heightPx = with(density) { height.roundToPx() }
    val api = (LocalContext.current.applicationContext as? OwnerApp)?.api
    val image by produceState(RemoteImages.cached(url, widthPx, heightPx), url, widthPx, heightPx) {
        // Reset first: a row reused for another person must not keep the last face.
        value = RemoteImages.cached(url, widthPx, heightPx)
        if (value == null && api != null) value = RemoteImages.load(api, url, widthPx, heightPx)
    }
    return image
}
