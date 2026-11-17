package com.saarthi.core.update

import android.os.Build
import com.saarthi.core.CoreConfig
import com.saarthi.core.network.UpdateOfferDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * A phone app's updates, from Saarthi's public release routes.
 *
 * No credential, on purpose: the routes say only what the website already says
 * about the app, plus the checksum the download is verified against, and each
 * route serves exactly one app whatever the caller asks for. A person signed
 * out, or riding along with no vehicle paired, is still offered the update.
 *
 * @param baseUrl read on every call, so a changed API address applies at once.
 * @param appPath the app's public route, e.g. `driver-app/public`.
 */
class PublicAppUpdates(
    private val baseUrl: () -> String,
    private val appPath: String,
) : UpdateSource {

    private val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        // A read stalls for as long as a weak signal does; the download stays
        // alive through it rather than restarting from nothing.
        .readTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private fun url(suffix: String) = "${baseUrl().trimEnd('/')}/api/v1/$appPath/$suffix"

    override suspend fun checkForUpdate(): UpdateOfferDto? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url("update?versionCode=${CoreConfig.versionCode}&sdk=${Build.VERSION.SDK_INT}"))
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Update check refused (${response.code})")
            val body = response.body?.string() ?: throw IOException("Update check returned nothing")
            val data = json.parseToJsonElement(body).jsonObject["data"]
            if (data == null || data is JsonNull) null else json.decodeFromJsonElement(UpdateOfferDto.serializer(), data)
        }
    }

    override suspend fun downloadUpdate(
        versionCode: Int,
        target: File,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): String = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url("update/$versionCode/download")).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Update download refused (${response.code})")
            val body = response.body ?: throw IOException("Update download was empty")
            body.writeHashed(target, onProgress)
        }
    }
}
