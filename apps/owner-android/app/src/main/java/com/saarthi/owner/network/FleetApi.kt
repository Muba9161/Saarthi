package com.saarthi.owner.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** A fleet's own numbers and vehicles, read with the signed-in person's permissions. */
class FleetApi(private val api: OwnerApi) {

    @Serializable
    data class FleetCounts(
        val totalTrucks: Int = 0,
        val available: Int = 0,
        val onTrip: Int = 0,
        val idle: Int = 0,
        val maintenance: Int = 0,
        val emergency: Int = 0,
    )

    @Serializable
    data class TripCounts(val active: Int = 0, val delayed: Int = 0, val completedThisMonth: Int = 0)

    @Serializable
    data class Compliance(
        val documentsExpiringSoon: Int = 0,
        val documentsExpired: Int = 0,
        val maintenanceOverdue: Int = 0,
    )

    @Serializable
    data class DriverCounts(val total: Int = 0, val available: Int = 0, val onTrip: Int = 0)

    @Serializable
    data class Dashboard(
        val fleet: FleetCounts = FleetCounts(),
        val drivers: DriverCounts = DriverCounts(),
        val trips: TripCounts = TripCounts(),
        val compliance: Compliance = Compliance(),
    )

    @Serializable
    data class Named(val id: String = "", val name: String = "")

    @Serializable
    data class TripRef(val id: String = "", val reference: String = "", val status: String = "", val progressPercent: Int = 0)

    /** Where one vehicle is, as the live map draws it. */
    @Serializable
    data class Position(
        val truckId: String,
        val registrationNumber: String,
        val truckType: String = "",
        val status: String = "",
        val latitude: Double? = null,
        val longitude: Double? = null,
        val speedKph: Double? = null,
        val recordedAt: String? = null,
        val driver: Named? = null,
        val trip: TripRef? = null,
        /** No fix for a while — drawn grey, never as if it were live. */
        val stale: Boolean = true,
    )

    @Serializable
    data class ApprovalDriver(
        val name: String = "",
        val experienceYears: Int = 0,
        val totalTrips: Int = 0,
        val licenseClass: String? = null,
        /** VALID, EXPIRING_SOON, EXPIRED or UNKNOWN. */
        val licenseValidity: String = "UNKNOWN",
        val verificationStatus: String = "",
        val scoreBand: String? = null,
    )

    @Serializable
    data class PastAssignment(val id: String = "", val registrationNumber: String = "", val status: String = "", val requestedAt: String = "", val sameVehicle: Boolean = false)

    @Serializable
    data class ApprovalEvent(val id: String = "", val eventType: String = "", val description: String? = null, val createdAt: String = "")

    /** A waiting driver in full: who they are, their history with this truck, and what has happened so far. */
    @Serializable
    data class ApprovalDetail(
        val id: String,
        val status: String = "",
        val driver: ApprovalDriver? = null,
        val registrationNumber: String = "",
        val requestedAt: String? = null,
        val secondsUntilEscalation: Long? = null,
        val selfieUrl: String? = null,
        val recentAssignments: List<PastAssignment> = emptyList(),
        val events: List<ApprovalEvent> = emptyList(),
    )

    suspend fun approvalDetail(id: String): ApprovalDetail? = api.get("/terminal/assignments/$id", ApprovalDetail.serializer())

    /** A driver at a vehicle, waiting for somebody to say yes. */
    @Serializable
    data class Approval(
        val id: String,
        val status: String = "",
        val driver: ApprovalDriver? = null,
        val registrationNumber: String = "",
        val requestedAt: String? = null,
        val secondsUntilEscalation: Long? = null,
    )

    /** One vehicle's FASTag, as far as its bank has told Saarthi. */
    @Serializable
    data class Fastag(
        val id: String,
        val registrationNumber: String = "",
        val status: String = "",
        val balance: Double? = null,
        val lowBalanceThreshold: Double = 0.0,
    ) {
        /** Blocked, or below the line the owner set. */
        val needsAttention: Boolean
            get() = status != "ACTIVE" || (balance != null && balance < lowBalanceThreshold)
    }

    suspend fun fastags(): List<Fastag> =
        api.get("/fleet/toll/fastag?pageSize=100", Page.serializer(Fastag.serializer()))?.items.orEmpty()

    suspend fun dashboard(): Dashboard = api.get("/analytics/dashboard", Dashboard.serializer()) ?: Dashboard()

    suspend fun positions(): List<Position> =
        api.get("/tracking/fleet", ListSerializer(Position.serializer())).orEmpty()

    /** Drivers waiting at a vehicle. Empty for anyone who may not approve them. */
    suspend fun waitingApprovals(): List<Approval> =
        api.get(
            "/terminal/assignments?status=PENDING_APPROVAL,SELFIE_SUBMITTED&pageSize=10",
            Page.serializer(Approval.serializer()),
        )?.items.orEmpty()

    @Serializable
    private data class ApproveBody(val assignVehicle: Boolean = true)

    suspend fun approve(id: String) {
        api.post(
            "/terminal/assignments/$id/approve",
            api.json.encodeToString(ApproveBody.serializer(), ApproveBody()),
            Approval.serializer(),
        )
    }

    @Serializable
    private data class RejectBody(val reason: String)

    /** Turn a driver down. The reason is required, and the driver is shown it. */
    suspend fun reject(id: String, reason: String) {
        api.post(
            "/terminal/assignments/$id/reject",
            api.json.encodeToString(RejectBody.serializer(), RejectBody(reason)),
            Approval.serializer(),
        )
    }
}

/** The bell: everything Saarthi has told this person. */
class AlertsApi(private val api: OwnerApi) {

    @Serializable
    data class Alert(
        val id: String,
        val type: String = "",
        val title: String = "",
        val body: String? = null,
        val priority: String = "NORMAL",
        /** Where the alert points, as a web path ("/orders/…"); the app opens the ones it has a screen for. */
        val actionUrl: String? = null,
        val readAt: String? = null,
        val createdAt: String = "",
    )

    @Serializable
    private data class UnreadCount(val unreadCount: Int = 0)

    @Serializable
    private data class MarkRead(val notificationIds: List<String>)

    @Serializable
    private data class Marked(val unreadCount: Int = 0)

    suspend fun page(page: Int = 1, pageSize: Int = 30): Page<Alert> =
        api.get("/notifications?page=$page&pageSize=$pageSize", Page.serializer(Alert.serializer())) ?: Page()

    suspend fun unreadCount(): Int = api.get("/notifications/unread-count", UnreadCount.serializer())?.unreadCount ?: 0

    suspend fun markRead(id: String) {
        api.post("/notifications/read", api.json.encodeToString(MarkRead.serializer(), MarkRead(listOf(id))), Marked.serializer())
    }

    suspend fun markAllRead() {
        api.post("/notifications/read-all", "{}", Marked.serializer())
    }
}
