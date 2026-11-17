package com.saarthi.driver.ui.ride.share

import com.saarthi.driver.data.DriverAccountStore
import com.saarthi.driver.network.DriverApi
import com.saarthi.driver.network.RideSharesApi
import com.saarthi.driver.ride.NamedContactsStore
import com.saarthi.driver.ride.RideSharePolicy
import com.saarthi.driver.ui.DriverViewModel.Stage
import com.saarthi.driver.ui.ride.RideAccess
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Riding along — sharing a ride with family — the view model's half of it.
 *
 * Kept in a class of its own so `DriverViewModel` stays about getting to work,
 * but it moves the same stage the rest of the app does, through the same busy
 * flag and the same error line: a refusal here reads exactly like one anywhere
 * else. Nothing in it is a driver's — a person sharing their ride is never a
 * vehicle's driver or its paired phone, and nobody approves anything.
 */
class RideShareActions internal constructor(
    private val shares: RideSharesApi,
    /** Whether this login may ride along, and whether it also holds an owner account. */
    private val access: RideAccess,
    /** The contacts named for the share that is on, so "You named" outlives the app being closed. */
    private val named: NamedContactsStore,
    private val scope: CoroutineScope,
    private val stage: MutableStateFlow<Stage>,
    private val busy: StateFlow<Boolean>,
    /** Runs a request behind the busy flag, its refusal landing in the error line. */
    private val attempt: (suspend () -> Unit) -> Unit,
    private val account: () -> DriverAccountStore.Account?,
    /** Where a person with nothing open belongs — the first question, or the vehicle screen. */
    private val home: suspend () -> Stage,
    /** This account may not ride along: the vehicle screen, with the server's reason. */
    private val notAllowed: (DriverApi.Failure.Refused) -> Unit,
) {

    /** Whether this login also holds an owner account, whose owner app can show the ride. */
    val hasOwnerAccount: StateFlow<Boolean> = access.ownerAccount

    /** The vehicle is named: on to who should see where the rider is. */
    fun chooseFamily(plate: String) {
        val driver = account() ?: return
        stage.value = Stage.ShareSetup(driver, plate.trim())
    }

    /** Back to the vehicle's number, as it was typed. */
    fun backToVehicle(plate: String) {
        val driver = account() ?: return
        stage.value = Stage.ShareVehicle(driver, plate)
    }

    /**
     * Start sharing the ride in [plate]. [contacts] are the numbers and
     * addresses [RideSharePolicy.contactsOf] already checked, so the server is never sent
     * one it would refuse the whole list for; [withSelf] is the rider's own
     * owner app, asked for only when the login holds one. Asking again while a
     * share is on returns that share.
     */
    fun start(plate: String, contacts: List<String>, withSelf: Boolean) = attempt {
        try {
            val self = RideSharePolicy.shareWithSelf(access.ownerAccount.value, withSelf)
            val share = shares.start(plate, contacts, self)
            stage.value = if (RideSharePolicy.phaseOf(share) == RideSharePolicy.Phase.SHARING) {
                // Asking again while a share is on returns that share: keep what was named on it already.
                val typed = (named.of(share.id) + contacts).distinct()
                named.save(share.id, typed)
                Stage.Sharing(share, named = typed)
            } else {
                Stage.ShareOver(share)
            }
        } catch (refused: DriverApi.Failure.Refused) {
            if (!RideSharePolicy.notAllowed(refused.status)) throw refused
            notAllowed(refused)
        }
    }

    /**
     * Show the ride on the rider's own owner app too — the same login. Refused
     * because there is no owner account after all, the offer goes; because the
     * share has ended, the rider is told so.
     */
    fun showOnOwnerApp() {
        val shown = (stage.value as? Stage.Sharing)?.share ?: return
        attempt {
            try {
                val updated = shares.showToSelf(shown.id)
                val now = stage.value as? Stage.Sharing
                if (now?.share?.id == shown.id) stage.value = now.copy(share = updated)
            } catch (refused: DriverApi.Failure.Refused) {
                when (RideSharePolicy.afterSelfRefusal(refused.status)) {
                    RideSharePolicy.SelfRefusal.NO_OWNER_ACCOUNT -> {
                        access.noOwnerAccount()
                        throw refused
                    }
                    RideSharePolicy.SelfRefusal.SHARE_ENDED -> stage.value = Stage.ShareOver(shown)
                    RideSharePolicy.SelfRefusal.OTHER -> throw refused
                }
            }
        }
    }

    /** Tell one more person, by mobile number or email address. [onAdded] closes whatever asked. */
    fun addFamily(contact: String, onAdded: () -> Unit) {
        val shown = stage.value as? Stage.Sharing ?: return
        attempt {
            val updated = shares.addContact(shown.share.id, contact)
            val now = stage.value as? Stage.Sharing
            if (now?.share?.id == shown.share.id) {
                val typed = (now.named + contact).distinct()
                named.save(updated.id, typed)
                stage.value = Stage.Sharing(updated, named = typed)
            }
            onAdded()
        }
    }

    /** Stop sharing, then back to "How are you travelling?". */
    fun stop() {
        val shown = (stage.value as? Stage.Sharing)?.share ?: return
        attempt {
            shares.end(shown.id)
            named.clear()
            stage.value = home()
        }
    }

    /**
     * Poll the share on screen. Nothing on any more means it ran out of time:
     * the short "Sharing stopped" screen, so the rider is never left wondering
     * whether family can still see them.
     *
     * A failed poll changes nothing — no answer is not "it ended" — and a poll
     * that raced "Slide to stop sharing" never replaces the screen.
     */
    fun refresh() {
        val shown = stage.value as? Stage.Sharing ?: return
        scope.launch {
            val latest = runCatching { shares.mine() }.getOrElse { return@launch }
            val now = stage.value as? Stage.Sharing
            if (busy.value || now?.share?.id != shown.share.id) return@launch
            stage.value = when (RideSharePolicy.phaseOf(latest)) {
                RideSharePolicy.Phase.SHARING ->
                    latest?.let { Stage.Sharing(it, named = if (it.id == now.share.id) now.named else emptyList()) } ?: now
                RideSharePolicy.Phase.OVER -> {
                    named.clear()
                    Stage.ShareOver(now.share)
                }
            }
        }
    }

    /**
     * The share still on from before the app was closed, if any — checked on
     * every launch. Access is asked too, so the owner-app offer is right on a
     * screen reached without passing the first question.
     */
    internal suspend fun openStage(): Stage? {
        val open = runCatching { shares.mine() }.getOrNull()
            ?.takeIf { RideSharePolicy.phaseOf(it) == RideSharePolicy.Phase.SHARING }
            ?: return null
        access.check()
        return Stage.Sharing(open, named = named.of(open.id))
    }
}
