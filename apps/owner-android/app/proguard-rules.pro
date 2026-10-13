# Saarthi for owners — release shrinking.
#
# kotlinx.serialization resolves each `@Serializable` class's `Companion` and
# `serializer()` reflectively; R8 cannot see that, so the wire types are kept.

-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**

-keepclassmembers class com.saarthi.owner.network.** {
    *** Companion;
}
-keepclasseswithmembers class com.saarthi.owner.network.** {
    kotlinx.serialization.KSerializer serializer(...);
}
