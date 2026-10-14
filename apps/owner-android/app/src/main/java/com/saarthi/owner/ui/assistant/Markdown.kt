package com.saarthi.owner.ui.assistant

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.saarthi.owner.ui.design.SType

/**
 * The part of Markdown the assistant writes: headings, bullet lists, bold
 * and tables. Anything else is shown as the plain text it is.
 */
@Composable
fun MarkdownText(source: String, color: Color, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks(source).forEach { block ->
            when (block) {
                is Block.Table -> TableBlock(block, color)
                is Block.Line -> LineBlock(block.text, color)
            }
        }
    }
}

/** A run of the answer: one line, or a whole table. */
private sealed interface Block {
    data class Line(val text: String) : Block
    data class Table(val header: List<String>, val rows: List<List<String>>) : Block
}

/** Lines, with consecutive `| … |` lines gathered into one table. */
private fun blocks(source: String): List<Block> {
    val out = mutableListOf<Block>()
    val table = mutableListOf<List<String>>()
    fun flush() {
        if (table.isEmpty()) return
        val rows = table.filterNot { row -> row.all { cell -> cell.isEmpty() || cell.all { it == '-' || it == ':' } } }
        if (rows.isNotEmpty()) out.add(Block.Table(rows.first(), rows.drop(1)))
        table.clear()
    }
    source.trim().lines().forEach { raw ->
        val line = raw.trimEnd()
        if (line.trimStart().startsWith("|")) {
            table.add(line.trim().trim('|').split("|").map { it.trim().replace("<br>", " ") })
        } else {
            flush()
            out.add(Block.Line(line))
        }
    }
    flush()
    return out
}

/**
 * A table, as a phone can read it: each row its own block, the first cell
 * as its title and the rest beneath it under their column names.
 */
@Composable
private fun TableBlock(table: Block.Table, color: Color) {
    val rows = table.rows.ifEmpty { listOf(table.header) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Column(
                Modifier
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                    .background(color.copy(alpha = 0.05f))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                row.forEachIndexed { index, cell ->
                    if (cell.isBlank()) return@forEachIndexed
                    if (index == 0) {
                        Text(inline(cell), style = SType.bodyStrong, color = color)
                    } else {
                        val label = table.header.getOrNull(index)?.takeIf { table.rows.isNotEmpty() && it.isNotBlank() }
                        Text(
                            inline(if (label != null) "**$label:** $cell" else cell),
                            style = SType.small,
                            color = color.copy(alpha = 0.85f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LineBlock(line: String, color: Color) {
    val trimmed = line.trimStart()
    when {
        trimmed.isEmpty() -> Box(Modifier.size(2.dp))
        trimmed.startsWith("#") -> Text(inline(trimmed.trimStart('#').trim()), style = SType.bodyStrong, color = color)
        trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ") -> Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(start = if (line.length - trimmed.length >= 2) 14.dp else 0.dp),
        ) {
            Box(
                Modifier
                    .padding(top = 8.dp)
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.6f)),
            )
            Text(inline(trimmed.drop(2)), style = SType.body, color = color)
        }
        else -> Text(inline(trimmed), style = SType.body, color = color)
    }
}

/** `**bold**` becomes bold; the markers themselves are dropped. */
private fun inline(text: String): AnnotatedString = buildAnnotatedString {
    val parts = text.split("**")
    parts.forEachIndexed { index, part ->
        if (index % 2 == 1 && index < parts.lastIndex) {
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(part) }
        } else {
            append(part)
        }
    }
}
