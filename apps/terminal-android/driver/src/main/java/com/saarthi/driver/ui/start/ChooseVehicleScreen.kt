package com.saarthi.driver.ui.start

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.saarthi.core.ui.screens.QrCamera
import com.saarthi.core.ui.screens.vehicleIdentityCode
import com.saarthi.driver.R
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.DriverPreferences
import com.saarthi.driver.ui.DriverViewModel
import com.saarthi.driver.ui.design.AppName
import com.saarthi.driver.ui.design.Avatar
import com.saarthi.driver.ui.design.Brand
import com.saarthi.driver.ui.design.ButtonTone
import com.saarthi.driver.ui.design.Ease
import com.saarthi.driver.ui.design.Eyebrow
import com.saarthi.driver.ui.design.IconWell
import com.saarthi.driver.ui.design.LineIcon
import com.saarthi.driver.ui.design.LinkButton
import com.saarthi.driver.ui.design.Lucide
import com.saarthi.driver.ui.design.NoticeCard
import com.saarthi.driver.ui.design.NoticeTone
import com.saarthi.driver.ui.design.PlateField
import com.saarthi.driver.ui.design.RingSpinner
import com.saarthi.driver.ui.design.SType
import com.saarthi.driver.ui.design.SaarthiButton
import com.saarthi.driver.ui.design.Saarthi
import com.saarthi.driver.ui.design.SegmentedControl
import com.saarthi.driver.ui.design.StepHeader
import com.saarthi.driver.ui.design.StepScreen
import com.saarthi.driver.ui.design.SuccessDisc
import com.saarthi.driver.ui.design.brandGradient
import com.saarthi.driver.ui.design.breathing
import com.saarthi.driver.ui.design.card
import com.saarthi.driver.ui.design.popIn
import com.saarthi.driver.ui.design.pressable
import com.saarthi.driver.ui.design.rememberLoop
import com.saarthi.driver.ui.design.rise
import com.saarthi.driver.ui.design.stagger
import com.saarthi.driver.ui.profile.ProfileSheet

/**
 * Choose your vehicle — the screen a driver sees at the start of every shift.
 *
 * Two routes to one request, side by side: scan the code on the truck, or type
 * its number when the sticker is peeling or covered in road film. Neither
 * authorises anything; the fleet still approves, and the sentence under the
 * heading says so before the driver has done either.
 */
