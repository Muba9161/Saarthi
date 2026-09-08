package com.saarthi.core.ui.screens

import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.R
import com.saarthi.core.ui.LocalReducedMotion

/**
 * The entrance (specification section 58).
 *
 * The existing Saarthi brand mark — `saarthi_mark.png`, the same asset the web
 * app renders — on the app's own night background. Section 3 is explicit that
 * the terminal reuses the project's logo rather than inventing one, so nothing
 * here is drawn.
 *
 * The mark sits on a light chip. The Saarthi logo is navy on transparency; on a
 * dark surface the navy simply disappears and only the saffron and green
 * survive, which is why the web app's `<SaarthiLogo onDark>` does the same
 * thing. Inventing a knockout variant of somebody else's artwork would be worse.
 *
 * The animation is short and it does not gate anything: the root dismisses this
 * the moment the first state arrives from the server, so on a warm start the
 * driver sees it for a few frames and on a cold one it covers a real wait.
 */
@Composable
fun SplashScreen(modifier: Modifier = Modifier) {
    val reducedMotion = LocalReducedMotion.current
    // A phone, rather than a fitted display. The mark is scaled to it below.
    val compact = LocalConfiguration.current.screenWidthDp < 600
    var entered by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { entered = true }

    val progress by animateFloatAsState(
        targetValue = if (entered || reducedMotion) 1f else 0f,
        animationSpec = tween(durationMillis = if (reducedMotion) 0 else 620, easing = EaseOutCubic),
        label = "splash",
    )

    Box(
        modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
                    ),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier
                .alpha(progress)
                .scale(0.94f + progress * 0.06f),
        ) {
            /*
             * Sized to the screen, not to a tablet.
             *
             * 132dp was chosen on a 10-inch fitted display, where it is a
             * reasonable mark. On a phone it fills most of the width and reads
             * as a mistake — which is exactly what it looked like to the first
             * person who installed the driver app.
             */
            Surface(
                shape = RoundedCornerShape(if (compact) 22.dp else 28.dp),
                color = androidx.compose.ui.graphics.Color.White,
                modifier = Modifier.size(if (compact) 96.dp else 132.dp),
            ) {
                Image(
                    painter = painterResource(R.drawable.saarthi_mark),
                    contentDescription = null,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(if (compact) 14.dp else 18.dp),
                )
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "SAARTHI",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 10.sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = "TERMINAL",
                    style = MaterialTheme.typography.titleLarge,
                    letterSpacing = 14.sp,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))

            Text(
                text = "Manage. Track. Move. Together.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
