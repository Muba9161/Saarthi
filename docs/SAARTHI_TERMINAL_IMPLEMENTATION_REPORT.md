# Saarthi Terminal — Implementation Report

What was built against `SAARTHI_TERMINAL_APP_SPECIFICATION.md`, what it reuses,
and what it deliberately does not do.

Read [`SAARTHI_TERMINAL_IMPLEMENTATION_MAP.md`](SAARTHI_TERMINAL_IMPLEMENTATION_MAP.md)
first — it is the analysis this was built from.

---

## The three rules everything else defends

**A driver is authorised only by an explicit human approval.** No timer
approves. The fifteen-minute SLA reminds, escalates and then *expires* the
request — it fails closed. `packages/shared/src/domain/terminal.test.ts` asserts
that `TERMINAL_APPROVAL_SLA` contains no auto-approval key, and
`apps/api/tests/terminal.test.ts` winds a request past twenty minutes and
asserts the driver is still not on the vehicle.

**Simulated data announces itself, end to end.** Engine values come from an
on-device simulator until the OBD adapter arrives. Every one is stamped
`MetricSource.SIMULATED` where it is produced; `MetricValue` has no constructor
that yields a number without its provenance. The label survives into the frame
posted to the gateway, into `TelemetryReading.simulatedMetrics`, into the gauge
on screen, and into `TerminalChecklistSubmission.usedSimulatedData` read back a
year later.

**The checklist never claims a reading the vehicle did not give.** An item whose
metric is absent from the last frame returns `status: null,
manualInputRequired: true` and says why. It does not read OK.

---

## Backend

### Data model

New tables: `terminal_sessions`, `terminal_session_events`,
`terminal_checklist_templates`, `terminal_checklist_template_items`,
`terminal_checklist_submissions`, `terminal_checklist_item_results`,
`terminal_issue_reports`.

Everything the spec listed under §40 that already existed was reused rather than
duplicated:

| Spec entity | Resolved as |
| --- | --- |
| `Terminal` | `HardwareDevice`, `deviceType = VEHICLE_TERMINAL` |
| `TerminalVehicleAssignment` | `DeviceAssignment` |
| `DriverVehicleAssignment` | `TruckAssignment` (opened on approval) |
| `TelemetrySnapshot` | `TelemetryReading` |

`DriverApprovalRequest` and `TerminalSession` were merged into one row: they are
one thing that happens once, in order, and splitting them would make "who is on
this truck right now" a join for no benefit.

Migrations `20260901120000_terminal_enums`, `_terminal_tables`,
`_terminal_pairing_code`. Enums are split from tables because PostgreSQL will
not let a value added by `ALTER TYPE … ADD VALUE` be used in the same
transaction — the same split `20260829120000_device_client_enums` already makes.

### Endpoints

Terminal-authenticated, under the existing `/device-gateway` prefix so a tablet
configures one base URL:

```
POST /device-gateway/terminal/pair             scan or type STH-XXXX-XXXX
GET  /device-gateway/terminal/state            everything, in one call
GET  /device-gateway/terminal/vehicle-qr       the vehicle's permanent code
GET  /device-gateway/terminal/checklist        template + live vehicle context
POST /device-gateway/terminal/checklist        submit
POST /device-gateway/terminal/trip/start|complete
POST /device-gateway/terminal/session/end
GET  /device-gateway/terminal/passport|maintenance|documents|driver
GET  /device-gateway/terminal/telemetry/latest
GET  /device-gateway/terminal/nearby
GET|POST /device-gateway/terminal/issues
POST /device-gateway/terminal/ai/ask
```

Heartbeat, telemetry, location, SOS, commands and camera are **not
re-declared**. The terminal uses `/device-gateway/heartbeat`, `/telemetry`,
`/sos` and the rest unchanged, because a second ingestion path is a second set
of rate limits, idempotency rules and validation that will eventually disagree
with the first.

People-facing, under `/terminal`:

```
POST /terminal/assignments/request              driver scans the vehicle QR
POST /terminal/assignments/:id/selfie           multipart, via the media library
POST /terminal/assignments/:id/submit|cancel
GET  /terminal/assignments/mine
GET  /terminal/assignments   /terminal/assignments/:id
POST /terminal/assignments/:id/approve|reject
GET  /terminal/terminals
GET|PUT /terminal/checklist-template
GET  /terminal/issues        PATCH /terminal/issues/:id
POST /fleet/vehicles/:id/terminal-pairing
```

