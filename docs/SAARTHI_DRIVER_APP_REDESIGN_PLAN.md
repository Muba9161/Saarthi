# Saarthi Driver app — port the website's new design language

## Context
The website (`apps/web`) has a new visual system: graphite ground, indigo primary, saffron accent, navy/saffron/green brand inks, a line-drawn splash, new marketing photography, and light + dark themes. The driver app still uses the older dark-only "Obsidian + Ember" look. It lives in `apps/terminal-android/driver`, which is Kotlin + Jetpack Compose (M3); `apps/device-android` is a test harness and not the driver app.

**Goal:** re-skin every driver phone screen to match the site without changing behaviour. `DriverViewModel`, `DriverApi`, the stores, Stage flow, Android Auto logic and core business code all stay as they are.

**Decisions Sir made:**
- Light + dark themes that follow the phone setting. The live map and cockpit stay dark.
- Driver phone app only. The `:terminal` app and core's `SaarthiTerminalTheme` are not touched.
- Full port of the splash, played once.
- Bundle Inter and Noto Sans Devanagari.

## Key facts from exploration
- All driver colours live in `driver/.../ui/design/FleetTheme.kt`, as top-level vals.
  - About 560 references across 15 files: Ash 79, Chalk 78, Slate 63, CautionAmber 32, Ember 27, and others.
  - The theme ignores `darkTheme` and forces `LocalDarkCockpit = true`.
- The core sheets and checklist the driver app borrows read `MaterialTheme.colorScheme` (156 uses). They will follow a new scheme automatically, with no change to `:core`.
- `TerminalSettings.darkTheme` is a core key shared with the terminal, and it defaults to false. The driver toggle wiring is `DriverActivity.kt:106-117` → `DriverRoot.kt:58` → `ScanVehicleScreen.kt:117`, where the parameter is unused.
- **Web sources to port:**
  - Tokens: `apps/web/tailwind.config.ts` and `apps/web/src/styles/globals.css`
  - Splash: `components/common/splash-logo/logo-trace.generated.ts` (about 50 stroke paths on a 900×813 box, each with `ink` and `at`), `splash-logo.tsx`, and the keyframes at the end of `globals.css`
  - Easing `[0.16,1,0.3,1]`: `components/motion/index.tsx`
  - Buttons and cards: `components/ui/button.tsx` and `card.tsx`
  - Logo trace generator: `tools/trace-logo.mjs`
  - Images: `apps/web/public/vorldx-saarthi.webp` and `vorldx-mark.png`, and in `public/marketing/`: `hero-highway-portrait.webp`, `role-driver.webp`, `safety-night.webp`

## Plan

### 1. Tokens and theme
Split `ui/design/FleetTheme.kt` (294 lines) into three focused files:
- **`FleetColors.kt`**
  - An `@Immutable data class FleetColors` with semantic slots that mirror the web: canvas, card, elevated, sunken, foreground, mutedForeground, subtle, border, borderStrong, ring, primary/onPrimary/primarySoft, accent/onAccent/accentSoft, and success, warning, destructive, info each with a soft variant.
  - `LightFleetColors` and `DarkFleetColors`, converted exactly from the web's HSL values.
  - Fixed brand constants that are the same in both themes: `BrandNavy #011C45`, `BrandSaffron #FE5D09`, `BrandGreen #02783F`, the `BrandGradient` (navy with saffron and green glows), and the logo-ink gradient stops.
  - `LocalFleetColors`, plus a `Fleet.colors` accessor.
- **`FleetType.kt`**
  - Inter via `res/font/` (the variable TTF, or static 400/500/600/700), with Noto Sans Devanagari as the fallback for Hindi.
  - The web's type scale: 500/600 weights, display tracking of -0.04em, and a `sectionLabel` style (11sp, 600, uppercase, 0.08em).
- **`FleetTheme.kt`**
  - Keeps `FleetRadius`, `FleetSpace` and the 56dp touch target. Radii realigned to the web: chip 11, field and control 16, tile and card 20, sheet 24, hero 32.
  - `FleetTheme(dark)` builds a light or dark M3 `colorScheme` from `FleetColors`, provides `LocalFleetColors`, and sets `LocalDarkCockpit = dark`.
