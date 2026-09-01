plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Where this build points.
 *
 * Read from a Gradle property so the same source produces a development,
 * staging or production build without an edit — `-PsaarthiApiUrl=...`, or a
 * line in `local.properties`. The default is the Android emulator's alias for
 * the host machine, which is what a developer running `npm run dev` needs, and
 * is useless anywhere else — which is the point: a build that shipped with a
 * localhost default would fail loudly rather than quietly talking to the wrong
 * server.
 */
val saarthiApiUrl: String =
    (project.findProperty("saarthiApiUrl") as String?) ?: "http://10.0.2.2:4000"

android {
    namespace = "com.saarthi.device"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.saarthi.device"
        // 26 rather than a lower floor: the foreground-service model this app
        // depends on to track in the background does not exist below it, and a
        // tracker that stops when the screen locks is not a tracker.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "SAARTHI_API_URL", "\"$saarthiApiUrl\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // The debug console is a build-type capability, not a setting a
            // user can switch on. Section 31 requires it be absent from
            // production builds, and the only way to guarantee that is for the
            // code paths not to be compiled in.
            buildConfigField("boolean", "DEBUG_CONSOLE", "true")
            // Simulated engine data is a testing affordance. Allowing it in a
            // release build would let fabricated telemetry reach a real fleet.
            buildConfigField("boolean", "ALLOW_SIMULATION", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("boolean", "DEBUG_CONSOLE", "false")
            buildConfigField("boolean", "ALLOW_SIMULATION", "false")
        }
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
        buildConfig = true
    }

    /**
     * Per-architecture APKs.
     *
     * libwebrtc ships a native library for each ABI, and carrying all four takes
     * the APK from 43 MB to 86 MB. That matters here more than it usually would:
     * these are sideloaded onto a driver's phone, often over a tethered
     * connection in a yard, and half of it would be machine code for a CPU the
     * phone does not have.
     *
     * The universal APK is still produced, because it is the one to reach for
     * when you do not know what you are installing onto.
     */
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Credentials at rest. A device secret in plain SharedPreferences is a
    // secret readable by anything with root or a backup.
    implementation(libs.androidx.security.crypto)

    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    implementation(libs.play.services.location)
    implementation(libs.mlkit.barcode.scanning)

    // WebRTC, for publishing this phone's camera to a WHIP gateway.
    implementation(libs.webrtc)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
}
