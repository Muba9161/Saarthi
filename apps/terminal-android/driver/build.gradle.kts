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

/**
 * The same lookup, except a release will not read a developer's machine.
 *
 * `local.properties` is where somebody keeps the tunnel they happen to be
 * testing against today, and it is not checked in — so a release that honoured
 * it would be built from settings nobody else can see or review. Not
 * hypothetical: this checkout carries a `saarthiApiUrl` pointing at a personal
 * dev tunnel on a web port, and any release cut here would have shipped aimed
 * at it while looking perfectly normal.
 *
 * An explicit `-PsaarthiApiUrl=...` still works, because a flag typed on the
 * command line is a decision somebody made on purpose.
 */
fun releaseSetting(name: String): String? = project.findProperty(name) as String?

/*
 * Where Saarthi actually lives.
 *
 * The apex, not an `api.` subdomain. This said `api.vorldxsaarthi.com` for as
 * long as the constant has existed and that host has never resolved — so every
 * release build shipped pointing at nothing, and a driver who installed one
 * could open the app and do nothing else. The API is served from the same
 * origin as the web app, with the routes under /api/v1 which the client
 * appends itself.
 *
 * Verified against the running server rather than assumed: /health returns the
 * API JSON, and /api/v1/auth/login answers 400 for an empty body rather than
 * 404 for a missing route.
 */
val productionApiUrl = "https://vorldxsaarthi.com"
val saarthiApiUrlOverride: String? = setting("saarthiApiUrl")
/*
 * Where a debug build looks, and why it is not the emulator's address.
 *
 * This was `10.0.2.2`, which is the emulator's alias for the host machine and
 * means nothing on a real handset — so a debug build installed on a phone
 * reached nothing at all. `localhost` reaches the developer's own API through
 * `adb reverse tcp:4000 tcp:4000`, which works on a physical device and on an
 * emulator alike.
 *
 * The split is deliberate: a debug build follows the tunnel to whatever the
 * developer is running, and a release build follows the domain. Neither has to
 * be remembered at the command line, because getting it wrong is silent —
 * `productionApiUrl` pointed at a host that never resolved for as long as it
 * existed, and nothing in the build said so.
 */
val saarthiApiUrl: String = saarthiApiUrlOverride ?: "http://localhost:4000"
/**
 * The dark basemap, not the tablet's bright one.
 *
 * The fitted terminal is a lit instrument panel bolted to a dashboard and
 * `liberty` suits it. A driver's phone is dark-first — see `FleetTheme` — and a
 * cream-coloured map in the middle of a near-black app was the one thing on the
 * cockpit that still looked borrowed. Same provider and the same terms as
 * before, so this adds no vendor: OpenFreeMap's `dark` style paints its
 * background at rgb(12,12,12), within a shade of the app's own Obsidian.
 */
val saarthiMapStyleUrl: String =
    setting("saarthiMapStyleUrl") ?: "https://tiles.openfreemap.org/styles/dark"

/**
 * Signed by the same key as the terminal.
 *
 * Different application ids, one keystore. Two keys would mean two things to
 * lose, and losing either ends the ability to update the apps already installed.
 */
val releaseStoreFile: String? = setting("releaseStoreFile")

// Raise the code on every build that leaves this machine. Two builds sharing a
// code are indistinguishable to Android and to the release pipeline: a phone
// that installed the first is never offered the second, and the upload endpoint
// refuses the duplicate rather than replacing it silently.
val appVersionCode = 13
val appVersionName = "1.4.1"

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
     * Awaiting a Play Services Task from a coroutine.
     *
     * :core keeps this to itself, and the car screens need it too: the nearby
     * map asks the fused provider for a last known fix when the reporting
     * service has not started, which is exactly the case when Android Auto is
     * what woke this process.
     */
    implementation(libs.kotlinx.coroutines.play.services)

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
