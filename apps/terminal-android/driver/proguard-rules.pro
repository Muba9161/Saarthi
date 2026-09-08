# Saarthi Driver — release shrinking.
#
# The rules that were here named `com.saarthi.device.network.**`, which is the
# old device-android app's package and does not exist in this build. They were
# copied across when this module was created and protected nothing.
#
# Everything below keeps a class that something *outside* the app looks up by
# name — the Android framework, the Android Auto host, or a serializer resolved
# at runtime. R8 cannot see any of those references, so without a rule it is
# entitled to rename or remove the class, and the failure is always at run time
# in a release build that nobody tested.

-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**

# --- Wire format -----------------------------------------------------------
#
# kotlinx.serialization generates a `Companion` and a `serializer()` per
# `@Serializable` class and resolves them reflectively. Both the shared DTOs and
# the driver's own are covered; naming only one of the two packages is how a
# release build parses the cockpit fine and then dies signing in.
-keepclassmembers class com.saarthi.core.network.** {
    *** Companion;
}
-keepclasseswithmembers class com.saarthi.core.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclassmembers class com.saarthi.driver.network.** {
    *** Companion;
}
-keepclasseswithmembers class com.saarthi.driver.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# --- Android Auto ----------------------------------------------------------
#
# The car host binds `CarAppService` by the name in the manifest and constructs
# the screens reflectively. A renamed service is a Saarthi that does not appear
# in the car at all, with nothing in the app's own log to explain it.
-keep public class com.saarthi.driver.car.** { *; }
-keep class androidx.car.app.** { *; }
-dontwarn androidx.car.app.**

# --- Entry points named in the manifest ------------------------------------
#
# AGP keeps these already; stated so that a future manifest edit that adds one
# does not depend on remembering this file exists.
-keep class com.saarthi.driver.SaarthiDriverApp { *; }
-keep class com.saarthi.driver.DriverActivity { *; }
-keep class com.saarthi.core.service.TerminalService { *; }
-keep class com.saarthi.core.service.BootReceiver { *; }

# --- Keystore and biometrics ----------------------------------------------
#
# `QuickLoginStore` names cipher transformations and key algorithms as strings,
# which R8 cannot follow. Keeping the class costs nothing and the alternative is
# a driver locked out of an app that worked in debug.
-keep class com.saarthi.driver.data.QuickLoginStore { *; }
-dontwarn javax.crypto.**

# --- Libraries that ship no consumer rules ---------------------------------
-dontwarn org.maplibre.**
-keep class org.maplibre.android.** { *; }
