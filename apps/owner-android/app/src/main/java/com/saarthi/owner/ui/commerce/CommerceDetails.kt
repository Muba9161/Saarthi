package com.saarthi.owner.ui.commerce

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.owner.network.CommerceApi
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.LinkButton
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiField
import com.saarthi.owner.ui.design.SaarthiSwitch
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * What a typed name has been read as — its category and the details that
 * category asks for — and what the person has confirmed or corrected.
 *
 * What they chose is "locked": sent back with every new reading, never
 * overridden by it. Matching sellers to needs works on the category, so a
 * listing or a material need is not ready until it has one and its required
 * details are filled.
 */
@Stable
class CommerceEntry(private val api: CommerceApi, private val scope: String) {
    var categoryId by mutableStateOf<String?>(null)
        private set
    var path by mutableStateOf("")
        private set
    var confidence by mutableStateOf("LOW")
        private set
    var alternatives by mutableStateOf<List<CommerceApi.CategoryRef>>(emptyList())
        private set
    var fields by mutableStateOf<List<CommerceApi.Field>>(emptyList())
        private set
    var attributes by mutableStateOf<Map<String, JsonPrimitive>>(emptyMap())
        private set
    var reading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    /** Read at least once, so there is something to show. */
    var read by mutableStateOf(false)
        private set

    private var categoryLocked = false
    private var lockedKeys = emptySet<String>()
    private var lastText = ""

    /** Required details still empty. */
    val missing: List<CommerceApi.Field> get() = fields.filter { it.required && attributes[it.key] == null }

    val ready: Boolean get() = categoryId != null && missing.isEmpty()

    /** The values to save beside the category. */
    val attributesJson: JsonObject get() = JsonObject(attributes)

    suspend fun interpret(text: String) {
        lastText = text
        if (text.trim().length < 2) return
        reading = true
        try {
            val result = api.interpret(
                text,
                scope,
                lockedCategoryId = categoryId.takeIf { categoryLocked },
                lockedAttributes = attributes.filterKeys { it in lockedKeys },
            )
            failed = false
            val category = result?.category?.takeIf { !it.isFallback }
            categoryId = category?.id
            path = category?.pathWords.orEmpty()
            confidence = result?.confidence ?: "LOW"
            alternatives = result?.alternatives.orEmpty().filter { it.id != category?.id }
            fields = result?.fields.orEmpty().sortedBy { it.sortOrder }
            attributes = result?.attributes.orEmpty() + attributes.filterKeys { it in lockedKeys }
        } catch (failure: Exception) {
            failed = true
        } finally {
            reading = false
            read = true
        }
    }

    /** The person picked the category themselves; read again under it for its details. */
    suspend fun choose(id: String) {
        categoryId = id
        categoryLocked = true
        // Details belong to a category; ones typed for another do not carry over.
        attributes = emptyMap()
        lockedKeys = emptySet()
        interpret(lastText)
    }

    /** Back to nothing read, for the next thing typed. */
    fun reset() {
        categoryId = null
        path = ""
        confidence = "LOW"
        alternatives = emptyList()
        fields = emptyList()
        attributes = emptyMap()
        failed = false
        read = false
        categoryLocked = false
        lockedKeys = emptySet()
        lastText = ""
    }

    fun set(key: String, value: JsonPrimitive?) {
        lockedKeys = if (value == null) lockedKeys - key else lockedKeys + key
        attributes = if (value == null) attributes - key else attributes + (key to value)
    }
}

