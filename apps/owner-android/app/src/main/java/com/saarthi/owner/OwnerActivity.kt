package com.saarthi.owner

import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.ui.OwnerRoot
import com.saarthi.owner.ui.design.SaarthiTheme
import com.saarthi.owner.ui.lock.LockScreen

/**
 * A `FragmentActivity` rather than a `ComponentActivity` for one reason: the
 * system biometric prompt behind App lock attaches to a fragment manager.
 */
class OwnerActivity : FragmentActivity() {

    /** Locked until the person proves it is them — only while App lock is on and somebody is signed in. */
    private var locked by mutableStateOf(false)

    /** When the app last went to the background, to lock again after a while away. */
    private var backgroundedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as OwnerApp
        locked = shouldLock(app)
        // The phone's own "remove animations" switch, which the design honours everywhere.
        val reducedMotion = runCatching {
            Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)

        setContent {
            val appearance by app.preferences.appearance.collectAsStateWithLifecycle()
            SaarthiTheme(appearance = appearance, reducedMotion = reducedMotion) {
                if (locked) LockScreen(onUnlocked = { locked = false }) else OwnerRoot(app)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        backgroundedAt = SystemClock.elapsedRealtime()
    }

    override fun onStart() {
        super.onStart()
        val away = SystemClock.elapsedRealtime() - backgroundedAt
        if (backgroundedAt > 0 && away > RELOCK_AFTER_MS && shouldLock(application as OwnerApp)) locked = true
    }

    private fun shouldLock(app: OwnerApp): Boolean =
        app.preferences.appLock.value && app.session.account.value != null

    private companion object {
        /** A glance at another app does not lock; a minute away does. */
        const val RELOCK_AFTER_MS = 60_000L
    }
}
