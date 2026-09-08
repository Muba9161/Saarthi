package com.saarthi.driver.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AlternateEmail
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.BrandHero
import com.saarthi.driver.ui.design.BrandWordmark
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.EmberBright
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetField
import com.saarthi.driver.ui.design.FleetMotion
import com.saarthi.driver.ui.design.FleetPasswordField
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.stillOr

/**
 * Signing in, once.
 *
 * The screen a driver should see exactly one time. Everything after this — the
 * thirty-day refresh token, the silent exchange on launch, Quick Login — exists
 * so that they never come back here, because a driver asked for an email
 * address and a password at five in the morning in a yard will stop using the
 * app, and an app nobody opens reports nothing.
 *
 * Registration is on the same screen rather than behind a link. A driver who has
 * just been told to download Saarthi does not know which of the two they are,
 * and a wrong guess on a sign-in screen reads as a rejection. The two modes
 * share one form and one button; the extra fields expand into place rather than
 * replacing the screen, so the driver never loses what they had already typed.
 *
 * This is also the only screen in the app that is allowed to be atmospheric.
 * It is where somebody decides whether the thing they just installed is real.
 */
@Composable
fun SignInScreen(viewModel: DriverViewModel) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()

    var creating by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }

    val canSubmit = email.isNotBlank() && password.length >= MIN_PASSWORD &&
        (!creating || (firstName.isNotBlank() && lastName.isNotBlank()))

    /*
     * The password rule, shown as it becomes relevant.
     *
     * Not on an untouched field — a red hint under an empty box on the screen
     * that decides whether somebody trusts the app reads as a rejection before
     * they have done anything. It appears once they have started typing, which
     * is the moment it becomes useful rather than discouraging.
     */
    val passwordHint = when {
        password.isEmpty() -> null
        password.length < MIN_PASSWORD ->
            "$MIN_PASSWORD characters or more. ${password.length} so far."
        else -> null
    }

    FleetScreen(horizontalPadding = 0.dp) {
        BrandHero()

        Column(Modifier.padding(horizontal = FleetSpace.roomy)) {
            Spacer(Modifier.height(FleetSpace.roomy))

            FleetEnter(index = 0) {
                BrandWordmark(Modifier.fillMaxWidth())
            }

            Spacer(Modifier.height(FleetSpace.roomy))

            FleetEnter(index = 1) {
                Column(Modifier.fillMaxWidth()) {
                    Text(
                        if (creating) "Create your account" else "Your shift starts here",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Chalk,
                    )
                    Spacer(Modifier.height(FleetSpace.tight))
                    Text(
                        if (creating) {
                            "You will only do this once. Your fleet connects you to a " +
                                "vehicle after you scan it."
                        } else {
                            "Sign in once and Saarthi will remember you. No password in " +
                                "a yard at five in the morning."
                        },
                        style = MaterialTheme.typography.bodyLarge,
                        color = Ash,
                    )
                }
            }

            Spacer(Modifier.height(FleetSpace.section))

            FleetEnter(index = 2) {
                FleetCard(Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(FleetSpace.snug)) {
                        /*
                         * The name and telephone fields, expanded rather than swapped.
                         *
                         * A driver who taps "create an account" having already typed
                         * their email must not lose it, and a screen that rebuilds
                         * itself around them is a screen that has lost their place.
                         */
                        AnimatedVisibility(
                            visible = creating,
                            enter = fadeIn(FleetMotion.enter(stillOr(FleetMotion.QUICK))) +
                                expandVertically(FleetMotion.settle()),
                            exit = fadeOut(FleetMotion.enter(stillOr(FleetMotion.EXIT))) +
                                shrinkVertically(FleetMotion.settle()),
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(FleetSpace.snug)) {
                                FleetField(
                                    value = firstName,
                                    onValueChange = { firstName = it },
                                    label = "First name",
                                    leadingIcon = Icons.Rounded.Badge,
                                    keyboardOptions = KeyboardOptions(
                                        capitalization = androidx.compose.ui.text.input
                                            .KeyboardCapitalization.Words,
                                        imeAction = ImeAction.Next,
                                    ),
                                )
                                FleetField(
                                    value = lastName,
                                    onValueChange = { lastName = it },
                                    label = "Last name",
                                    keyboardOptions = KeyboardOptions(
                                        capitalization = androidx.compose.ui.text.input
                                            .KeyboardCapitalization.Words,
                                        imeAction = ImeAction.Next,
                                    ),
                                )
                                FleetField(
                                    value = phone,
                                    onValueChange = { phone = it },
                                    label = "Mobile number",
                                    placeholder = "Optional",
                                    leadingIcon = Icons.Rounded.Phone,
                                    keyboardOptions = KeyboardOptions(
                                        keyboardType = KeyboardType.Phone,
                                        imeAction = ImeAction.Next,
                                    ),
                                )
                                Spacer(Modifier.height(FleetSpace.hair))
                            }
                        }

                        FleetField(
                            value = email,
                            onValueChange = { email = it },
                            label = "Email",
                            leadingIcon = Icons.Rounded.AlternateEmail,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Email,
                                autoCorrectEnabled = false,
                                imeAction = ImeAction.Next,
                            ),
                        )

                        FleetPasswordField(
                            value = password,
                            onValueChange = { password = it },
                            label = "Password",
                            supportingText = passwordHint,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                        )
                    }
                }
            }

            error?.let { message ->
                Spacer(Modifier.height(FleetSpace.snug))
                FleetError(message)
            }

            Spacer(Modifier.height(FleetSpace.roomy))

            FleetEnter(index = 3) {
                FleetButton(
                    label = if (creating) "Create account" else "Sign in",
                    busyLabel = if (creating) "Creating your account…" else "Signing you in…",
                    busy = busy,
                    enabled = canSubmit,
                    onClick = {
                        if (creating) {
                            viewModel.register(
                                DriverApi.RegisterRequest(
                                    email = email.trim(),
                                    password = password,
                                    firstName = firstName.trim(),
                                    lastName = lastName.trim(),
                                    phone = phone.trim().ifBlank { null },
                                ),
                            )
                        } else {
                            viewModel.signIn(email, password)
                        }
                    },
                )
            }

            Spacer(Modifier.height(FleetSpace.base))

            /*
             * The other door, as a sentence rather than a second button.
             *
             * Two full-width buttons on this screen would give a driver two
             * things that look equally like the way forward. A question with a
             * highlighted answer reads as what it is: the case that does not
             * apply to most people opening this.
             */
            Row(
                Modifier
                    .fillMaxWidth()
                    .pressable(enabled = !busy) {
                        creating = !creating
                        viewModel.clearError()
                    }
                    .padding(vertical = FleetSpace.base),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (creating) "Already have an account? " else "New to Saarthi? ",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ash,
                )
                Text(
                    if (creating) "Sign in" else "Create an account",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = EmberBright,
                )
            }

            Spacer(Modifier.height(FleetSpace.base))
        }
    }
}

/** Matches the server's own floor, so a rejection never arrives after typing. */
private const val MIN_PASSWORD = 8
