package com.saarthi.driver.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.core.util.DebugLog
import com.saarthi.driver.SaarthiDriverApp
import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.data.QuickLoginStore
import com.saarthi.driver.network.DriverApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.crypto.Cipher

/**
 * A driver's way in.
 *
 * Everything from opening the app to being approved onto a truck. Once approved
 * the phone pairs itself to the vehicle and the shared cockpit takes over — so
 * this class stops where `TerminalViewModel` starts, and deliberately knows
 * nothing about maps, trips or telemetry.
 *
 * The states below are the screens, in the order a driver meets them. There is
 * no back stack: a driver cannot press Back out of an approved session into the
 * scanner, because that would not mean anything to the fleet that approved them.
 */
class DriverViewModel(application: Application) : AndroidViewModel(application) {

    private val app: SaarthiDriverApp = application as SaarthiDriverApp
    private val api: DriverApi = app.driverApi

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

    /** Where the driver is on the way to a working cockpit. */
    sealed interface Stage {
        /** Deciding, on launch, whether the stored session still works. */
        data object Restoring : Stage

        /** Nobody is signed in. */
        data object SignedOut : Stage

        /**
         * Just signed in, and asked whether to set up Quick Login.
         *
         * Shown once, immediately after a password sign-in, because that is the
         * only moment a driver is thinking about getting back in — and the only
         * moment the credential is in hand to seal. Offered, never forced: the
         * specification is explicit that a driver may choose neither method, and
         * a PIN somebody resents is a PIN written on the dashboard.
         */
        data class OfferQuickLogin(val driver: DriverAccountStore.Account) : Stage

        /**
         * Signed in, and the session is behind Saarthi Quick Login.
         *
         * The driver is who they were; the credential that proves it is sealed
         * behind a Keystore key needing a PIN or a fingerprint. Unlocking
         * authorises nothing by itself — it produces the refresh token, which
         * the server then decides about, exactly as on any other launch.
         */
        data class Locked(val methods: QuickLoginStore.Enabled) : Stage

        /** Signed in, no vehicle. The scanner. */
        data class ChooseVehicle(val driver: DriverAccountStore.Account) : Stage

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

            /*
             * Quick Login comes first, when it is on.
             *
             * With a PIN or biometrics enabled the account store no longer holds
             * the refresh token at all — the only copy is sealed behind a
             * Keystore key — so there is nothing to restore silently, and the
             * honest first screen is the lock. A driver who enabled neither
             * method is still signed in silently, as before.
             */
            val methods = quickLogin.enabled.value
            if (methods.any && app.account.account.value != null) {
                _stage.value = Stage.Locked(methods)
                return@launch
            }

            val driver = api.restore()
            if (driver == null) {
                _stage.value = Stage.SignedOut
                return@launch
            }

