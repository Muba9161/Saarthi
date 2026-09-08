package com.saarthi.driver.ui

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Dialpad
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.location.LocationServices
import com.saarthi.core.ui.LocalReducedMotion
import com.saarthi.core.ui.screens.ScannerPanel
import com.saarthi.core.ui.screens.vehicleIdentityCode
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.ui.design.Ash
import com.saarthi.driver.ui.design.Chalk
import com.saarthi.driver.ui.design.Ember
import com.saarthi.driver.ui.design.EmberBright
import com.saarthi.driver.ui.design.FleetButton
import com.saarthi.driver.ui.design.FleetCard
import com.saarthi.driver.ui.design.FleetEnter
import com.saarthi.driver.ui.design.FleetError
import com.saarthi.driver.ui.design.FleetField
import com.saarthi.driver.ui.design.FleetMotion
import com.saarthi.driver.ui.design.FleetMono
import com.saarthi.driver.ui.design.FleetRadius
import com.saarthi.driver.ui.design.FleetScreen
import com.saarthi.driver.ui.design.FleetSpace
import com.saarthi.driver.ui.design.FleetTextButton
import com.saarthi.driver.ui.design.FleetTile
import com.saarthi.driver.ui.design.FleetWorking
import com.saarthi.driver.ui.design.Hairline
import com.saarthi.driver.ui.design.Monogram
import com.saarthi.driver.ui.design.Obsidian
import com.saarthi.driver.ui.design.Onyx
import com.saarthi.driver.ui.design.SectionHeader
import com.saarthi.driver.ui.design.Slate
import com.saarthi.driver.ui.design.TileRow
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberSweep
import com.saarthi.driver.ui.design.stillOr

/** How the driver is naming the vehicle on this screen. */
private enum class VehicleEntry { SCAN, NUMBER }

/**
 * Point the phone at the truck.
 *
 * The whole of "starting a shift", as far as a driver is concerned, and the
 * screen they will look at more than any other in the app. They scan the code
 * stuck to the vehicle and wait — no vehicle list to search, no registration to
 * type, nobody to telephone.
 *
 * It is laid out as a home screen rather than as a form: who you are, the ways
 * in, then the work surface. The four tiles at the top are the whole of what a
 * driver can do here, and two of them — scan and type — are the two routes to
 * the same request, shown side by side and never one behind the other. A sticker
 * peels, gets covered in road film, or sits on a trailer parked nose-in against
 * a wall, and a driver who cannot scan must not be unable to work.
 *
 * Neither route authorises anything. The fleet still approves, and the copy on
 * this screen is careful to say so before the driver has done either.
 *
 * The position is sent with the request when the phone knows it. It is not a
 * check on the driver, and it is not required: the fleet approving the request
 * sees where the scan happened, which is what turns "somebody scanned RIG0001"
 * into "somebody scanned RIG0001 while standing next to it".
 */
