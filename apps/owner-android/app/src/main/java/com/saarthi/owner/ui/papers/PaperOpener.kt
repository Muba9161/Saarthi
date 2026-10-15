package com.saarthi.owner.ui.papers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File

/** What came of asking to see a paper. */
internal enum class PaperOpening { OPENED, NO_VIEWER }

/**
 * Where a downloaded paper is kept: the cache's `papers/` folder, the only one
 * besides receipts that `res/xml/receipt_paths.xml` lets another app read.
 * The cache, so Android may clear it and nothing lingers that the owner did
 * not choose to keep.
 */
internal fun paperFile(context: Context, name: String, mimeType: String?): File {
    val extension = mimeType?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) } ?: "pdf"
    return File(File(context.cacheDir, "papers"), "$name.$extension")
}

/**
 * Hand a downloaded paper to whatever app can show it.
 *
 * Through the app's one FileProvider (named for receipts, which it served
 * first), with a read grant on this intent alone, so the viewer can read this
 * file and nothing else the app holds.
 */
internal fun openPaper(context: Context, file: File, mimeType: String?): PaperOpening {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.receipts", file)
    val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, mimeType ?: context.contentResolver.getType(uri))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        context.startActivity(view)
        PaperOpening.OPENED
    } catch (missing: ActivityNotFoundException) {
        PaperOpening.NO_VIEWER
    }
}
