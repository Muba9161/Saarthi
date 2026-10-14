package com.saarthi.owner

import android.app.Application
import org.maplibre.android.MapLibre
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.network.AssistantApi
import com.saarthi.owner.network.CommerceApi
import com.saarthi.owner.network.HandoverApi
import com.saarthi.owner.network.AssociationApi
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.network.MaterialsApi
import com.saarthi.owner.network.OrdersApi
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.network.PapersApi
import com.saarthi.owner.network.PaymentsApi
import com.saarthi.owner.network.PlacesApi
import com.saarthi.owner.network.RequirementsApi
import com.saarthi.owner.network.ReturnLoadsApi
import com.saarthi.owner.network.SosApi
import com.saarthi.owner.network.TravelApi
import com.saarthi.owner.network.TripsApi
import com.saarthi.owner.network.VehiclesApi

/** The app's few long-lived objects, made once and shared by every screen. */
class OwnerApp : Application() {

    lateinit var session: SessionStore
        private set
    lateinit var preferences: OwnerPreferences
        private set
    lateinit var api: OwnerApi
        private set
    lateinit var fleet: FleetApi
        private set
    lateinit var alerts: AlertsApi
        private set
    lateinit var vehicles: VehiclesApi
        private set
    lateinit var drivers: DriversApi
        private set
    lateinit var payments: PaymentsApi
        private set
    lateinit var trips: TripsApi
        private set
    lateinit var requirements: RequirementsApi
        private set
    lateinit var orders: OrdersApi
        private set
    lateinit var returnLoads: ReturnLoadsApi
        private set
    lateinit var sos: SosApi
        private set
    lateinit var places: PlacesApi
        private set
    lateinit var materials: MaterialsApi
        private set
    lateinit var travel: TravelApi
        private set
    lateinit var association: AssociationApi
        private set
    lateinit var papers: PapersApi
        private set
    lateinit var assistant: AssistantApi
        private set
    lateinit var commerce: CommerceApi
        private set
    lateinit var handover: HandoverApi
        private set

    override fun onCreate() {
        super.onCreate()
        // MapLibre wants initialising before any map view is inflated. No key:
        // OpenFreeMap needs no registration, which is why the web app uses it too.
        MapLibre.getInstance(this)
        session = SessionStore(this)
        preferences = OwnerPreferences(this)
        api = OwnerApi(BuildConfig.SAARTHI_API_URL, BuildConfig.VERSION_NAME, session)
        fleet = FleetApi(api)
        alerts = AlertsApi(api)
        vehicles = VehiclesApi(api)
        drivers = DriversApi(api)
        payments = PaymentsApi(api)
        trips = TripsApi(api)
        requirements = RequirementsApi(api)
        orders = OrdersApi(api)
        returnLoads = ReturnLoadsApi(api)
        sos = SosApi(api)
        places = PlacesApi(this, BuildConfig.VERSION_NAME)
        materials = MaterialsApi(api)
        travel = TravelApi(api)
        association = AssociationApi(api)
        papers = PapersApi(api)
        assistant = AssistantApi(api)
        commerce = CommerceApi(api)
        handover = HandoverApi(api)
    }
}
