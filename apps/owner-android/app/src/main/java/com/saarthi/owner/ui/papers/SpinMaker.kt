package com.saarthi.owner.ui.papers

import android.content.Context
import android.graphics.Bitmap
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

/*
 * Turning what the phone captured into the frames of a 360° spin, on the phone
 * itself: a walk-around video is hundreds of megabytes, and the frames chosen
 * from it are all the server ever needs. The same choices as the web's
 * `spin-frames.ts` — see [SpinAnalysis] for how frames are picked.
 *
 * Every frame is made twice: a full rendition for looking closely, and a
 * small one the viewer turns through, so most views never download a full one.
 */

/** A spin prepared on the phone and not saved yet. */
internal data class SpinDraft(
    val frames: List<PapersApi.SpinUpload>,
    val fromVideo: Boolean,
    /** The video ran past its starting view and was cut where the loop closed. */
    val trimmed: Boolean,
)

/** Something wrong with what was picked, in words that say what to do. */
internal class SpinSourceError(message: String) : Exception(message)

private const val FULL_QUALITY = 82
private const val THUMB_EDGE = 640
private const val THUMB_QUALITY = 72

/** Moments sampled per kept frame, so the sharpest can be chosen. */
private const val CANDIDATES_PER_FRAME = 2

/** Width of the greyscale sample used to judge sharpness and similarity. */
private const val ANALYSIS_WIDTH = 96

/** Shorter than this and the walk cannot have gone all the way round. */
private const val MIN_VIDEO_MS = 4_000L

/** Fewer different views than this and the walk cannot be judged — as many as finding the loop needs. */
private const val MIN_DISTINCT_VIEWS = 8

/** Share of the progress bar spent judging moments, before frames are made. */
private const val ANALYSIS_SHARE = 0.55f

/**
 * The frames of a spin from a walk-around video, in two passes: twice as many
 * moments as needed are sampled at postage-stamp size to judge sharpness and
 * find where the walk came back to its start, then only the chosen moments are
 * decoded properly.
 */
internal suspend fun framesFromVideo(context: Context, video: Uri, onProgress: (Float) -> Unit): SpinDraft =
    withContext(Dispatchers.Default) {
        val retriever = MediaMetadataRetriever()
        try {
            try {
                retriever.setDataSource(context, video)
            } catch (unreadable: RuntimeException) {
                throw SpinSourceError(Words.get(R.string.papers_spin_video_unreadable))
            }
            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                ?: throw SpinSourceError(Words.get(R.string.papers_spin_video_no_length))
            if (durationMs < MIN_VIDEO_MS) {
                throw SpinSourceError(Words.get(R.string.papers_spin_video_too_short, MIN_VIDEO_MS / 1000))
            }

            val count = PapersApi.SPIN_MAX_FRAMES
            val total = count * CANDIDATES_PER_FRAME
            // The nearest key frame is enough to judge by, and far quicker to decode. A video with
            // key frames too far apart to tell the views apart is judged frame by frame instead.
            var (candidates, samples) = sampleVideo(retriever, durationMs, total, exact = false, onProgress)
            if (samples.distinctBy { it.contentHashCode() }.size < MIN_DISTINCT_VIEWS) {
                val exact = sampleVideo(retriever, durationMs, total, exact = true, onProgress)
                candidates = exact.first
                samples = exact.second
            }
            if (candidates.size < PapersApi.SPIN_MIN_FRAMES) {
                throw SpinSourceError(Words.get(R.string.papers_spin_video_too_little))
            }

            val closure = findLoopClosure(samples)
            val endMs = closure?.let { candidates[it].timeMs } ?: durationMs
            val times = pickSharpestPerSlot(candidates.filter { it.timeMs < endMs }, 0, endMs, count)
            val frames = times.mapIndexedNotNull { index, timeMs ->
                coroutineContext.ensureActive()
                val frame = retriever.frameAt(timeMs, PapersApi.SPIN_FRAME_EDGE, exact = true)?.let(::bothRenditions)
                onProgress(ANALYSIS_SHARE + (index + 1f) / times.size * (1 - ANALYSIS_SHARE))
                frame
            }
            SpinDraft(frames, fromVideo = true, trimmed = closure != null)
        } finally {
            retriever.release()
        }
    }

