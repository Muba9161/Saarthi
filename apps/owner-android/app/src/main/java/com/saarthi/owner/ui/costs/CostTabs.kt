package com.saarthi.owner.ui.costs

import androidx.annotation.StringRes
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.FuelApi
import com.saarthi.owner.network.LoansApi
import com.saarthi.owner.network.ServicingApi
import com.saarthi.owner.network.TollApi
import com.saarthi.owner.ui.common.Words

/** The web's Running costs tabs, cut to a phone's width. */
enum class CostTab(@StringRes private val labelRes: Int) {
    FUEL(R.string.costs_tab_fuel),
    SERVICING(R.string.costs_tab_servicing),
    SLIPS(R.string.costs_tab_slips),
    LOANS(R.string.costs_tab_loans),
    TOLL(R.string.costs_tab_toll),
    ;

    val label: String get() = Words.get(labelRes)
}

/**
 * What this person may see and do in each tab: the permission the server
 * checks, and the plan feature the web gates the tab on.
 */
class CostAccess(account: SessionStore.Account) {
    val tabs: List<CostTab> = buildList {
        if (account.can(FuelApi.CAN_READ)) add(CostTab.FUEL)
        if (account.can(ServicingApi.CAN_READ) && account.hasFeature(ServicingApi.FEATURE)) add(CostTab.SERVICING)
        if (account.can(FuelApi.CAN_READ)) add(CostTab.SLIPS)
        if (account.can(LoansApi.CAN_READ) && account.hasFeature(LoansApi.FEATURE)) add(CostTab.LOANS)
        if (account.can(TollApi.CAN_READ) && account.hasFeature(TollApi.FEATURE)) add(CostTab.TOLL)
    }

    val logFuel: Boolean = account.can(FuelApi.CAN_LOG)
    val manageServicing: Boolean = account.can(ServicingApi.CAN_MANAGE)
    val manageLoans: Boolean = account.can(LoansApi.CAN_MANAGE)
    val manageToll: Boolean = account.can(TollApi.CAN_MANAGE)
    val bankLink: Boolean = account.hasFeature(TollApi.FEATURE_SYNC)
}
