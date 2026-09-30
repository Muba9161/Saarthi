package com.saarthi.driver.ui.common

import android.app.Activity
import android.content.Context
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
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.Devanagari
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.Inter
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.bottomRule
import com.saarthi.driver.ui.design.pressable

/**
 * One language Humsafar speaks.
 *
 * [tag] is what Android resolves resources by — a folder such as `values-bn`,
 * or `values-b+doi` for the languages with three-letter codes. The names are
 * the platform's own (`packages/shared/src/domain/languages.ts`), so a driver
 * finds their language written the same way in the app as on the web.
 */
data class AppLanguage(val tag: String, val nativeName: String, val englishName: String)

/**
 * Every language the Saarthi platform supports, in its catalogue order.
 *
 * All nineteen, not a subset: each has a translation file in this app, so
 * choosing one changes what the driver reads rather than leaving them in
 * English and wondering what went wrong.
 */
val AppLanguages: List<AppLanguage> = listOf(
    AppLanguage("en", "English", "English"),
    AppLanguage("as", "অসমীয়া", "Assamese"),
    AppLanguage("bn", "বাংলা", "Bengali"),
    AppLanguage("doi", "डोगरी", "Dogri"),
    AppLanguage("gu", "ગુજરાતી", "Gujarati"),
    AppLanguage("hi", "हिन्दी", "Hindi"),
    AppLanguage("kn", "ಕನ್ನಡ", "Kannada"),
    AppLanguage("kok", "कोंकणी", "Konkani"),
    AppLanguage("mai", "मैथिली", "Maithili"),
    AppLanguage("ml", "മലയാളം", "Malayalam"),
    AppLanguage("mr", "मराठी", "Marathi"),
    AppLanguage("ne", "नेपाली", "Nepali"),
    AppLanguage("or", "ଓଡ଼ିଆ", "Odia"),
    AppLanguage("pa", "ਪੰਜਾਬੀ", "Punjabi"),
    AppLanguage("sa", "संस्कृतम्", "Sanskrit"),
    AppLanguage("ta", "தமிழ்", "Tamil"),
    AppLanguage("te", "తెలుగు", "Telugu"),
    AppLanguage("ur", "اُردُو", "Urdu"),
    AppLanguage("raj", "राजस्थानी", "Rajasthani"),
)

/** The language the app is speaking now, as a tag ("" follows the phone). */
fun currentLanguageTag(context: Context): String =
    (context.applicationContext as SaarthiDriverApp).settings.languageTag

/** The chosen language, or null while the app follows the phone. */
fun currentLanguage(context: Context): AppLanguage? =
    currentLanguageTag(context).takeIf { it.isNotEmpty() }?.let { tag ->
        AppLanguages.firstOrNull { it.tag == tag }
    }

/**
 * Switch the app's language.
 *
 * Resources are resolved when a context is created, so the activity is built
 * again to speak the new one. Nothing is lost: the driver stays signed in and
 * every screen is derived from the server's state.
 */
fun chooseLanguage(context: Context, tag: String) {
    val app = context.applicationContext as SaarthiDriverApp
    if (app.settings.languageTag == tag) return
    app.settings.languageTag = tag
    (context as? Activity)?.recreate()
}

private fun isDevanagari(text: String) = text.any { it in 'ऀ'..'ॿ' }

/**
 * The language rows: "Phone default" and then all nineteen, native name first.
 *
 * Somebody who reads only Bengali cannot find "Bengali" in a list of English
 * words, but they find "বাংলা" at once — so the native name leads and the
 * English one follows in grey.
 */
@Composable
fun LanguageRows(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val chosen = currentLanguageTag(context)
    val c = Saarthi.colors
    val rows = listOf(
        AppLanguage("", stringResource(R.string.language_phone_default), stringResource(R.string.language_phone_default_sub)),
    ) + AppLanguages

    Column(modifier.fillMaxWidth()) {
        rows.forEachIndexed { index, language ->
            val on = language.tag == chosen
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 58.dp)
                    .bottomRule(c.border, show = index < rows.lastIndex)
                    .pressable(role = Role.RadioButton, scale = 0.99f) { chooseLanguage(context, language.tag) }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
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
                    if (language.englishName != language.nativeName) {
                        Text(language.englishName, style = SType.caption, color = c.subtle)
                    }
                }
                if (on) {
                    IconWell(
                        Lucide.check,
                        well = c.primary,
                        ink = c.onPrimary,
                        size = 28.dp,
                        shape = CircleShape,
                        iconSize = 14.dp,
                        stroke = 3f,
                    )
                }
            }
        }
    }
}

/** The sheet the welcome screen's language chip opens. */
@Composable
fun LanguageSheetContent() {
    val c = Saarthi.colors
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.language_sheet_title), style = SType.sheetTitle, color = c.fg)
        Text(stringResource(R.string.language_sheet_blurb), style = SType.body, color = c.muted)
        LanguageRows()
    }
}
