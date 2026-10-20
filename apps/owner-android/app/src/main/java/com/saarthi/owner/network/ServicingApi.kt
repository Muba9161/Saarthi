package com.saarthi.owner.network

import com.saarthi.owner.R
import com.saarthi.owner.ui.common.Words
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Work on the vehicles, as the web keeps it: jobs booked ahead (`/maintenance`)
 * and work done (`/service-history`) — one record on the server either way, so
 * a job booked here and marked done later sits in the same history as work
 * logged after the fact, and as what a person it is shared with logs.
 */
class ServicingApi(private val api: OwnerApi) {

    /** A job: booked, under way, done or called off. */
    @Serializable
    data class Job(
        val id: String,
        val truckId: String = "",
        val registrationNumber: String = "",
        val type: String = "OTHER",
        val title: String = "",
        val cost: Double? = null,
        val status: String = "",
        val scheduledAt: String? = null,
        val completedAt: String? = null,
        val serviceProvider: String? = null,
        val overdue: Boolean = false,
        val createdAt: String = "",
    ) {
        val open: Boolean get() = status == "SCHEDULED" || status == "IN_PROGRESS"
    }

    /** A vehicle worth a look before it breaks down, and why. */
    @Serializable
    data class Risk(
        val truckId: String,
        val registrationNumber: String = "",
        val riskScore: Int = 0,
        val level: String = "LOW",
        val kmSinceLastService: Double? = null,
        val daysSinceLastService: Int? = null,
        val overdueCount: Int = 0,
        val reasons: List<String> = emptyList(),
    )

    /** Work done on a vehicle, as its service record holds it. */
    @Serializable
    data class Record(
        val id: String,
        val vehicleId: String = "",
        val registrationNumber: String = "",
        val type: String = "OTHER",
        val title: String = "",
        val status: String = "",
        val serviceDate: String? = null,
        val completedAt: String? = null,
        val odometerKm: Double? = null,
        val workshopName: String? = null,
        val totalCost: Double? = null,
        val invoiceNumber: String? = null,
        val verificationStatus: String = "",
    )

    @Serializable
    data class Health(val health: String = "", val reasons: List<String> = emptyList())

    @Serializable
    data class Spend(val total: Double = 0.0, val labour: Double = 0.0, val parts: Double = 0.0, val recordCount: Int = 0, val costPerKm: Double? = null)

    /** One vehicle's servicing as the web's timeline shows it: how it stands, what it cost, what was done. */
    @Serializable
    data class Timeline(
        val vehicleId: String = "",
        val records: List<Record> = emptyList(),
        val health: Health = Health(),
        val spend: Spend = Spend(),
        val lastServiceAt: String? = null,
        val nextDueAt: String? = null,
        val nextDueOdometerKm: Double? = null,
    )

    /** Open and recent jobs, fleet-wide or for one vehicle. */
    suspend fun jobs(vehicleId: String?, open: Boolean, page: Int = 1): Page<Job> =
        api.get(
            "/maintenance?page=$page&pageSize=$PAGE_SIZE" +
                vehicleId?.let { "&truckId=$it" }.orEmpty() +
                if (open) "&status=SCHEDULED,IN_PROGRESS" else "",
            Page.serializer(Job.serializer()),
        ) ?: Page()

    suspend fun risks(): List<Risk> = api.get("/maintenance/risk", ListSerializer(Risk.serializer())).orEmpty()

    /** Work done across the fleet, newest first. */
    suspend fun records(vehicleId: String?, page: Int = 1): Page<Record> =
        api.get(
            "/service-history?page=$page&pageSize=$PAGE_SIZE${vehicleId?.let { "&vehicleId=$it" }.orEmpty()}",
            Page.serializer(Record.serializer()),
        ) ?: Page()

    suspend fun timeline(vehicleId: String): Timeline? =
        api.get("/fleet/vehicles/$vehicleId/service-history", Timeline.serializer())

    class DoneWork(
        val vehicleId: String,
        val type: String,
        val title: String,
        /** ISO instant the work was done. */
        val serviceDate: String,
        val odometerKm: Double?,
        val workshop: String?,
        val totalCost: Double?,
        val invoiceNumber: String?,
    )

    /** Work already done: a completed record, unverified until checked on the web. */
    suspend fun recordDone(work: DoneWork): Record? {
        val body = buildJsonObject {
            put("vehicleId", work.vehicleId)
            put("type", work.type)
            put("title", work.title.take(160))
            put("serviceDate", work.serviceDate)
            work.odometerKm?.let { put("odometerKm", it) }
            work.workshop?.ifBlank { null }?.let { put("workshopName", it.take(160)) }
            work.totalCost?.let { put("totalCost", it) }
            work.invoiceNumber?.ifBlank { null }?.let { put("invoiceNumber", it.take(80)) }
        }
        return api.post("/service-history", body.toString(), Record.serializer())
    }

    /** Work booked ahead, for a day. */
    suspend fun book(vehicleId: String, type: String, title: String, scheduledAt: String, workshop: String?, cost: Double?): Job? {
        val body = buildJsonObject {
            put("truckId", vehicleId)
            put("type", type)
            put("title", title.take(160))
            put("scheduledAt", scheduledAt)
            workshop?.ifBlank { null }?.let { put("serviceProvider", it.take(160)) }
            cost?.let { put("cost", it) }
        }
        return api.post("/maintenance", body.toString(), Job.serializer())
    }

    /** A booked job done, or called off. */
    suspend fun close(jobId: String, done: Boolean, cost: Double? = null): Job? {
        val body = buildJsonObject {
            put("status", if (done) "COMPLETED" else "CANCELLED")
            if (done) put("completedAt", java.time.Instant.now().toString())
            cost?.let { put("cost", it) }
        }
        return api.patch("/maintenance/$jobId", body.toString(), Job.serializer())
    }

    companion object {
        const val PAGE_SIZE = 25

        const val CAN_READ = "maintenance.read"
        const val CAN_MANAGE = "maintenance.manage"

        /** The plan feature the web gates servicing on. */
        const val FEATURE = "maintenance.basic"

        /** `maintenanceTypeSchema`, in the words a person picks from. */
        val TYPES: List<Pair<String, String>>
            get() = listOf(
                "PREVENTIVE" to Words.get(R.string.net_service_type_preventive),
                "REPAIR" to Words.get(R.string.net_service_type_repair),
                "OIL_CHANGE" to Words.get(R.string.net_service_type_oil_change),
                "TYRE" to Words.get(R.string.net_service_type_tyre),
                "BRAKE" to Words.get(R.string.net_service_type_brake),
                "INSPECTION" to Words.get(R.string.net_service_type_inspection),
                "ENGINE" to Words.get(R.string.net_service_type_engine),
                "ELECTRICAL" to Words.get(R.string.net_service_type_electrical),
                "BODYWORK" to Words.get(R.string.net_service_type_bodywork),
                "OTHER" to Words.get(R.string.net_service_type_other),
            )

        /** A job's standing in a word: booked, in the workshop, done, called off. */
        fun statusWord(status: String): String = when (status) {
            "SCHEDULED" -> Words.get(R.string.net_servicing_status_scheduled)
            "IN_PROGRESS" -> Words.get(R.string.net_servicing_status_in_progress)
            "COMPLETED" -> Words.get(R.string.net_servicing_status_completed)
            "CANCELLED" -> Words.get(R.string.net_servicing_status_cancelled)
            else -> status.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
        }

        fun typeWord(type: String): String =
            TYPES.firstOrNull { it.first == type }?.second ?: Words.get(R.string.net_service_type_other)
    }
}