@Composable
fun ChooseVehicleScreen(
    viewModel: DriverViewModel,
    driver: DriverAccountStore.Account,
    preferences: DriverPreferences,
) {
    val context = LocalContext.current
    val c = Saarthi.colors
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    val fleet by viewModel.fleet.collectAsState()
    val quickLogin by viewModel.quickLoginMethods.collectAsState()
    val licenceMissing by viewModel.licenceMissing.collectAsState()

    var scanMode by rememberSaveable { mutableStateOf(true) }
    var number by rememberSaveable { mutableStateOf("") }
    var refused by remember { mutableStateOf<String?>(null) }
    var joinOpen by rememberSaveable { mutableStateOf(false) }
    var licenceOpen by rememberSaveable { mutableStateOf(false) }
    var profileOpen by rememberSaveable { mutableStateOf(false) }
    val openProfile = { profileOpen = true }
    var shake by remember { mutableIntStateOf(0) }

    // Set when this screen sent a request, so the shared busy flag — which a
    // fleet join also raises — only shows "Vehicle found" for a real request.
    var requesting by remember { mutableStateOf(false) }
    var requestedPlate by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(busy) { if (!busy) requesting = false }
    LaunchedEffect(error, refused) { if (error != null || refused != null) shake++ }

    val sendScan: (String) -> Unit = { token ->
        refused = null
        requesting = true
        requestedPlate = null
        withLastPosition(context) { lat, lng -> viewModel.vehicleScanned(token, lat, lng) }
    }
    val sendNumber: () -> Unit = {
        refused = null
        requesting = true
        requestedPlate = number.trim()
        withLastPosition(context) { lat, lng -> viewModel.vehicleNumberEntered(number, lat, lng) }
    }

    AnimatedContent(
        targetState = requesting && busy,
        transitionSpec = { fadeIn(tween(400)) togetherWith fadeOut(tween(200)) },
        label = "choose-vehicle",
    ) { sending ->
        if (sending) {
            VehicleFoundScreen(requestedPlate)
            return@AnimatedContent
        }
        Box(Modifier.fillMaxSize()) {
            StepScreen(scroll = true) {
                StepHeader(
                    eyebrow = AppName.APP,
                    title = stringResource(R.string.choose_header),
                    modifier = Modifier.rise(),
                ) {
                    Avatar(
                        driver.name,
                        size = 44.dp,
                        brand = true,
                        fontSize = 15.sp,
                        modifier = Modifier.pressable(scale = 0.94f, label = stringResource(R.string.profile_open), onClick = openProfile),
                    )
                }
                Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.choose_title), style = SType.display, color = c.fg, modifier = Modifier.rise(stagger(1)))
                    Text(stringResource(R.string.choose_lead), style = SType.lead, color = c.muted, modifier = Modifier.rise(stagger(2)))
                }

                when (fleet?.joined) {
                    false -> JoinFleetCard(Modifier.padding(top = 16.dp).rise(stagger(3))) { joinOpen = true }
                    true -> fleet?.name?.let { FleetPill(it, Modifier.padding(top = 14.dp).popIn()) }
                    null -> Unit
                }

                if (licenceMissing) {
                    NoticeCard(
                        stringResource(R.string.licence_reminder),
                        NoticeTone.INFO,
                        Modifier
                            .padding(top = 14.dp)
                            .rise(stagger(3)),
                        icon = Lucide.creditCard,
                        trailing = {
                            LinkButton(stringResource(R.string.licence_add), { licenceOpen = true }, style = SType.smallStrong)
                        },
                    )
                }

                SegmentedControl(
                    options = listOf(stringResource(R.string.choose_scan), stringResource(R.string.choose_number)),
                    icons = listOf(Lucide.qr, Lucide.hash),
                    selected = if (scanMode) 0 else 1,
                    onSelect = {
                        scanMode = it == 0
                        refused = null
                        viewModel.clearError()
                    },
                    container = c.segment,
                    modifier = Modifier
                        .padding(top = 16.dp)
                        .rise(stagger(4)),
                )

                if (scanMode) {
                    ScanSquare(
                        onToken = sendScan,
                        onRefused = { refused = it },
                        modifier = Modifier
                            .padding(top = 14.dp)
                            .rise(stagger(5)),
                    )
                } else {
                    Column(
                        Modifier
                            .padding(top = 14.dp)
                            .rise(stagger(5)),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        PlateField(
                            value = number,
                            onValueChange = { number = it },
                            keyboardActions = KeyboardActions(onDone = { if (number.trim().length >= 4) sendNumber() }),
                        )
                        // Four characters is the server's own floor.
                        SaarthiButton(
                            stringResource(R.string.choose_request),
                            sendNumber,
                            enabled = number.trim().length >= 4,
                        )
                    }
                }

                (refused ?: error)?.let { message ->
                    ErrorAlert(
                        message = message,
                        shakeKey = shake,
                        onJoin = if (fleet?.joined == false) ({ joinOpen = true }) else null,
                        modifier = Modifier.padding(top = 14.dp),
                    )
                }

                QuickLoginRow(
                    on = quickLogin.any,
                    onClick = openProfile,
                    modifier = Modifier
                        .padding(top = 14.dp)
                        .rise(stagger(6)),
                )
            }

            ProfileSheet(
                visible = profileOpen,
                driver = viewModel,
                preferences = preferences,
                onJoinFleet = { joinOpen = true },
                onAddLicence = { licenceOpen = true },
                onClose = { profileOpen = false },
            )
            JoinFleetSheet(
                visible = joinOpen,
                viewModel = viewModel,
                onDismiss = {
                    joinOpen = false
                    viewModel.clearError()
                },
            )
            AddLicenceSheet(
                visible = licenceOpen,
                viewModel = viewModel,
                onDismiss = {
                    licenceOpen = false
                    viewModel.clearError()
                },
            )
        }
    }
}

/** "Join your fleet first" — shown while the session says the driver has no fleet. */
@Composable
private fun JoinFleetCard(modifier: Modifier = Modifier, onEnterCode: () -> Unit) {
    val c = Saarthi.colors
    val shape = RoundedCornerShape(20.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.joinWash)
            .border(1.dp, c.primaryRing, shape)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .size(44.dp)
                .brandGradient(RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            LineIcon(Lucide.users, size = 20.dp, color = Color.White)
        }
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.join_card_title), style = SType.bodyStrong, color = c.fg)
            Text(stringResource(R.string.join_card_body), style = SType.small, color = c.muted)
        }
        Box(
            Modifier
                .height(44.dp)
                .clip(CircleShape)
                .background(c.primary)
                .pressable(onClick = onEnterCode)
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.join_card_action), style = SType.buttonSmall, color = c.onPrimary)
        }
    }
}

