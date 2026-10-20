package com.saarthi.owner.network

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Finding a place by name — the same public Photon geocoder over
 * OpenStreetMap the web app's address search uses, kept to India.
 *
 * No key and no account, like the maps. Nothing about the person is sent:
 * only what they typed — or, when they ask for it, the point they stand on.
 */
class PlacesApi(private val context: Context, private val clientVersion: String) {

    /** A place a requirement can start or end at. */
    data class Place(
        val name: String,
        val address: String,
        val city: String?,
        val latitude: Double,
        val longitude: Double,
    ) {
        /** The place as the API's `addressSchema` takes it. */
        fun toAddressJson(): JsonObject = buildJsonObject {
            put("addressLine", address.take(300))
            city?.let { put("city", it.take(120)) }
            put("latitude", latitude)
            put("longitude", longitude)
        }
    }

    @Serializable
    private data class Collection(val features: List<Feature> = emptyList())

    @Serializable
    private data class Feature(val properties: Properties = Properties(), val geometry: Geometry = Geometry())

    @Serializable
    private data class Geometry(val coordinates: List<Double> = emptyList())

    @Serializable
    private data class Properties(
        val name: String? = null,
        val street: String? = null,
        val housenumber: String? = null,
        val district: String? = null,
        val city: String? = null,
        val county: String? = null,
        val state: String? = null,
        val postcode: String? = null,
        val countrycode: String? = null,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    suspend fun search(query: String, limit: Int = 8): List<Place> = withContext(Dispatchers.IO) {
        if (query.trim().length < 3) return@withContext emptyList()
        val url = "https://photon.komoot.io/api/".toHttpUrl().newBuilder()
            .addQueryParameter("q", query.trim())
            .addQueryParameter("limit", limit.toString())
            .addQueryParameter("lang", "en")
            .build()
        fetch(url)
            // One place is often several map objects (a station, its building, its stop) under the same words.
            .distinctBy { it.address.lowercase() }
    }

    /**
     * The street or landmark nearest a point, for "use my current location".
     * The place keeps the phone's own point, not the map object's: a pickup is
     * where the person stands, not the middle of the road named after it.
     *
     * The phone's own address lookup first (free, and an answer in a moment),
     * then Photon, which can take longer than a person will wait at a busy hour.
     */
    suspend fun nearest(latitude: Double, longitude: Double): Place? =
        (onPhone(latitude, longitude) ?: withContext(Dispatchers.IO) {
            val url = "https://photon.komoot.io/reverse".toHttpUrl().newBuilder()
                .addQueryParameter("lat", latitude.toString())
                .addQueryParameter("lon", longitude.toString())
                .addQueryParameter("limit", "1")
                .addQueryParameter("lang", "en")
                .build()
            fetch(url).firstOrNull()
        })?.copy(latitude = latitude, longitude = longitude)

    /** The phone's geocoder, where it has one; null when it has none, fails or is slow. */
    private suspend fun onPhone(latitude: Double, longitude: Double): Place? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale.ENGLISH)
        val found = withTimeoutOrNull(PHONE_LOOKUP_MS) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                suspendCancellableCoroutine { waiting ->
                    geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<Address>) = waiting.resume(addresses.firstOrNull())
                        override fun onError(errorMessage: String?) = waiting.resume(null)
                    })
                }
            } else {
                withContext(Dispatchers.IO) {
                    @Suppress("DEPRECATION")
                    runCatching { geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull() }.getOrNull()
                }
            }
        } ?: return null
        if (found.countryCode != null && !found.countryCode.equals("in", ignoreCase = true)) return null
        val name = listOf(found.thoroughfare, found.subLocality, found.locality)
            .firstNotNullOfOrNull { it?.trim()?.ifBlank { null } } ?: return null
        return Place(
            name = name,
            address = joinParts(name, found.subLocality, found.locality, found.subAdminArea, found.adminArea, found.postalCode),
            city = found.locality?.trim()?.ifBlank { null } ?: found.subAdminArea?.trim()?.ifBlank { null },
            latitude = latitude,
            longitude = longitude,
        )
    }

    /** Places in India from one Photon answer. */
    private fun fetch(url: HttpUrl): List<Place> {
        val request = Request.Builder().url(url).header("User-Agent", "VorldX-Saarthi-Owner/$clientVersion").build()
        val body = try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw OwnerApi.Failure.Refused(response.code, Words.get(R.string.net_error_address_search_down))
                response.body?.string().orEmpty()
            }
        } catch (error: IOException) {
            throw OwnerApi.Failure.Offline(error)
        }
        return json.decodeFromString(Collection.serializer(), body).features.mapNotNull { feature ->
            val p = feature.properties
            val coordinates = feature.geometry.coordinates
            if (coordinates.size < 2) return@mapNotNull null
            if (p.countrycode != null && !p.countrycode.equals("in", ignoreCase = true)) return@mapNotNull null
            val name = p.name?.trim()?.ifBlank { null } ?: p.street?.trim()?.ifBlank { null } ?: return@mapNotNull null
            Place(
                name = name,
                address = joinParts(
                    name,
                    joinParts(p.housenumber, p.street).ifBlank { null },
                    p.district,
                    p.city,
                    p.county,
                    p.state,
                    p.postcode,
                ),
                city = p.city?.trim()?.ifBlank { null } ?: p.county?.trim()?.ifBlank { null },
                latitude = coordinates[1],
                longitude = coordinates[0],
            )
        }
    }

    /** Parts joined with commas, skipping blanks and a part that repeats the one before it. */
    private fun joinParts(vararg parts: String?): String {
        val out = mutableListOf<String>()
        parts.forEach { part ->
            val value = part?.trim().orEmpty()
            if (value.isNotEmpty() && !value.equals(out.lastOrNull(), ignoreCase = true)) out.add(value)
        }
        return out.joinToString(", ")
    }

    private companion object {
        const val PHONE_LOOKUP_MS = 6_000L
    }
}
