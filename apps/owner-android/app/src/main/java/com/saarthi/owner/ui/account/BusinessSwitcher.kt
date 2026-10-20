package com.saarthi.owner.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.data.SessionStore
import com.saarthi.owner.network.OwnerApi
import com.saarthi.owner.ui.common.RevealedNotice
import com.saarthi.owner.ui.common.Words
import com.saarthi.owner.ui.common.readable
import com.saarthi.owner.ui.design.IconWell
import com.saarthi.owner.ui.design.InlineSpinner
import com.saarthi.owner.ui.design.Lucide
import com.saarthi.owner.ui.design.NoticeTone
import com.saarthi.owner.ui.design.SType
import com.saarthi.owner.ui.design.Saarthi
import com.saarthi.owner.ui.design.bottomRule
import com.saarthi.owner.ui.design.card
import com.saarthi.owner.ui.design.pressable
import kotlinx.coroutines.launch

/** What kind of business an organisation type is, in a word. */
fun businessKind(type: String): String = when (type) {
    "FLEET_OWNER", "ENTERPRISE" -> Words.get(R.string.people_business_fleet)
    "MOBILITY_PROVIDER" -> Words.get(R.string.people_business_travel)
    "CUSTOMER" -> Words.get(R.string.people_business_customer)
    "SUPPLIER" -> Words.get(R.string.people_business_seller)
    "TRUCK_ASSOCIATION" -> Words.get(R.string.people_business_association)
    "PLATFORM" -> Words.get(R.string.people_business_team)
    else -> type.lowercase().replace('_', ' ')
}

/**
 * Every business this person belongs to, the current one ticked — tap
 * another to act for it. The app reopens on that business's own home.
 */
@Composable
fun BusinessSwitcher(account: SessionStore.Account, api: OwnerApi, modifier: Modifier = Modifier) {
    val c = Saarthi.colors
    val scope = rememberCoroutineScope()
    var switching by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.fillMaxWidth().card(radius = 22.dp)) {
            account.businesses.forEachIndexed { index, business ->
                val current = business.id == account.organizationId
                Row(
                    Modifier
                        .fillMaxWidth()
                        .pressable(enabled = !current && switching == null, scale = 0.99f) {
                            switching = business.id
                            error = null
                            scope.launch {
                                runCatching { api.switchOrganization(business.id) }
                                    .onFailure { error = it.readable() }
                                switching = null
                            }
                        }
                        .bottomRule(c.border, show = index < account.businesses.lastIndex)
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    IconWell(Lucide.briefcase, well = if (current) c.primarySoft else c.sunken, ink = if (current) c.primary else c.muted, size = 38.dp, radius = 12.dp, iconSize = 18.dp)
                    Column(Modifier.weight(1f)) {
                        Text(business.name, style = SType.bodyStrong, color = c.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(businessKind(business.type), style = SType.caption, color = c.muted)
                    }
                    when {
                        switching == business.id -> InlineSpinner(color = c.primary, size = 18.dp)
                        current -> IconWell(Lucide.check, well = c.successSoft, ink = c.success, size = 28.dp, shape = CircleShape, iconSize = 14.dp)
                    }
                }
            }
        }
        error?.let { RevealedNotice(it, NoticeTone.DANGER) }
    }
}
