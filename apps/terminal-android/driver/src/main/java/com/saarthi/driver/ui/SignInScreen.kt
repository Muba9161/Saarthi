package com.saarthi.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import com.saarthi.core.R
import com.saarthi.core.ui.SolidCard
import com.saarthi.core.ui.TerminalPage
import com.saarthi.driver.network.DriverApi

/**
 * Signing in, once.
 *
 * The screen a driver should see exactly one time. Everything after this — the
 * thirty-day refresh token, the silent exchange on launch — exists so that they
 * never come back here, because a driver asked for an email address and a
 * password at five in the morning in a yard will stop using the app, and an app
 * nobody opens reports nothing.
 *
 * Registration is on the same screen rather than behind a link. A driver who has
 * just been told to download Saarthi does not know which of the two they are,
 * and a wrong guess on a sign-in screen reads as a rejection.
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

    TerminalPage {
        /*
         * The mark, then the words.
         *
         * This screen was a heading and two bare fields, which is the one place
         * a driver decides whether the thing they just installed is real. It is
         * also the only screen most of them will ever see twice, so it carries
         * the brand the same way the cockpit does.
         */
        Spacer(Modifier.height(24.dp))

        Surface(
            shape = RoundedCornerShape(24.dp),
            color = Color.White,
            shadowElevation = 6.dp,
            modifier = Modifier.size(88.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.saarthi_mark),
                contentDescription = null,
                modifier = Modifier.fillMaxSize().padding(14.dp),
            )
        }

        Spacer(Modifier.height(20.dp))

        Text(
            "Saarthi",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            if (creating) {
                "Create your driver account. You will only do this once."
            } else {
                "Sign in once. Saarthi will remember you."
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(24.dp))

        SolidCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (creating) {
                OutlinedTextField(
                    value = firstName,
                    onValueChange = { firstName = it },
                    label = { Text("First name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = lastName,
                    onValueChange = { lastName = it },
                    label = { Text("Last name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Mobile number") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        }

        error?.let { message ->
            Spacer(Modifier.height(12.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Spacer(Modifier.height(20.dp))

        Button(
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
            enabled = canSubmit && !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.height(18.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(if (creating) "Create account" else "Sign in")
            }
        }

        Spacer(Modifier.height(8.dp))

        TextButton(
            onClick = {
                creating = !creating
                viewModel.clearError()
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (creating) {
                    "I already have an account"
                } else {
                    "New to Saarthi? Create an account"
                },
            )
        }
    }
}

/** Matches the server's own floor, so a rejection never arrives after typing. */
private const val MIN_PASSWORD = 8
