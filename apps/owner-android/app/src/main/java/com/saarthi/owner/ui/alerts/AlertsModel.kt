package com.saarthi.owner.ui.alerts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.saarthi.owner.network.AlertsApi
import com.saarthi.owner.ui.common.Loadable
import com.saarthi.owner.ui.common.readable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The alerts read so far, and whether there are older ones to fetch. */
data class AlertList(
    val items: List<AlertsApi.Alert>,
    val hasMore: Boolean,
    val page: Int,
    val loadingMore: Boolean = false,
) {
    val unread: Int get() = items.count { it.readAt == null }
}

class AlertsModel(private val alerts: AlertsApi) : ViewModel() {

    private val _state = MutableStateFlow<Loadable<AlertList>>(Loadable.Loading)
    val state: StateFlow<Loadable<AlertList>> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = Loadable.Loading
        viewModelScope.launch {
            _state.value = try {
                val page = alerts.page(page = 1, pageSize = PAGE_SIZE)
                Loadable.Ready(AlertList(page.items, page.pagination.hasNextPage, page = 1))
            } catch (error: Exception) {
                Loadable.Failed(error.readable())
            }
        }
    }

    fun loadMore() {
        val current = (_state.value as? Loadable.Ready)?.value ?: return
        if (!current.hasMore || current.loadingMore) return
        _state.value = Loadable.Ready(current.copy(loadingMore = true))
        viewModelScope.launch {
            _state.value = try {
                val next = alerts.page(page = current.page + 1, pageSize = PAGE_SIZE)
                Loadable.Ready(
                    AlertList(
                        items = current.items + next.items.filter { new -> current.items.none { it.id == new.id } },
                        hasMore = next.pagination.hasNextPage,
                        page = current.page + 1,
                    ),
                )
            } catch (error: Exception) {
                Loadable.Ready(current.copy(loadingMore = false))
            }
        }
    }

    /** Mark one read the moment it is opened; the server catches up behind. */
    fun open(id: String) {
        val stamp = java.time.Instant.now().toString()
        var changed = false
        edit { items ->
            items.map {
                if (it.id == id && it.readAt == null) {
                    changed = true
                    it.copy(readAt = stamp)
                } else {
                    it
                }
            }
        }
        if (changed) viewModelScope.launch { runCatching { alerts.markRead(id) } }
    }

    fun markAllRead() {
        val stamp = java.time.Instant.now().toString()
        edit { items -> items.map { if (it.readAt == null) it.copy(readAt = stamp) else it } }
        viewModelScope.launch { runCatching { alerts.markAllRead() } }
    }

    private fun edit(change: (List<AlertsApi.Alert>) -> List<AlertsApi.Alert>) {
        _state.update { state ->
            if (state is Loadable.Ready) Loadable.Ready(state.value.copy(items = change(state.value.items))) else state
        }
    }

    private companion object {
        const val PAGE_SIZE = 30
    }
}
