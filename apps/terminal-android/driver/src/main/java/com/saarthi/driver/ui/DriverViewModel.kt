package com.saarthi.driver.ui

import android.app.Application
import androidx.annotation.StringRes
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.domain.TerminalState
import com.saarthi.core.network.SaarthiApi
import com.saarthi.core.ui.Language
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.R
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.QuickLoginStore
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.network.RideSharesApi
import com.saarthi.driver.ride.NamedContactsStore
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.ride.RideAccess
import com.saarthi.driver.ui.ride.share.RideShareActions
import com.saarthi.driver.ui.lock.canLockApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.crypto.Cipher

/**
 * A driver's way in.
 *
 * Everything from opening the app to being approved onto a truck. Once approved
 * the phone pairs itself to the vehicle and the shared cockpit takes over — so
 * this class stops where `TerminalViewModel` starts, and deliberately knows
 * nothing about maps, trips or telemetry. A rider — somebody travelling in a
 * vehicle without driving it — never reaches the cockpit at all; their whole
 * journey, from naming the vehicle to stopping the share, is the share stages
 * below.
 *
 * The states below are the screens, in the order a driver meets them. There is
 * no back stack: a driver cannot press Back out of an approved session into the
 * scanner, because that would not mean anything to the fleet that approved them.
 */
class DriverViewModel(application: Application) : AndroidViewModel(application) {

    private val app: SaarthiDriverApp = application as SaarthiDriverApp
    private val api: DriverApi = app.driverApi
    private val shares = RideSharesApi(api)

    /** Whether this account may ride along — the server decides — and whether it holds an owner account. */
    private val rideAccess = RideAccess(shares)

    /*
     * Declared here, above every `init` block, and that placement is the fix
     * for a real crash rather than a matter of taste.
     *
     * Kotlin runs property initialisers and `init` blocks in declaration order.
     * This started life below the `init` that calls `restore()`, so `restore()`
     * ran first, read `quickLogin.enabled` and found null — an immediate
     * NullPointerException in the view model's constructor, which to the person
     * holding the phone is an app that will not open at all.
     *
     * Nothing about it was visible in a debug build until Quick Login was
     * enabled, and nothing about it is visible in a compiler warning.
     */
    private val quickLogin = app.quickLogin

    /** Which quick-unlock methods this driver has turned on. */
    val quickLoginMethods: StateFlow<QuickLoginStore.Enabled> = quickLogin.enabled

    /** Who is signed in, for the profile. Null once they sign out. */
    val account: StateFlow<DriverAccountStore.Account?> = app.account.account

    /** Whether the driver belongs to a fleet yet, from the latest session. */
    val fleet: StateFlow<DriverApi.Fleet?> = api.fleet

    /** The driver registered without a licence and has not added it yet. */
    val licenceMissing: StateFlow<Boolean> = api.licenceMissing

    /** Whether "How are you travelling?" is offered — and so the way back to it from the vehicle screen. */
    val rideAlong: StateFlow<Boolean> = rideAccess.allowed

    /** Where the driver is on the way to a working cockpit. */
    sealed interface Stage {
        /** Deciding, on launch, whether the stored session still works. */
        data object Restoring : Stage

        /** Nobody is signed in. */
        data object SignedOut : Stage

        /**
         * Signed in, but Saarthi could not be reached to restore the session:
         * no signal, or the server briefly unavailable. Not a sign-in screen,
         * because nothing is wrong with the session; it carries on by itself
         * once the connection returns.
         */
        data object Unreachable : Stage

        /**
         * A credential still sealed by the retired Saarthi Quick Login.
         *
         * Humsafar now opens straight away and guards the screen with App lock,
         * as the owner app does. A driver who set a Quick Login PIN or
         * fingerprint before that change has their session sealed behind it,
         * so they unlock with it one last time. The session then moves to
         * ordinary encrypted storage and App lock is switched on for them.
         * Nobody reaches this stage otherwise.
         */
        data class Locked(val methods: QuickLoginStore.Enabled) : Stage

