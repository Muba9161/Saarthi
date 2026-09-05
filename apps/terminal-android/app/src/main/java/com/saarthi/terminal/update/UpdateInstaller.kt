package com.saarthi.terminal.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.ContextCompat
import com.saarthi.terminal.util.DebugLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Handing a downloaded build to Android.
 *
 * Through `PackageInstaller` rather than an `ACTION_VIEW` intent on the file.
 * The intent route needs a `FileProvider`, a content URI and a grant that
 * several manufacturers' file handlers get wrong, and when it fails it fails
 * silently — the driver taps Update, something flashes, and nothing happens.
 * A session reports what became of itself, which is the difference between a
 * bug you can act on and a bug a driver reports as "the button does nothing".
 *
 * The install is still the user's decision. Android shows its own confirmation
 * and there is no way around that for an ordinary app, nor should there be:
 * silent installation is a device-owner capability, and a fleet tablet that can
 * be updated without anybody agreeing is a fleet tablet that can be
 * *downgraded* without anybody agreeing.
 */
class UpdateInstaller(private val context: Context) {

    /** What became of an install attempt. */
    sealed interface Outcome {
        /** Android is showing its confirmation; the app is about to be replaced. */
        data object AwaitingUser : Outcome

        /** The session could not even be created or written. */
        data class Failed(val reason: String) : Outcome
    }

    /**
     * Write the APK into a session and commit it.
     *
     * Returns as soon as the system takes over. Nothing after `commit` is
     * guaranteed to run: a successful install stops this process to replace it,
     * so any "it worked" handling would be code that never executes on the happy
     * path. Failure is what arrives back, through the receiver.
     */
    suspend fun install(apk: File): Outcome = withContext(Dispatchers.IO) {
        if (!apk.isFile || apk.length() == 0L) {
            return@withContext Outcome.Failed("The downloaded file is missing.")
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL,
        ).apply {
            // Naming the package stops a session being committed with an APK for
            // something else entirely, which the server already refuses to serve
            // but which costs nothing to assert again at the last gate.
            setAppPackageName(context.packageName)

            /*
             * Ask to be reopened afterwards.
             *
             * A terminal is a screen bolted into a cab. Left to itself the
             * install replaces the app and stops there, and the driver is
             * looking at a launcher they have no reason to understand. Available
             * from API 31; below it the driver taps the icon, which is the
             * behaviour they already have.
             */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_UNSPECIFIED)
            }
        }

        val sessionId = try {
            installer.createSession(params)
        } catch (error: Exception) {
            DebugLog.warn(TAG, "Could not create an install session: ${error.message}")
            return@withContext Outcome.Failed("Android would not start the installation.")
        }

        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite(WRITE_NAME, 0, apk.length()).use { output ->
                    apk.inputStream().use { input -> input.copyTo(output, BUFFER) }
                    // Without this the bytes may still be in a buffer when the
                    // session is committed, and the installer sees a short file.
                    session.fsync(output)
                }

                session.commit(pendingIntent(sessionId).intentSender)
            }
        } catch (error: Exception) {
            DebugLog.warn(TAG, "Could not write the install session: ${error.message}")
            installer.abandonSession(sessionId)
            return@withContext Outcome.Failed("The update could not be handed to Android.")
        }

        Outcome.AwaitingUser
    }

    private fun pendingIntent(sessionId: Int): PendingIntent {
        val intent = Intent(ACTION_INSTALL_RESULT).setPackage(context.packageName)
        return PendingIntent.getBroadcast(
            context,
            sessionId,
            intent,
            // Mutable, because the installer fills in the status extras. This is
            // the one place a mutable PendingIntent is correct, and it is scoped
            // to this package by `setPackage` above.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    companion object {
        private const val TAG = "UpdateInstaller"
        private const val ACTION_INSTALL_RESULT = "com.saarthi.terminal.INSTALL_RESULT"
        private const val WRITE_NAME = "saarthi-terminal"
        private const val BUFFER = 64 * 1024

        /**
         * Listen for what the installer decides.
         *
         * Registered for as long as an install is in flight rather than declared
         * in the manifest: the result is only interesting to the screen that
         * started it, and a manifest receiver would wake the app for a session
         * nobody is watching.
         *
         * `STATUS_PENDING_USER_ACTION` is not a failure — it is Android asking
         * to show its confirmation dialog, and the intent it hands back is the
         * dialog. Treating it as an error is the classic way to build an update
         * button that reports failure while working perfectly.
         */
        fun observe(context: Context, onFailure: (String) -> Unit): BroadcastReceiver {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    val status = intent.getIntExtra(
                        PackageInstaller.EXTRA_STATUS,
                        PackageInstaller.STATUS_FAILURE,
                    )

                    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                        } else {
                            @Suppress("DEPRECATION")
                            intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                        }
                        confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        confirm?.let(context::startActivity)
                        return
                    }

                    if (status == PackageInstaller.STATUS_SUCCESS) return

                    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    onFailure(explain(status, message))
                }
            }

            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(ACTION_INSTALL_RESULT),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            return receiver
        }

        /**
         * A failure a driver can act on.
         *
         * Android's own messages name internal states — `INSTALL_FAILED_
         * UPDATE_INCOMPATIBLE` tells a driver nothing and tells the office
         * everything, so both are given: the plain sentence first, the code
         * after it for whoever answers the phone.
         */
        private fun explain(status: Int, message: String?): String = when (status) {
            PackageInstaller.STATUS_FAILURE_STORAGE ->
                "There is not enough free space on this tablet to install the update."

            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                "This update is not compatible with this tablet."

            PackageInstaller.STATUS_FAILURE_CONFLICT ->
                "The update could not replace the installed app. Call the office — the " +
                    "terminal may need reinstalling by hand. ($message)"

            PackageInstaller.STATUS_FAILURE_ABORTED ->
                "The update was cancelled."

            PackageInstaller.STATUS_FAILURE_INVALID ->
                "The downloaded update was rejected as damaged. Try again."

            else -> message ?: "The update could not be installed."
        }
    }
}
