package com.saarthi.owner.ui.common

import android.content.Context
import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes

/**
 * The app's words in the language it speaks, for code that is not drawing a
 * screen — a view model's message, a list of a server enum's labels, a
 * notification. Screens use `stringResource`, which follows the same language.
 *
 * Bound to the application at start (so a notification from a background
 * service has words) and again by the activity each time it is built, which is
 * every time the language changes.
 */
object Words {
    @Volatile
    private var resources: Resources? = null

    fun bind(context: Context) {
        resources = context.resources
    }

    fun get(@StringRes id: Int, vararg args: Any): String =
        resources?.getString(id, *args) ?: error("Words used before the app bound them")

    fun plural(@PluralsRes id: Int, count: Int, vararg args: Any): String =
        resources?.getQuantityString(id, count, *args.ifEmpty { arrayOf<Any>(count) }) ?: error("Words used before the app bound them")
}
