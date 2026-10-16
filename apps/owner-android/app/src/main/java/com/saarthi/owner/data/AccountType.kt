package com.saarthi.owner.data

/**
 * Which home a signed-in account opens on.
 *
 * Read from the session the server issues, never chosen in the app: the
 * organisation's type decides the business, and a fleet-owner organisation on
 * a personal seat is somebody running their own vehicles.
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
        fun of(organizationType: String?, personalSeat: Boolean, isDriver: Boolean): AccountType =
            when (organizationType) {
                // The personal seat alone decides, as on the web: a business on the
                // Personal tier is still a business, with the fleet's screens.
                "FLEET_OWNER", "ENTERPRISE" -> if (personalSeat) PERSONAL else FLEET
                "MOBILITY_PROVIDER" -> TRAVEL
                "CUSTOMER" -> CUSTOMER
                "SUPPLIER" -> SELLER
                "TRUCK_ASSOCIATION" -> ASSOCIATION
                null -> if (isDriver) DRIVER_ONLY else UNSUPPORTED
                else -> UNSUPPORTED
            }
    }
}

/**
 * The roles that own an operating business, freight or travel: the server's
 * `OPERATOR_OWNER_ROLES`. Only they may hand a vehicle over without the
 * customer's or passenger's code.
 */
val OPERATOR_OWNER_ROLES: Set<String> = setOf("FLEET_OWNER", "MOBILITY_PROVIDER")

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
