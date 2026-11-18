package com.saarthi.driver.ui.lock

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
import com.saarthi.driver.R
import com.saarthi.driver.ui.design.AlwaysDark
import com.saarthi.driver.ui.design.BrandSpinner
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger

/*
 * App lock, the same as the owner app's.
 *
 * Fingerprint, face or the phone's own screen lock, whichever the driver has
 * set up. Humsafar never sees any of them: Android checks and answers yes or
 * no. It guards the screen, not the credential, which stays in encrypted
 * storage so the app can open instantly and restore the session silently.
 */
private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

/**
 * Whether the driver has passed App lock in this process.
 *
 * Kept for the life of the process, never in an activity's saved state. A saved
 * "unlocked" outlived Android killing Humsafar in the background: the activity
 * was rebuilt from it and opened without asking, and the one-minute relock
 * could not fire either, because its clock restarted at zero in the new
 * process. A new process now always asks; a language change, which rebuilds
 * the activity in the same process, does not.
 */
object AppLockSession {
    @Volatile
    var unlocked: Boolean = false
}

/** Whether this phone can lock the app at all: something must be enrolled. */
fun canLockApp(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

/**
 * Ask Android to confirm it is the driver. [onResult] is false for a cancel as
 * well as a failure, because backing out is a decision, not an error.
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
 * Humsafar, locked: the logo in its brand ring and one way in. The prompt opens
 * by itself on arrival, and again from the button after a cancel.
 */
@Composable
fun LockScreen(onUnlocked: () -> Unit) = AlwaysDark {
    val c = Saarthi.colors
    val context = LocalContext.current
    val promptTitle = stringResource(R.string.biometric_unlock_title)
    val promptSubtitle = stringResource(R.string.lock_prompt_subtitle)
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
            Text(stringResource(R.string.lock_locked), style = SType.sheetTitle, color = c.fg, modifier = Modifier.rise(stagger(1)))
            Text(
                stringResource(R.string.unlock_lead),
                style = SType.body,
                color = c.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.rise(stagger(2)),
            )
            SaarthiButton(
                stringResource(R.string.lock_unlock),
                onClick = ask,
                leading = Lucide.fingerprint,
                modifier = Modifier.rise(stagger(3)),
            )
        }
    }
}