@Composable
fun ScanVehicleScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
    @Suppress("UNUSED_PARAMETER") onDarkThemeChanged: (Boolean) -> Unit,
    onOpenProfile: () -> Unit,
) {
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val context = LocalContext.current

    // Refused codes are shown here rather than through the view model: a driver
    // waving the camera at the wrong sticker is not a failure worth keeping
    // after the next frame reads correctly.
    var refused by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf(VehicleEntry.SCAN) }
    var showSecurity by remember { mutableStateOf(false) }
    val quickLogin by viewModel.quickLoginMethods.collectAsState()
    var number by remember { mutableStateOf("") }

    val firstName = driver.name.trim().substringBefore(' ').ifBlank { "driver" }

    FleetScreen {
        Spacer(Modifier.height(FleetSpace.snug))

        /*
         * Who you are, and the ways in — as four tiles.
         *
         * The profile used to be the word "Sign out" in this corner, which put
         * the most destructive action on the screen a driver sees most and hid
         * the profile entirely. Signing out now lives inside the profile, one
         * deliberate step further away.
         */
        FleetEnter(index = 0) {
            TileRow {
                ProfileTile(
                    name = firstName,
                    fullName = driver.name,
                    onClick = onOpenProfile,
                    modifier = Modifier.weight(1f),
                )
                FleetTile(
                    icon = Icons.Rounded.QrCodeScanner,
                    title = "Scan code",
                    subtitle = if (mode == VehicleEntry.SCAN) "Selected" else "Fastest",
                    accent = mode == VehicleEntry.SCAN,
                    onClick = {
                        mode = VehicleEntry.SCAN
                        refused = null
                        viewModel.clearError()
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.snug))

        FleetEnter(index = 1) {
            TileRow {
                FleetTile(
                    icon = Icons.Rounded.Dialpad,
                    title = "Enter number",
                    subtitle = if (mode == VehicleEntry.NUMBER) "Selected" else "If it won't scan",
                    accent = mode == VehicleEntry.NUMBER,
                    onClick = {
                        mode = VehicleEntry.NUMBER
                        refused = null
                        viewModel.clearError()
                    },
                    modifier = Modifier.weight(1f),
                )
                FleetTile(
                    icon = Icons.Rounded.Fingerprint,
                    title = "Quick Login",
                    subtitle = if (quickLogin.any) "On · Change" else "Off · Set up",
                    accent = showSecurity,
                    onClick = { showSecurity = !showSecurity },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.section))

        FleetEnter(index = 2) {
            Column(Modifier.fillMaxWidth()) {
                Text(
                    "Choose your vehicle",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Chalk,
                )
                Spacer(Modifier.height(FleetSpace.tight))
                Text(
                    "Scan the Saarthi code on the vehicle, or enter its number. Your " +
                        "fleet approves you before the trip can start.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Ash,
                )
            }
        }

        Spacer(Modifier.height(FleetSpace.base))

        FleetEnter(index = 3) {
            FleetCard(Modifier.fillMaxWidth(), padding = FleetSpace.base) {
                when {
                    busy -> {
                        Spacer(Modifier.height(FleetSpace.snug))
                        FleetWorking("Sending your request to the fleet…")
                        Spacer(Modifier.height(FleetSpace.snug))
                    }

                    mode == VehicleEntry.SCAN -> {
                        ScannerFrame {
                            ScannerPanel(
                                onToken = { token ->
                                    refused = null
                                    withLastPosition(context) { latitude, longitude ->
                                        viewModel.vehicleScanned(token, latitude, longitude)
                                    }
                                },
                                onRejected = { refused = it },
                                accept = ::vehicleIdentityCode,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                        Spacer(Modifier.height(FleetSpace.snug))
                        Text(
                            "Hold the phone steady over the sticker on the door or the " +
                                "windscreen.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate,
                        )
                    }

                    else -> {
                        FleetField(
                            value = number,
                            onValueChange = { number = it.uppercase() },
                            label = "Vehicle number",
                            placeholder = "DL 01 AB 1234",
                            // Capitals and no autocorrect: a registration is not
                            // a word, and a keyboard that helpfully corrects one
                            // is a keyboard that stops a driver working.
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Characters,
                                autoCorrectEnabled = false,
                                imeAction = ImeAction.Done,
                            ),
                            textStyle = MaterialTheme.typography.titleLarge.copy(
                                fontFamily = FleetMono,
                                color = Chalk,
                                letterSpacing = 2.sp,
                            ),
                        )
                        Spacer(Modifier.height(FleetSpace.base))
                        FleetButton(
                            label = "Request this vehicle",
                            // Four characters is the server's own floor, so a
                            // rejection never arrives after typing.
                            enabled = number.trim().length >= 4,
                            onClick = {
                                refused = null
                                withLastPosition(context) { latitude, longitude ->
                                    viewModel.vehicleNumberEntered(number, latitude, longitude)
                                }
                            },
                        )
                    }
                }
            }
        }

        (refused ?: error)?.let { message ->
            Spacer(Modifier.height(FleetSpace.snug))
            FleetError(message)
        }

        /*
         * Quick Login, on the screen a driver is already on.
         *
         * Behind the tile rather than always open, so it does not compete with
         * the camera — but on this screen rather than a settings menu, because
         * this is where a signed-in driver stands when they are not driving, and
         * a security control three taps deep is one nobody uses.
         */
        AnimatedVisibility(
            visible = showSecurity,
            enter = fadeIn(FleetMotion.enter(stillOr(FleetMotion.QUICK))) +
                expandVertically(FleetMotion.settle()),
            exit = fadeOut(FleetMotion.enter(stillOr(FleetMotion.EXIT))) +
                shrinkVertically(FleetMotion.settle()),
        ) {
            Column(Modifier.fillMaxWidth()) {
                Spacer(Modifier.height(FleetSpace.section))
                SectionHeader("Sign-in and security")
                Spacer(Modifier.height(FleetSpace.snug))
                QuickLoginSettings(viewModel)
                Spacer(Modifier.height(FleetSpace.tight))
                FleetTextButton("Hide", onClick = { showSecurity = false }, tint = Ash)
            }
        }

        Spacer(Modifier.height(FleetSpace.wide))
    }
}

/**
 * The driver, as the first tile.
 *
 * Their own name is the one piece of information on this screen that is theirs
 * rather than the fleet's, and putting it first is what makes the app read as
 * something they are signed in to rather than a terminal they are using.
 */
@Composable
private fun ProfileTile(
    name: String,
    fullName: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            // The same floor as FleetTile: the two sit side by side in a row,
            // and a four-pixel difference between them is the sort of thing
            // that makes a screen look assembled rather than designed.
            .sizeIn(minHeight = 72.dp)
            .clip(RoundedCornerShape(FleetRadius.tile))
            .background(Onyx)
            .border(1.dp, Hairline, RoundedCornerShape(FleetRadius.tile))
            .pressable(onClick = onClick)
            .padding(horizontal = FleetSpace.snug, vertical = FleetSpace.snug),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FleetSpace.snug),
    ) {
        Monogram(fullName, size = 44.dp)
        Column(Modifier.weight(1f)) {
            Text(
                "Hi, $name!",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = Chalk,
                maxLines = 1,
            )
            Text(
                "Change profile",
                style = MaterialTheme.typography.bodySmall,
                color = Ash,
                maxLines = 1,
            )
        }
    }
}

/**
 * The viewfinder, framed.
 *
 * Four corner brackets and a sweep line over the live camera. Neither is
 * decoration: the brackets tell a driver where to put the sticker, and the
 * sweep is the only thing on the screen that says the camera is running rather
 * than frozen — which matters when the picture is a dark yard at night and
 * nothing in it is moving.
 *
 * The sweep stops under reduced motion. The brackets stay.
 */
@Composable
private fun ScannerFrame(content: @Composable () -> Unit) {
    val sweep by rememberSweep(2_400)
    val reducedMotion = LocalReducedMotion.current

    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RoundedCornerShape(FleetRadius.tile))
            .background(Obsidian),
    ) {
        content()

        Canvas(Modifier.fillMaxSize().clearAndSetSemantics { }) {
            val inset = size.minDimension * 0.10f
            val arm = size.minDimension * 0.11f
            val left = inset
            val top = inset
            val right = size.width - inset
            val bottom = size.height - inset

            val bracket = Path().apply {
                moveTo(left, top + arm); lineTo(left, top); lineTo(left + arm, top)
                moveTo(right - arm, top); lineTo(right, top); lineTo(right, top + arm)
                moveTo(right, bottom - arm); lineTo(right, bottom); lineTo(right - arm, bottom)
                moveTo(left + arm, bottom); lineTo(left, bottom); lineTo(left, bottom - arm)
            }
            drawPath(
                bracket,
                color = EmberBright,
                style = Stroke(width = 5f, cap = StrokeCap.Round),
            )

            if (!reducedMotion) {
                // Down and back, rather than jumping to the top: a line that
                // restarts reads as a repaint, one that returns reads as a scan.
                val travel = if (sweep <= 0.5f) sweep * 2f else (1f - sweep) * 2f
                val y = top + (bottom - top) * travel
                drawLine(
                    brush = Brush.horizontalGradient(
                        listOf(Color.Transparent, Ember.copy(alpha = 0.85f), Color.Transparent),
                    ),
                    start = Offset(left, y),
                    end = Offset(right, y),
                    strokeWidth = 3f,
                )
            }
        }
    }
}

/**
 * The last known position, if the phone has one, and nothing if it does not.
 *
 * Deliberately not a fresh fix. Asking for one costs seconds a driver spends
 * looking at a spinner in a yard, and the request is just as valid without a
 * position — the server treats it as optional, so waiting for GPS would be
 * trading the thing that matters for the thing that does not.
 */
@SuppressLint("MissingPermission")
private fun withLastPosition(
    context: Context,
    send: (latitude: Double?, longitude: Double?) -> Unit,
) {
    runCatching {
        LocationServices.getFusedLocationProviderClient(context).lastLocation
            .addOnSuccessListener { location -> send(location?.latitude, location?.longitude) }
            .addOnFailureListener { send(null, null) }
    }.onFailure { send(null, null) }
}
