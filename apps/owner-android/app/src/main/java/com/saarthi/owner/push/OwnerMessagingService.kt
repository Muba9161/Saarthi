package com.saarthi.owner.push

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.saarthi.owner.OwnerActivity
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R

/**
 * What arrives from Firebase: a new token to hand to Saarthi, or a message to
 * show. Messages carry data only, so every notification is drawn here — the
 * same look, and the same screen on a tap, whether the app was open or not.
 */
class OwnerMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val app = application as OwnerApp
        if (app.session.account.value != null) Push.tokenChanged(app.api, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: return
        val urgent = data["priority"] == "CRITICAL" || data["priority"] == "HIGH"
        // Signed out on this phone since: the news is not for whoever holds it now.
        if ((application as OwnerApp).session.account.value == null) return

        val open = Intent(this, OwnerActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(OwnerActivity.EXTRA_LINK, data["actionUrl"])
        val id = (message.messageId ?: "$title${System.currentTimeMillis()}").hashCode()
        val tap = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        val notification = NotificationCompat.Builder(this, if (urgent) Push.CHANNEL_URGENT else Push.CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(data["body"])
            .setStyle(NotificationCompat.BigTextStyle().bigText(data["body"]))
            .setPriority(if (urgent) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        // Without the permission (refused, or not yet asked) nothing is shown; the inbox still has it.
        val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (allowed) NotificationManagerCompat.from(this).notify(id, notification)
    }
}
