package com.saarthi.owner.ui.papers

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.BottomSheet
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Hint
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.pressable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The web's own cap on a vehicle's exterior photos. */
private const val MAX_PHOTOS = 12

/** What this account may do with a vehicle's photographs. */
internal data class PhotoRights(val add: Boolean, val remove: Boolean, val planIncludesPhotos: Boolean)

internal fun photoRights(account: SessionStore.Account?) = PhotoRights(
    add = account?.can(PapersApi.CAN_UPLOAD_PHOTOS) == true,
    remove = account?.can(PapersApi.CAN_DELETE_PHOTOS) == true,
    planIncludesPhotos = account?.hasFeature(PapersApi.PHOTOS_FEATURE) == true,
)

/**
 * The vehicle's photographs, two to a row; a tap shows one full size. Adding
 * them is done here when the account may: a photo is never reviewed, so it
 * counts the moment it lands. Removing one asks first, in [RemovePhotoSheet].
 */
@Composable
internal fun PhotoFolder(
    app: OwnerApp,
    vehicleId: String,
    photos: List<PapersApi.Photo>,
    rights: PhotoRights,
    notice: Pair<String, NoticeTone>?,
    onNotice: (Pair<String, NoticeTone>?) -> Unit,
    onAdded: () -> Unit,
    onRemove: (PapersApi.Photo) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var shownId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun add(picked: Result<OwnerApi.Upload>) {
        val file = picked.getOrElse {
            onNotice((it.message ?: Words.get(R.string.papers_photo_unusable)) to NoticeTone.DANGER)
            return
        }
        busy = true
        onNotice(null)
        scope.launch {
            try {
                app.papers.uploadPhoto(vehicleId, file)
                onNotice(Words.get(R.string.papers_photo_added) to NoticeTone.SUCCESS)
                onAdded()
            } catch (failure: Exception) {
                onNotice(failure.readable() to NoticeTone.DANGER)
            } finally {
                busy = false
            }
        }
    }

    val load: suspend (String, Boolean) -> ByteArray? = { id, thumbnail -> app.papers.photo(id, thumbnail) }
    // A removed photo drops out of the list, and its full-size view with it.
    photos.firstOrNull { it.id == shownId }?.let { photo ->
        FullPhoto(photo, load, canRemove = rights.remove, onClose = { shownId = null }, onRemove = { onRemove(photo) })
        return
    }

    val canAdd = rights.add && rights.planIncludesPhotos
    if (photos.isEmpty()) {
        Hint(if (canAdd) stringResource(R.string.papers_photos_empty_can_add) else stringResource(R.string.papers_photos_empty))
    }
    ThumbnailGrid(photos, load) { shownId = it.id }

    when {
        !rights.add -> if (photos.isNotEmpty()) Hint(stringResource(R.string.papers_photos_view_only))
        !rights.planIncludesPhotos -> Hint(stringResource(R.string.papers_photos_not_in_plan))
        photos.size >= MAX_PHOTOS -> Hint(stringResource(R.string.papers_photos_full, MAX_PHOTOS))
        else -> AddPhotoButtons(busy, ::add)
    }
    notice?.let { (text, tone) -> NoticeCard(text, tone) }
    SpinSection(app, vehicleId, rights)
}

@Composable
private fun AddPhotoButtons(busy: Boolean, onPicked: (Result<OwnerApi.Upload>) -> Unit) {
    val pickers = rememberPickers(imagesOnly = true, onPicked = onPicked)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SaarthiButton(stringResource(R.string.papers_take_photo), onClick = pickers.takePhoto, busy = busy, busyText = stringResource(R.string.papers_photo_adding), leading = Lucide.camera)
        SaarthiButton(stringResource(R.string.papers_photo_choose), onClick = pickers.chooseFile, enabled = !busy, tone = ButtonTone.SECONDARY, leading = Lucide.image)
    }
}

/**
 * Asking before a photo is taken off the vehicle. Placed beside the page, not
 * in it, so it rises over the whole screen; [photo] null keeps it closed.
 */
