package com.saarthi.device

import android.app.Application
import android.content.Context
import com.saarthi.device.data.DeviceRepository

/**
 * The application object, and the one place the repository is constructed.
 *
 * Deliberately hand-rolled rather than a dependency-injection framework. There
 * is exactly one graph node with any lifetime — the repository — and it is
 * needed by the UI, a service and a broadcast receiver. Hilt would add an
 * annotation processor and a build step to solve a problem that fits in ten
 * lines, and on a device app the build staying simple is worth something.
 */
class SaarthiDeviceApp : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        @Volatile private var instance: SaarthiDeviceApp? = null
        @Volatile private var repo: DeviceRepository? = null

        /**
         * The single repository.
         *
         * Created on first use rather than in `onCreate` because it opens an
         * encrypted preferences file, and a broadcast receiver waking the
         * process at boot should not pay for that unless it is going to use it.
         */
        fun repository(context: Context): DeviceRepository =
            repo ?: synchronized(this) {
                repo ?: DeviceRepository(context.applicationContext).also { repo = it }
            }
    }
}
