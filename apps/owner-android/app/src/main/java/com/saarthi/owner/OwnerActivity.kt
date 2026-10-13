package com.saarthi.owner

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.ui.OwnerRoot
import com.saarthi.owner.ui.design.SaarthiTheme

class OwnerActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as OwnerApp
        // The phone's own "remove animations" switch, which the design honours everywhere.
        val reducedMotion = runCatching {
            Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)

        setContent {
            val appearance by app.preferences.appearance.collectAsStateWithLifecycle()
            SaarthiTheme(appearance = appearance, reducedMotion = reducedMotion) {
                OwnerRoot(app)
            }
        }
    }
}
