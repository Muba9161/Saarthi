package com.saarthi.owner.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.saarthi.owner.OwnerApp
import com.saarthi.owner.data.AccountType
import com.saarthi.owner.ui.account.NotForThisAppScreen
import com.saarthi.owner.ui.account.PausedScreen
import com.saarthi.owner.ui.design.Ease
import com.saarthi.owner.ui.shell.HomeShell
import com.saarthi.owner.ui.signin.SignedOutFlow
import com.saarthi.owner.ui.splash.SplashScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The whole app, as one surface: splash, signed out, or inside an account.
 *
 * Which screen shows is derived from the session, never from history. The
 * splash holds until the remembered session has been confirmed with the
 * server — and for at least as long as the logo takes to draw itself — so a
 * fast restore is a brand moment rather than a flicker.
 */
@Composable
fun OwnerRoot(app: OwnerApp) {
    val account by app.session.account.collectAsStateWithLifecycle()
    var splashDone by rememberSaveable { mutableStateOf(false) }
    var restored by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val started = System.currentTimeMillis()
        // Offline is not signed out: the remembered account stays, and its
        // screens say they cannot reach Saarthi until the connection returns.
        if (!restored && app.session.account.value != null) runCatching { app.api.restore() }
        restored = true
        delay((SPLASH_MIN_MS - (System.currentTimeMillis() - started)).coerceAtLeast(0))
        splashDone = true
    }

    val signOut: () -> Unit = { scope.launch { app.api.signOut() } }

    val stage = when {
        !splashDone -> Stage.SPLASH
        account == null -> Stage.SIGNED_OUT
        else -> Stage.INSIDE
    }

    val slide = with(LocalDensity.current) { 48.dp.roundToPx() }
    Box(Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = stage,
            transitionSpec = {
                (slideInHorizontally(tween(550, easing = Ease.out)) { slide } + fadeIn(tween(550, easing = Ease.out))) togetherWith
                    fadeOut(tween(220))
            },
            label = "owner-stage",
        ) { shown ->
            when (shown) {
                Stage.SPLASH -> SplashScreen()
                Stage.SIGNED_OUT -> SignedOutFlow(app.api)
                Stage.INSIDE -> {
                    val current = account ?: return@AnimatedContent
                    when {
                        current.paused -> PausedScreen(
                            account = current,
                            api = app.api,
                            onCheckAgain = { runCatching { app.api.restore() } },
                            onSignOut = signOut,
                        )
                        current.accountType == AccountType.DRIVER_ONLY ||
                            current.accountType == AccountType.UNSUPPORTED ->
                            NotForThisAppScreen(account = current, api = app.api, onSignOut = signOut)
                        // A different business is a different app: nothing of the last one carries over.
                        else -> key(current.userId, current.organizationId) {
                            HomeShell(app = app, account = current, onSignOut = signOut)
                        }
                    }
                }
            }
        }
    }
}

private enum class Stage { SPLASH, SIGNED_OUT, INSIDE }

/** Long enough for the lockup to trace and flood in. */
private const val SPLASH_MIN_MS = 2_200L
