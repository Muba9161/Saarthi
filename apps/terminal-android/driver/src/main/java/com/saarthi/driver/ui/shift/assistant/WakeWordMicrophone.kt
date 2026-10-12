package com.saarthi.driver.ui.shift.assistant

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

/**
 * Whether "Hey Saarthi" can be listened for: switched on, and the microphone
 * allowed.
 *
 * With the phrase on, the microphone is asked for once when the shift opens —
 * in context, on the screen where it is used, rather than on a sign-in screen
 * where a driver cannot tell what it is for. Asked once: a driver who refuses
 * is not asked again on every visit, and can still tap the microphone in the
 * assistant, which asks for itself. Looked at again whenever the app comes back
 * to the front, so allowing it in the phone's Settings takes effect without a
 * restart.
 */
@Composable
internal fun rememberWakeWordMicrophone(wakeWord: Boolean): Boolean {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var granted by remember { mutableStateOf(context.microphoneAllowed()) }
    var asked by rememberSaveable { mutableStateOf(false) }

    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        granted = allowed
    }

    LaunchedEffect(wakeWord) {
        if (wakeWord && !granted && !asked) {
            asked = true
            request.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) granted = context.microphoneAllowed()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    return wakeWord && granted
}

internal fun Context.microphoneAllowed(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
