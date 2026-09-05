import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Where this build points.
 *
 * Read from a Gradle property so one source tree produces a development,
 * staging or production build without an edit — `-PsaarthiApiUrl=...`, or a
 * line in `local.properties`. Without one, the default follows the build type:
 * a debug build gets the emulator's alias for the host machine, which is what a
 * developer running `npm run dev` needs, and a release build gets the official
 * API. Neither default can reach the other's server by accident — cleartext is
 * permitted only to the two development addresses.
 *
 * `local.properties` is read explicitly, because Gradle does not do it for you.
 * The comment above promised it did, and the promise was worth keeping rather
 * than deleting: a URL that only lives in a `-P` flag is a URL that survives
 * exactly as long as somebody remembers to type it, and forgetting produces a
 * tablet quietly pointed at localhost with nothing on screen to say so.
 *
 * `local.properties` is machine-local and untracked, which is the right home
 * for a dev tunnel that changes between sessions.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

fun setting(name: String): String? =
    (project.findProperty(name) as String?) ?: localProperties.getProperty(name)

/**
 * The official Saarthi API.
 *
 * `vorldxsaarthi.com` is the product's domain; the API and the device gateway
 * both live on `api.` beneath it. A release build points here unless it is told
 * otherwise, so a production APK is correct by default rather than by somebody
 * remembering a flag.
 */
val productionApiUrl = "https://api.vorldxsaarthi.com"

/**
 * The version this build is.
 *
 * `versionCode` is the only thing the update pipeline compares — a terminal
 * offers an update when the published release's code is higher than its own, so
 * it must increase on every release and never repeat. `versionName` is what a
 * driver reads on the update card.
 */
val appVersionCode = 1
val appVersionName = "1.0.0"

/** An explicit `-PsaarthiApiUrl=` or `local.properties` entry beats both defaults. */
val saarthiApiUrlOverride: String? = setting("saarthiApiUrl")

/** Debug: the emulator's alias for the machine running `npm run dev`. */
val saarthiApiUrl: String = saarthiApiUrlOverride ?: "http://10.0.2.2:4000"

/**
 * The basemap style.
 *
 * The same OpenFreeMap style the web app renders, so the cockpit map and the
 * dispatcher's map agree about what a road looks like. No key, no account, no
 * request ceiling — see `apps/web/src/features/maps/map-config.ts`.
 */
val saarthiMapStyleUrl: String =
    setting("saarthiMapStyleUrl") ?: "https://tiles.openfreemap.org/styles/liberty"

/**
 * Release signing.
 *
 * Every release must be signed by the *same* key, for ever. Android refuses an
 * update whose signature does not match the installed app, so a key that
 * changes — or is lost — strands every terminal already fitted to a vehicle:
 * the only remedy is uninstalling each tablet by hand, in the cab. That is why
 * the keystore lives outside the repository and is named from
 * `local.properties` rather than being generated per machine like the debug key.
 *
 * A build with no keystore configured still succeeds and simply produces an
 * unsigned release — which `installRelease` will refuse. Failing at install
 * time is better than silently signing with the debug key and shipping an APK
 * that can never be updated.
 */
val releaseStoreFile: String? = setting("releaseStoreFile")

android {
    namespace = "com.saarthi.terminal"
    compileSdk = 36

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = setting("releaseStorePassword")
                keyAlias = setting("releaseKeyAlias")
                keyPassword = setting("releaseKeyPassword")

                // v1 as well as v2/v3: minSdk is 26, and the older scheme costs
                // nothing while remaining what some vendor installers check.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    defaultConfig {
        applicationId = "com.saarthi.terminal"
        /*
         * 26 rather than a lower floor.
         *
         * The foreground-service model this app depends on to keep reporting
         * while the screen is off does not exist below it, and a terminal that
         * stops tracking when the tablet dims is not a terminal. Every Android
         * device sold as a vehicle display is well past this.
         */
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        /*
         * The version code, as a BuildConfig field.
         *
         * `versionCode` is already in the package manager, but reading it back
         * costs a PackageManager round trip at every update check and returns
         * a `Long` on newer APIs and an `Int` on older ones. The number that
         * decides whether an update applies is worth having as a constant.
         */
        buildConfigField("int", "VERSION_CODE", "$appVersionCode")

        buildConfigField("String", "SAARTHI_API_URL", "\"$saarthiApiUrl\"")
        buildConfigField("String", "MAP_STYLE_URL", "\"$saarthiMapStyleUrl\"")

        // A terminal is fitted to a vehicle and rotates with whatever bracket
        // it is in, so both orientations have real layouts. `resConfigs` is not
        // set: the app has to be readable in whatever locale the fitter left
        // the tablet in.
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            /*
             * Developer affordances are a *build-type* capability, never a
             * setting a driver can switch on.
             *
             * Section 49 requires the telemetry simulator be inaccessible from
             * normal driver mode, and the only way to guarantee that is for the
             * code path not to be compiled into a release build at all.
             */
            buildConfigField("boolean", "DEVELOPER_TOOLS", "true")
            buildConfigField("boolean", "ALLOW_SIMULATION", "true")
        }
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField("boolean", "DEVELOPER_TOOLS", "false")
            buildConfigField("boolean", "ALLOW_SIMULATION", "false")

            /*
             * Release points at the real API, not at the developer's laptop.
             *
             * The default used to be the emulator host for every build type,
             * on the reasoning that a shipped build should fail loudly rather
             * than quietly talk to the wrong server. The reasoning was right
             * and the conclusion is now unnecessary: there is a canonical
             * production host, so a release can simply be correct. Nothing is
             * given up either — `network_security_config.xml` permits cleartext
             * only to `localhost` and `10.0.2.2`, so a release build cannot
             * silently reach a development server whatever it is pointed at.
             */
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
     * Let a JVM test call into the Android framework without a device.
     *
     * `android.util.Log` is a stub in the unit-test runtime and throws rather
     * than doing nothing, so any class that logs — which is every class worth
     * testing here — took the whole suite down with "Method i in android.util.Log
     * not mocked". Returning defaults makes the logging calls silent no-ops,
     * which is exactly what a test wants from them.
     */
    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    /**
     * Per-architecture APKs.
     *
     * MapLibre ships a native renderer per ABI. Carrying all of them roughly
     * doubles the APK, and these are sideloaded onto tablets in a yard, often
     * over a tethered connection — half of it would be machine code for a CPU
     * the tablet does not have. The universal APK is still produced, because it
     * is the one to reach for when you do not know what you are installing onto.
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
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.window)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Credentials at rest. A device secret in plain SharedPreferences is a
    // secret readable by anything with root or a backup.
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.datastore.preferences)

    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)

    implementation(libs.play.services.location)
    implementation(libs.mlkit.barcode.scanning)

    implementation(libs.maplibre.android)
    implementation(libs.coil.compose)
    implementation(libs.haze)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
}
