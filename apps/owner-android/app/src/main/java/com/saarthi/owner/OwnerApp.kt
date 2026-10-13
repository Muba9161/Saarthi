package com.saarthi.owner

import android.app.Application
import com.saarthi.owner.data.OwnerPreferences
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.network.DriversApi
import com.saarthi.owner.network.FleetApi
import com.saarthi.owner.network.OwnerApi
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

    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
        preferences = OwnerPreferences(this)
        api = OwnerApi(BuildConfig.SAARTHI_API_URL, BuildConfig.VERSION_NAME, session)
        fleet = FleetApi(api)
        alerts = AlertsApi(api)
        vehicles = VehiclesApi(api)
        drivers = DriversApi(api)
    }
}
