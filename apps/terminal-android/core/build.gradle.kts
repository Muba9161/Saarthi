plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Everything the fitted tablet and the driver's phone both do.
 *
 * The two products are the same job from different seats: report where a vehicle
 * is, read its engine, navigate, run a safety check, start and finish trips,
 * raise an emergency. Only the way a person gets *to* that job differs — a
 * tablet is paired to a truck by a fitter and identifies its driver on the
 * spot; a phone is signed in to by the driver and then scans the truck.
 *
 * So this module holds the job and the apps hold the way in. Concretely it owns
 * the network client, the offline outbox, telemetry (GPS, OBD and simulation),
 * the map, the cockpit, the checklist and the over-the-air updater; and it knows
 * nothing about kiosk mode, admin gates, pairing codes or sign-in screens.
 *
 * It has no `BuildConfig` of its own by design — see `CoreConfig`, which each
 * app fills in at startup. A library that read build constants would be a
 * library that could only ever belong to one app.
 */
android {
    namespace = "com.saarthi.core"
    compileSdk = 36

    defaultConfig {
        // The floor is set by the foreground-service model the telemetry
        // service depends on, not by anything in the UI.
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    /**
     * Let a JVM test call into the Android framework without a device.
     *
     * `android.util.Log` is a stub in the unit-test runtime and throws rather
     * than doing nothing, so any class that logs — which is every class worth
     * testing here — took the whole suite down. Returning defaults makes those
     * calls silent no-ops, which is what a test wants from them.
     */
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // `api` rather than `implementation` for anything that appears in a public
    // signature the apps use. A composable taking a `Modifier` or a view model
    // exposing a `StateFlow` is unusable from an app that cannot see the type.
    api(libs.androidx.core.ktx)
    api(libs.androidx.lifecycle.runtime.ktx)
    api(libs.androidx.lifecycle.service)
    api(libs.androidx.lifecycle.process)
    api(libs.androidx.lifecycle.viewmodel.compose)
    api(libs.androidx.lifecycle.runtime.compose)
    api(libs.androidx.activity.compose)

    api(platform(libs.androidx.compose.bom))
    api(libs.androidx.compose.ui)
    api(libs.androidx.compose.ui.graphics)
    api(libs.androidx.compose.ui.tooling.preview)
    api(libs.androidx.compose.material3)
    api(libs.androidx.compose.material3.window)
    api(libs.androidx.compose.material.icons)
    api(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Credentials at rest. A device secret in plain SharedPreferences is a
    // secret readable by anything with root or a backup.
    api(libs.androidx.security.crypto)
    implementation(libs.androidx.datastore.preferences)

    // The camera is shared: the tablet scans a pairing code, the phone scans a
    // vehicle QR, and both take the arrival selfie.
    api(libs.androidx.camera.core)
    api(libs.androidx.camera.camera2)
    api(libs.androidx.camera.lifecycle)
    api(libs.androidx.camera.view)
    api(libs.mlkit.barcode.scanning)

    api(libs.play.services.location)
    api(libs.maplibre.android)
    api(libs.coil.compose)
    api(libs.haze)

    api(libs.okhttp)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
