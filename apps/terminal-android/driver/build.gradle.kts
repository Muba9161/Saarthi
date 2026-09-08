import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Saarthi for drivers.
 *
 * The same job as the fitted terminal, reached from the other direction. A
 * tablet is bolted into a truck and a fitter pairs it; this is a driver's own
 * phone, and the driver signs in, scans whichever vehicle they have been given
 * that morning, and works. Nothing in it requires anybody to open a laptop.
 *
 * It is a separate application id from the terminal on purpose. Both can be
 * installed on one device — which is exactly what happens on a test bench, and
 * once in a while in a cab where a driver wants their own app alongside the
 * fitted screen.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

fun setting(name: String): String? =
    (project.findProperty(name) as String?) ?: localProperties.getProperty(name)

val productionApiUrl = "https://api.vorldxsaarthi.com"
val saarthiApiUrlOverride: String? = setting("saarthiApiUrl")
val saarthiApiUrl: String = saarthiApiUrlOverride ?: "http://10.0.2.2:4000"
val saarthiMapStyleUrl: String =
    setting("saarthiMapStyleUrl") ?: "https://tiles.openfreemap.org/styles/liberty"

/**
 * Signed by the same key as the terminal.
 *
 * Different application ids, one keystore. Two keys would mean two things to
 * lose, and losing either ends the ability to update the apps already installed.
 */
val releaseStoreFile: String? = setting("releaseStoreFile")

val appVersionCode = 5
val appVersionName = "1.1.0"

android {
    namespace = "com.saarthi.driver"
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
        applicationId = "com.saarthi.driver"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        buildConfigField("int", "VERSION_CODE", "$appVersionCode")
        buildConfigField("String", "SAARTHI_API_URL", "\"$saarthiApiUrl\"")
        buildConfigField("String", "MAP_STYLE_URL", "\"$saarthiMapStyleUrl\"")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            /*
             * No simulator, in any build type.
             *
             * The tablet may fabricate telemetry in a debug build because a
             * developer needs a moving vehicle without a vehicle. A driver's
             * phone is only ever in a real cab, and a fabricated reading
             * reaching a fleet's records from a driver's own handset is the
             * failure section 19 exists to prevent. The code path is simply not
             * compiled in.
             */
            buildConfigField("boolean", "ALLOW_SIMULATION", "false")
        }
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField("boolean", "ALLOW_SIMULATION", "false")
            buildConfigField(
                "String",
                "SAARTHI_API_URL",
                "\"${saarthiApiUrlOverride ?: productionApiUrl}\"",
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
     * Per-architecture APKs.
     *
     * More important here than on the tablet: a driver installs this over their
     * own mobile data, and the universal APK is more than twice the size of the
     * one their phone can actually run.
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
    implementation(project(":core"))

    /*
     * Android Auto, through the templated car app library.
     *
     * Only the driver app depends on this. A fitted tablet *is* the car's
     * screen; projecting it onto another one would be a second display of the
     * same cab, and Android Auto is for a phone the driver brought with them.
     */
    implementation(libs.car.app)

    /*
     * The system biometric prompt.
     *
     * Driver only. A fitted tablet is shared between drivers and has no
     * personal session to unlock; a fingerprint reader on it would be securing
     * the wrong thing.
     */
    implementation(libs.androidx.biometric)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
