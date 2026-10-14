package com.saarthi.owner.ui.common

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import com.saarthi.owner.ui.design.NoticeCard
import com.saarthi.owner.ui.design.NoticeTone

/**
 * A notice that scrolls itself into sight when it appears — and again once
 * the keyboard settles — for the answer to a button at the foot of a long
 * form, which would otherwise land below the fold and look like nothing
 * happened.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RevealedNotice(message: String, tone: NoticeTone, modifier: Modifier = Modifier) {
    val requester = remember { BringIntoViewRequester() }
    val keyboard = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(message, keyboard) { requester.bringIntoView() }
    NoticeCard(message, tone, modifier.bringIntoViewRequester(requester))
}
