package com.saarthi.core.ui

import android.content.Context
import android.content.res.Configuration
import com.saarthi.core.data.TerminalSettings
import java.util.Locale

/**
 * The language Saarthi speaks to a driver in.
 *
 * The platform has always supported twenty-six Indian languages: the web app is
 * fully localised, and registration asks a driver which one they read and stores
 * it on their profile. The Android app ignored all of it and spoke English —
 * which meant a fleet owner could run Saarthi in Maithili and the driver could
 * not. That is the wrong way round. Drivers are the population least likely to
 * read English and the one that uses the app every day.
 *
 * ## Why a context wrapper rather than the per-app locale API
 *
 * `AppCompatDelegate.setApplicationLocales` is the modern answer and it needs
 * `AppCompatActivity`; this app's activity is a `FragmentActivity` because
 * `BiometricPrompt` requires one, and changing its base class would change its
 * theming too. Android 13's `LocaleManager` is dependency-free but exists only
 * from API 33, and a driver's phone is exactly the phone that will not be on
 * API 33.
 *
 * Overriding the configuration in `attachBaseContext` works on every version
 * Saarthi supports, needs no new dependency, and leaves the translations as
 * ordinary `values-xx/strings.xml` — which matters for the twenty-four
 * languages still to be translated, because that is the format every
 * translation house and tool already speaks.
 */
object Language {

    /**
     * The languages with translations in the app today.
     *
     * Deliberately *not* the platform's full catalogue of twenty-six. Offering a
     * driver a language that then renders in English is worse than not offering
     * it: they choose it, nothing changes, and they conclude the app is broken
     * rather than untranslated. This list grows as files land in `values-xx`.
     */
    val available: List<Choice> = listOf(
        Choice(tag = "", englishName = "Phone default", nativeName = "Phone default"),
        Choice(tag = "en", englishName = "English", nativeName = "English"),
        Choice(tag = "hi", englishName = "Hindi", nativeName = "हिन्दी"),
    )

    /**
     * One offered language.
     *
     * Both names, and the native one leads in the picker. Somebody who reads
     * only Hindi cannot find "Hindi" in a list; they can find "हिन्दी".
     */
    data class Choice(
        val tag: String,
        val englishName: String,
        val nativeName: String,
    )

    /**
     * Wrap a context so resources resolve in the driver's chosen language.
     *
     * Called from `attachBaseContext`, before any view or resource is touched.
     * An empty tag returns the context untouched, which leaves the phone's own
     * language in force — the correct default.
     */
    fun wrap(base: Context): Context {
        val tag = TerminalSettings(base).languageTag
        if (tag.isBlank()) return base

        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)

        val configuration = Configuration(base.resources.configuration)
        configuration.setLocale(locale)
        // `setLocales` as well, so a system that consults the list rather than
        // the single locale agrees with it.
        configuration.setLocales(android.os.LocaleList(locale))

        return base.createConfigurationContext(configuration)
    }

    /** The choice currently in force, for showing in a picker. */
    fun current(context: Context): Choice {
        val tag = TerminalSettings(context).languageTag
        return available.firstOrNull { it.tag == tag } ?: available.first()
    }
}