            _stage.value = stageForOpenAssignment(driver)
        }
    }

    fun signIn(email: String, password: String) {
        attempt { _stage.value = afterSignIn(api.signIn(email.trim(), password)) }
    }

    fun register(request: DriverApi.RegisterRequest) {
        attempt { _stage.value = afterSignIn(api.register(request)) }
    }

    /**
     * Where a driver goes the moment a password worked.
     *
     * Straight past the offer if Quick Login is already set up — re-signing in
     * after a session expiry should not ask again about something they have
     * already answered.
     */
    private suspend fun afterSignIn(driver: DriverAccountStore.Account): Stage =
        if (quickLogin.enabled.value.any) {
            stageForOpenAssignment(driver)
        } else {
            Stage.OfferQuickLogin(driver)
        }

    /** Move on from the offer, whether or not anything was enabled. */
    fun finishQuickLoginSetup() {
        val driver = app.account.account.value ?: return
        viewModelScope.launch { _stage.value = stageForOpenAssignment(driver) }
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
            _stage.value = Stage.ChooseVehicle(driver)
        }
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
    // Saarthi Quick Login
    // -----------------------------------------------------------------------


    /**
     * The unsealed credential for this session, in memory only.
     *
     * Kept so that switching a method off can hand the token back to readable
     * storage, and so that adding biometrics after a PIN unlock does not need a
     * fresh sign-in. Never persisted here, and gone when the process dies.
     */
    @Volatile
    private var unsealedToken: String? = null

    /**
     * The refresh token this process can still lay hands on, wherever it is.
     *
     * Three homes, in the order they are likely to have it: readable storage
     * while Quick Login is off, the copy kept from an unlock, and the copy the
     * account store kept from the last sign-in or rotation.
     *
     * The third is not a belt-and-braces addition. A driver who signed in with
     * a password while Quick Login held custody has never unlocked anything in
     * this process, so the first two are both null — and every switch on the
     * Quick Login card was failing for them with nothing to seal and nothing to
     * hand back.
     */
    private fun currentRefreshToken(): String? =
        app.account.refreshToken ?: unsealedToken ?: app.account.liveRefreshToken

    /**
     * Unlock with a PIN.
     *
     * The PIN is checked on the device and never leaves it. What it produces is
     * the refresh token, which goes to the ordinary refresh endpoint — so the
     * server still decides whether the session lives, and no PIN can outlive a
     * session the fleet has revoked.
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
     * Called when [biometricCipher] comes back null. Before this the caller
     * simply returned: no fingerprint dialog appeared, no message was shown,
     * and the screen went on offering a button that could not work — which is
     * indistinguishable, from the cab, from the app having frozen.
     *
     * The store has already switched the slot off by this point, so the live
     * `quickLoginMethods` will drop the offer on the next recomposition. All
     * that is left is to say why.
     */
    fun reportBiometricUnavailable() {
        _error.value = quickLogin.takeBiometricProblem()
            ?: "Fingerprint unlock is not available just now. Use your PIN or password."
    }

    /**
     * Turn the PIN on, taking custody of the credential.
     *
     * Surrendering the token from the account store is what makes the
     * protection real rather than decorative: afterwards the only copy is
     * sealed, so a copy of the app's data opens nothing.
     */
    fun enableQuickLoginPin(pin: String, onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val token = currentRefreshToken()
            if (token == null) {
                onResult(false)
                return@launch
            }
            val sealed = quickLogin.enablePin(pin, token)
            if (sealed) {
                unsealedToken = token
                app.account.surrenderRefreshToken()
            }
            onResult(sealed)
        }
    }

    /**
     * The cipher a prompt must authorise before biometrics can be turned on.
     *
     * Null when the device has no usable key — no enrolled biometric, no secure
     * lock screen, or a key the platform has already invalidated.
     */
    fun biometricsUsable(): Boolean = quickLogin.biometricsUsable()

    /**
     * Finish turning biometrics on, once the prompt has confirmed the driver.
     *
     * No cipher is handed in any more. Sealing uses the public half of a key
     * pair, which the platform never gates — the prompt above it is there to
     * prove the driver can actually authenticate before the switch claims they
     * can, not because encryption needs it. See `QuickLoginStore.sealWithBiometric`
     * for why that separation is what makes a rotating credential workable.
     *
     * Surrendering the token from the account store is what makes the
     * protection real: afterwards the only copies are sealed.
     */
    fun completeBiometricSetup(onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val token = currentRefreshToken()
            if (token == null) {
                onResult(false)
                return@launch
            }
            val sealed = quickLogin.sealWithBiometric(token)
            if (sealed) {
                unsealedToken = token
                app.account.surrenderRefreshToken()
            }
            onResult(sealed)
        }
    }

    /**
     * Turn Quick Login off entirely, giving the credential back.
     *
     * The driver reached this through an unlocked session, so returning the
     * token to readable storage is the trade they asked for: silent restore on
     * every launch, and no PIN.
     */
    fun disableQuickLogin() {
        /*
         * Custody comes back whether or not the token does.
         *
         * `clear()` destroys the sealed copies, so this is the last moment the
         * credential can be put back where the app can read it. When it cannot
         * — a lockout already discarded it, or the platform invalidated the
         * key — the flag must still come down: left standing it tells the
         * account store that every future sign-in belongs to a Quick Login that
         * is no longer holding anything, and the driver is signed out fifteen
         * minutes later with both switches refusing to turn back on.
         */
        val token = currentRefreshToken()
        if (token != null) {
            app.account.reclaimRefreshToken(token)
        } else {
            app.account.releaseCustody()
        }
        quickLogin.clear()
    }

    /** Drop one method while keeping the other, if the other is on. */
    fun disableQuickLoginPin() {
        quickLogin.disablePin()
        if (!quickLogin.enabled.value.any) disableQuickLogin()
    }

    fun disableQuickLoginBiometrics() {
        quickLogin.disableBiometrics()
        if (!quickLogin.enabled.value.any) disableQuickLogin()
    }

    /** Carry on from an unlocked credential, exactly as a normal launch would. */
    private suspend fun resumeWith(token: String) {
        unsealedToken = token
        // The server remains the authority. An unlocked PIN proves who is
        // holding the phone; only the refresh endpoint can say the session lives.
        val driver = api.restoreWith(token)
        _stage.value = if (driver == null) {
            _error.value = "Your session has expired. Please sign in again."
            Stage.SignedOut
        } else {
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
                "Wrong PIN. One more attempt before you will need to sign in."
            } else {
                "Wrong PIN. ${failure.attemptsLeft} attempts left."
            }

        is QuickLoginStore.Failure.CoolingDown ->
            "Too many attempts. Try again in ${failure.seconds} seconds."

        QuickLoginStore.Failure.LockedOut ->
            "Too many wrong PINs. Please sign in with your password."

        is QuickLoginStore.Failure.Unavailable -> failure.reason
        null -> "Quick Login could not be used. Please sign in."
    }

    /** Sign out of the phone entirely. */
    fun signOut() {
        viewModelScope.launch {
            api.signOut()
            _stage.value = Stage.SignedOut
        }
    }

    fun clearError() {
        _error.value = null
    }

    // -----------------------------------------------------------------------

    /** Where a driver belongs, given whatever request they already have open. */
    private suspend fun stageForOpenAssignment(driver: DriverAccountStore.Account): Stage {
        val open = runCatching { api.myAssignment() }.getOrNull()
        return if (open == null) Stage.ChooseVehicle(driver) else stageFor(open)
    }

    private suspend fun stageFor(assignment: DriverApi.AssignmentDto): Stage =
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
            "CANCELLED", "COMPLETED" ->
                app.account.account.value?.let(Stage::ChooseVehicle) ?: Stage.SignedOut

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
     * which is what happens every time the app is reopened mid-shift.
     */
    private suspend fun pairToVehicle(assignment: DriverApi.AssignmentDto) {
        if (app.identity.pairedRegistration == assignment.registrationNumber) return

        try {
            val pairing = api.vehiclePairing(assignment.id)
            val code = pairing.pairingCode ?: return
            app.repository.pair(token = null, pairingCode = code).getOrThrow()
            DebugLog.info(TAG, "Paired to ${assignment.registrationNumber}")
        } catch (error: Exception) {
            // Not fatal to the stage: the driver is approved either way, and the
            // cockpit will say it cannot report rather than the app refusing to
            // open. Reporting is the thing that degrades, not the shift.
            DebugLog.warn(TAG, "Could not pair to the vehicle: ${error.message}")
            _error.value = "Signed on, but this phone could not connect to the vehicle yet."
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
                _error.value = "Something went wrong. Please try again."
            } finally {
                _busy.value = false
            }
        }
    }

    private companion object {
        const val TAG = "DriverViewModel"
    }
}