        /**
         * Signed in, nothing open: driving, or riding along?
         *
         * Asked first because the two are different people to Saarthi. A driver
         * is approved by their fleet and the phone becomes the vehicle's
         * terminal; a rider shares their ride with family and is never the
         * vehicle's driver or its paired phone. Only asked when the server allows it.
         */
        data class ChooseRole(val driver: DriverAccountStore.Account) : Stage

        /** Driving, no vehicle yet. The scanner. */
        data class ChooseVehicle(val driver: DriverAccountStore.Account) : Stage

        /**
         * Riding along, step one: the vehicle's number, typed — no QR, which
         * names a driver's vehicle — so family know which vehicle to look for.
         */
        data class ShareVehicle(val driver: DriverAccountStore.Account, val plate: String = "") : Stage

        /** Riding along, step two: who should see where the rider is. */
        data class ShareSetup(val driver: DriverAccountStore.Account, val plate: String) : Stage

        /** Shared: family can follow the phone live. [named] are the contacts typed on this phone. */
        data class Sharing(val share: RideSharesApi.ShareView, val named: List<String> = emptyList()) : Stage

        /** The share ran out of time, and the rider is told so once. */
        data class ShareOver(val share: RideSharesApi.ShareView) : Stage

        /**
         * Named a vehicle, and the fleet needs a photograph before it decides.
         *
         * Not skippable, and not a courtesy: `submitForApproval` refuses without
         * a photo, so a driver who bypassed this would meet the refusal one
         * screen later with nothing they could do about it.
         */
        data class Selfie(val assignment: DriverApi.AssignmentDto) : Stage

        /** Scanned, waiting for the fleet. */
        data class AwaitingApproval(val assignment: DriverApi.AssignmentDto) : Stage

        /** The fleet said no, with a reason worth showing. */
        data class Rejected(val assignment: DriverApi.AssignmentDto) : Stage

        /** Approved and paired. The cockpit runs from here. */
        data class Driving(val assignment: DriverApi.AssignmentDto) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Restoring)
    val stage: StateFlow<Stage> = _stage.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** The last refusal, in the server's own words. Cleared on the next attempt. */
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** One pairing at a time; see [pairToVehicle]. */
    private val pairingLock = Mutex()

    /**
     * The vehicle just scanned has a Saarthi OBD, and the adapter should be
     * connected now — at the vehicle, not mid-shift.
     */
    private val _obdSetup = MutableStateFlow(false)
    val obdSetup: StateFlow<Boolean> = _obdSetup.asStateFlow()

    /** Requests the OBD prompt has already been shown for, so a poll cannot reopen it. */
    private val obdOffered = mutableSetOf<String>()

    fun dismissObdSetup() {
        _obdSetup.value = false
    }

    /** Riding along: naming the vehicle and family, sharing, and stopping. */
    val sharing = RideShareActions(
        shares = shares,
        access = rideAccess,
        named = NamedContactsStore(application),
        scope = viewModelScope,
        stage = _stage,
        busy = _busy,
        attempt = ::attempt,
        account = { app.account.account.value },
        home = ::noOpenWork,
        notAllowed = ::notAllowed,
    )

    init {
        restore()
    }

    /**
     * Work out, without asking, what the driver should be looking at.
     *
     * Runs on every launch. The stored refresh token is exchanged silently, and
     * then the server is asked whether this driver already has a request open —
     * so a driver who signed on, put the phone in their pocket and reopened the
     * app two hours later comes back to the same session rather than a scanner.
     */
    fun restore() {
        viewModelScope.launch {
            _stage.value = Stage.Restoring
            _stage.value = resolveSession()
        }
    }

