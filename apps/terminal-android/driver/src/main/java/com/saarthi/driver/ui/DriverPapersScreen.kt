package com.saarthi.driver.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.OfflinePin
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.saarthi.core.network.DriverPaperDto
import com.saarthi.core.ui.TerminalViewModel
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.ui.design.AlertRed
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.CautionAmber
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.CircleAction
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetNotice
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.IconChip
import com.saarthi.driver.ui.design.LiveGreen
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.StatusPill
import com.saarthi.driver.ui.design.pressable

/**
 * The papers, ready for somebody who has asked to see them.
 *
 * This screen exists for one situation: an officer at a state border, a mine
 * gate or a bypass check post, at an hour and a place where the phone has no
 * signal. That is not an edge case — it is disproportionately *where* papers
 * get asked for, and it is precisely where a link to a web page fails.
 *
 * So everything here is designed around the cache rather than the network:
 *
 *  * Each paper says whether it is **on this phone**. A driver can see, before
 *    they need it, whether they are covered — which is the only moment the
 *    information is any use.
 *  * The list refreshes when there is a signal and never blocks on one. An old
 *    list of cached papers beats a spinner.
 *  * Expiry is the sort order and the loudest thing on each row, because an
 *    expired certificate produced confidently is worse than a missing one.
 */
@Composable
fun DriverPapersScreen(
    cockpit: TerminalViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as SaarthiDriverApp
    val papers by cockpit.papers.collectAsState()
    // Observed, so a row flips to "on this phone" the moment its download
    // lands rather than only after the screen is reopened.
    val cached by app.papers.cached.collectAsState()
    val problem by cockpit.papersProblem.collectAsState()
    var notice by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { cockpit.loadPapers() }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        FleetEnter(index = 0) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
            ) {
                CircleAction(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        "Your papers",
                        style = MaterialTheme.typography.titleLarge,
                        color = Chalk,
                    )
                    Text(
                        "Kept on this phone, so a check post with no signal is not a problem.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate,
                    )
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.base))

        (notice ?: problem)?.let {
            FleetNotice(message = it, tint = CautionAmber)
            Spacer(Modifier.height(FleetSpace.snug))
        }

        if (papers.isEmpty()) {
            FleetEnter(index = 1) {
                FleetCard(Modifier.fillMaxWidth()) {
                    SectionHeader("Nothing here yet")
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        "Your fleet has not uploaded any papers for this vehicle or for " +
                            "you. Ask the office to add the RC, insurance, permit and PUC — " +
                            "they will appear here and stay available offline.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ash,
                    )
                }
            }
            return@FleetScreen
        }

        // `let` rather than a smart cast: `daysToExpiry` crosses a module
        // boundary, so Kotlin will not narrow it from a null check alone.
        val expiring = papers.count { paper ->
            paper.daysToExpiry?.let { it <= EXPIRY_WARN_DAYS } == true
        }
        if (expiring > 0) {
            FleetEnter(index = 1) {
                Column {
                    FleetNotice(
                        message = if (expiring == 1) {
                            "One paper needs attention. Tell the office before it lapses."
                        } else {
                            "$expiring papers need attention. Tell the office before they lapse."
                        },
                        tint = AlertRed,
                    )
                    Spacer(Modifier.height(FleetSpace.snug))
                }
            }
        }

        papers.forEachIndexed { index, paper ->
            FleetEnter(index = (index + 2).coerceAtMost(6)) {
                Column {
                    PaperRow(
                        paper = paper,
                        cached = paper.id in cached,
                        onOpen = {
                            val file = app.papers.fileFor(paper.id, paper.mimeType)
                            if (!file.exists() || file.length() == 0L) {
                                notice = "That one is not on this phone yet. " +
                                    "Open it once where there is a signal and it will stay."
                                cockpit.loadPapers()
                            } else {
                                openPaper(context, file, paper.mimeType) { problem ->
                                    notice = problem
                                }
                            }
                        },
                    )
                    Spacer(Modifier.height(FleetSpace.tight))
                }
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

@Composable
private fun PaperRow(
    paper: DriverPaperDto,
    cached: Boolean,
    onOpen: () -> Unit,
) {
    val days = paper.daysToExpiry
    val tint = when {
        days == null -> Slate
        days < 0 -> AlertRed
        days <= EXPIRY_WARN_DAYS -> CautionAmber
        else -> LiveGreen
    }

    FleetCard(Modifier.fillMaxWidth().pressable(onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconChip(icon = Icons.Rounded.Description)
            Spacer(Modifier.width(FleetSpace.snug))
            Column(Modifier.weight(1f)) {
                Text(
                    paper.title ?: paper.documentType.humanised(),
                    style = MaterialTheme.typography.titleSmall,
                    color = Chalk,
                    maxLines = 2,
                )
                Text(
                    listOfNotNull(
                        if (paper.ownerType == "DRIVER") "Yours" else "Vehicle",
                        paper.number,
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate,
                    maxLines = 1,
                )
            }
            /*
             * Whether it is on the phone, stated on every row.
             *
             * The single most useful fact here, and the one a driver needs
             * *before* the barrier rather than at it.
             */
            IconChip(
                icon = if (cached) Icons.Rounded.OfflinePin else Icons.Rounded.CloudOff,
                tinted = cached,
            )
        }

        Spacer(Modifier.height(FleetSpace.snug))

        StatusPill(
            label = when {
                days == null -> "No expiry recorded"
                days < 0 -> "Expired ${-days} day(s) ago"
                days == 0 -> "Expires today"
                else -> "$days day(s) left"
            },
            tint = tint,
        )
    }
}

/**
 * Hand the file to whatever can read it.
 *
 * Through a `FileProvider` rather than a `file://` URI: the papers live in the
 * app's private storage precisely so no other app can browse them, and a
 * content URI grants one reader access to one file for as long as the intent
 * lives. A `file://` URI would both crash on modern Android and defeat the
 * reason for keeping them private.
 */
private fun openPaper(
    context: android.content.Context,
    file: java.io.File,
    mimeType: String?,
    onProblem: (String) -> Unit,
) {
    val uri = runCatching {
        FileProvider.getUriForFile(context, "${context.packageName}.papers", file)
    }.getOrNull()

    if (uri == null) {
        onProblem("Saarthi could not open that file.")
        return
    }

    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType ?: "application/pdf")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    runCatching { context.startActivity(intent) }.onFailure {
        // A phone with no PDF reader. Saying so is better than nothing
        // happening, which reads as the app being broken.
        onProblem("No app on this phone can open that. Install a PDF reader.")
    }
}

/** `INSURANCE_CERTIFICATE` reads badly on a card; "Insurance certificate" does not. */
private fun String.humanised(): String =
    lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }


/** A month's notice. Long enough to get a certificate renewed in India. */
private const val EXPIRY_WARN_DAYS = 30
