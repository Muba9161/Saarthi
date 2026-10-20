package com.saarthi.owner.ui.papers

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.ProgressRing
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.card
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Where the spin section stands. */
private sealed interface SpinStage {
    data object Loading : SpinStage
    data class Failed(val message: String) : SpinStage
    data class Stored(val frames: List<PapersApi.SpinFrame>) : SpinStage
    data class Preparing(val fraction: Float, val fromVideo: Boolean) : SpinStage
    data class Draft(val draft: SpinDraft) : SpinStage
    data class Saving(val sent: Int, val of: Int) : SpinStage
}

/**
 * The vehicle's 360° spin, under its photos: turned if there is one, offered
 * if there is not. One spin per vehicle; replacing one keeps the current spin
 * until the new walk-around has been prepared and checked, and only saving
 * swaps them — as on the web.
 */
@Composable
internal fun SpinSection(app: OwnerApp, vehicleId: String, rights: PhotoRights) {
    val c = Saarthi.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var stage by remember { mutableStateOf<SpinStage>(SpinStage.Loading) }
    var stored by remember { mutableStateOf<List<PapersApi.SpinFrame>>(emptyList()) }
    var notice by remember { mutableStateOf<Pair<String, NoticeTone>?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var confirmingRemove by remember { mutableStateOf(false) }
    // A path, not a File, so it survives the activity being recreated while the camera records.
    var recordingPath by rememberSaveable { mutableStateOf<String?>(null) }
    val canAdd = rights.add && rights.planIncludesPhotos

    LaunchedEffect(vehicleId, attempt) {
        stage = SpinStage.Loading
        stage = try {
            app.papers.spin(vehicleId).also { stored = it }.let(SpinStage::Stored)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            SpinStage.Failed(failure.readable())
        }
    }

    fun prepare(fromVideo: Boolean, make: suspend ((Float) -> Unit) -> SpinDraft, cleanUp: () -> Unit = {}) {
        notice = null
        stage = SpinStage.Preparing(0f, fromVideo)
        scope.launch {
            stage = try {
                SpinStage.Draft(make { fraction -> stage = SpinStage.Preparing(fraction, fromVideo) })
            } catch (failure: SpinSourceError) {
                notice = failure.message.orEmpty() to NoticeTone.WARNING
                SpinStage.Stored(stored)
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                notice = Words.get(R.string.papers_spin_prepare_failed) to NoticeTone.WARNING
                SpinStage.Stored(stored)
            } finally {
                cleanUp()
            }
        }
    }

    val recorder = rememberLauncherForActivityResult(ActivityResultContracts.CaptureVideo()) { recorded ->
        val path = recordingPath ?: return@rememberLauncherForActivityResult
        recordingPath = null
        if (recorded) {
            prepare(fromVideo = true, make = { progress -> framesFromVideo(context, Uri.fromFile(File(path)), progress) }, cleanUp = { File(path).delete() })
        } else {
            File(path).delete()
        }
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) prepare(fromVideo = true, make = { progress -> framesFromVideo(context, uri, progress) })
    }
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) prepare(fromVideo = false, make = { progress -> framesFromPhotos(context, uris, progress) })
    }

    fun save(draft: SpinDraft) {
        notice = null
        val replacing = stored.map { it.id }
        stage = SpinStage.Saving(0, draft.frames.size)
        scope.launch {
            try {
                // The frame cap is one spin's worth, so the old one has to go before the new can land.
                if (replacing.isNotEmpty()) app.papers.removeSpin(replacing)
                app.papers.uploadSpin(vehicleId, draft.frames) { sent -> stage = SpinStage.Saving(sent, draft.frames.size) }
                notice = Words.get(if (replacing.isEmpty()) R.string.papers_spin_saved else R.string.papers_spin_replaced) to NoticeTone.SUCCESS
                attempt++
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                val failed = if (replacing.isNotEmpty()) R.string.papers_spin_save_failed_cleared else R.string.papers_spin_save_failed
                notice = Words.get(failed, failure.readable()) to NoticeTone.DANGER
                stage = SpinStage.Draft(draft)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Eyebrow(stringResource(R.string.papers_spin_title), Modifier.padding(start = 4.dp, top = 8.dp))
        when (val shown = stage) {
            SpinStage.Loading -> InlineSpinner(c.primary)
            is SpinStage.Failed -> {
                NoticeCard(shown.message, NoticeTone.WARNING)
                LinkButton(stringResource(R.string.papers_try_again), onClick = { attempt++ })
            }
            is SpinStage.Stored -> if (shown.frames.isNotEmpty()) {
                StoredSpin(app, shown.frames)
                if (canAdd) {
                    SpinSources(
                        replacing = true,
                        onRecord = { recordingPath = startRecording(context, recorder::launch) },
                        onVideo = { videoPicker.launch(arrayOf("video/*")) },
                        onPhotos = { photoPicker.launch(arrayOf("image/*")) },
                    )
                }
                if (rights.remove) {
                    if (confirmingRemove) {
                        RemoveSpinConfirm(
                            onRemove = {
                                confirmingRemove = false
                                scope.launch {
                                    notice = try {
                                        app.papers.removeSpin(shown.frames.map { it.id })
                                        attempt++
                                        Words.get(R.string.papers_spin_removed) to NoticeTone.SUCCESS
                                    } catch (failure: Exception) {
                                        if (failure is CancellationException) throw failure
                                        failure.readable() to NoticeTone.DANGER
                                    }
                                }
                            },
                            onKeep = { confirmingRemove = false },
                        )
                    } else {
                        LinkButton(stringResource(R.string.papers_spin_remove_link), onClick = { confirmingRemove = true }, color = c.danger)
                    }
                }
            } else if (canAdd) {
                ShootingGuide()
                SpinSources(
                    replacing = false,
                    onRecord = { recordingPath = startRecording(context, recorder::launch) },
                    onVideo = { videoPicker.launch(arrayOf("video/*")) },
                    onPhotos = { photoPicker.launch(arrayOf("image/*")) },
                )
            } else {
                Hint(stringResource(R.string.papers_spin_empty))
            }
            is SpinStage.Preparing -> Working(
                fraction = shown.fraction,
                text = if (shown.fromVideo) stringResource(R.string.papers_spin_choosing_frames) else stringResource(R.string.papers_spin_preparing_photos),
            )
            is SpinStage.Draft -> DraftSpin(
                shown.draft,
                onChange = { stage = SpinStage.Draft(it) },
                onSave = { save(shown.draft) },
                onDiscard = { stage = SpinStage.Stored(stored) },
            )
            is SpinStage.Saving -> Working(
                fraction = shown.sent.toFloat() / shown.of.coerceAtLeast(1),
                text = stringResource(R.string.papers_spin_saving, shown.sent, shown.of),
            )
        }
        notice?.let { (text, tone) -> NoticeCard(text, tone) }
    }
}

/** A file in the shared cache for the camera to record into; its path, so the result can find it. */
private fun startRecording(context: Context, launch: (Uri) -> Unit): String {
    val file = File(File(context.cacheDir, "papers").apply { mkdirs() }, "walkaround-${System.currentTimeMillis()}.mp4")
    launch(FileProvider.getUriForFile(context, "${context.packageName}.receipts", file))
    return file.absolutePath
}

@Composable
private fun SpinSources(replacing: Boolean, onRecord: () -> Unit, onVideo: () -> Unit, onPhotos: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SaarthiButton(
            if (replacing) stringResource(R.string.papers_spin_record_new) else stringResource(R.string.papers_spin_record),
            onClick = onRecord,
            tone = if (replacing) ButtonTone.SECONDARY else ButtonTone.PRIMARY,
            leading = Lucide.camera,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SaarthiButton(stringResource(R.string.papers_spin_choose_video), onClick = onVideo, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
            SaarthiButton(stringResource(R.string.papers_spin_choose_photos), onClick = onPhotos, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
        }
    }
}

/** How to shoot it, as steps: a spin is decided by how it was filmed, before anything uploads. */
@Composable
private fun ShootingGuide() {
    val c = Saarthi.colors
    Column(
        Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.papers_spin_guide_title), style = SType.bodyStrong, color = c.fg)
        listOf(
            stringResource(R.string.papers_spin_guide_park_title) to stringResource(R.string.papers_spin_guide_park_body),
            stringResource(R.string.papers_spin_guide_stand_title) to stringResource(R.string.papers_spin_guide_stand_body),
            stringResource(R.string.papers_spin_guide_walk_title) to
                stringResource(R.string.papers_spin_guide_walk_body, PapersApi.SPIN_MIN_FRAMES, PapersApi.SPIN_MAX_FRAMES),
            stringResource(R.string.papers_spin_guide_centre_title) to stringResource(R.string.papers_spin_guide_centre_body),
        ).forEachIndexed { index, (title, body) ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${index + 1}", style = SType.smallStrong, color = c.primary)
                Column {
                    Text(title, style = SType.smallStrong, color = c.fg)
                    Text(body, style = SType.caption, color = c.muted)
                }
            }
        }
    }
}

