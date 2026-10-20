package com.saarthi.owner.ui.payments

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.R
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.ui.common.HeaderContentHeight
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.design.CircleButton
import com.saarthi.owner.ui.design.Eyebrow
import com.saarthi.owner.ui.design.LineIcon
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.RingSpinner
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.shell.LocalNavigator
import com.saarthi.owner.ui.shell.Navigator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/** How a payment ended, as the API — not the checkout page — reports it. */
enum class PaymentOutcome { SUCCEEDED, FAILED, PENDING }

/**
 * Opens Cashfree's hosted checkout for a session the API created, then asks
 * the API how it ended.
 *
 * What the checkout page says is a hint only; the outcome always comes from
 * `POST /payments/:reference/confirm`, exactly as the web app does it. A null
 * session is an API on the mock gateway that settled the payment itself.
 */
@Stable
class CheckoutLauncher internal constructor(
    private val navigator: Navigator,
    private val payments: PaymentsApi,
    private val scope: CoroutineScope,
) {
    var confirming by mutableStateOf(false)
        private set

    fun pay(session: PaymentsApi.CheckoutSession?, onResult: (PaymentOutcome) -> Unit) {
        if (session == null) {
            onResult(PaymentOutcome.SUCCEEDED)
            return
        }
        navigator.push("checkout-${session.reference}") {
            CheckoutScreen(session) {
                navigator.pop()
                confirming = true
                scope.launch {
                    val status = runCatching { payments.confirm(session.reference) }.getOrDefault("PENDING")
                    confirming = false
                    onResult(
                        when (status) {
                            "SUCCEEDED" -> PaymentOutcome.SUCCEEDED
                            "FAILED", "CANCELLED", "EXPIRED" -> PaymentOutcome.FAILED
                            else -> PaymentOutcome.PENDING
                        },
                    )
                }
            }
        }
    }
}

@Composable
fun rememberCheckout(): CheckoutLauncher {
    val navigator = LocalNavigator.current
    val app = LocalContext.current.applicationContext as OwnerApp
    val scope = rememberCoroutineScope()
    return remember(navigator) { CheckoutLauncher(navigator, app.payments, scope) }
}

/** The sentence to show for an outcome. */
fun PaymentOutcome.sentence(paidWhat: String): String = when (this) {
    PaymentOutcome.SUCCEEDED -> Words.get(R.string.papers_payments_outcome_succeeded, paidWhat)
    PaymentOutcome.FAILED -> Words.get(R.string.papers_payments_outcome_failed)
    PaymentOutcome.PENDING -> Words.get(R.string.papers_payments_outcome_pending)
}

/** Cashfree's own checkout, full screen, with a way out. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CheckoutScreen(session: PaymentsApi.CheckoutSession, onFinished: () -> Unit) {
    val c = Saarthi.colors
    var loading by remember { mutableStateOf(true) }
    var finished by remember { mutableStateOf(false) }
    val finish = {
        if (!finished) {
            finished = true
            onFinished()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(c.canvas)
            .windowInsetsPadding(WindowInsets.statusBars)
            .windowInsetsPadding(WindowInsets.navigationBars),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(HeaderContentHeight)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircleButton(Lucide.close, stringResource(R.string.papers_payments_close), finish, size = 44.dp)
            Column(Modifier.weight(1f)) {
                Eyebrow(stringResource(R.string.papers_payments_secure))
                Text("Cashfree", style = SType.headerTitle, color = c.fg)
            }
            LineIcon(Lucide.lock, size = 18.dp, color = c.success)
        }
        Box(Modifier.weight(1f)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val url = request.url.toString()
                                if (isReturn(url, session.reference)) {
                                    finish()
                                    return true
                                }
                                val scheme = request.url.scheme.orEmpty()
                                if (scheme == "http" || scheme == "https") return false
                                // UPI apps and bank apps are opened outside the page.
                                runCatching {
                                    val intent = if (scheme == "intent") {
                                        Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                                    } else {
                                        Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                    }
                                    context.startActivity(intent)
                                }.onFailure { if (it !is ActivityNotFoundException) throw it }
                                return true
                            }

                            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                                if (isReturn(url, session.reference)) finish()
                            }

                            override fun onPageFinished(view: WebView, url: String) {
                                loading = false
                            }
                        }
                        loadDataWithBaseURL(
                            "https://sdk.cashfree.com/",
                            checkoutPage(session),
                            "text/html",
                            "utf-8",
                            null,
                        )
                    }
                },
            )
            if (loading) {
                Box(Modifier.fillMaxSize().background(c.canvas), contentAlignment = Alignment.Center) {
                    RingSpinner(track = c.track, head = c.primary, size = 44.dp, stroke = 4.dp)
                }
            }
        }
    }
}

/** Cashfree sends the payer back to the API's return URL, carrying Saarthi's reference. */
private fun isReturn(url: String, reference: String): Boolean =
    url.contains("order_id=") && (url.contains(reference) || url.contains(Uri.encode(reference)))

/** A page that only loads Cashfree's v3 SDK and opens the checkout in place. */
private fun checkoutPage(session: PaymentsApi.CheckoutSession): String {
    val mode = if (session.mode == "production") "production" else "sandbox"
    return """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
        </head><body style="margin:0;background:#ffffff">
        <script>
          Cashfree({ mode: ${JSONObject.quote(mode)} })
            .checkout({ paymentSessionId: ${JSONObject.quote(session.sessionId)}, redirectTarget: "_self" });
        </script>
        </body></html>
    """.trimIndent()
}
