package com.saarthi.core.ui

import android.content.Context
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.saarthi.core.util.DebugLog

/**
 * Getting a camera running, once, for whoever asks.
 *
 * A utility, not a screen. `:core` already talks to CameraX for the QR scanner,
 * and this is the same three lines of provider plumbing that any second camera
 * surface would otherwise copy — including the part everybody gets wrong, which
 * is that `ProcessCameraProvider.getInstance` hands back a Guava
 * `ListenableFuture` that consumers of this library do not get on their compile
 * classpath. Keeping the future inside the module that owns the dependency is
 * cheaper than exporting Guava to every app.
 *
 * What lives here is deliberately only the *binding*. There is no capture
 * surface, no preview UI and no photograph handling in this module: the arrival
 * selfie belongs to the driver's phone, and the fitted terminal has never taken
 * one.
 */
object CameraBinding {

    /**
     * Bind a preview, and whatever else the caller needs, to a lifecycle.
     *
     * `preferFront` falls back to the rear camera rather than failing. Some
     * rugged handsets issued to drivers have no front camera at all, and a
     * photograph taken by a colleague is worth more than no photograph.
     *
     * Failures are logged and swallowed. A camera that will not bind leaves the
     * caller showing an empty viewfinder, which its own screen explains far
     * better than an exception thrown out of a composable could.
     */
    fun bind(
        context: Context,
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView,
        preferFront: Boolean,
        vararg useCases: UseCase,
    ) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = runCatching { future.get() }.getOrElse { error ->
                DebugLog.warn(TAG, "No camera provider: ${error.message}")
                return@addListener
            }

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val front = CameraSelector.DEFAULT_FRONT_CAMERA
            val selector = if (preferFront && runCatching { provider.hasCamera(front) }
                    .getOrDefault(false)
            ) {
                front
            } else {
                CameraSelector.DEFAULT_BACK_CAMERA
            }

            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, selector, preview, *useCases)
            }.onFailure { error ->
                DebugLog.warn(TAG, "Camera would not bind: ${error.message}")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private const val TAG = "CameraBinding"
}
