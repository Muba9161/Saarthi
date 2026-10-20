package com.saarthi.owner.ui.common

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.ui.design.Devanagari
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.Inter
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import java.util.Locale

/**
 * The language the app speaks — Humsafar's mechanism, copied: a tag kept on
 * the phone, the activity's context wrapped in it before anything is drawn, and
 * the activity rebuilt when it changes. Translations are ordinary
 * `values-xx/strings*.xml`, the format every translator already works in.
 *
 * Only languages the app actually carries are offered, the same seven Humsafar
 * translates plus English: choosing one that then shows English reads as a
 * broken app, not an untranslated one.
 */
data class AppLanguage(val tag: String, val nativeName: String, val englishName: String)

val AppLanguages: List<AppLanguage> = listOf(
    AppLanguage("en", "English", "English"),
    AppLanguage("hi", "हिन्दी", "Hindi"),
    AppLanguage("bn", "বাংলা", "Bengali"),
    AppLanguage("doi", "डोगरी", "Dogri"),
    AppLanguage("gu", "ગુજરાતી", "Gujarati"),
    AppLanguage("ml", "മലയാളം", "Malayalam"),
    AppLanguage("mr", "मराठी", "Marathi"),
    AppLanguage("ta", "தமிழ்", "Tamil"),
)

object Language {
    /**
     * [base] speaking the chosen language; untouched when the phone's own is
     * followed. Called from `attachBaseContext`, before any resource is read.
     */
    fun wrap(base: Context): Context {
        val tag = OwnerPreferences(base).languageTag
        if (tag.isBlank()) {
            // Back to the phone's own: dates and numbers follow it again too, not the language chosen before.
            Locale.setDefault(base.resources.configuration.locales[0])
            return base
        }
        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(locale)
        configuration.setLocales(LocaleList(locale))
        return base.createConfigurationContext(configuration)
    }

    /** The chosen language, or null while the phone's own is followed. */
    fun current(context: Context): AppLanguage? =
        OwnerPreferences(context).languageTag.takeIf { it.isNotEmpty() }?.let { tag -> AppLanguages.firstOrNull { it.tag == tag } }

    /**
     * Speak [tag] from now on. Resources are read when a context is made, so the
     * activity is built again; the person stays signed in and every screen is
     * read again from the server.
     */
    fun choose(context: Context, tag: String) {
        val preferences = OwnerPreferences(context)
        if (preferences.languageTag == tag) return
        preferences.languageTag = tag
        (context.findActivity())?.recreate()
    }

    private tailrec fun Context.findActivity(): Activity? = when (this) {
        is Activity -> this
        is android.content.ContextWrapper -> baseContext.findActivity()
        else -> null
    }
}

private fun isDevanagari(text: String) = text.any { it in 'ऀ'..'ॿ' }

/**
 * "Phone default" and then each language, its own name first: somebody who
 * reads only Bengali cannot find "Bengali" in a list of English words, but they
 * find "বাংলা" at once.
 */
@Composable
fun LanguageRows(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val chosen = OwnerPreferences(context).languageTag
    val c = Saarthi.colors
    val rows = listOf(AppLanguage("", stringResource(R.string.ui_language_phone_default), stringResource(R.string.ui_language_follows_phone))) + AppLanguages
    Column(modifier.fillMaxWidth().card(radius = 22.dp)) {
        rows.forEachIndexed { index, language ->
            val on = language.tag == chosen
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 58.dp)
                    .bottomRule(c.border, show = index < rows.lastIndex)
                    .pressable(role = Role.RadioButton, scale = 0.99f, label = language.englishName) { Language.choose(context, language.tag) }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f).padding(vertical = 9.dp)) {
                    Text(
                        language.nativeName,
                        style = SType.rowTitle.copy(
                            fontFamily = if (isDevanagari(language.nativeName)) Devanagari else Inter,
                            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                        ),
                        color = if (on) c.fg else c.muted,
                    )
                    if (language.englishName != language.nativeName) Text(language.englishName, style = SType.caption, color = c.subtle)
                }
                if (on) IconWell(Lucide.check, well = c.primary, ink = c.onPrimary, size = 28.dp, shape = CircleShape, iconSize = 14.dp, stroke = 3f)
            }
        }
    }
}
