package com.saarthi.driver

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Every language Humsafar offers must actually be complete.
 *
 * The failure this prevents is specific and bad: a driver picks हिन्दी, half the
 * app stays in English, and they conclude the app is broken rather than
 * untranslated. Offering a language is a promise, and a missing key silently
 * falls back to English — which is exactly the kind of gap nobody notices in
 * review and every driver reading their own language notices immediately.
 *
 * Checked for all eighteen translations and every `strings*.xml` file, because
 * each feature keeps its words in a file of its own. Read off the resource files
 * rather than the generated `R` class so this runs as a plain unit test.
 */
class LanguageCoverageTest {

    /** The resource folder for each language the picker offers, English aside. */
    private val languages = listOf(
        "as", "bn", "b+doi", "gu", "hi", "kn", "b+kok", "b+mai", "ml",
        "mr", "ne", "or", "pa", "sa", "ta", "te", "ur", "b+raj",
    )

    private val res = File("src/main/res")

    private val englishFiles: List<File> =
        File(res, "values").listFiles { file -> file.name.startsWith("strings") && file.name.endsWith(".xml") }
            .orEmpty()
            .sortedBy { it.name }

    private val entry = Regex("""<(string|plurals) name="([^"]+)"([^>]*)>(.*?)</\1>""", RegexOption.DOT_MATCHES_ALL)
    private val placeholder = Regex("""%\d+\$[sd]""")

    /** Key → the placeholders it uses, for every translatable string and plural in a file. */
    private fun entries(file: File): Map<String, Set<String>> {
        if (!file.exists()) return emptyMap()
        return entry.findAll(file.readText())
            // A product name is a product name: `translatable="false"` stays English.
            .filterNot { it.groupValues[3].contains("translatable=\"false\"") }
            .associate { match ->
                match.groupValues[2] to placeholder.findAll(match.groupValues[4]).map { it.value }.toSet()
            }
    }

    private fun translated(language: String, english: File) = File(res, "values-$language/${english.name}")

    @Test
    fun `there are english strings to check`() {
        assertTrue("No strings*.xml found under ${res.absolutePath}/values", englishFiles.isNotEmpty())
    }

    @Test
    fun `every language translates every string the app offers`() {
        val gaps = languages.flatMap { language ->
            englishFiles.mapNotNull { english ->
                val missing = (entries(english).keys - entries(translated(language, english)).keys).sorted()
                missing.takeIf { it.isNotEmpty() }?.let { "values-$language/${english.name} is missing ${it.size}: $it" }
            }
        }
        assertTrue(gaps.joinToString("\n"), gaps.isEmpty())
    }

    @Test
    fun `no language keeps strings the english original has dropped`() {
        // A leftover translation is dead weight and, worse, a sign the files have
        // drifted — which is how a key gets renamed in one and not the other.
        val orphans = languages.flatMap { language ->
            englishFiles.mapNotNull { english ->
                val extra = (entries(translated(language, english)).keys - entries(english).keys).sorted()
                extra.takeIf { it.isNotEmpty() }?.let { "values-$language/${english.name} has extra: $it" }
            }
        }
        assertTrue(orphans.joinToString("\n"), orphans.isEmpty())
    }

    @Test
    fun `every format placeholder survives translation`() {
        /*
         * A dropped or renumbered placeholder is not a cosmetic problem.
         *
         * `String.format` throws on a missing argument index, so a translation
         * that loses a `%1$s` crashes the screen it is on — in a language
         * nobody on the team reads, on a phone in a lorry.
         */
        val broken = languages.flatMap { language ->
            englishFiles.flatMap { english ->
                val base = entries(english)
                entries(translated(language, english)).filter { (key, found) ->
                    val expected = base[key] ?: return@filter false
                    found != expected
                }.keys.map { "values-$language/${english.name}: $it" }
            }
        }
        assertTrue("Placeholders differ from the English original in:\n${broken.joinToString("\n")}", broken.isEmpty())
    }
}