/**
 * [total] moments across the video at postage-stamp size, each with how sharp
 * it is: the first pass of [framesFromVideo].
 */
private suspend fun sampleVideo(
    retriever: MediaMetadataRetriever,
    durationMs: Long,
    total: Int,
    exact: Boolean,
    onProgress: (Float) -> Unit,
): Pair<List<FrameCandidate>, List<FloatArray>> {
    val candidates = ArrayList<FrameCandidate>(total)
    val samples = ArrayList<FloatArray>(total)
    for (index in 0 until total) {
        coroutineContext.ensureActive()
        // Mid-slot, so the first and last instants — the phone still being raised or lowered — are never used.
        val timeMs = ((index + 0.5) * durationMs / total).toLong()
        val small = retriever.frameAt(timeMs, ANALYSIS_WIDTH, exact) ?: continue
        val luma = small.luma()
        samples += luma
        candidates += FrameCandidate(timeMs, sharpness(luma, small.width, small.height))
        onProgress((index + 1f) / total * ANALYSIS_SHARE)
    }
    return candidates to samples
}

/**
 * The frames of a spin from photos taken walking round the vehicle, in the
 * order they were taken — the camera's own time on each, where it kept one —
 * rather than the order the picker returned them in.
 */
internal suspend fun framesFromPhotos(context: Context, photos: List<Uri>, onProgress: (Float) -> Unit): SpinDraft =
    withContext(Dispatchers.Default) {
        if (photos.size < PapersApi.SPIN_MIN_FRAMES) {
            throw SpinSourceError(Words.get(R.string.papers_spin_photos_too_few, PapersApi.SPIN_MIN_FRAMES))
        }
        // Times first, then one photo in memory at a time: two dozen camera photos would not fit at once.
        val ordered = photos.mapIndexed { index, uri -> Triple(uri, takenAt(context, uri) ?: "", index) }
            .sortedWith(compareBy({ it.second }, { it.third }))
            .map { it.first }
            .take(PapersApi.SPIN_MAX_FRAMES)
        val frames = ordered.mapIndexed { index, uri ->
            coroutineContext.ensureActive()
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw SpinSourceError(Words.get(R.string.papers_spin_photo_unreadable))
            val upright = runCatching { decodeUpright(bytes, PapersApi.SPIN_FRAME_EDGE) }
                .getOrElse { throw SpinSourceError(Words.get(R.string.papers_spin_photo_bad_format)) }
            onProgress((index + 1f) / ordered.size)
            bothRenditions(upright)
        }
        SpinDraft(frames, fromVideo = false, trimmed = false)
    }

/** When the camera says the photo was taken, as its sortable "yyyy:MM:dd HH:mm:ss"; null without one. */
private fun takenAt(context: Context, photo: Uri): String? = runCatching {
    context.contentResolver.openInputStream(photo)?.use { ExifInterface(it).getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) }
}.getOrNull()

private fun bothRenditions(frame: Bitmap) = PapersApi.SpinUpload(
    full = frame.scaledTo(PapersApi.SPIN_FRAME_EDGE).toJpeg(FULL_QUALITY),
    thumb = frame.scaledTo(THUMB_EDGE).toJpeg(THUMB_QUALITY),
)

/**
 * The frame at [timeMs] — exactly, or the nearest key frame when [exact] is
 * false — no wider than [width]; null where the video cannot give one.
 */
private fun MediaMetadataRetriever.frameAt(timeMs: Long, width: Int, exact: Boolean): Bitmap? {
    val timeUs = timeMs * 1000
    val option = if (exact) MediaMetadataRetriever.OPTION_CLOSEST else MediaMetadataRetriever.OPTION_CLOSEST_SYNC
    return runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            getScaledFrameAtTime(timeUs, option, width, width * 4)
        } else {
            getFrameAtTime(timeUs, option)?.scaledTo(width)
        }
    }.getOrNull()
}

private fun Bitmap.luma(): FloatArray {
    val pixels = IntArray(width * height)
    getPixels(pixels, 0, width, 0, 0, width, height)
    return toLuma(pixels)
}
