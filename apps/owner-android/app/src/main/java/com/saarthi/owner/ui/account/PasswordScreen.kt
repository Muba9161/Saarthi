package com.saarthi.owner.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.network.AccountApi
import com.saarthi.owner.ui.common.DetailScreen
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.SaarthiField
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The server's password rules (`passwordSchema`), each as the line that shows it is met — read afresh, in the app's language. */
private val RULES: List<Pair<String, (String) -> Boolean>>
    get() = listOf(
        Words.get(R.string.people_password_rule_length) to { it.length in 10..128 },
        Words.get(R.string.people_password_rule_lower) to { p -> p.any { it.isLowerCase() } },
        Words.get(R.string.people_password_rule_upper) to { p -> p.any { it.isUpperCase() } },
        Words.get(R.string.people_password_rule_number) to { p -> p.any { it.isDigit() } },
    )

/**
 * A new password, as the web's security step changes it: the current one, the
 * new one twice. Every other signed-in phone and browser is signed out by the
 * server; this one stays in.
 */
@Composable
internal fun PasswordScreen(accountApi: AccountApi, onChanged: () -> Unit) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }

    val rulesMet = RULES.all { (_, met) -> met(new) }
    val matches = new.isNotEmpty() && new == again
    val different = new != current
    val ready = current.isNotEmpty() && rulesMet && matches && different

    DetailScreen(
        eyebrow = stringResource(R.string.people_account_security),
        title = stringResource(R.string.people_account_change_password),
        footer = {
            problem?.let { NoticeCard(it, NoticeTone.DANGER) }
            if (done) {
                NoticeCard(stringResource(R.string.people_password_changed), NoticeTone.SUCCESS)
            } else {
                SaarthiButton(
                    stringResource(R.string.people_account_change_password),
                    onClick = {
                        busy = true
                        problem = null
                        scope.launch {
                            try {
                                accountApi.changePassword(current, new)
                                done = true
                                onChanged()
                            } catch (failure: Exception) {
                                if (failure is CancellationException) throw failure
                                problem = failure.readable()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = ready && !busy,
                    busy = busy,
                    busyText = stringResource(R.string.people_password_changing),
                )
            }
        },
    ) {
        PasswordField(stringResource(R.string.people_password_current), current) { current = it }
        PasswordField(stringResource(R.string.people_password_new), new) { new = it }
        RULES.forEach { (rule, met) ->
            val ok = met(new)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LineIcon(if (ok) Lucide.check else Lucide.close, size = 14.dp, color = if (ok) c.success else c.subtle)
                Text(rule, style = SType.small, color = if (ok) c.fg else c.muted)
            }
        }
        PasswordField(stringResource(R.string.people_password_again), again) { again = it }
        when {
            again.isNotEmpty() && !matches -> Text(stringResource(R.string.people_password_mismatch), style = SType.small, color = c.danger)
            new.isNotEmpty() && !different -> Text(stringResource(R.string.people_password_same), style = SType.small, color = c.danger)
        }
    }
}

@Composable
private fun PasswordField(label: String, value: String, onChange: (String) -> Unit) {
    SaarthiField(
        value = value,
        onValueChange = { onChange(it.take(128)) },
        label = label,
        leading = Lucide.lock,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
    )
}
