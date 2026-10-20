package com.saarthi.owner.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.saarthi.owner.BuildConfig
import com.saarthi.owner.R
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Push notifications, through Firebase Cloud Messaging.
 *
 * Set up from the build's Firebase settings rather than google-services.json,
 * so a build with none still runs, with push off. After sign-in the phone's
 * token is given to Saarthi; on sign-out it is taken back, so the next person
 * to sign in on the phone never gets the last one's news.
 */
object Push {

    const val CHANNEL_URGENT = "urgent"
    const val CHANNEL_UPDATES = "updates"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** A link from a tapped notification, waiting for the signed-in screens to open it. */
    private val _pendingLink = MutableStateFlow<String?>(null)
    val pendingLink: StateFlow<String?> = _pendingLink.asStateFlow()

    fun openLink(link: String?) {
        if (!link.isNullOrBlank()) _pendingLink.value = link
    }

    fun consumeLink() {
        _pendingLink.value = null
    }

    /** True once Firebase is set up; false in a build with no Firebase settings. */
    var enabled = false
        private set

    fun start(context: Context) {
        if (BuildConfig.FIREBASE_APP_ID.isBlank() || BuildConfig.FIREBASE_PROJECT_ID.isBlank()) return
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        createChannels(context)
        enabled = true
    }

    private fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_URGENT, Words.get(R.string.net_push_channel_urgent), NotificationManager.IMPORTANCE_HIGH).apply {
                description = Words.get(R.string.net_push_channel_urgent_about)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, Words.get(R.string.net_push_channel_updates), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = Words.get(R.string.net_push_channel_updates_about)
            },
        )
    }

    /** Give Saarthi this phone's token for the signed-in person. */
    suspend fun register(api: OwnerApi) {
        if (!enabled) return
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
        send(api, "/notifications/devices", token)
    }

    /** A new token from Firebase while signed in: hand it over in the background. */
    fun tokenChanged(api: OwnerApi, token: String) {
        scope.launch { runCatching { send(api, "/notifications/devices", token) } }
    }

    /** Before signing out: this phone stops getting this person's pushes. */
    suspend fun unregister(api: OwnerApi) {
        if (!enabled) return
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull() ?: return
        runCatching { send(api, "/notifications/devices/remove", token) }
    }

    private suspend fun send(api: OwnerApi, path: String, token: String) {
        api.post(path, buildJsonObject { put("token", token) }.toString(), JsonObject.serializer())
    }

    private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { waiting ->
        addOnSuccessListener { waiting.resume(it) }
        addOnFailureListener { waiting.resumeWithException(it) }
    }
}
