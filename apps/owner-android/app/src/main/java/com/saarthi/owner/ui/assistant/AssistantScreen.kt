package com.saarthi.owner.ui.assistant

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AssistantApi
import com.saarthi.owner.ui.common.HeaderContentHeight
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.ChoiceChip
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.shell.LocalNavigator
import kotlinx.coroutines.launch
import java.time.LocalTime

/** Questions worth asking, by the kind of business asking them. */
private fun suggestionsFor(type: AccountType): List<String> = when (type) {
    AccountType.FLEET -> listOf("What needs my attention today?", "Which trucks are idle?", "Papers due this month", "Fuel spend this week")
    AccountType.TRAVEL -> listOf("What's on today?", "Which vehicles are free?", "Papers due this month")
    AccountType.CUSTOMER -> listOf("Where are my orders?", "What have I spent this month?")
    AccountType.SELLER -> listOf("Which orders are waiting for payment?", "What is low on stock?")
    AccountType.PERSONAL -> listOf("Which papers expire soon?", "When is my next service?")
    else -> listOf("What needs my attention today?")
}

/**
 * "Ask Saarthi" — the design's assistant, answering from the business's own
 * records. Typed, or asked out loud: the mic asks for the microphone only
 * when it is tapped, and an answer to a spoken question is read back. The
 * blob is Saarthi itself — rippling while idle, and following the voice as
 * it listens and speaks.
 */
@Composable
fun AssistantScreen(assistant: AssistantApi, account: SessionStore.Account) {
    val c = Saarthi.colors
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val turns = remember { mutableStateListOf<AssistantApi.Turn>() }
    var conversationId by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var thinking by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val context = LocalContext.current
    val voice = rememberVoiceInput()
    /** Whether the question being answered was spoken — then the answer is spoken too. */
    var byVoice by remember { mutableStateOf(false) }

    LaunchedEffect(turns.size, thinking) {
        if (turns.isNotEmpty()) list.animateScrollToItem(turns.size + if (thinking) 1 else 0)
    }

    fun ask(question: String, spoken: Boolean = false) {
        val text = question.trim()
        if (text.length < 2 || thinking) return
        val history = turns.toList()
        turns.add(AssistantApi.Turn("user", text))
        draft = ""
        thinking = true
        byVoice = spoken
        error = null
        voice.stopSpeaking()
        scope.launch {
            try {
                val reply = assistant.ask(text, history, conversationId)
                conversationId = reply?.conversationId ?: conversationId
                val answer = reply?.answer?.ifBlank { null } ?: "I couldn't find an answer to that in your records."
                turns.add(AssistantApi.Turn("assistant", answer))
                if (spoken) voice.speak(answer)
            } catch (failure: Exception) {
                error = failure.readable()
            }
            thinking = false
        }
    }

    fun listen() {
        if (!voice.available) {
            error = "This phone has no speech recogniser. You can type the question instead."
            return
        }
        error = null
        voice.listen { heard -> ask(heard, spoken = true) }
    }

    val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) listen() else error = "Saarthi needs the microphone to hear you. You can still type the question."
    }

    fun startVoice() {
        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (allowed) listen() else microphone.launch(Manifest.permission.RECORD_AUDIO)
    }

    val voiceState = when {
        voice.listening -> VoiceState.LISTENING
        thinking && byVoice -> VoiceState.THINKING
        voice.speaking -> VoiceState.SPEAKING
        else -> VoiceState.IDLE
    }
    val voiceActive = voiceState != VoiceState.IDLE

    val greeting = when (LocalTime.now().hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .imePadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().height(HeaderContentHeight).padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircleButton(Lucide.chevronLeft, "Back", navigator::pop, size = 44.dp)
            Column(Modifier.weight(1f)) {
                Eyebrow("From your own records")
                Text("Ask Saarthi", style = SType.headerTitle, color = c.fg)
            }
        }

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = list,
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item(key = "hello") {
                Row(Modifier.rise(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    SaarthiBlob(
                        if (thinking) VoiceState.THINKING else VoiceState.IDLE,
                        amplitude = 0f,
                        diameter = 56.dp,
                    )
                    Column {
                        Text("$greeting, ${account.firstName}", style = SType.cardTitle, color = c.fg)
                        Text("Ask about vehicles, trips, papers or money.", style = SType.small, color = c.muted)
                    }
                }
            }
            itemsIndexed(turns, key = { index, _ -> index }) { _, turn ->
                if (turn.role == "user") {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                        Box(
                            Modifier
                                .widthIn(max = 290.dp)
                                .clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp))
                                .background(c.primary)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            Text(turn.content, style = SType.body, color = c.onPrimary)
                        }
                    }
                } else {
                    Box(Modifier.fillMaxWidth().card(radius = 22.dp).padding(18.dp)) {
                        MarkdownText(turn.content, color = c.fg)
                    }
                }
            }
            if (thinking) {
                item(key = "thinking") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        RingSpinner(track = c.track, head = c.primary, size = 20.dp, stroke = 2.5.dp)
                        Text("Looking through your records…", style = SType.small, color = c.muted)
                    }
                }
            }
            (error ?: voice.problem)?.let { message -> item(key = "error") { NoticeCard(message, NoticeTone.WARNING) } }
        }

        if (voiceActive) {
            // Saarthi, listening, thinking or talking: tap it to stop.
            Column(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SaarthiBlob(
                    voiceState,
                    voice.amplitude,
                    Modifier.pressable(scale = 0.96f, label = "Stop") {
                        voice.stopListening()
                        voice.stopSpeaking()
                    },
                    diameter = 132.dp,
                )
                Text(
                    when (voiceState) {
                        VoiceState.LISTENING -> voice.heard.ifBlank { "Listening…" }
                        VoiceState.THINKING -> "Looking through your records…"
                        else -> "Tap Saarthi to stop"
                    },
                    style = SType.bodyStrong,
                    color = c.fg,
                    maxLines = 2,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
        } else if (turns.isEmpty()) {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow("Try asking")
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    suggestionsFor(account.accountType).forEach { suggestion ->
                        ChoiceChip(suggestion, selected = false, onClick = { ask(suggestion) })
                    }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .weight(1f)
                    .height(56.dp)
                    .card(radius = 28.dp, color = c.elevated)
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (draft.isEmpty()) Text("Ask about your business…", style = SType.body, color = c.subtle)
                BasicTextField(
                    value = draft,
                    onValueChange = { draft = it.take(2000) },
                    textStyle = SType.body.copy(color = c.fg),
                    cursorBrush = SolidColor(c.primary),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { ask(draft) }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            // An empty box offers the mic; typing turns it into Send.
            val typed = draft.trim().length >= 2
            val canSpeak = draft.isBlank() && !thinking
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(if ((typed && !thinking) || canSpeak) c.primary else c.sunken)
                    .pressable(
                        enabled = (typed && !thinking) || canSpeak,
                        label = when {
                            voice.listening -> "Stop listening"
                            canSpeak -> "Ask out loud"
                            else -> "Send"
                        },
                    ) {
                        when {
                            voice.listening -> voice.stopListening()
                            canSpeak -> startVoice()
                            else -> ask(draft)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                LineIcon(
                    when {
                        voice.listening -> Lucide.stop
                        canSpeak -> Lucide.mic
                        else -> Lucide.send
                    },
                    size = 20.dp,
                    color = if ((typed && !thinking) || canSpeak) c.onPrimary else c.muted,
                )
            }
        }
    }
}