### Permissions

Four new grants, deliberately their own group rather than folded into
`devices.*`: what they govern is not hardware, it is who may authorise a person
to take a vehicle out.

| Permission | Held by |
| --- | --- |
| `terminal.read` | owners, managers, dispatchers, drivers (scoped to their own) |
| `terminal.approve` | owners, mobility providers, fleet managers |
| `terminal.manage` | owners, mobility providers, fleet managers |
| `terminal.drive` | drivers |

A dispatcher sees the arrival queue and cannot decide it.

### Realtime

One new event, `terminal.session.updated`, on the existing gateway. Published to
`device:{terminalId}`, `fleet:{orgId}`, `driver:{driverId}` and
`truck:{vehicleId}` — all channels the existing `channel-authorization.ts`
already governs. No second realtime architecture, no new channel kinds.

### Redis

Existing `cache` and `lock` drivers only. Three new keys: the assembled terminal
state (10 s, invalidated explicitly on every transition), an approval-decision
claim (two managers tapping Approve at once), and a per-session assistant
budget. PostgreSQL stays the source of truth.

### Distance and routing

Nearby services report **road distance**, not straight-line distance, and the
difference is the point. Section 29's example is a driver on low fuel asking for
the nearest pump: a pump 800 m away across a motorway with no junction for six
kilometres is not the nearest pump, and a driver sent to it on a quarter tank has
been actively misled.

* New provider layer, `apps/api/src/providers/routing/`, backed by
  OpenRouteService. It is server-side rather than in the app because a tablet
  bolted into a truck gets sold, stolen and factory-reset, and section 6 forbids
  embedding backend secrets in the APK. The web app keeps its own browser-side
  key; the terminal asks Saarthi, and Saarthi asks ORS.
* One **matrix** call measures a whole services list, not one directions call per
  place. That is the difference between spending a fleet's daily allowance on a
  single search and spending one request on it.
* The list is **re-ranked** by road distance. Road numbers in crow-flies order
  would be the wrong order with the right figures on it.
* Routed on the *vehicle's* profile: `driving-hgv` for anything carrying freight,
  `driving-car` otherwise. A lorry routed as a car is sent under a bridge it does
  not fit beneath.
* `POST /device-gateway/terminal/route` returns geometry, turn-by-turn steps, a
  free-flow duration and a server-computed ETA. Fetched once, when the driver
  picks somewhere.

**When routing is unavailable** — no key, quota spent, service down, or a pair
the router cannot connect — the answer still arrives, every distance is labelled
`STRAIGHT_LINE`, and the terminal renders "3.2 km direct" with a banner
explaining why. Degrading quietly, so a crow-flies figure reads as a road
distance, is the one outcome this must never produce. `DistanceBasis` exists as a
type rather than a comment for exactly that reason, and the assistant's caveats
tell the model to say "in a straight line" in so many words.

### AI

`TERMINAL_TOOLS` in the existing registry. They are *driver* tools: none takes a
vehicle id, every one resolves the caller's own live session, and a driver with
no session gets a sentence the model can relay. They run through
`askWithTools` under an `AuthContext` rebuilt from the signed-on driver — so a
driver suspended after sign-on is refused by every tool without this module
knowing what suspension is.

Emergency intent short-circuits before any model call, on both the device and
the server.

---

## Android — `apps/terminal-android`

New standalone Gradle project, `com.saarthi.terminal`, Kotlin + Compose +
Material 3. `apps/device-android` is untouched.

- Splash, pairing (QR **and** typed code), vehicle identity with the permanent
  QR, approval waiting with an honest clock, welcome, the ten-point checklist,
  the map-first cockpit, services, vehicle/driver/issues sheet, the assistant,
  and diagnostics.
- `TelemetryProvider` abstraction with phone, simulator and a real-but-idle
  Bluetooth OBD provider. Measured values always beat simulated ones on merge.
- Foreground service: telemetry, upload, heartbeat and state loops at three
  cadences. Offline outbox on disk, bounded, aged out, idempotent.
- MapLibre against the same OpenFreeMap styles the web app renders. No key. The
  route is drawn as a dark casing under a bright core — legible over both a pale
  motorway and a dark park, and cheaper on low-end hardware than any glow.
- A turn-by-turn banner. The next manoeuvre is computed **on the device** from a
  route it already holds, so a driver keeps being told where to turn inside a
  tunnel; the arrow is a glyph rather than a word, because a driver glancing up
  has about a second.
