package com.saarthi.terminal.kiosk

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import com.saarthi.terminal.util.DebugLog

/**
 * Device-owner receiver.
 *
 * Declaring this is what lets an EMM, or `adb shell dpm set-device-owner`, make
 * Saarthi the device owner of a freshly-provisioned tablet. It grants nothing on
 * its own, and the policy it declares in `res/xml/device_admin.xml` is
 * deliberately the narrowest set lock-task mode requires.
 */
class TerminalDeviceAdminReceiver : DeviceAdminReceiver()

/**
 * Dedicated-device mode (specification section 45).
 *
 * A terminal is meant to be the only thing on the tablet it is fitted to. The
 * driver should not be able to wander into the Play Store, and the app should
 * come back after a reboot without anybody tapping an icon.
 *
 * Android has a supported mechanism for exactly this — device-owner provisioning
 * plus lock-task mode — and this class uses it and nothing else. Section 45 asks
 * for that explicitly, and the reason is worth stating: the usual alternatives
 * are accessibility-service hacks that intercept the home button, `SYSTEM_ALERT`
 * overlays that cover the launcher, and immersive-mode loops that fight the
 * status bar. All of them break on the next Android release, all of them are
 * indistinguishable from malware to a security review, and all of them leave a
 * driver unable to make a phone call in an emergency. None of them is worth it.
 *
 * When Saarthi is *not* the device owner — which is every ordinary tablet — every
 * method here returns false and the app runs as a normal application. That is
 * the expected case during development and for a fleet that has not provisioned
 * its hardware, and nothing degrades except the kiosk itself.
 */
class KioskController(private val context: Context) {

    private val policyManager: DevicePolicyManager?
        get() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

    private val adminComponent: ComponentName
        get() = ComponentName(context, TerminalDeviceAdminReceiver::class.java)

    /**
     * Whether this app owns the device.
     *
     * The gate on everything else here. A tablet is provisioned as a dedicated
     * device once, at the point it is fitted — by an EMM, by NFC provisioning, or
     * by `dpm set-device-owner` on a factory-fresh device — and never afterwards.
     */
    val isDeviceOwner: Boolean
        get() = policyManager?.isDeviceOwnerApp(context.packageName) == true

    /**
     * Allow this app to enter lock-task mode.
     *
     * Called once after provisioning. Without it, `startLockTask` prompts the
     * user for confirmation, which on a mounted tablet means a dialog nobody is
     * there to accept.
     */
    fun configure(): Boolean {
        val manager = policyManager ?: return false
        if (!isDeviceOwner) return false

        return runCatching {
            manager.setLockTaskPackages(adminComponent, arrayOf(context.packageName))

            /*
             * Which system affordances survive inside lock task.
             *
             * Home and Recents are gone — that is the point of the mode. What is
             * deliberately kept:
             *
             *   SYSTEM_INFO   the status bar's clock, battery and signal. A driver
             *                 needs to know the tablet is about to die and whether
             *                 it has signal, and hiding that to look tidy is how
             *                 somebody discovers a flat battery at a weighbridge.
             *
             *   NOTIFICATIONS the foreground-service notification is the privacy
             *                 notice. Hiding it would mean a tablet reporting a
             *                 person's location with no visible indication.
             *
             *   GLOBAL_ACTIONS the power menu. A device that cannot be turned off
             *                 by the person holding it is not something to fit in
             *                 a vehicle.
             */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.setLockTaskFeatures(
                    adminComponent,
                    DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO or
                        DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
                )
            }

            // Come back after a reboot without anybody tapping an icon: Saarthi
            // becomes the persistent HOME activity, so the launcher never gets a
            // chance to appear. This is the supported mechanism — it is why the
            // manifest declares a HOME intent filter — and not a home-button hack.
            manager.addPersistentPreferredActivity(
                adminComponent,
                android.content.IntentFilter(android.content.Intent.ACTION_MAIN).apply {
                    addCategory(android.content.Intent.CATEGORY_HOME)
                    addCategory(android.content.Intent.CATEGORY_DEFAULT)
                },
                ComponentName(context, com.saarthi.terminal.MainActivity::class.java),
            )

            DebugLog.info("kiosk", "Lock-task configured for ${context.packageName}")
            true
        }.getOrElse { error ->
            DebugLog.error("kiosk", "Could not configure lock task", error)
            false
        }
    }

    /** Enter kiosk mode. A no-op unless this app owns the device. */
    fun enter(activity: Activity): Boolean {
        if (!isDeviceOwner) return false
        return runCatching {
            activity.startLockTask()
            true
        }.getOrElse { error ->
            DebugLog.error("kiosk", "Could not enter lock task", error)
            false
        }
    }

    /**
     * Leave kiosk mode.
     *
     * Reachable from the admin screen behind the PIN, so an engineer with the
     * tablet in their hands can get out of it. A kiosk with no documented exit is
     * a tablet that has to be factory reset to be serviced.
     */
    fun exit(activity: Activity): Boolean {
        if (!isDeviceOwner) return false
        return runCatching {
            activity.stopLockTask()
            true
        }.getOrElse { false }
    }

    /**
     * Give up device ownership entirely.
     *
     * The decommissioning path. A tablet being removed from a vehicle and sold
     * on must not stay locked to a fleet's application, and the only way to
     * relinquish device ownership is for the owner app to do it itself.
     */
    fun relinquish(): Boolean {
        val manager = policyManager ?: return false
        if (!isDeviceOwner) return false
        return runCatching {
            manager.clearDeviceOwnerApp(context.packageName)
            DebugLog.info("kiosk", "Device ownership relinquished")
            true
        }.getOrElse { false }
    }

    /** A one-line description for the admin screen. */
    fun describe(): String = when {
        isDeviceOwner -> "Device owner — kiosk mode available"
        else -> "Not a device owner. Provision this tablet with an EMM or `dpm set-device-owner` to enable kiosk mode."
    }
}
