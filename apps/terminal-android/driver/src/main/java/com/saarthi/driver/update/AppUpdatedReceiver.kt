package com.saarthi.driver.update

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.saarthi.driver.BuildConfig
import com.saarthi.driver.DriverActivity
import com.saarthi.driver.R

/**
 * "Humsafar updated — tap to open."
 *
 * Android closes an app to replace it and does not open it again, and it will
 * not let an app open itself from the background either. So the new build
 * says it is ready the one way it can: a notification that opens it.
 *
 * Only after an update the app started itself ([AppUpdates.consumeUpdated]); a
 * reinstall from a browser or a developer's machine stays quiet.
 */
class AppUpdatedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!AppUpdates.consumeUpdated(context)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, context.getString(R.string.update_channel_name), NotificationManager.IMPORTANCE_DEFAULT),
        )

        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, DriverActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(context.getString(R.string.update_done_title))
            .setContentText(context.getString(R.string.update_done_body, BuildConfig.VERSION_NAME))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    private companion object {
        const val CHANNEL_ID = "app-updates"
        const val NOTIFICATION_ID = 7_301
    }
}