- **`FleetMotion.kt`:** set the standard easing to `CubicBezierEasing(0.16f,1f,0.3f,1f)` and the durations to the web's values (200, 280, 320 and 400 ms, stagger 50 ms).

**Migration.** Replace each old token with its semantic name. This is mechanical and done file by file:

| Old token | New token |
|---|---|
| Obsidian | canvas |
| Onyx | card |
| OnyxRaised | elevated |
| OnyxDeep | sunken |
| Hairline | border |
| Chalk | foreground |
| Ash | mutedForeground |
| Slate | subtle |
| Ember / EmberBright / EmberDeep / EmberInk | primary / ring / primary-pressed / onPrimary |
| EmberGradient / EmberSweep | BrandGradient (hero CTAs such as slide-to-start) |
| LiveGreen | success |
| AlertRed | destructive (SOS stays red) |
| CautionAmber | warning |
| FleetGround | canvas gradient |

Colours read inside `Canvas`/`DrawScope` or `remember` blocks are captured into a local first, since those blocks cannot read CompositionLocals.

**Cockpit stays dark.** `DriverCockpitScreen` and any map surface are wrapped in `FleetTheme(dark = true)`, so the MapLibre dark style and the night-vision rule are kept.

**Theme mode (small, UI-only addition):**
- Add a driver-only `themeMode` preference (System, Light or Dark; default System) in `driver/data/`, instead of reusing the core key the terminal shares.
- Add an "Appearance" row in `DriverProfileScreen`, next to `LanguageCard`.
- Reuse the existing `onDarkThemeChanged` plumbing.
- In `DriverActivity`, call `enableEdgeToEdge(SystemBarStyle.auto(...))` so status-bar icons flip with the theme.

### 2. Assets
Add to `driver/src/main/res/drawable-nodpi/`, as WebP:
- `brand_lockup`: from `vorldx-saarthi.webp`, 900×813, replacing the 512px PNG on a white card.
- `hero_highway`: from `hero-highway-portrait.webp`, 3:4. It replaces `splash_truck.png` (1.56 MB), so the APK gets smaller.
- `driver_role`: from `role-driver.webp`, for the sign-in and offer screens.
- `safety_night`: optional, for the approval and awaiting states.

Delete the unused `splash_truck.png` and the old `brand_lockup.png`.

Add `res/font/`: Inter and Noto Sans Devanagari, both OFL. They have to be downloaded; I will ask before fetching.