@Composable
private fun Working(fraction: Float, text: String) {
    val c = Saarthi.colors
    Row(
        Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ProgressRing(track = c.track, fill = c.primary, modifier = Modifier.size(36.dp), fraction = fraction)
        Text(text, style = SType.small, color = c.muted, modifier = Modifier.weight(1f))
        Text(stringResource(R.string.papers_percent, (fraction * 100).toInt()), style = SType.smallStrong, color = c.fg)
    }
}

@Composable
private fun RemoveSpinConfirm(onRemove: () -> Unit, onKeep: () -> Unit) {
    val c = Saarthi.colors
    Column(Modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.papers_spin_remove_title), style = SType.bodyStrong, color = c.fg)
        Text(stringResource(R.string.papers_removed_for_everyone), style = SType.small, color = c.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SaarthiButton(stringResource(R.string.papers_spin_keep), onClick = onKeep, tone = ButtonTone.SECONDARY, modifier = Modifier.weight(1f))
            SaarthiButton(stringResource(R.string.papers_spin_remove), onClick = onRemove, tone = ButtonTone.DANGER_OUTLINE, modifier = Modifier.weight(1f))
        }
    }
}

/** A saved spin: small frames load first, the opening view before the rest; a full frame loads where the turning stops. */
@Composable
private fun StoredSpin(app: OwnerApp, frames: List<PapersApi.SpinFrame>) {
    val small = remember(frames) { mutableStateListOf<ImageBitmap?>().apply { repeat(frames.size) { add(null) } } }
    var index by remember(frames) { mutableIntStateOf(0) }
    var sharp by remember(frames) { mutableStateOf<Pair<Int, ImageBitmap>?>(null) }

    LaunchedEffect(frames) {
        frames.forEachIndexed { at, frame -> small[at] = runCatching { decodeImage(app.papers.spinFrame(frame, full = false)) }.getOrNull() }
    }
    LaunchedEffect(frames, index) {
        // Only once the turning has stopped on an angle.
        delay(FULL_FRAME_AFTER_MS)
        val at = index
        runCatching { decodeImage(app.papers.spinFrame(frames[at], full = true)) }.getOrNull()?.let { sharp = at to it }
    }
    SpinViewer(
        count = frames.size,
        index = index,
        frame = { at -> sharp?.takeIf { it.first == at }?.second ?: small.getOrNull(at) },
        onIndex = { index = it },
    )
}