/** The fleet the driver belongs to, as a small confirmed chip. */
@Composable
private fun FleetPill(name: String, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .card(radius = 999.dp)
            .padding(start = 8.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconWell(Lucide.check, well = c.successSoft, ink = c.success, size = 24.dp, shape = CircleShape, iconSize = 12.dp, stroke = 3f)
        Text(name, style = SType.smallStrong, color = c.fg)
    }
}

/**
 * The live camera in a rounded square, with saffron brackets and a sweep line.
 *
 * The brackets tell a driver where the sticker goes; the sweep is the one thing
 * that says the camera is running rather than frozen, which matters in a dark
 * yard where nothing in the picture moves. Without camera permission the square
 * says why and offers the one button that fixes it.
 */
@Composable
private fun ScanSquare(
    onToken: (String) -> Unit,
    onRefused: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val camera = rememberCameraAccess()
    val shape = RoundedCornerShape(28.dp)
    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .shadow(18.dp, shape, spotColor = Color.Black.copy(alpha = 0.55f), ambientColor = Color.Transparent)
            .clip(shape)
            .background(
                Brush.radialGradient(
                    0f to Color(0xFF2A3140),
                    0.7f to Color(0xFF12151C),
                    1f to Color(0xFF0B0D12),
                ),
            ),
    ) {
        if (camera.granted) {
            QrCamera(
                onToken = onToken,
                onRejected = onRefused,
                accept = ::vehicleIdentityCode,
                modifier = Modifier.fillMaxSize(),
            )
            ScanOverlay()
        } else {
            NoCamera(onAllow = camera.request)
        }
    }
}

@Composable
private fun BoxScope.ScanOverlay() {
    val sweep by rememberLoop(1_200, Ease.standard, reverse = true, rest = 0.5f, label = "scan-sweep")
    Eyebrow(
        stringResource(R.string.choose_scan_label),
        Modifier
            .align(Alignment.TopStart)
            .padding(18.dp),
        color = Color.White.copy(alpha = 0.8f),
    )
    Canvas(
        Modifier
            .matchParentSize()
            .padding(horizontal = 46.dp, vertical = 58.dp)
            .breathing(periodMs = 2_400, low = 0.55f),
    ) {
        drawBrackets(Brand.saffron, 2.4.dp.toPx())
    }
    Canvas(Modifier.matchParentSize()) {
        val top = size.height * 0.14f
        val bottom = size.height * 0.84f
        val y = top + (bottom - top) * sweep
        val left = size.width * 0.15f
        val right = size.width * 0.85f
        drawLine(
            Brush.horizontalGradient(
                listOf(Brand.saffron.copy(alpha = 0f), Brand.saffron.copy(alpha = 0.95f), Brand.saffron.copy(alpha = 0f)),
                startX = left,
                endX = right,
            ),
            Offset(left, y),
            Offset(right, y),
            strokeWidth = 2.dp.toPx(),
        )
    }
    Text(
        stringResource(R.string.choose_scan_hint),
        style = SType.small,
        color = Color.White.copy(alpha = 0.8f),
        modifier = Modifier
            .align(Alignment.BottomStart)
            .padding(start = 18.dp, end = 18.dp, bottom = 16.dp),
    )
}


/** Four rounded corner brackets filling the canvas — the design's viewfinder frame. */
internal fun androidx.compose.ui.graphics.drawscope.DrawScope.drawBrackets(color: Color, width: Float) {
    val arm = size.minDimension * 0.16f
    val r = size.minDimension * 0.04f
    val w = size.width
    val h = size.height
    val path = Path().apply {
        moveTo(0f, arm); lineTo(0f, r); quadraticTo(0f, 0f, r, 0f); lineTo(arm, 0f)
        moveTo(w - arm, 0f); lineTo(w - r, 0f); quadraticTo(w, 0f, w, r); lineTo(w, arm)
        moveTo(w, h - arm); lineTo(w, h - r); quadraticTo(w, h, w - r, h); lineTo(w - arm, h)
        moveTo(arm, h); lineTo(r, h); quadraticTo(0f, h, 0f, h - r); lineTo(0f, h - arm)
    }
    drawPath(path, color, style = Stroke(width, cap = StrokeCap.Round))
}

