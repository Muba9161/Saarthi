package com.saarthi.core.domain

/**
 * Which pump price to show a vehicle.
 *
 * The same mistake as the nearby stations, in a different place. That list
 * offered petrol pumps to an electric van because the category was chosen by the
 * button rather than by the vehicle; this card showed a *diesel* rate to every
 * vehicle because the label was written into the screen. An electric scooter was
 * being told the price of diesel.
 *
 * A price is not a destination, and that changes what to do when the answer is
 * unknown. For stations, showing too many is recoverable and hiding the only one
 * a driver can use is not — so an unrecorded fuel type keeps both. Here the
 * output is a number somebody may budget a tank against, so the rule is:
 *
 *  * **A recorded fuel type shows exactly its own rate.**
 *  * **An unrecorded one shows every rate published**, labelled, so a driver
 *    reads the right line themselves rather than being handed a guess.
 *  * **Electric shows nothing.** There is no pump price for a battery, and no
 *    electricity tariff provider behind this. A card would be noise at best and
 *    a wrong number at worst.
 */
object PumpPrice {

    /** The fuels a rate is actually published for. */
    enum class Fuel { DIESEL, PETROL, CNG }

    /**
     * Which rates belong on the card for this vehicle.
     *
     * Empty means no card: either the vehicle takes none of these, or none of
     * them is published where it is standing.
     *
     * @param fuelType the vehicle's recorded fuel, as the server spells it.
     */
    fun shownFor(fuelType: String?): List<Fuel> = when (fuelType?.uppercase()) {
        "DIESEL" -> listOf(Fuel.DIESEL)
        "PETROL" -> listOf(Fuel.PETROL)
        "CNG" -> listOf(Fuel.CNG)

        /*
         * A hybrid burns one of them and charges from the other, so the pump
         * price it needs is the liquid one. Petrol rather than diesel because
         * every hybrid sold in India is petrol-electric.
         */
        "HYBRID" -> listOf(Fuel.PETROL)

        /*
         * No pump price exists for either of these.
         *
         * Electric is obvious. LNG is not: it is a real fuel for heavy haulage
         * and the rate provider does not publish it, so the honest answer is
         * silence rather than the diesel figure standing in for it.
         */
        "ELECTRIC", "LNG" -> emptyList()

        // Unrecorded. Every rate, labelled, so the driver picks their own line.
        else -> listOf(Fuel.DIESEL, Fuel.PETROL, Fuel.CNG)
    }

    /**
     * Whether it is worth asking the server for a rate at all.
     *
     * The lookup costs a reverse geocode and a provider fetch, and for a vehicle
     * that cannot use any published rate both are spent on nothing.
     */
    fun worthFetching(fuelType: String?): Boolean = shownFor(fuelType).isNotEmpty()

    /**
     * What a rate is measured in.
     *
     * CNG is sold by weight and petrol and diesel by volume. Printing "₹96.18 a
     * litre" against a CNG rate would be wrong by about a third, which is the
     * kind of error a driver would only find at the till.
     */
    fun unitOf(fuel: Fuel): Unit = when (fuel) {
        Fuel.CNG -> Unit.KILOGRAM
        Fuel.DIESEL, Fuel.PETROL -> Unit.LITRE
    }

    enum class Unit { LITRE, KILOGRAM }
}