/** A spin prepared on the phone, to check and tidy before saving: start it elsewhere, turn it the other way, drop a frame. */
@Composable
private fun DraftSpin(draft: SpinDraft, onChange: (SpinDraft) -> Unit, onSave: () -> Unit, onDiscard: () -> Unit) {
    val c = Saarthi.colors
    val images = remember(draft.frames) { mutableStateListOf<ImageBitmap?>().apply { repeat(draft.frames.size) { add(null) } } }
    // Kept across edits, so the angle being looked at stays in view — as the web's editor does.
    var index by remember { mutableIntStateOf(0) }
    val count = draft.frames.size

    LaunchedEffect(draft.frames) {
        draft.frames.forEachIndexed { at, frame -> images[at] = decodeImage(frame.thumb) }
    }
    SpinViewer(count = count, index = index, frame = { images.getOrNull(it) }, onIndex = { index = it })
    Text(
        if (draft.trimmed) {
            pluralStringResource(R.plurals.papers_spin_draft_summary_trimmed, count, count)
        } else {
            pluralStringResource(R.plurals.papers_spin_draft_summary, count, count)
        },
        style = SType.small,
        color = c.muted,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        LinkButton(stringResource(R.string.papers_spin_start_here), onClick = {
            onChange(draft.copy(frames = startAt(draft.frames, index)))
            index = 0
        }, style = SType.smallStrong)
        LinkButton(stringResource(R.string.papers_spin_reverse), onClick = {
            onChange(draft.copy(frames = reverseTurn(draft.frames)))
            index = reversedIndex(index, count)
        }, style = SType.smallStrong)
        if (count > PapersApi.SPIN_MIN_FRAMES) {
            LinkButton(stringResource(R.string.papers_spin_drop_frame), onClick = {
                onChange(draft.copy(frames = withoutFrame(draft.frames, index)))
                index = minOf(index, count - 2)
            }, style = SType.smallStrong, color = c.danger)
        }
    }
    SaarthiButton(stringResource(R.string.papers_spin_save), onClick = onSave, leading = Lucide.check)
    LinkButton(stringResource(R.string.papers_spin_discard), onClick = onDiscard, color = c.muted)
}

