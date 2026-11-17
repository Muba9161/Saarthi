package com.saarthi.driver.ui.plate

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.saarthi.driver.ui.design.PlateField

/**
 * The vehicle-number field, typed or read off the plate with the camera.
 *
 * The "Scan" button beside its label opens [PlateScanner]; what it reads lands
 * in the field through [onValueChange] exactly as typing would, so every rule
 * the screen applies to a typed number applies to a scanned one too.
 */
@Composable
internal fun PlateInput(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var scanning by rememberSaveable { mutableStateOf(false) }

    PlateField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        keyboardActions = keyboardActions,
        onScan = { scanning = true },
    )

    if (scanning) {
        PlateScanner(
            onPlate = { plate ->
                scanning = false
                onValueChange(plate)
            },
            onDismiss = { scanning = false },
        )
    }
}
