# Saarthi Terminal

The driver-facing digital cockpit for a vehicle-mounted Android tablet.

This is **not** `apps/device-android`. That one is Saarthi Device — a developer's
test harness for phone GPS, camera and telemetry, and it stays exactly as it is.
This is a separate product with its own package (`com.saarthi.terminal`), its own
Gradle build and its own release cadence, because one is a tool an engineer
installs on a handset and the other is fitted to a customer's vehicle.

---

## What it does

A driver walks up to a truck. The tablet in the cab is showing that vehicle's
permanent Saarthi QR. The driver scans it with their own Saarthi account, takes
an arrival photo, and submits. Somebody at the fleet approves or rejects. On
approval the driver completes the ten-point pre-trip safety check, and only then
does the cockpit open: map, speed, fuel, services, vehicle records, SOS, and
"Hey Saarthi".

The lifecycle is one server-owned value, not a set of local flags:

```
UNPAIRED → PAIRING → VEHICLE_PAIRED → AWAITING_DRIVER
  → DRIVER_IDENTIFIED → SELFIE_SUBMITTED → PENDING_APPROVAL
  → APPROVED → CHECKLIST_REQUIRED → READY → TRIP_ACTIVE → TRIP_COMPLETED
  → AWAITING_DRIVER

PENDING_APPROVAL → REJECTED → AWAITING_DRIVER
```

`TerminalRoot.kt` is a single `when` over that value. There is no navigation
graph, so there is no route a driver can reach that disagrees with what the
vehicle's own state says.

---

## Three rules this app is built around

**A driver is authorised only by an explicit human approval.** No timer approves
anybody. The fifteen-minute SLA reminds and escalates and then *expires* the
request — it fails closed. There is a test asserting that
`TERMINAL_APPROVAL_SLA` has no auto-approval key, because that is the single
most dangerous change anybody could make to this product.

**Simulated data announces itself, everywhere.** The OBD adapter has not
arrived, so engine values come from an on-device simulator. Every one of them is
stamped `MetricSource.SIMULATED` at the point it is produced, and that label
survives into the frame posted to Saarthi, into the gauge on screen, and into
the checklist submission read back a year later. `MetricValue` has no
constructor that produces a number without its provenance.

**The checklist never claims a reading the vehicle did not give.** An item whose
metric is absent from the last frame falls back to a manual inspection and says
so. It does not read OK. A false "✓ NORMAL" on a brake check is the worst thing
this app could produce.

---

## Building

```bash
# Point at your own API. The default is the emulator's host alias, which is
# useless anywhere else — deliberately, so a mispointed build fails loudly.
./gradlew assembleDebug -PsaarthiApiUrl=http://192.168.1.20:4000

# Or put it in local.properties:
#   saarthiApiUrl=http://192.168.1.20:4000
#   sdk.dir=C:/Users/you/AppData/Local/Android/Sdk

./gradlew assembleRelease
./gradlew testDebugUnitTest
```

Per-ABI APKs are produced alongside a universal one. MapLibre ships a native
renderer per architecture and carrying all of them roughly doubles the download,
which matters when these are sideloaded over a tethered connection in a yard.

`http://` only reaches `localhost` and `10.0.2.2` in a release build. A debug
build permits cleartext to anything, because a developer's API on a LAN address
has no certificate and never will — see `src/debug/res/xml/network_security_config.xml`.

---

## Connecting a terminal to a vehicle

1. In the Saarthi dashboard, open the vehicle → **Hardware** → **Connect a
   terminal**.
2. Scan the QR from the tablet, **or** type the `STH-XXXX-XXXX` code.

Both are the same single-use credential. The typed form exists because a
terminal is a tablet bolted into a cab: its camera gets scratched, and it is
frequently mounted where nothing can be held up in front of it. A pairing flow
that only works through a camera fails on exactly the units that are hardest to
reach.

The code expires in five minutes and works once.

---

## Kiosk / dedicated-device deployment

Section 45 of the specification asks for dedicated-device operation using
supported Android mechanisms and explicitly rules out unsafe hacks. This app
uses **device-owner provisioning plus lock-task mode**, and nothing else.

### Why not the usual alternatives

Accessibility services that swallow the home button, `SYSTEM_ALERT_WINDOW`
overlays that cover the launcher, and immersive-mode loops that fight the status
bar all work today. Every one of them breaks on the next Android release, every
one is indistinguishable from malware to a security review, and every one can
leave a driver unable to make a phone call in an emergency. None is worth it.

### Provisioning a tablet

The device must be **factory fresh with no accounts added**. Device ownership
cannot be granted afterwards.

```bash
adb install app-arm64-v8a-release.apk
adb shell dpm set-device-owner \
  com.saarthi.terminal/.kiosk.TerminalDeviceAdminReceiver
```

For a fleet, use an EMM or NFC/QR provisioning with the same component name.

Then, on the tablet: **Diagnostics → Dedicated device → Kiosk mode**.

### What kiosk mode does

* Home and Recents are disabled; the driver cannot leave Saarthi.
* Saarthi becomes the persistent HOME activity, so it returns after a reboot
  without anybody tapping an icon.
* The vehicle pairing survives reboots — it is in encrypted storage, and the
  boot receiver restarts the reporting service.

### What it deliberately leaves alone

| Kept | Why |
| --- | --- |
| Status bar (clock, battery, signal) | A driver needs to know the tablet is about to die and whether it has signal. Hiding that to look tidy is how somebody discovers a flat battery at a weighbridge. |
| Notifications | The foreground-service notification **is** the privacy notice. Hiding it would mean a tablet reporting a person's location with no visible indication. |
| Power menu | A device that cannot be turned off by the person holding it is not something to fit in a vehicle. |
| The "Stop" action on the notification | A person must always be able to stop a device from reporting their location. |

