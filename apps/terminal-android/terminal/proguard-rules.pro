# kotlinx.serialization keeps its generated serializers on the classes
# themselves; R8 needs telling not to strip them.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.saarthi.device.network.** {
    *** Companion;
}
-keepclasseswithmembers class com.saarthi.device.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}