/**
 * Drag sideways to turn the vehicle: one drag across the view is one full
 * turn. The arrows step an angle at a time, for anyone who cannot drag.
 */
@Composable
private fun SpinViewer(count: Int, index: Int, frame: (Int) -> ImageBitmap?, onIndex: (Int) -> Unit) {
    val current = frame(index)
    // The drag handler outlives each recomposition, so it reads the latest angle and callback.
    val latestIndex by rememberUpdatedState(index)
    val latestOnIndex by rememberUpdatedState(onIndex)
    val viewDescription = stringResource(R.string.papers_spin_view_description, index + 1, count)
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(20.dp))
            .background(Color.Black)
            .semantics { contentDescription = viewDescription }
            .pointerInput(count) {
                var start = 0
                var travelled = 0f
                detectHorizontalDragGestures(
                    onDragStart = { start = latestIndex; travelled = 0f },
                ) { _, dragAmount ->
                    travelled += dragAmount
                    val step = size.width.toFloat() / count
                    latestOnIndex(Math.floorMod(start - (travelled / step).toInt(), count))
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (current != null) {
            Image(current, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        } else {
            InlineSpinner(Color.White)
        }
        Row(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleButton(Lucide.chevronLeft, stringResource(R.string.papers_spin_turn_left), { onIndex(Math.floorMod(index - 1, count)) }, size = 36.dp, elevated = false)
            Text(
                stringResource(R.string.papers_spin_drag_hint, index + 1, count),
                style = SType.caption,
                color = Color.White.copy(alpha = 0.85f),
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
            )
            CircleButton(Lucide.chevronRight, stringResource(R.string.papers_spin_turn_right), { onIndex(Math.floorMod(index + 1, count)) }, size = 36.dp, elevated = false)
        }
    }
}

private suspend fun decodeImage(bytes: ByteArray?): ImageBitmap? = bytes?.let {
    withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
}

private const val FULL_FRAME_AFTER_MS = 350L
