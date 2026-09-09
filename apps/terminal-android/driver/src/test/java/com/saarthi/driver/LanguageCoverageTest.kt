package com.saarthi.driver

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Every language Saarthi offers must actually be complete.
 *
 * The failure this prevents is specific and bad: a driver picks हिन्दी, half the
 * app stays in English, and they conclude the app is broken rather than
 * untranslated. Offering a language is a promise, and a missing key silently
 * falls back to English — which is exactly the kind of gap nobody notices in
 * review and every Hindi-reading driver notices immediately.
 *
 * Read off the resource files rather than the generated `R` class so this runs
 * as a plain unit test, with no device and no Android framework.
 */
class LanguageCoverageTest {

    /**
     * Names that stay in English on purpose.
     *
     * A product name is a product name. "Saarthi" transliterated would be a
     * different word from the one on the sticker in the cab.
     */
    private val untranslated = setOf("app_name", "app_name_short", "service_title")

    private fun keysIn(path: String): Set<String> {
        val file = File(path)
        assertTrue("Missing resource file: $path", file.exists())
        return Regex("""<string name="([^"]+)"""")
            .findAll(file.readText())
            .map { it.groupValues[1] }
            .toSet()
    }

    private val english = "src/main/res/values/strings.xml"

    @Test
    fun `hindi translates every string the app offers`() {
        val base = keysIn(english) - untranslated
        val hindi = keysIn("src/main/res/values-hi/strings.xml")

        val missing = (base - hindi).sorted()
        assertTrue(
            "हिन्दी is offered in Language.available but is missing ${missing.size} " +
                "string(s), which would silently fall back to English: $missing",
            missing.isEmpty(),
        )
    }

    @Test
    fun `hindi has no strings the english original has dropped`() {
        val base = keysIn(english)
        val hindi = keysIn("src/main/res/values-hi/strings.xml")

        val orphans = (hindi - base).sorted()
        // A leftover translation is dead weight and, worse, a sign the two files
        // have drifted — which is how a key gets renamed in one and not the
        // other and the fallback goes unnoticed.
        assertTrue("Hindi has strings the English original does not: $orphans", orphans.isEmpty())
    }

    @Test
    fun `every format placeholder survives translation`() {
        val pattern = Regex("""<string name="([^"]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
        fun placeholders(path: String): Map<String, Set<String>> =
            pattern.findAll(File(path).readText()).associate { match ->
                match.groupValues[1] to
                    Regex("""%\d+\$[sd]""").findAll(match.groupValues[2])
                        .map { it.value }
                        .toSet()
            }

        val base = placeholders(english)
        val hindi = placeholders("src/main/res/values-hi/strings.xml")

        val broken = hindi.filter { (key, found) ->
            val expected = base[key] ?: return@filter false
            found != expected
        }.keys.sorted()

        /*
         * A dropped or renumbered placeholder is not a cosmetic problem.
         *
         * `String.format` throws on a missing argument index, so a translation
         * that loses a `%1$s` crashes the screen it is on — in a language
         * nobody on the team reads, on a phone in a lorry.
         */
        assertTrue("Placeholders differ from the English original in: $broken", broken.isEmpty())
    }
}