**Logo trace:** extend `tools/trace-logo.mjs` so it also writes `driver/.../ui/design/splash/LogoTrace.kt` (the box, plus each stroke's `ink`, `at` and SVG `d` string). The web and the app then keep one source of truth. The paths are parsed at runtime with Compose `PathParser`.

**Launcher icon:** keep the adaptive icon (`saarthi_mark` foreground). Only align the background shape colour to the site's light canvas.

### 3. Splash
- **System splash:**
  - `values/themes.xml`: parent becomes `Theme.Material.Light.NoActionBar`, with the background `#EEF2F8`.
  - New `values-night/themes.xml` and `values-night-v31/themes.xml` with `#080C17`.
  - `values-v31`: splash background plus `windowSplashScreenAnimatedIcon` set to the mark.
  - `colors.xml` gets light and night splash colours.
- **In-app splash:** a new `ui/design/splash/SplashLogo.kt` that ports `splash-logo.tsx` in draw-once mode.
  - The background is the web's radial gradient (light or dark), plus a saffron/green ambient layer drifting over 14s.
  - Rise-in: 900ms, from opacity 0, translateY 14dp, scale 0.97.
  - **Strokes:** each path draws with `PathMeasure.getSegment` from 0 to 1 over 20% of the cycle. Its delay is `at × cycle × 0.26`, easing `(.45,0,.3,1)`, stroke width 5 in the 900-unit space, round caps, in its ink colour. Dark mode uses `#9DB7E6` for the navy ink.
  - **Colour flood:** the `brand_lockup` image is drawn with a moving horizontal gradient mask (`drawWithContent` + `BlendMode.DstIn`). It sweeps left to right at 40–58% of the cycle, and the outlines fade out at 50–60%.
  - **Caption:** "Manage · Track · Move · Together" as a string resource in English and Hindi. It uses the section-label style and fades up after 420ms.
  - **Timing:** the cycle is 5s and draw-once runs 0.6 of it, so 3s.
  - **Reduced motion:** show the static lockup only.
- **Wiring:** `FleetSplash()` in `FleetBrand.kt` becomes a thin wrapper around `SplashLogo`. It stays on screen until both conditions hold: restore has finished, and the draw has completed. There is a cap so a slow restore is never blocked. The `Stage` flow itself is unchanged.

### 4. Components (`ui/design/`)
- **`FleetControls.kt`**
  - `FleetButton` matches the web's default button: primary fill, 16dp radius, 56dp height, press scale 0.985, disabled at 50%.
  - Add a `gradient` variant using `BrandGradient` with white text.
  - `FleetOutlineButton` gets a card fill with a 1dp border ring.
  - Fields: 16dp radius and the input border, with the focus ring in the primary colour.
- **`FleetSurface.kt`**
  - Cards follow the web's "no border" rule: a card shadow plus a 1dp ring at foreground 5%, or white 6% in dark.
  - `EmberCard` becomes `BrandCard`, a gradient wash with a 1dp top highlight.
  - `StatusPill` and badges use soft status fills at 10–15%. `SectionHeader` uses the section-label style.
- **`FleetBrand.kt`**
  - `BrandHero`: a dark photo stage in both themes, with the text-protection gradient from `imagery.tsx`.
  - `BrandLockup`: the new lockup with no white card. It sits on a chip only when shown over a photo.
  - `BrandWordmark`: "VorldX Saarthi" and "Driver", moved into string resources.
- **`FleetInstruments.kt`, `FleetTracking.kt`, `FleetSlideAction.kt`:** move to the tokens only. The slide-to-start track uses `BrandGradient`.

### 5. Screens: re-skin through tokens and components only, with no logic changes
Work in this order, checking each one in light and dark:
1. `SignInScreen` (new hero)
2. `QuickLoginScreen` and `QuickLoginOfferScreen`
3. `ScanVehicleScreen`
4. `SelfieCaptureScreen`
5. `ApprovalScreens`
6. `DriverDashboardScreen`
7. `DispatchCard`, `LanguageCard`, `OfflineMapCard`, `QuickLoginSettings`
8. `DriverPapersScreen`, `DriverTripsScreen`, `DriverNoticesScreen`, `FuelSlipScreen`
9. `DriverProfileScreen` and `DriverSecurityScreen`
10. `DriverCockpitScreen` (forced dark; only accent and token alignment)

Any new user-facing text goes into `values/strings.xml` and `values-hi/strings.xml`, so `LanguageCoverageTest` keeps passing.

### Out of scope
- `:terminal`, `apps/device-android`, and core's `Theme.kt`.
- Android Auto: car templates are system-styled, so it only picks up the icon.
- Localising the text that other screens already hard-code. This can be a separate task if Sir wants it.

## Verification
- From `apps/terminal-android`:
  - `./gradlew :driver:assembleDebug :driver:testDebugUnitTest :driver:lintDebug`
  - `./gradlew :terminal:assembleDebug`, to confirm the terminal is unaffected.
- Install on a device or emulator. Walk through every Stage: sign-in, quick login, scan, selfie, awaiting and rejected approval, dashboard, each sub-screen, and the cockpit. Do this in:
  - system light and system dark;
  - forced Light and forced Dark through the Appearance row;
  - Hindi;
  - reduced motion (which should give a static splash).
- Also check:
  - the system splash on API 31+ and on API 26–30;
  - edge-to-edge status-bar icon contrast in both themes;
  - the release APK size against the current build (fonts added, and the 1.56 MB PNG removed).
- Add Compose `@Preview`s in light and dark for the redesigned components and for `SplashLogo`.
