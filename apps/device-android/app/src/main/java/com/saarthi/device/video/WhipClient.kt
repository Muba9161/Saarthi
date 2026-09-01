package com.saarthi.device.video

import com.saarthi.device.util.DebugLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * WHIP — WebRTC-HTTP Ingestion Protocol (RFC 9725).
 *
 * The entire signalling protocol, which is the reason WHIP was worth adopting:
 * publishing a stream is one HTTP POST and, later, one HTTP DELETE. There is no
 * socket to keep open, no custom message format and no library to bind to a
 * particular server.
 *
 *     POST {endpoint}            Content-Type: application/sdp   body = offer
 *       → 201 Created            Location: {resource}            body = answer
 *     DELETE {resource}
 *       → 200
 *
 * ## Why this waits for ICE rather than trickling
 *
 * WHIP defines an optional PATCH for trickled candidates, and a good number of
 * servers do not implement it. Gathering fully before the POST costs a second or
 * two at start-up and works against every implementation, which for a device
 * that publishes once and then streams for hours is the right trade.
 *
 * ## Authorisation
 *
 * The bearer token is Saarthi's publish ticket. The gateway does not validate it
 * itself — it hands it back to Saarthi, which owns the decision about who may
 * point a camera at a driver. See `video-gateway.routes.ts`.
 */
class WhipClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val sdpMedia = "application/sdp".toMediaType()

    class WhipException(val status: Int, override val message: String) : Exception(message)

    data class Session(
        /** Where to DELETE when the stream ends. Absolute. */
        val resourceUrl: String,
        val answerSdp: String,
    )

    /**
     * Publish an offer and get the answer back.
     *
     * @param endpoint the WHIP ingest URL from the Saarthi publish ticket
     * @param token the ticket, presented as a bearer credential
     * @param offerSdp a complete offer with ICE gathering finished
     */
    suspend fun publish(endpoint: String, token: String, offerSdp: String): Session =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(endpoint)
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/sdp")
                .post(offerSdp.toRequestBody(sdpMedia))
                .build()

            val response = try {
                client.newCall(request).execute()
            } catch (error: IOException) {
                throw WhipException(0, error.message ?: "Could not reach the video gateway.")
            }

            response.use {
                val body = it.body?.string().orEmpty()

                if (it.code !in 200..299) {
                    // The gateway's own words where it gave any. A 401 here means
                    // Saarthi refused the ticket, and saying so is more useful
                    // than "publish failed".
                    throw WhipException(
                        it.code,
                        when (it.code) {
                            401, 403 -> "The video gateway refused this device's ticket."
                            404 -> "The video gateway has no ingest endpoint at that address."
                            else -> body.take(200).ifBlank { "The video gateway returned ${it.code}." }
                        },
                    )
                }

                if (body.isBlank()) {
                    throw WhipException(it.code, "The video gateway returned no SDP answer.")
                }

                Session(
                    resourceUrl = resolveResource(endpoint, it.headers),
                    answerSdp = body,
                )
            }
        }

    /**
     * End a session.
     *
     * Best-effort. A phone that loses signal mid-stream never gets to call this,
     * which is why the gateway times sessions out on its own and Saarthi sweeps
     * its own stream-session rows — this only makes the tidy case tidy.
     */
    suspend fun delete(resourceUrl: String, token: String) = withContext(Dispatchers.IO) {
        runCatching {
            client.newCall(
                Request.Builder()
                    .url(resourceUrl)
                    .header("Authorization", "Bearer $token")
                    .delete()
                    .build(),
            ).execute().close()
        }.onFailure {
            DebugLog.add("WHIP DELETE failed: ${it.message}")
        }
        Unit
    }

    /**
     * Work out where the session lives.
     *
     * `Location` is allowed to be relative, and several gateways return one —
     * MediaMTX returns a path, Cloudflare returns an absolute URL. Resolving it
     * against the endpoint handles both, and falling back to the endpoint itself
     * handles a server that omits the header entirely rather than leaving the
     * session impossible to close.
     */
    private fun resolveResource(endpoint: String, headers: Headers): String {
        val location = headers["Location"] ?: return endpoint
        return runCatching { URI(endpoint).resolve(location).toString() }.getOrDefault(location)
    }
}
