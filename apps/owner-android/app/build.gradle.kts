import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Saarthi for owners and businesses.
 *
 * Every Saarthi account that is not a driver — fleet owners and their managers,
 * travel operators, personal owners, customers, sellers and truck associations —
 * signs in here and sees its own home. Sign in only: an account is opened on the
 * web, and plans, renewals and paid checks stay there too. That is what keeps the
 * app inside Google Play's payment rules without paying Play a share of every
 * subscription.
 *
 * Its own application id, beside the driver app and the fitted terminal, because
 * an owner who also drives keeps both on one phone.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

fun setting(name: String): String? =
    (project.findProperty(name) as String?) ?: localProperties.getProperty(name)

/** A release reads only flags typed on the command line, never a developer's local.properties. */
fun releaseSetting(name: String): String? = project.findProperty(name) as String?

/** Where Saarthi lives: the apex, with the API under /api/v1. */
val productionApiUrl = "https://vorldxsaarthi.com"

/**
 * Where a debug build looks: the developer's own API through `adb reverse`, so
 * the same build works on an emulator and on a phone on the desk.
 */
val saarthiApiUrl: String = setting("saarthiApiUrl") ?: "http://localhost:4000"

val saarthiMapStyleUrl: String = setting("saarthiMapStyleUrl") ?: "https://tiles.openfreemap.org/styles/dark"
val saarthiMapStyleUrlLight: String =
    setting("saarthiMapStyleUrlLight") ?: "https://tiles.openfreemap.org/styles/liberty"

/**
 * The release (Play upload) key, kept outside the repository and named from
 * the command line or local.properties, as the driver app does. A build with
 * no key named still succeeds and simply produces an unsigned APK.
 */
val releaseStoreFile: String? = setting("releaseStoreFile")

val appVersionCode = 1
val appVersionName = "0.1.0"

android {
    namespace = "com.saarthi.owner"
    compileSdk = 36

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = setting("releaseStorePassword")
                keyAlias = setting("releaseKeyAlias")
                keyPassword = setting("releaseKeyPassword")
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    defaultConfig {
        applicationId = "com.saarthi.owner"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        buildConfigField("String", "SAARTHI_API_URL", "\"$saarthiApiUrl\"")
        buildConfigField("String", "MAP_STYLE_URL", "\"$saarthiMapStyleUrl\"")
        buildConfigField("String", "MAP_STYLE_URL_LIGHT", "\"$saarthiMapStyleUrlLight\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField(
                "String",
                "SAARTHI_API_URL",
                "\"${releaseSetting("saarthiApiUrl") ?: productionApiUrl}\"",
            )
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
     * Per-architecture APKs, as the driver app builds them.
     *
     * MapLibre ships a native renderer per architecture, so the universal APK
     * carries four of them. An owner downloads this over mobile data, and the
     * arm64 split is the one nearly every phone in use can run.
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
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.maplibre.android)
    implementation(libs.androidx.biometric)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
