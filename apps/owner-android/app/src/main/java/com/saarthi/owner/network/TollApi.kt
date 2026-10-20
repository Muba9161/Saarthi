package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * FASTags and toll crossings, as the web's Toll & FASTag tab keeps them: each
 * vehicle's tag and what its bank last said of it, the plazas crossed, and
 * where the money goes.
 *
 * A recharge recorded here notes one made at the bank; it moves no money.
 */
class TollApi(private val api: OwnerApi) {

    @Serializable
    data class TagHealth(val health: String = "UNKNOWN", val reasons: List<String> = emptyList(), val balanceAgeDays: Int? = null)

    /** One vehicle's FASTag. A null [balance] was never reported — not zero. */
    @Serializable
    data class Tag(
        val id: String,
        val vehicleId: String = "",
        val registrationNumber: String = "",
        /** Masked by the server unless this person may see it whole. */
        val tagId: String? = null,
        val issuerBank: String = "",
        val status: String = "",
        val balance: Double? = null,
        val balanceUpdatedAt: String? = null,
        val lowBalanceThreshold: Double = 0.0,
        val health: TagHealth = TagHealth(),
        val expiresAt: String? = null,
        val lastSyncedAt: String? = null,
        val lastSyncError: String? = null,
    ) {
        /** Blocked, or below the line the owner set. */
        val needsAttention: Boolean
            get() = status != "ACTIVE" || (balance != null && balance < lowBalanceThreshold)
    }

    /** What the bank link can do for this business: read balances, crossings, find a vehicle's tag. */
    @Serializable
    data class Capabilities(
        val supportsLookup: Boolean = false,
        val supportsBalance: Boolean = false,
        val supportsTransactions: Boolean = false,
        val unavailableReason: String? = null,
    )

    @Serializable
    data class Crossing(
        val id: String,
        val vehicleId: String = "",
        val registrationNumber: String = "",
        val plazaName: String = "",
        val highway: String? = null,
        val paymentMode: String = "",
        val amount: Double = 0.0,
        val crossedAt: String = "",
    )

    @Serializable
    data class Plaza(val plazaName: String = "", val crossings: Int = 0, val total: Double = 0.0)

    @Serializable
    data class Summary(
        val total: Double = 0.0,
        val crossings: Int = 0,
        val averagePerCrossing: Double? = null,
        val topPlazas: List<Plaza> = emptyList(),
        val windowDays: Int = 30,
    )

    @Serializable
    data class Recharged(val fastag: Tag? = null, val message: String? = null)

    @Serializable
    data class Synced(val fastag: Tag? = null, val coverageNote: String? = null)

    @Serializable
    data class Discovered(val found: Boolean = false, val reason: String? = null, val fastag: Tag? = null, val coverageNote: String? = null)

    suspend fun tags(vehicleId: String? = null): List<Tag> =
        api.get("/fleet/toll/fastag?pageSize=100${vehicleId?.let { "&vehicleId=$it" }.orEmpty()}", Page.serializer(Tag.serializer()))?.items.orEmpty()

    suspend fun capabilities(): Capabilities = api.get("/fleet/toll/fastag/capabilities", Capabilities.serializer()) ?: Capabilities()

    suspend fun crossings(vehicleId: String?, page: Int = 1): Page<Crossing> =
        api.get(
            "/fleet/toll/transactions?page=$page&pageSize=$PAGE_SIZE${vehicleId?.let { "&vehicleId=$it" }.orEmpty()}",
            Page.serializer(Crossing.serializer()),
        ) ?: Page()

    suspend fun summary(vehicleId: String?, days: Int = 30): Summary =
        api.get("/fleet/toll/summary?days=$days${vehicleId?.let { "&vehicleId=$it" }.orEmpty()}", Summary.serializer()) ?: Summary()

    /** The balance as the owner read it off the bank's app or SMS. */
    suspend fun updateBalance(tagId: String, balance: Double, observedAt: String): Tag? {
        val body = buildJsonObject {
            put("balance", balance)
            put("observedAt", observedAt)
            put("source", "MANUAL")
        }
        return api.post("/fleet/toll/fastag/$tagId/balance", body.toString(), Tag.serializer())
    }

    suspend fun recordRecharge(tagId: String, amount: Double, balanceAfter: Double?, reference: String?, rechargedAt: String): Recharged? {
        val body = buildJsonObject {
            put("amount", amount)
            put("rechargedAt", rechargedAt)
            balanceAfter?.let { put("balanceAfter", it) }
            reference?.ifBlank { null }?.let { put("reference", it.take(120)) }
        }
        return api.post("/fleet/toll/fastag/$tagId/recharge", body.toString(), Recharged.serializer())
    }

    /** Ask the bank again: the tag's status, balance and recent crossings. */
    suspend fun sync(tagId: String): Synced? =
        api.post("/fleet/toll/fastag/$tagId/sync", buildJsonObject { put("apply", true) }.toString(), Synced.serializer())

    /** Find a vehicle's tag through the bank link, by its plate. */
    suspend fun discover(vehicleId: String): Discovered? =
        api.post("/fleet/toll/fastag/discover", buildJsonObject { put("vehicleId", vehicleId) }.toString(), Discovered.serializer())

    companion object {
        const val PAGE_SIZE = 25

        const val CAN_READ = "toll.read"
        const val CAN_MANAGE = "toll.manage"
        const val FEATURE = "toll.fastag"
        /** The bank link: balances, crossings and finding tags from the bank. */
        const val FEATURE_SYNC = "toll.fastag.sync"

        fun modeWord(mode: String): String = when (mode) {
            "FASTAG" -> "FASTag"
            "CASH" -> Words.get(R.string.net_toll_mode_cash)
            "UPI" -> "UPI"
            "CARD" -> Words.get(R.string.net_toll_mode_card)
            "EXEMPT" -> Words.get(R.string.net_toll_mode_exempt)
            else -> Words.get(R.string.net_toll_mode_unknown)
        }
    }
}
