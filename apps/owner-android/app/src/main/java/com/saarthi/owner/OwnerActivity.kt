package com.saarthi.owner

import android.os.Bundle
import com.saarthi.owner.push.Push
import android.content.Context
import android.content.Intent
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
import com.saarthi.owner.ui.common.Language
import com.saarthi.owner.ui.common.Words
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

    /** The chosen language, before anything reads a resource. */
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(Language.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Words outside a screen (messages, notifications) in the language just chosen.
        Words.bind(this)
        enableEdgeToEdge()
        val app = application as OwnerApp
        // Rebuilt in place (a new language, say): still unlocked if it was, rather than asking again.
        locked = savedInstanceState?.getBoolean(KEY_LOCKED) ?: shouldLock(app)
        // Opened from a push: the screen it is about opens once signed in (and unlocked).
        Push.openLink(intent?.getStringExtra(EXTRA_LINK))
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Push.openLink(intent.getStringExtra(EXTRA_LINK))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(KEY_LOCKED, locked)
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

    companion object {
        /** The link a push notification opens, as an alert's `actionUrl`. */
        const val EXTRA_LINK = "saarthi.link"

        /** A glance at another app does not lock; a minute away does. */
        private const val RELOCK_AFTER_MS = 60_000L

        private const val KEY_LOCKED = "locked"
    }
}