### Getting out

**Diagnostics → Kiosk mode → off**, which calls `stopLockTask()`. To decommission
a tablet entirely — removing it from a vehicle and selling it on —
`KioskController.relinquish()` gives up device ownership. A kiosk with no
documented exit is a tablet that has to be factory reset to be serviced.

---

## Distance and routes

Nearby services show the distance the driver will **actually cover**, not the
crow-flies figure. A pump 800 m away across a motorway with no junction for six
kilometres is not the nearest pump, and a driver sent to it on a quarter tank has
been misled.

The terminal never holds a routing key. It asks Saarthi
(`POST /device-gateway/terminal/route`, `GET .../nearby`), Saarthi asks
OpenRouteService, and the key stays on the server — a tablet bolted into a truck
gets sold, stolen and factory-reset.

* The services list is **re-ranked** by road distance, with a driving time.
* Routing uses the **vehicle's** profile. A lorry is routed as a lorry.
* Picking a place draws the route on the map and starts the turn banner.
* The next manoeuvre is computed **on the device**, so instructions keep coming
  inside a tunnel.

When routing is unavailable — no key, quota spent, service down — every row reads
"3.2 km **direct**", there is no driving time, and a banner says why. A
straight-line distance is never dressed up as a road distance.

---

## Architecture

```
data/         identity (encrypted), settings, offline outbox, the repository
network/      Saarthi client, DTOs, realtime socket
telemetry/    TelemetryProvider abstraction and its implementations
domain/       state machine, voice classification — pure, testable
ui/           adaptive Compose surfaces, theme, the AI blob
service/      foreground telemetry + heartbeat, boot receiver
kiosk/        device-owner policy
voice/        wake word and speech
```

### The telemetry abstraction

```
TelemetryHub                     merges every provider into one snapshot
 ├── PhoneTelemetryProvider      real GPS, speed, heading, motion
 ├── SimulatedTelemetryProvider  the engine block, until the adapter arrives
 └── BluetoothObdTelemetryProvider  real and registered, reports NOT_CONNECTED
```

Everything above `TelemetrySnapshot` — gauges, checklist, assistant, the frames
posted to Saarthi — is written against the abstraction and knows nothing about
where a value came from. When the OBD adapter arrives,
`BluetoothObdTelemetryProvider.connect()` gains an RFCOMM socket and an ELM327
loop, `sample()` starts returning values stamped `OBD`, and nothing else
changes. That is the test of whether the abstraction was worth having.

**Precedence:** where two providers offer the same metric, the *measured* one
wins, always. A real OBD fuel reading beats a simulated one. There is no
configuration for this, because a configuration that let a simulated value
shadow a real one would be a way to fabricate telemetry for a working truck.

### Offline

Frames are written to disk **before** they are uploaded, never after. A frame
that only ever existed in flight is a frame lost the moment the truck enters a
tunnel, and those are exactly the positions a fleet most wants afterwards. The
buffer holds 5,000 events, drops from the front when full, ages out at 24 hours,
and every frame carries an idempotency key so a retried batch is stored once.

The terminal never tells a driver something was submitted that the server did
not receive.

---

## What it reuses rather than rebuilds

| | |
| --- | --- |
| Enrolment, token exchange, pairing | `/api/v1/device-gateway/*` — the same endpoints Saarthi Device uses |
| Telemetry ingest, heartbeat, SOS, commands | The same endpoints, unchanged |
| Realtime | The existing `/ws/device` socket |
| Maps | MapLibre against the same OpenFreeMap styles the web app renders. No key, no account, no per-request cost. |
| Routing | OpenRouteService, proxied by Saarthi so no key ships in the APK. The same router the web app uses. |
| Vehicle QR | The vehicle's existing `QrCode` record, rendered server-side |
| Passport, maintenance, documents, nearby | The existing services, reached under the signed-on driver's own authorisation |
| Brand | `saarthi_mark.png` — the same asset the web app renders |

The terminal-specific surface is `/api/v1/device-gateway/terminal/*`, and it
re-declares none of the above.

---

## Permissions

| Permission | Why | If refused |
| --- | --- | --- |
| Location (fine + coarse) | Position, speed, heading | The terminal still shows the vehicle QR and still lets a driver sign on. It cannot report a position, and says so. |
| Camera | Pairing QR, arrival photo, issue photos | Pairing falls back to the typed code. |
| Microphone | "Hey Saarthi" | The assistant still works by typing. |
| Notifications | The foreground-service privacy notice | Tracking cannot start — an app that cannot show the notice must not do the thing it announces. |
| Bluetooth | The OBD adapter, when it arrives | Diagnostics say so. Nothing else changes. |

`ACCESS_BACKGROUND_LOCATION` is deliberately **not** declared. A foreground
service with a permanent notification covers everything a mounted terminal
needs.

---

## Testing

```bash
./gradlew testDebugUnitTest        # domain logic
```

`VoiceClassifierTest` mirrors the TypeScript tests in
`packages/shared/src/domain/terminal.test.ts` case for case. That classifier is
duplicated on purpose — an emergency must not wait for a network round trip —
and duplication is exactly where two implementations drift apart. If one of
those files passes while the other fails, the divergence is the bug.

The server-side rules have their own coverage in `apps/api/tests/terminal.test.ts`.
