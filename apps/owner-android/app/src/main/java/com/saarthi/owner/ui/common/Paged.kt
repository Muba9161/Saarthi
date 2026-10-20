package com.saarthi.owner.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.saarthi.owner.R
import com.saarthi.owner.ui.design.ButtonTone
import com.saarthi.owner.ui.design.SaarthiButton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * A list read a page at a time: the first page (with whatever totals it
 * carries), the rows gathered so far, and the way to the next page.
 */
internal class Paged<T, P>(
    val first: Loadable<P>,
    val rows: List<T>,
    val hasMore: Boolean,
    val loadingMore: Boolean,
    val more: () -> Unit,
    val retry: () -> Unit,
)

/** Read [load] from page one whenever [key] changes, and further pages on `more`. */
@Composable
internal fun <T, P> rememberPaged(
    key: Any,
    load: suspend (page: Int) -> P,
    rowsOf: (P) -> List<T>,
    hasMoreOf: (P) -> Boolean,
): Paged<T, P> {
    val scope = rememberCoroutineScope()
    var attempt by remember(key) { mutableIntStateOf(0) }
    var first by remember(key) { mutableStateOf<Loadable<P>>(Loadable.Loading) }
    var rows by remember(key) { mutableStateOf<List<T>>(emptyList()) }
    var page by remember(key) { mutableIntStateOf(1) }
    var hasMore by remember(key) { mutableStateOf(false) }
    var loadingMore by remember(key) { mutableStateOf(false) }

    LaunchedEffect(key, attempt) {
        first = Loadable.Loading
        first = try {
            val read = load(1)
            rows = rowsOf(read)
            hasMore = hasMoreOf(read)
            page = 1
            Loadable.Ready(read)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            Loadable.Failed(failure.readable())
        }
    }

    return Paged(
        first = first,
        rows = rows,
        hasMore = hasMore,
        loadingMore = loadingMore,
        more = {
            if (!loadingMore) {
                loadingMore = true
                scope.launch {
                    try {
                        val read = load(page + 1)
                        rows = rows + rowsOf(read)
                        hasMore = hasMoreOf(read)
                        page += 1
                    } catch (failure: Exception) {
                        if (failure is CancellationException) throw failure
                        hasMore = true
                    } finally {
                        loadingMore = false
                    }
                }
            }
        },
        retry = { attempt++ },
    )
}

/** "Show more" under a list that has another page. */
@Composable
internal fun MoreButton(busy: Boolean, onClick: () -> Unit) {
    SaarthiButton(stringResource(R.string.ui_show_more), onClick = onClick, tone = ButtonTone.SECONDARY, busy = busy, busyText = stringResource(R.string.ui_loading), height = 46.dp, modifier = Modifier.padding(top = 2.dp))
}
