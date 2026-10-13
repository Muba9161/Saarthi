package com.saarthi.owner.data

/**
 * Which home a signed-in account opens on.
 *
 * Read from the session the server issues, never chosen in the app: the
 * organisation's type decides the business, and a fleet-owner organisation on
 * a personal seat or the Personal plan is somebody running their own vehicles.
 */
enum class AccountType {
    FLEET,
    PERSONAL,
    TRAVEL,
    CUSTOMER,
    SELLER,
    ASSOCIATION,

    /** A driver with no business of their own — Humsafar is their app. */
    DRIVER_ONLY,

    /** Platform staff, or an account with no business this app can show. */
    UNSUPPORTED;

    companion object {
        fun of(organizationType: String?, personalSeat: Boolean, planTier: String?, isDriver: Boolean): AccountType =
            when (organizationType) {
                "FLEET_OWNER", "ENTERPRISE" ->
                    if (personalSeat || planTier == "PERSONAL") PERSONAL else FLEET
                "MOBILITY_PROVIDER" -> TRAVEL
                "CUSTOMER" -> CUSTOMER
                "SUPPLIER" -> SELLER
                "TRUCK_ASSOCIATION" -> ASSOCIATION
                null -> if (isDriver) DRIVER_ONLY else UNSUPPORTED
                else -> UNSUPPORTED
            }
    }
}

/** How the account's role reads under its name: "Fleet owner", "Dispatcher". */
fun roleLabel(membershipRole: String): String = when (membershipRole) {
    "FLEET_OWNER" -> "Owner"
    "FLEET_MANAGER" -> "Fleet manager"
    "DISPATCHER" -> "Dispatcher"
    "CUSTOMER" -> "Customer"
    "SUPPLIER" -> "Seller"
    "ASSOCIATION_ADMIN" -> "Association admin"
    "ASSOCIATION_RESPONDER" -> "Responder"
    "MOBILITY_PROVIDER" -> "Travel operator"
    else -> membershipRole.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
}