@Composable
private fun BoxScope.NoCamera(onAllow: () -> Unit) {
    Column(
        Modifier
            .align(Alignment.Center)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        LineIcon(Lucide.camera, size = 40.dp, color = Color.White.copy(alpha = 0.7f), stroke = 1.8f)
        Text(
            stringResource(R.string.camera_needed_scan),
            style = SType.body,
            color = Color.White.copy(alpha = 0.85f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        SaarthiButton(stringResource(R.string.camera_allow), onAllow, tone = ButtonTone.WHITE, leading = Lucide.camera)
    }
}

/**
 * A refusal, shaken into view — the wrong truck, a code from another fleet.
 *
 * Offers "Join" when the driver has no fleet yet, because that is what almost
 * every refusal means for them.
 */
@Composable
private fun ErrorAlert(message: String, shakeKey: Int, onJoin: (() -> Unit)?, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val offset = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(shakeKey) {
        if (shakeKey == 0) return@LaunchedEffect
        offset.animateTo(
            0f,
            androidx.compose.animation.core.keyframes {
                durationMillis = 500
                -2f at 50; 4f at 100; -6f at 150; 6f at 200; -6f at 250; 6f at 300; -6f at 350; 4f at 400; -2f at 450
            },
        )
    }
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier
            .graphicsLayer { translationX = offset.value * density }
            .fillMaxWidth()
            .clip(shape)
            .background(c.dangerWash)
            .border(1.dp, c.dangerRing, shape)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(c.danger),
        )
        Text(message, style = SType.body, color = c.fg, modifier = Modifier.weight(1f))
        onJoin?.let {
            LinkButton(stringResource(R.string.join_link), it, style = SType.body, modifier = Modifier.height(32.dp))
        }
    }
}

/** The Quick Login row at the foot of the screen, which opens the profile's settings. */
@Composable
private fun QuickLoginRow(on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .card(radius = 20.dp)
            .pressable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        IconWell(Lucide.fingerprint, well = c.successSoft, ink = c.success, size = 40.dp, shape = CircleShape, iconSize = 18.dp)
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.quick_login), style = SType.bodyStrong, color = c.fg)
            Text(
                stringResource(if (on) R.string.choose_quick_on else R.string.choose_quick_off),
                style = SType.small,
                color = c.muted,
            )
        }
        LineIcon(Lucide.chevronRight, size = 18.dp, color = c.subtle)
    }
}

/**
 * "Vehicle found" — the code read, the request on its way to the fleet.
 *
 * Green brackets snap onto the square and a tick pops in, then the plate, while
 * the card underneath says exactly what is happening: nothing is approved yet.
 */
@Composable
private fun VehicleFoundScreen(plate: String?) {
    val c = Saarthi.colors
    StepScreen {
        StepHeader(
            eyebrow = stringResource(R.string.choose_header),
            title = stringResource(R.string.found_title),
        )
        Box(
            Modifier
                .padding(top = 14.dp)
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(28.dp))
                .background(
                    Brush.radialGradient(
                        0f to Color(0xFF243A33),
                        0.7f to Color(0xFF10171A),
                        1f to Color(0xFF0B0D12),
                    ),
                ),
        ) {
            Canvas(
                Modifier
                    .matchParentSize()
                    .padding(horizontal = 92.dp, vertical = 92.dp)
                    .popIn(from = 1.25f),
            ) {
                drawBrackets(Color(0xFF4ADE80), 3.dp.toPx())
            }
            SuccessDisc(
                size = 76.dp,
                disc = Color(0xFF22C55E),
                tick = Color.White,
                halo = Color(0x3822C55E),
                haloWidth = 10.dp,
                tickSize = 38.dp,
                tickStroke = 3f,
                modifier = Modifier.align(Alignment.Center),
            )
            plate?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it.uppercase(),
                    style = SType.plate(20.sp),
                    color = Color(0xFF18181B),
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 22.dp)
                        .rise(stagger(4))
                        .shadow(10.dp, RoundedCornerShape(12.dp))
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
        Row(
            Modifier
                .padding(top = 18.dp)
                .rise(stagger(5))
                .fillMaxWidth()
                .card()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(c.primarySoft),
                contentAlignment = Alignment.Center,
            ) {
                RingSpinner(track = Color.Transparent, head = c.primary, size = 24.dp, stroke = 2.5.dp)
            }
            Text(stringResource(R.string.found_sending), style = SType.lead, color = c.muted)
        }
    }
}

