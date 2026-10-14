package com.saarthi.owner.ui.common

import android.content.res.Resources
import android.graphics.BitmapFactory
import androidx.annotation.DrawableRes
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Where a portrait role photo is cropped from when it fills a wide card: near
 * its top, where the people's faces are, not its middle, which shows chests.
 */
val FacesAlignment: Alignment = BiasAlignment(horizontalBias = 0f, verticalBias = -0.8f)

/**
 * A photograph decoded once, small, off the main thread, and shared.
 *
 * A list of forty vehicles is forty rows asking for the same six pictures;
 * decoding the 900-pixel originals in each row, on the main thread, is what
 * makes a list stutter as it scrolls. Each picture is decoded at half size
 * the first time it is asked for and handed to every row after that.
 */
@Composable
fun rememberPhoto(@DrawableRes id: Int): ImageBitmap? {
    val resources = LocalContext.current.resources
    val photo by produceState(Thumbnails.get(id), id) {
        if (value == null) value = withContext(Dispatchers.Default) { Thumbnails.load(resources, id) }
    }
    return photo
}

private object Thumbnails {
    private val cache = LruCache<Int, ImageBitmap>(24)

    fun get(id: Int): ImageBitmap? = cache.get(id)

    fun load(resources: Resources, id: Int): ImageBitmap? {
        cache.get(id)?.let { return it }
        val options = BitmapFactory.Options().apply { inSampleSize = 2 }
        val bitmap = BitmapFactory.decodeResource(resources, id, options) ?: return null
        return bitmap.asImageBitmap().also { cache.put(id, it) }
    }
}