@Composable
internal fun RemovePhotoSheet(app: OwnerApp, photo: PapersApi.Photo?, onDismiss: () -> Unit, onRemoved: (PapersApi.Photo) -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var removing by remember { mutableStateOf(false) }
    var problem by remember(photo?.id) { mutableStateOf<String?>(null) }

    BottomSheet(visible = photo != null, onDismiss = { if (!removing) onDismiss() }) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.papers_photo_remove_title), style = SType.sheetTitle, color = c.fg)
            Text(stringResource(R.string.papers_removed_for_everyone), style = SType.body, color = c.muted)
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            SaarthiButton(
                stringResource(R.string.papers_photo_remove_button),
                onClick = {
                    val target = photo ?: return@SaarthiButton
                    removing = true
                    problem = null
                    scope.launch {
                        try {
                            app.papers.deletePhoto(target.id)
                            onRemoved(target)
                        } catch (failure: Exception) {
                            problem = failure.readable()
                        } finally {
                            removing = false
                        }
                    }
                },
                tone = ButtonTone.DANGER_OUTLINE,
                busy = removing,
                busyText = stringResource(R.string.papers_removing),
            )
        }
    }
}

/**
 * A vehicle's photographs to look at only — for the person a vehicle is shared
 * with. [load] fetches one photo's bytes, small or full size.
 */
@Composable
internal fun ReadOnlyPhotos(photos: List<PapersApi.Photo>, load: suspend (String, Boolean) -> ByteArray?) {
    var shownId by remember { mutableStateOf<String?>(null) }
    photos.firstOrNull { it.id == shownId }?.let { photo ->
        FullPhoto(photo, load, canRemove = false, onClose = { shownId = null }, onRemove = {})
        return
    }
    if (photos.isEmpty()) Hint(stringResource(R.string.papers_photos_empty))
    ThumbnailGrid(photos, load) { shownId = it.id }
}

/** Photographs two to a row. */
@Composable
internal fun ThumbnailGrid(photos: List<PapersApi.Photo>, load: suspend (String, Boolean) -> ByteArray?, onOpen: (PapersApi.Photo) -> Unit) {
    photos.chunked(2).forEach { pair ->
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            pair.forEach { photo -> Thumbnail(photo, load, onOpen = { onOpen(photo) }, Modifier.weight(1f)) }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

/** Bytes from the API, decoded off the main thread; null while loading or when unreadable. */
@Composable
private fun rememberRemoteBitmap(key: Any, load: suspend () -> ByteArray?): Bitmap? {
    val bitmap by produceState<Bitmap?>(null, key) {
        value = withContext(Dispatchers.IO) {
            runCatching { load()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
        }
    }
    return bitmap
}

@Composable
private fun Thumbnail(photo: PapersApi.Photo, load: suspend (String, Boolean) -> ByteArray?, onOpen: () -> Unit, modifier: Modifier) {
    val bitmap = rememberRemoteBitmap(photo.id to true) { load(photo.id, photo.hasThumbnail) }
    val label = photo.caption ?: stringResource(R.string.papers_photo_label)
    Box(
        modifier
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(16.dp))
            .background(Saarthi.colors.sunken)
            .pressable(scale = 0.97f, label = label, onClick = onOpen),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(bitmap.asImageBitmap(), contentDescription = label, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            LineIcon(Lucide.image, size = 24.dp, color = Saarthi.colors.subtle)
        }
    }
}

@Composable
internal fun FullPhoto(
    photo: PapersApi.Photo,
    load: suspend (String, Boolean) -> ByteArray?,
    canRemove: Boolean,
    onClose: () -> Unit,
    onRemove: () -> Unit,
) {
    val c = Saarthi.colors
    val bitmap = rememberRemoteBitmap(photo.id to false) { load(photo.id, false) }
    val label = photo.caption ?: stringResource(R.string.papers_photo_label)

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = SType.bodyStrong, color = c.fg, modifier = Modifier.weight(1f))
        CircleButton(Lucide.close, stringResource(R.string.papers_photo_close), onClose, size = 40.dp, elevated = false)
    }
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap.asImageBitmap(),
                contentDescription = label,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)),
            )
        } else {
            Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f), contentAlignment = Alignment.Center) {
                LineIcon(Lucide.image, size = 28.dp, color = Color.White.copy(alpha = 0.6f))
            }
        }
    }
    if (canRemove) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            LinkButton(stringResource(R.string.papers_photo_remove_link), onClick = onRemove, color = c.danger)
        }
    }
}