- Wake word via Android's on-device recogniser with `EXTRA_PREFER_OFFLINE` while
  waiting for the phrase — audio never leaves the tablet to detect it.
- Kiosk through device-owner provisioning and lock-task mode, keeping the status
  bar, notifications and power menu. Documented in the app's README.

Builds clean in debug and release (R8 included).

---

## Web

- `/fleet/terminal-approvals` — the arrival queue. Evidence above the buttons,
  a clock that says *escalation* and never "auto-approve", and a mandatory
  rejection reason the driver reads on the terminal.
- Vehicle → Hardware → **Saarthi Terminal** panel, with the QR and the typed code.
- A sign-on card on the existing `/q/:token` scan page, rendered only for a
  signed-in driver scanning a vehicle in their own fleet. Request → selfie →
  submit, with the selfie downscaled in the browser before upload.

---

## Verification

| | |
| --- | --- |
| `npm run typecheck` | Clean. The three failures are pre-existing (`jsqr` not installed; two stale `toll.test.ts` assertions) and were present before this work. |
| `npm test` (API) | **546 passed.** `sticker-layout.test.ts` fails to load for the same pre-existing missing `jsqr` dependency. |
| `packages/shared` | **252 passed**, including 25 new terminal rule tests. |
| `apps/api/tests/terminal.test.ts` | **28 passed** — pairing, single use, cross-tenant refusal, arrival, approval, rejection, the SLA, the checklist, and the credential boundaries. |
| `apps/api/tests/terminal-routing.test.ts` | **6 passed** — road-distance labelling, re-ranking, per-pair fallback, outage degradation, and the vehicle profile. |
| `terminal-android` | `assembleDebug`, `assembleRelease` (R8 included) and `testDebugUnitTest` all pass — 5 Kotlin tests. |
| `npx eslint` on new files | Clean. |

Two real bugs were found by the tests and fixed.

**A terminal that kept using its *enrolment* token after pairing 401s on its very
next request**, because claiming an enrolment changes the caller's subject. The
pairing response returns a fresh token; the client now stores it.

**Nearby results were not sorted by distance at all on the `PLACES_PROVIDER=local`
path.** `collectNearbyPlaces` returned rows straight from a Prisma `findMany`
with no `orderBy` and without calling `rank()` — every other branch ranked. So
"find me the nearest fuel station" returned whichever row PostgreSQL happened to
hold first, and the ordering shifted as the table's physical layout changed. It
was pre-existing and outside this feature's scope, but it sits directly on the
terminal's services path and is one line, so it is fixed
(`apps/api/src/modules/nearby/nearby.service.ts`). An existing test asserted
distance ordering and had been passing by luck.

---

## What was deliberately not done

**OBD.** The adapter has not arrived. `BluetoothObdTelemetryProvider` is real,
registered and discovers adapters, and returns an empty sample — which is also
what a real generic adapter does for most of what a truck's ECU knows.
`connect()` is explicitly unimplemented rather than filled with a plausible
ELM327 loop nobody has run against hardware; the comment says exactly what goes
there. Everything above the abstraction is already written against it.

**A custom wake-word model.** Porcupine or similar would be more accurate and is
a licensed binary with a per-device fee and a model that needs training for
accented Indian English. The Android recogniser is less accurate, and the README
says so; the wake word is off by default for that reason and because a
continuously-open microphone in a cab is not something to switch on for people.

**Voice-guided navigation and automatic rerouting.** The terminal draws the
route, shows the next manoeuvre and updates it as the vehicle moves, but it does
not read instructions aloud and does not notice when the driver has left the
route. Both need the vehicle projected onto the polyline rather than matched to
the nearest manoeuvre point, plus a deviation threshold tuned against real
journeys — and a reroute that fires on GPS noise in an urban canyon is worse
than none. `TerminalRouteView.geometry` carries the full-resolution line
precisely so that work has what it needs.

**Terminal camera streaming.** The camera is used for QR, selfie and issue
photos. Live publishing exists for the YC06/device path and is deliberately kept
separate (§43).

**A lockout on the diagnostics PIN.** The engineer PIN is enforced
(`AdminGate.kt`), set on first use rather than shipped as a default, and cleared
on every exit — but a wrong PIN costs nothing except retyping it. A terminal
that locked an engineer out at a roadside because a bored driver had been
guessing would be worse than the thing the lockout prevents, and the gate is not
a security boundary in any case: nothing behind it grants authority the server
would honour.