    /**
     * Try the connection again from [Stage.Unreachable].
     *
     * Stays on that screen while it asks, with the button busy, rather than
     * flashing the splash on every attempt; the automatic retry uses this too.
     */
    fun retryConnection() {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            try {
                _stage.value = resolveSession()
            } finally {
                _busy.value = false
            }
        }
    }

    /** The stage the stored session leads to, asking Saarthi as little as it can. */
    private suspend fun resolveSession(): Stage {
        /*
         * A credential the retired Quick Login still holds.
         *
         * Only drivers who set a PIN or fingerprint before App lock replaced
         * it. The refresh token is sealed and not in the account store, so
         * it cannot restore silently: they unlock once (see [Stage.Locked]).
         * If nothing sealed is left to open, only a password gets back in.
         */
        if (app.account.heldByQuickLogin && app.account.account.value != null) {
            val methods = quickLogin.enabled.value
            if (methods.any) return Stage.Locked(methods)
            app.account.clear()
        }
        retireQuickLogin()

        val driver = try {
            api.restore()
        } catch (failure: DriverApi.Failure) {
            // Saarthi could not be asked. The session is kept, so this is not a sign-in.
            DebugLog.info(TAG, "Could not reach Saarthi to restore the session: ${failure.message}")
            return Stage.Unreachable
        } ?: return Stage.SignedOut

        return stageForOpenAssignment(driver)
    }

    fun signIn(email: String, password: String) {
        attempt { _stage.value = afterSignIn(api.signIn(email.trim(), password)) }
    }

    fun register(request: DriverApi.RegisterRequest) {
        attempt { _stage.value = afterSignIn(api.register(request)) }
    }

    /**
     * Where a driver goes the moment a password worked: straight in.
     *
     * No offer to set anything up, as in the owner app. App lock is a switch in
     * Profile for whoever wants it.
     */
    private suspend fun afterSignIn(driver: DriverAccountStore.Account): Stage {
        // A new sign-in may be a different account: ask again whether it may ride along.
        rideAccess.forget()
        // The credential was just stored readable; anything sealed is from before.
        retireQuickLogin()
        return stageForOpenAssignment(driver)
    }

    /**
     * A vehicle QR was read.
     *
     * Scanning is not authorisation — this opens a request and the fleet still
     * decides. The wording on the waiting screen says so, because a driver who
     * believes scanning was enough will climb in and start driving.
     */
    fun vehicleScanned(qrToken: String, latitude: Double?, longitude: Double?) {
        attempt {
            _stage.value = stageFor(api.requestAssignmentByQr(qrToken, latitude, longitude))
        }
    }

    /**
     * A registration number, typed.
     *
     * The same request, the same approval, the same everything after this line.
     * Knowing a number authorises nobody — it names a vehicle, and the fleet
     * still decides.
     */
    fun vehicleNumberEntered(registrationNumber: String, latitude: Double?, longitude: Double?) {
        attempt {
            _stage.value = stageFor(
                api.requestAssignmentByNumber(registrationNumber.trim(), latitude, longitude),
            )
        }
    }

    /**
     * Join a fleet with its joining code.
     *
     * Self-service, and the code is the whole authorisation — the server says
     * in plain words when it is wrong, full, or the driver already belongs
     * elsewhere, and that sentence lands in [error] like any other refusal.
     */
    fun joinFleet(code: String, onJoined: (DriverApi.Fleet) -> Unit) {
        attempt { onJoined(api.joinFleet(code)) }
    }

    /**
     * Email the registration code. Not behind [busy]: the step stays on screen
     * while it sends, rather than switching to "Creating your account".
     */
    fun sendRegistrationCode(email: String, firstName: String, onSent: (DriverApi.EmailCode?) -> Unit) {
        viewModelScope.launch {
            _error.value = null
            val sent = try {
                api.sendRegistrationCode(email, firstName)
            } catch (failure: DriverApi.Failure) {
                _error.value = failure.message
                null
            } catch (failure: Exception) {
                DebugLog.warn(TAG, "Could not send the registration code: ${failure.message}")
                _error.value = text(R.string.error_generic)
                null
            }
            onSent(sent)
        }
    }

    /**
     * Request a password reset email for [email].
     *
     * Successful dispatch delivers the server's confirmation message to [onResult].
     * Failures populate [_error] and notify [onResult].
     */
    fun forgotPassword(email: String, onResult: (Result<String>) -> Unit) {
        viewModelScope.launch {
            _error.value = null
            try {
                val message = api.forgotPassword(email) ?: text(R.string.signin_forgot_sent)
                onResult(Result.success(message))
            } catch (failure: DriverApi.Failure) {
                _error.value = failure.message
                onResult(Result.failure(failure))
            } catch (failure: Exception) {
                DebugLog.warn(TAG, "Could not send password reset: ${failure.message}")
                _error.value = text(R.string.error_generic)
                onResult(Result.failure(failure))
            }
        }
    }

    /** Record the licence skipped at sign-up. Failures land in [error]. */
    fun addLicence(number: String, onSaved: () -> Unit) {
        attempt {
            api.addLicence(number)
            onSaved()
        }
    }

    /** Poll for a decision. Called while the waiting screen is on show. */
    fun refreshAssignment() {
        viewModelScope.launch {
            val assignment = runCatching { api.myAssignment() }.getOrNull() ?: return@launch
            val next = stageFor(assignment)
            // Only move forward. A poll that raced a scan must not drop a driver
            // back to a screen they have already left.
            if (next::class != _stage.value::class) _stage.value = next
        }
    }

    /** Withdraw the request — wrong truck, or the driver walked away. */
    fun cancel() {
        val current = _stage.value
        val assignment = when (current) {
            is Stage.AwaitingApproval -> current.assignment
            is Stage.Rejected -> current.assignment
            else -> return
        }
        attempt {
            api.cancel(assignment.id)
            val driver = app.account.account.value ?: return@attempt
            // Still driving: back to the vehicle screen, exactly as before riding along existed.
            _stage.value = Stage.ChooseVehicle(driver)
        }
    }

    // -----------------------------------------------------------------------
    // Riding along
    // -----------------------------------------------------------------------

    /** "I'm driving" — on to the scanner, exactly as before riding along existed. */
    fun chooseDriving() = moveOn(Stage::ChooseVehicle)

    /** "I'm riding along" — on to typing the vehicle's number. */
    fun chooseRiding() = moveOn { Stage.ShareVehicle(it) }

    /**
     * Back to "How are you travelling?" — from either branch, or once a share
     * is over. Straight to the vehicle screen when this account may not ride along.
     */
    fun chooseAgain() {
        val driver = app.account.account.value ?: return
        _error.value = null
        viewModelScope.launch { _stage.value = home(driver) }
    }

    private fun moveOn(next: (DriverAccountStore.Account) -> Stage) {
        val driver = app.account.account.value ?: return
        _error.value = null
        _stage.value = next(driver)
    }

    /** This account may not ride along (any more): the vehicle screen, with the server's reason. */
    private fun notAllowed(refused: DriverApi.Failure.Refused) {
        rideAccess.refused()
        val driver = app.account.account.value ?: return
        _stage.value = Stage.ChooseVehicle(driver)
        _error.value = refused.message
    }

    /**
     * Send the arrival photo, then send the request.
     *
     * One action from the driver's side, because the two are one decision: a
     * photo uploaded and not submitted helps nobody, and leaving them separate
     * would put a "now submit" button in front of somebody who has already said
     * they are ready.
     *
     * The upload is idempotent server-side — retaking before submission
     * supersedes the previous photo — so a retry after a failure replaces rather
     * than duplicates.
     */
    fun submitSelfie(assignmentId: String, jpeg: ByteArray) {
        attempt {
            api.uploadSelfie(assignmentId, jpeg)
            _stage.value = stageFor(api.submit(assignmentId))
        }
    }

    /** A camera failure, in words the driver can act on. */
    fun reportSelfieFailure(message: String) {
        _error.value = message
    }

    // -----------------------------------------------------------------------
    // The retired Quick Login: one last unlock, then App lock
    // -----------------------------------------------------------------------

    /**
     * Unlock with the old Quick Login PIN.
     *
     * The PIN is checked on the device and never leaves it. What it produces is
     * the refresh token, which goes to the ordinary refresh endpoint, so the
     * server still decides whether the session lives.
     */
    fun unlockWithPin(pin: String) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null

            quickLogin.unlockWithPin(pin)
                .onSuccess { token -> resumeWith(token) }
                .onFailure { failure -> handleUnlockFailure(failure) }

            _busy.value = false
        }
    }

    /** Unlock with a cipher the system biometric prompt has just authorised. */
    fun unlockWithBiometric(cipher: Cipher) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null

            quickLogin.unlockWithBiometricCipher(cipher)
                .onSuccess { token -> resumeWith(token) }
                .onFailure { failure -> handleUnlockFailure(failure) }

            _busy.value = false
        }
    }

    /** The cipher a biometric prompt must authorise, or null when unavailable. */
    fun biometricCipher(): Cipher? = quickLogin.biometricCipher()

    /**
     * No prompt could be raised, and the driver is owed an explanation.
     *
     * Called when [biometricCipher] comes back null. The store has already
     * switched the slot off by this point, so the live `quickLoginMethods` drops
     * the button on the next recomposition. All that is left is to say why.
     */
    fun reportBiometricUnavailable() {
        _error.value = quickLogin.takeBiometricProblem()
            ?: text(R.string.biometric_unavailable)
    }

    /**
     * Carry on from an unlocked credential, and leave Quick Login behind.
     *
     * The refresh exchange stores the rotated token in the account store, where
     * every later launch restores it silently. The sealed copies are then
     * destroyed, and App lock takes over the job the PIN or fingerprint was
     * doing, so the driver keeps a lock without being asked to set one up again.
     */
    private suspend fun resumeWith(token: String) {
        // The server remains the authority. An unlocked PIN proves who is
        // holding the phone; only the refresh endpoint can say the session lives.
        val driver = try {
            api.restoreWith(token)
        } catch (failure: DriverApi.Failure) {
            /*
             * No signal, or Saarthi briefly unavailable. That says nothing about
             * the session, and nothing was rotated, so the sealed copy still
             * works. The driver stays on the lock screen to try again instead of
             * being sent to the password screen after a correct PIN.
             */
            DebugLog.info(TAG, "Unlock could not reach Saarthi: ${failure.message}")
            _error.value = failure.message
            return
        }
        retireQuickLogin()
        _stage.value = if (driver == null) {
            _error.value = text(R.string.session_expired)
            Stage.SignedOut
        } else {
            if (canLockApp(app)) app.preferences.setAppLock(true)
            stageForOpenAssignment(driver)
        }
    }

    private fun handleUnlockFailure(failure: Throwable) {
        val reason = (failure as? QuickLoginStore.QuickLoginException)?.failure
        _error.value = describe(reason)

        // A lockout or an invalidated key leaves the lock screen nothing to
        // offer, so the driver goes to normal sign-in rather than a dead end.
        if (reason is QuickLoginStore.Failure.LockedOut ||
            reason is QuickLoginStore.Failure.Unavailable
        ) {
            _stage.value = Stage.SignedOut
        }
    }

    private fun describe(failure: QuickLoginStore.Failure?): String = when (failure) {
        is QuickLoginStore.Failure.WrongPin ->
            if (failure.attemptsLeft == 1) {
                text(R.string.pin_wrong_last)
            } else {
                text(R.string.pin_wrong_left, failure.attemptsLeft)
            }

        is QuickLoginStore.Failure.CoolingDown -> text(R.string.pin_cooling_down, failure.seconds)

        QuickLoginStore.Failure.LockedOut -> text(R.string.pin_locked_out)

        is QuickLoginStore.Failure.Unavailable -> failure.reason
        null -> text(R.string.quick_login_failed)
    }

    /**
     * Sign out of the phone entirely.
     *
     * Anything the retired Quick Login still holds goes too, so a sealed token
     * and PIN from this session cannot survive onto a phone handed to someone
     * else.
     */
    fun signOut() {
        rideAccess.forget()
        viewModelScope.launch {
            api.signOut()
            retireQuickLogin()
            _stage.value = Stage.SignedOut
        }
    }

    /**
     * Destroy whatever the retired Quick Login still holds.
     *
     * Called wherever the credential is known to live in the account store, or
     * nowhere: after a sign-in, after the last unlock, on sign-out, and on a
     * launch that is not a legacy unlock. A sealed copy left behind would be a
     * second, stale credential with nothing keeping it current.
     */
    private fun retireQuickLogin() {
        if (quickLogin.enabled.value.any) {
            DebugLog.info(TAG, "Retiring Quick Login; App lock replaces it")
            quickLogin.clear()
        }
    }

    fun clearError() {
        _error.value = null
    }

    // -----------------------------------------------------------------------

    /**
     * Where a driver belongs, given whatever they already have open.
     *
     * A request to drive first, as it always was; then a shared ride — always,
     * so an account no longer allowed to ride along can still see it and stop
     * it; then [home].
     */
    private suspend fun stageForOpenAssignment(driver: DriverAccountStore.Account): Stage {
        val open = runCatching { api.myAssignment() }.getOrNull()
        if (open != null) return stageFor(open)
        return sharing.openStage() ?: home(driver)
    }

    /**
     * Nothing open: "How are you travelling?" when the server allows riding
     * along, and otherwise the vehicle screen, exactly as before it existed.
     */
    private suspend fun home(driver: DriverAccountStore.Account): Stage =
        when (RideSharePolicy.homeFor(rideAccess.check())) {
            RideSharePolicy.Home.CHOOSE_ROLE -> Stage.ChooseRole(driver)
            RideSharePolicy.Home.CHOOSE_VEHICLE -> Stage.ChooseVehicle(driver)
        }

    /** Nothing open: [home], or sign-in if the account has gone. */
    private suspend fun noOpenWork(): Stage = app.account.account.value?.let { home(it) } ?: Stage.SignedOut

    private suspend fun stageFor(assignment: DriverApi.AssignmentDto): Stage {
        prepareVehicle(assignment)
        return stageForStatus(assignment)
    }

    /**
     * Set the phone up for the vehicle, the moment it is scanned.
     *
     * The owner assigned this driver to the vehicle, so the phone pairs now and
     * stays paired across shifts — the approval still has to come before the
     * shift starts, and until it does nothing the phone sends is recorded. A
     * driver who is not assigned waits for the approval, and pairs then.
     *
     * And if the vehicle has a Saarthi OBD, the adapter is connected now, while
     * the driver is standing at it.
     */
    private suspend fun prepareVehicle(assignment: DriverApi.AssignmentDto) {
        val setup = assignment.vehicleSetup ?: return
        if (assignment.status !in PRE_APPROVAL_STATUSES) return

        if (setup.assignedToYou) pairToVehicle(assignment, requireSignedOn = false)

        if (setup.tracker == TRACKER_OBD && obdOffered.add(assignment.id)) {
            _obdSetup.value = true
        }
    }

    private suspend fun stageForStatus(assignment: DriverApi.AssignmentDto): Stage =
        when (assignment.status) {
            "APPROVED", "READY", "TRIP_ACTIVE" -> {
                pairToVehicle(assignment)
                Stage.Driving(assignment)
            }

            /*
             * Before submission, the photo is what is missing.
             *
             * `DRIVER_IDENTIFIED` is a request with no photo yet;
             * `SELFIE_SUBMITTED` is one with a photo that was never sent to the
             * fleet — which is where a driver lands if the app died between the
             * upload and the submit. Both belong on the same screen, and the
             * second skips straight to submitting.
             */
            "DRIVER_IDENTIFIED", "SELFIE_SUBMITTED" -> Stage.Selfie(assignment)

            "REJECTED" -> Stage.Rejected(assignment)
            // A driver whose request or shift is over stays a driver: the vehicle screen, as before.
            "CANCELLED", "COMPLETED" -> app.account.account.value?.let(Stage::ChooseVehicle) ?: Stage.SignedOut

            else -> Stage.AwaitingApproval(assignment)
        }

    /**
     * Become the vehicle's terminal.
     *
     * The step that turns an approval into a working cockpit. The phone asks for
     * a pairing code — which the server will only issue against an approved
     * session belonging to this driver — and redeems it through the ordinary
     * device gateway. From then on it reports telemetry exactly as a fitted
     * tablet does.
     *
     * Idempotent: a phone already paired to this vehicle skips the whole dance,
     * which is what happens every time the app is reopened mid-shift — but only
     * once the server confirms that pairing still stands. A stored pairing the
     * server has since let go of (a finished session, a revoked device) would
     * otherwise be trusted for the whole shift, and the cockpit would sit on
     * "Not signed on" while the driver drives an approved truck.
     *
     * [requireSignedOn] is false for an assigned driver pairing before their
     * shift is approved: a phone that is paired and waiting is already right,
     * and treating it as stale would re-pair it on every poll.
     *
     * Serialised by [pairingLock]. Sign-in and the assignment poll can both
     * reach this within the same second, and two runs each minted a pairing
     * code and redeemed it — the second one refused once, then paired again,
     * and the driver got "Device paired" twice. Under the lock the second run
     * finds the first one's pairing confirmed and stops.
     */
    private suspend fun pairToVehicle(
        assignment: DriverApi.AssignmentDto,
        requireSignedOn: Boolean = true,
    ): Unit = pairingLock.withLock {
        if (app.identity.pairedRegistration == assignment.registrationNumber) {
            val refreshed = app.repository.refresh()
            // Unreachable is not "no longer holds". Forgetting here would throw
            // away a working pairing because of one bad connection.
            if (refreshed.exceptionOrNull() is SaarthiApi.Failure.Offline) return@withLock
            val confirmed = refreshed.isSuccess &&
                TerminalState.parse(app.repository.state.value?.state).let {
                    if (requireSignedOn) it.signedOnToVehicle else it.pairedToVehicle
                }
            if (confirmed) return@withLock
            DebugLog.info(TAG, "Stored pairing to ${assignment.registrationNumber} no longer holds; pairing again")
            app.repository.forgetPairing()
        }

        try {
            val pairing = api.vehiclePairing(assignment.id)
            val code = pairing.pairingCode ?: return@withLock
            app.repository.pair(token = null, pairingCode = code).getOrThrow()
            DebugLog.info(TAG, "Paired to ${assignment.registrationNumber}")
        } catch (error: Exception) {
            // Not fatal to the stage: the driver is approved either way, and the
            // cockpit will say it cannot report rather than the app refusing to
            // open. Reporting is the thing that degrades, not the shift.
            DebugLog.warn(TAG, "Could not pair to the vehicle: ${error.message}")
            _error.value = text(R.string.pair_failed)
        }
    }

    /** Run something that can fail, with the busy flag and the error message. */
    private fun attempt(block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null
            try {
                block()
            } catch (failure: DriverApi.Failure) {
                _error.value = failure.message
            } catch (failure: Exception) {
                DebugLog.warn(TAG, "Unexpected failure: ${failure.message}")
                _error.value = text(R.string.error_generic)
            } finally {
                _busy.value = false
            }
        }
    }

    /**
     * A sentence in the driver's chosen language.
     *
     * Through [Language.wrap] because only the activity's context carries the
     * in-app language; the application's own resources follow the phone.
     */
    private fun text(@StringRes id: Int, vararg args: Any): String = Language.wrap(app).getString(id, *args)

    private companion object {
        const val TAG = "DriverViewModel"

        /** A request the fleet has not approved yet. */
        val PRE_APPROVAL_STATUSES = setOf("DRIVER_IDENTIFIED", "SELFIE_SUBMITTED", "PENDING_APPROVAL")

        /** `TrackerProduct.OBD_BLUETOOTH` on the server. */
        const val TRACKER_OBD = "OBD_BLUETOOTH"
    }
}
