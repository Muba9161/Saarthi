package com.saarthi.driver.ui.ride

import com.saarthi.driver.network.RideSharesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether this account may ride along — share its rides with family — and
 * whether its login also holds an owner account, asked once a session.
 *
 * The server decides who may ride along; the app only follows its answer. That
 * answer is kept until the next sign-in; a call that failed is not, so one bad
 * connection does not hide riding along for the rest of the day.
 */
internal class RideAccess(private val shares: RideSharesApi) {

    private val _allowed = MutableStateFlow(false)
    private val _ownerAccount = MutableStateFlow(false)

    /** True only once the server has said yes. Drives the way back to "How are you travelling?". */
    val allowed: StateFlow<Boolean> = _allowed.asStateFlow()

    /** True once the server has said this login also holds an owner account. */
    val ownerAccount: StateFlow<Boolean> = _ownerAccount.asStateFlow()

    /** The server's answer this session, or null before it has given one. */
    private var known: RideSharesApi.Access? = null

    /** Whether riding along is allowed, asking the server the first time. Null when it could not be asked. */
    suspend fun check(): Boolean? {
        known?.let { return it.rideAlong }
        val answer = runCatching { shares.access() }.getOrNull() ?: return null
        keep(answer)
        return answer.rideAlong
    }

    /** The server refused a share for this account — it is a no until the next sign-in. */
    fun refused() = keep((known ?: RideSharesApi.Access()).copy(rideAlong = false))

    /** The server says this login holds no owner account after all. */
    fun noOwnerAccount() = keep((known ?: RideSharesApi.Access()).copy(hasOwnerAccount = false))

    /** A new sign-in, or none: ask again next time. */
    fun forget() {
        known = null
        _allowed.value = false
        _ownerAccount.value = false
    }

    private fun keep(answer: RideSharesApi.Access) {
        known = answer
        _allowed.value = answer.rideAlong
        _ownerAccount.value = answer.hasOwnerAccount
    }
}
