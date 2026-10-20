package com.saarthi.owner.ui.lock

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.saarthi.owner.R
import com.saarthi.owner.ui.design.AlwaysDark
import com.saarthi.owner.ui.design.BrandSpinner
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.SaarthiButton
import com.saarthi.owner.ui.design.rise
import com.saarthi.owner.ui.design.stagger

/**
 * Fingerprint, face, or the phone's own screen lock — whichever the person
 * has set up. Saarthi never sees any of them: Android checks, and answers
 * yes or no.
 */
private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

/** Whether this phone can lock the app at all: something must be enrolled. */
fun canLockApp(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

/**
 * Ask Android to confirm it is the person. [onResult] is false for a cancel
 * as well as a failure — backing out is a decision, not an error.
 */
fun confirmPerson(context: Context, title: String, subtitle: String, onResult: (Boolean) -> Unit) {
    val activity = context as? FragmentActivity ?: return onResult(false)
    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onResult(true)
            override fun onAuthenticationError(code: Int, message: CharSequence) = onResult(false)
        },
    )
    // No negative button: with the screen lock allowed, Android provides the way out.
    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build(),
    )
}

/**
 * The app, locked: the logo in its brand ring and one way in. The prompt
 * opens by itself on arrival, and again from the button after a cancel.
 */
@Composable
fun LockScreen(onUnlocked: () -> Unit) = AlwaysDark {
    val c = Saarthi.colors
    val context = LocalContext.current
    val promptTitle = stringResource(R.string.people_lock_prompt_title)
    val promptSubtitle = stringResource(R.string.people_lock_prompt_subtitle)
    val ask = {
        confirmPerson(context, promptTitle, promptSubtitle) { ok ->
            if (ok) onUnlocked()
        }
    }
    LaunchedEffect(Unit) { ask() }
    Box(Modifier.fillMaxSize().background(c.canvas), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            BrandSpinner(size = 136.dp)
            Text(stringResource(R.string.people_lock_locked), style = SType.sheetTitle, color = c.fg, modifier = Modifier.rise(stagger(1)))
            Text(
                stringResource(R.string.people_lock_body),
                style = SType.body,
                color = c.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(2)),
            )
            SaarthiButton(stringResource(R.string.people_lock_unlock), onClick = ask, leading = Lucide.fingerprint, modifier = Modifier.rise(stagger(3)))
        }
    }
}