/**
 * The "What is it?" panel under a name field: the category Saarthi read, a
 * way to change it, and the details the category needs. Reads [text] again a
 * moment after typing stops.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CommerceDetails(entry: CommerceEntry, text: String, api: CommerceApi, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var showOptional by remember { mutableStateOf(false) }

    LaunchedEffect(text) {
        if (text.trim().length < 3) return@LaunchedEffect
        delay(READ_PAUSE_MS)
        entry.interpret(text)
    }
    if (!entry.read && !entry.reading) return

    val direct = entry.categoryId == null
    val openPicker = {
        navigator.push("category-picker") {
            CategoryPickerScreen(api, entry.categoryId) { picked -> scope.launch { entry.choose(picked) } }
        }
    }
    Column(
        modifier.fillMaxWidth().card(radius = 20.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    LineIcon(Lucide.sparkles, size = 14.dp, color = c.primary)
                    Eyebrow(
                        when {
                            entry.failed -> "Choose a category"
                            direct -> "What is it?"
                            else -> "Detected"
                        },
                    )
                }
                when {
                    entry.reading && !entry.read -> Text("Reading what this is…", style = SType.small, color = c.muted)
                    !direct -> Text(entry.path, style = SType.bodyStrong, color = c.fg)
                    entry.failed -> Text("Saarthi could not read that just now. Pick the category.", style = SType.small, color = c.muted)
                    else -> Text("Saarthi could not tell what this is. Pick the closest category.", style = SType.small, color = c.muted)
                }
                if (!direct && entry.confidence == "MEDIUM") {
                    Text("Is this right? Change it if not.", style = SType.caption, color = c.subtle)
                }
            }
            if (entry.reading) {
                RingSpinner(track = c.track, head = c.primary, size = 18.dp, stroke = 2.dp)
            } else {
                LinkButton(if (direct) "Choose" else "Change", onClick = openPicker, style = SType.smallStrong)
            }
        }

        if (entry.alternatives.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                entry.alternatives.forEach { alternative ->
                    ChoiceChip(alternative.pathWords, selected = false, onClick = { scope.launch { entry.choose(alternative.id) } }, offColor = c.sunken, height = 36.dp)
                }
            }
        }

        val required = entry.fields.filter { it.required }
        val optional = entry.fields.filterNot { it.required }
        required.forEach { field -> AttributeField(field, entry) }
        if (optional.isNotEmpty()) {
            if (showOptional || optional.any { entry.attributes[it.key] != null }) {
                optional.forEach { field -> AttributeField(field, entry) }
            } else {
                LinkButton("Add more details (optional)", onClick = { showOptional = true }, style = SType.smallStrong)
            }
        }
    }
}

/** One detail, in the control its type calls for. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttributeField(field: CommerceApi.Field, entry: CommerceEntry) {
    val c = Saarthi.colors
    val label = listOfNotNull(field.label, field.unit?.let { "($it)" }).joinToString(" ") + if (field.required) "" else " (optional)"
    val current = entry.attributes[field.key]
    when (field.type) {
        "SELECT" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = SType.fieldLabel, color = if (field.required && current == null) c.fg else c.muted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                field.options.forEach { option ->
                    val on = current?.content == option
                    // The panel is a card already; a chip the card's colour would vanish into it.
                    ChoiceChip(option, selected = on, onClick = { entry.set(field.key, if (on) null else JsonPrimitive(option)) }, offColor = c.sunken, height = 36.dp)
                }
            }
        }
        "BOOLEAN" -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = SType.rowTitle, color = c.fg, modifier = Modifier.weight(1f))
            SaarthiSwitch(checked = current?.booleanOrNull == true, onCheckedChange = { entry.set(field.key, JsonPrimitive(it)) }, label = field.label)
        }
        "NUMBER" -> {
            var typed by remember(field.key) { mutableStateOf(current?.doubleOrNull?.let(::plain).orEmpty()) }
            SaarthiField(
                value = typed,
                onValueChange = { next ->
                    typed = next.filter { it.isDigit() || it == '.' }.take(12)
                    entry.set(field.key, typed.toDoubleOrNull()?.let(::JsonPrimitive))
                },
                label = label,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                height = 52.dp,
            )
        }
        else -> {
            var typed by remember(field.key) { mutableStateOf(current?.content.orEmpty()) }
            SaarthiField(
                value = typed,
                onValueChange = { next ->
                    typed = next.take(200)
                    entry.set(field.key, typed.trim().ifBlank { null }?.let(::JsonPrimitive))
                },
                label = label,
                height = 52.dp,
            )
        }
    }
}

/** "12" rather than "12.0". */
private fun plain(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/** A pause after typing before the name is read, so each letter is not a request. */
private const val READ_PAUSE_MS = 700L
