package com.saarthi.driver.ui.shift.papers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.saarthi.core.data.PaperCache
import com.saarthi.core.network.DriverPaperDto
import com.saarthi.core.util.DebugLog

/** What came of asking to see a paper. */
internal enum class PaperOpening { OPENED, NOT_ON_PHONE, NO_VIEWER }

/**
 * Hand the copy on this phone to whatever app can show it.
 *
 * Always the cached file, never a download: the moment a paper is asked for is
 * usually a moment with no signal, so one that is not already here is reported
 * as such. The file leaves through the app's own FileProvider —
 * `${packageName}.papers`, which `res/xml/paper_paths.xml` scopes to the
 * cache's one directory — with a read grant on this intent alone, so the viewer
 * can read this paper and nothing else the app holds.
 */
internal fun openPaper(context: Context, cache: PaperCache, paper: DriverPaperDto): PaperOpening {
    if (!cache.isCached(paper.id, paper.mimeType)) return PaperOpening.NOT_ON_PHONE
    val file = cache.fileFor(paper.id, paper.mimeType)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.papers", file)
    val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, paper.mimeType ?: context.contentResolver.getType(uri))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        context.startActivity(view)
        PaperOpening.OPENED
    } catch (missing: ActivityNotFoundException) {
        DebugLog.warn("papers", "No app can open ${paper.mimeType ?: "an untyped file"}: ${missing.message}")
        PaperOpening.NO_VIEWER
    }
}
