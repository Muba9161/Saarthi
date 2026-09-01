# Saarthi Device — implementation report

What was built for `SAARTHI_DEVICE_APP_COMPLETE_SPECIFICATION_v1.0.md`, what was
reused rather than rebuilt, and what is not finished.

The shape of the work was decided by one finding from the repository audit:
**roughly three-quarters of the backend the device specification asks for
already existed.** The device registry, the assignment-history model, the
credential scheme, the ingestion gateway, the normalised telemetry contract, the
vendor-adapter registry, the Redis live-state key (already
`saarthi:{env}:vehicle:{id}:live`, exactly as §16 names it), the pub/sub → WebSocket
fan-out, the camera and video-ticket abstraction, the SOS network and the
authorised Gemini tool registry were all in place and production-shaped. So this
was an extension of an existing device architecture, not a second one.

---

## Files created

**Shared contract**

| File | Purpose |
|---|---|
| `packages/shared/src/domain/device-client.ts` | intervals, buffer ceilings, simulation profiles, capability lists |
| `packages/shared/src/validation/device-client.ts` | the zod wire contract — the authority for both sides |

**API**

| File | Purpose |
|---|---|
| `apps/api/src/modules/devices/device-auth.ts` | device credentials, tokens, revocation, request authentication |
| `apps/api/src/modules/devices/enrolment.service.ts` | self-enrolment and its sweep |
| `apps/api/src/modules/devices/pairing.service.ts` | QR pairing, reassignment, unpairing, device config |
| `apps/api/src/modules/devices/pairing.routes.ts` | Vehicle → Hardware → Add device |
| `apps/api/src/modules/devices/device-client.routes.ts` | the device-facing surface |
| `apps/api/src/modules/devices/device-status.service.ts` | heartbeat, live status, silence sweep |
| `apps/api/src/modules/devices/device-command.service.ts` | server → device commands |
| `apps/api/src/providers/devices/phone.adapter.ts` | normalises a phone frame, separating measured from simulated |
| `apps/api/src/providers/video/device-webrtc.provider.ts` | WHIP/WHEP publisher and viewer tickets, and the ticket signature |
| `apps/api/src/modules/devices/video-gateway.routes.ts` | the gateway authorisation callback |
| `apps/api/src/realtime/device-websocket.routes.ts` | `/ws/device` |
| `apps/api/src/modules/ai/tools/device.tools.ts` | four authorised Gemini tools |
| `apps/api/tests/device-client.test.ts` | 33 integration tests |
| `apps/api/tests/device-ingestion.test.ts` | 16 integration tests |
| `apps/api/tests/video-gateway.test.ts` | 19 integration tests |

**Migrations** — `20260829120000_device_client_enums`,
`20260829120100_device_client_tables`, `20260829130000_telemetry_simulated_metrics`.
Split in two because PostgreSQL cannot use a new enum value in the same
transaction that adds it.

**Web** — `apps/web/src/features/devices/vehicle-hardware.tsx`,
`apps/web/src/features/cameras/whep-player.tsx`.

**Infrastructure** — `docker/mediamtx.yml`, plus a `video`-profiled service in
`docker-compose.yml`.

**Android** — `apps/device-android/`, 22 Kotlin files plus Gradle and resources.
Builds to an installable APK; see its README.

**Docs** — `docs/SAARTHI_DEVICE_APP_CONTRACT.md`, `apps/device-android/README.md`.

## Files modified

31 files. The substantive ones:

| File | Change |
|---|---|
| `prisma/schema.prisma` | 3 models, 6 enums, 15 columns — all additive |
| `domain/enums.ts` | `MOBILE` provider, `MOBILE_TEST_DEVICE` type, `DeviceRole`, command/network/subsystem enums, and the YC06/MULTI_CAMERA drift fix |
| `domain/permissions.ts` | new `devices.pair` grant |
| `domain/telemetry.ts` | `simulatedMetrics` on the normalised reading |
| `api/realtime.ts` | 5 events, 4 payloads, `simulatedMetrics` on telemetry |
| `devices/device.service.ts` | role-aware occupancy; credential revocation on rotate/suspend/unpair; client health in the summary |
| `telemetry/gateway.routes.ts` | accepts both payload shapes; shared authentication; device-keyed rate limit |
| `telemetry/gateway.service.ts` | idempotency, `simulatedMetrics`, `duplicates` in the outcome |
| `sos/sos.service.ts` | escalation extracted and shared with a new device-triggered path |
| `devices/camera.service.ts` | publish sessions in the existing access log |
| `config/env.ts` | device and video-gateway settings, plus a production guard |
| `web/pages/fleet/vehicle-detail.tsx` | Hardware tab |

---

## Existing APIs used unchanged

`POST /device-gateway/telemetry` · `POST /device-gateway/verify` ·
`ingestLocation()` (the tracking pipeline the map already consumes) ·
`GET /telemetry/vehicles/:id/devices` · `GET /telemetry/vehicles/:id/latest` ·
`POST /devices/:id/assign` · `POST /devices/:id/unassign` ·
`GET /devices/:id/events` · `POST /cameras/:id/live` ·
`GET /fleet/vehicles/:id/cameras` · the whole `/sos/*` surface · `/ai/*` ·
`registerCamera()` · `notifyOrganization()` · `broadcastTruckLocation()` ·
`evaluateTelemetryRules()`.

## APIs added

Device-authenticated, on the existing `/api/v1/device-gateway` prefix:

`POST /enroll` · `POST /token` · `GET /me` · `GET /config` · `POST /pair` ·
`POST /unpair` · `POST /heartbeat` · `POST /location` · `POST /sos` ·
`GET /commands` · `POST /commands/:id/ack` · `POST /camera/publish-ticket` ·
`POST /camera/sessions/:id/end`

User-authenticated:

`POST /fleet/vehicles/:id/pairing-token` · `GET /fleet/vehicles/:id/pairing-tokens` ·
`DELETE /devices/pairing-tokens/:id` · `POST /devices/:id/commands` ·
`GET /devices/:id/commands`

No duplicate of an existing endpoint was created. Where the specification listed
one that already existed — telemetry ingestion — the existing route was extended
to accept the app's payload shape rather than given a sibling.

---

## Database changes

**New:** `device_enrolments`, `device_pairing_tokens`, `device_commands`.

**`hardware_devices`** gains `role`, `credentialVersion`, `selfEnrolled`,
`platform`, `deviceModel`, `osVersion`, `appVersion`, `lastHeartbeatAt`,
`batteryPercent`, `batteryCharging`, `networkType`, `gpsStatus`, `cameraStatus`,
`bufferedEvents`, `reportingIntervalSeconds`.

**`telemetry_readings`** gains `simulatedMetrics` and `clientEventId`, with
`@@unique([deviceId, clientEventId])`.

**`sos_incidents`** gains `triggeredByDeviceId`; `triggeredByUserId` becomes
nullable.

Every column is nullable or defaulted, so existing rows and existing queries are
unaffected. Verified against the live development database: the five demo
devices took sensible defaults and nothing needed backfilling.

### Two schema decisions worth stating

**`simulatedMetrics` rather than a boolean.** A phone sends a real position and
an invented RPM in the same frame. A single `simulated` flag cannot express
that: setting it brands a genuine position as fabricated and keeps it off the
map, and leaving it clear presents an invented coolant temperature as a
measurement. Telling an owner their coolant ran at 112 °C, when a test app made
the number up, takes a working truck off the road. So the honesty is recorded
per metric and travels all the way to the gauge and the AI answer.

**Enrolment is not a device.** A `DeviceEnrolment` has a real identifier and a
real secret and belongs to nobody. It can read itself and redeem a pairing code,
and nothing else. A `HardwareDevice` is created only when an authorised person's
pairing code is redeemed — so self-enrolment never writes into a tenant's fleet,
`organizationId` stays non-nullable, and unclaimed identities are swept away
rather than accumulating from an open endpoint.

---

## Redis

The live-vehicle key was already what §16 specifies and is unchanged. Added,
following the existing environment- and tenant-namespacing rules:

| Key | TTL | Purpose |
|---|---|---|
| `saarthi:{env}:device:{id}:status` | 180 s | heartbeat snapshot; expiry *is* the "not heard from" signal |
| `saarthi:{env}:device:{id}:commands` | 3600 s | fast path for a device without a socket |
| `saarthi:{env}:device:pair:{tokenHash}` | 60 s | single-use claim, held only for the transaction |
| `saarthi:{env}:device:{id}:idem:{eventId}` | 24 h | offline-replay guard in front of the unique index |

Cache strategy: nothing here is the only copy of anything. The database is
authoritative for commands, pairing and events; Redis is speed. The one place
absence carries meaning is device status, where an expired key means "silent",
which is exactly the fact the sweep acts on.

---

## WebSocket

`/ws/device`, separate from `/ws`, authenticated by a device token. A device
socket is joined to `device:{id}` at the handshake and can never join anything
else — there is no subscribe message, so the class of "client asked for a
channel it should not have" cannot arise. It is one-way; telemetry and
acknowledgements go over HTTP where they are validated, rate limited and
idempotent.

New events: `vehicle.device.heartbeat`, `vehicle.device.paired`,
`vehicle.device.unpaired`, `device.command`, `device.config.updated`.

Reusing `/ws` with a device branch would have put two authentication schemes and
two authorisation models in one handler, where a mistake in either leaks into
the other. The duplication was the cheaper risk.

---

## Video

`VideoProvider` gained `issuePublishTicket()` and `supportsPublishing`, and a
`DeviceWebRtcVideoProvider` (`VIDEO_PROVIDER=device`) issues HMAC-signed WHIP
publisher tickets and WHEP viewer tickets against an external gateway. A phone
behind carrier NAT cannot be dialled, so it publishes outward; a YC06 is dialled
by the gateway; both arrive at the browser as WebRTC and the dashboard cannot
tell them apart.

Phone cameras are registered as ordinary `DeviceCamera` rows at pairing —
channel 1 road-facing, channel 2 cabin — so the existing camera grid, live-view
ticket and access log work unchanged and the dashboard shows
**UP32 AB 1234 · Live Camera** rather than a device id.

Publish sessions are recorded in the same `VideoStreamSession` table as human
viewings. A lens pointed at a driver is accountable only if the record includes
the times the *device* switched it on.

`supportsPublishing` is reported to the device separately from `supportsLive`,
because they are different capabilities: an environment can display a recorder
while having nowhere for a phone to publish, and a device told otherwise opens
its camera, spends a driver's battery and data, and sends frames into nothing.

### The full path, end to end

```
phone camera ─Camera2─▶ VideoTrack ─▶ PeerConnection ─WHIP─▶ MediaMTX ─WHEP─▶ browser
                                                                │
                                            POST /video-gateway/authorize
                                                                ▼
                                                             Saarthi
```

**Device side** — `VideoPublisher.kt` and `WhipClient.kt`. libwebrtc via
`io.github.webrtc-sdk:android`, hardware H.264 where the phone has it and VP8 as
the universal fallback. WHIP (RFC 9725) is the whole of the signalling: one HTTP
POST carrying an SDP offer, one answer back, one DELETE at the end. ICE is
gathered fully before the POST rather than trickled, which costs a second at
start-up and works against every WHIP server rather than only those implementing
the optional PATCH.

**The gateway** — MediaMTX, added to `docker-compose.yml` behind a `video`
profile so it only runs when somebody wants it. RTSP, RTMP, HLS and recording
are all switched off: a gateway that also accepts RTSP is a second front door
nobody is watching, and recording driver-facing footage to a relay's disk would
put it somewhere Saarthi has no record of.

**Authorisation stays with Saarthi.** MediaMTX holds no user list. Every publish
and every view is referred to `POST /api/v1/video-gateway/authorize`, which
verifies the HMAC ticket, checks the requested path is the session the ticket was
issued for, checks the direction matches, and checks the session is still open.
That last check is what makes **Close** in the dashboard actually stop a stream,
rather than leaving it running until the ticket happens to lapse.

**Viewer side** — `whep-player.tsx`. The browser already has a complete WebRTC
implementation, and WHEP exists precisely so nobody has to ship a signalling
client, so the player is one `fetch` and no library. The camera grid previously
rendered a `<video>` element with no source; it now plays.

**The service owns the camera, not the screen.** Section 40 lets the dashboard
send `START_CAMERA`, so a stream has to start with the phone in a pocket and
survive the app closing. `TelemetryService` declares
`foregroundServiceType="location|camera"` — required from Android 14 — and its
notification says the camera is on for as long as it is. A screen that opened
its own CameraX preview would take the lens away from the service and stop the
stream at the exact moment somebody looked to check it was working, so the
camera screen renders the publisher's existing track instead.

---

## Authentication

| Layer | Mechanism |
|---|---|
| Enrolment credential | bcrypt secret, shown once, never recoverable |
| Session credential | device JWT, 15 min, own signing key (`DEVICE_JWT_SECRET`) |
| Revocation | `credentialVersion` on the device; every token carries the version it was minted under |
| Back-compat | header pair and HTTP Basic still accepted, so Freematics firmware is unaffected |
| WebSocket | token as a query parameter, the same compromise the user socket makes |
| Rate limiting | keyed on device identifier, not IP — a fleet behind one APN shares an address |

Rotating a secret, suspending a device, retiring it or unpairing it raises the
credential version, so outstanding tokens die on their next request rather than
at their next expiry. That is what makes revoking a stolen phone real rather
than advisory, and it is covered by a test.

Every authentication failure returns an identical 401 with an identical message,
so the surface cannot be used to enumerate devices — also tested.

### An RBAC decision you should know about

The existing rule — documented in `permissions.ts` — is that *telematics
hardware is provisioned and fitted by Saarthi*, so `devices.assign` is
platform-admin only and a fleet owner does not hold it.

A phone somebody already owns is not Saarthi-provisioned hardware, and requiring
a support ticket to pair one would defeat the point of a test device. Rather
than weaken the existing rule, a narrower grant was added: **`devices.pair`**,
held by `FLEET_OWNER` and `FLEET_MANAGER`, which issues pairing codes for
app-based device types *only*. Fitting a Freematics or claiming a YC06 still
requires `devices.assign`. The boundary is enforced by device type at the route,
and both halves are tested.

---

## QR pairing flow

```
web (devices.pair) ─▶ POST /fleet/vehicles/:id/pairing-token
                          │  single-use · 5 min · revocable · stored as SHA-256
                          ▼
                    QR: { v, kind, api, token }   ← nothing else
                          │
phone ── scan ────────────┤
       ── POST /device-gateway/pair  (+ its own credentials)
                          ▼
        validate token · check expiry, revocation, consumption
        check device type matches · check role slot free · check tenant
                          ▼
        promote enrolment → HardwareDevice (inside the issuing fleet)
        open DeviceAssignment · consume token · register cameras
        (all in one transaction)
                          ▼
        return identity + config + a fresh device token
```

The QR carries a token and an API URL and nothing else — no vehicle, no
registration, no fleet name. A code on a screen is photographed by whoever walks
past, and everything the pairing discloses is decided server-side at redemption.

Two live codes for one vehicle is how the wrong phone gets fitted to it, so
issuing a code revokes any outstanding one. Redemption is serialised by a Redis
claim and made single-use by the transaction, and the claim is released either
way so the next attempt reads "already used" rather than "in use by another
device".

---

## Multi-device vehicles

`assignDevice()` previously enforced one active device per vehicle, which
conflicts with §35. It now enforces one active device *per exclusive role*:

```
UP32 AB 1234
├── FREEMATICS       → TELEMETRY   ← only one of these
├── YC06             → CAMERA
└── SAARTHI-DEV-001  → CAMERA / AUXILIARY
```

The exclusivity moved from the device to the role because the original concern
was real: two units reporting slightly different positions for one truck
produces a map that flickers and an ETA that oscillates. Cameras take no
position slot, so a vehicle can carry as many as it has.

---

## GPS and offline strategy

```
FusedLocationProvider ─▶ frame built (real GPS + real motion + simulated engine)
                      ─▶ SQLite buffer (bounded 5,000, oldest dropped)
                      ─▶ upload loop, separate and backing off
                      ─▶ POST /location or /telemetry
                      ─▶ gateway → TelemetryReading + ingestLocation()
                      ─▶ Redis live state → pub/sub → dashboard
```

**Queue first, send second.** Every fix is written before an upload is
attempted, and rows leave only when Saarthi confirms it holds them. A crash
between the two costs a duplicate upload, which the event id makes harmless; the
other order costs the data.

**Idempotency is durable, not cached.** The Redis guard is a short cut; the real
guarantee is the unique index on `(deviceId, clientEventId)`, so a device
replaying a day-old buffer after a cache flush still writes once. Tested by
clearing the cache mid-test.

**Duplicates are a success.** They are counted and reported separately from
rejections, because a device replaying a buffer is behaving correctly and
filing that as a fault would fill its event log with alarms describing the
system working.

**A refusal ends the retry.** A 422 or 403 means stop and discard; a timeout
means keep and back off. Conflating them either loses data or flattens a
battery in a tunnel.

---

## SOS flow

```
phone ─▶ POST /device-gateway/sos   (position, type, its own battery/network)
      ─▶ resolve vehicle, driver, organization from the assignment
      ─▶ fold into any open incident for the vehicle
      ─▶ escalateIncident()  ← the same function a driver-raised SOS uses
           ├── flag truck + trip
           ├── notify fleet owner / manager / dispatcher
           ├── expanding-radius responder search
           └── district association routing
```

The payload names no vehicle, no driver and no recipients. All are resolved
server-side, because recipient selection is a decision about people's safety and
does not belong on a handset.

`triggeredByUserId` became nullable rather than being filled with the current
driver: when a phone on a windscreen raises an alarm there may be no signed-in
human, and recording one would be a claim about who acted that nobody verified.
`triggeredByDeviceId` records what actually happened.

The escalation path was *extracted* from `triggerSos` and is shared, not copied.
An emergency raised by a device reaches exactly the same people as one raised by
a driver.

---

## Gemini integration

Four tools added to the existing authorised registry, so they inherit its
permission filtering, plan gating, argument validation and provenance labelling:

- `list_vehicle_devices` — what is fitted, and what each reports about itself
- `summarise_vehicle_drive` — distance, duration, max/average speed, moving time
- `check_device_connectivity` — silence, gaps, battery, buffered events
- `check_vehicle_telemetry_readings` — engine and motion values

Two things make these safe to point a model at.

**Measured and simulated are returned under separate headings** and never
averaged together, with a caveat the model is instructed to relay. The system
prompt was extended to say why in the terms that matter: a fabricated coolant
temperature presented as a reading can put a working truck in a workshop.

**Reporting gaps are returned as facts.** A window where the device was silent
is excluded from distance and moving time, and the result says so — so the model
answers "at least 46 km, and the device was dark for 12 minutes" rather than a
confident figure derived from half a journey.

---

## Queues and workers

Two additions to the existing scheduler; no new infrastructure.

| Job | Interval | Purpose |
|---|---|---|
| `devices:offline-sweep` (extended) | 2 min | added heartbeat-silence detection and command expiry |
| `devices:credential-sweep` (new) | 1 h | expires unclaimed enrolments and old pairing codes |

Heartbeat silence is swept separately from telemetry silence because they mean
different things: a phone parked overnight is quiet and healthy, the same phone
with a flat battery is quiet and gone.

---

## The Android app

`apps/device-android/` — a standalone Gradle project inside the npm workspace.
npm's `apps/*` glob only matches directories containing a `package.json`, so it
is skipped by `npm install`; verified.

20 Kotlin files: Compose UI, a foreground tracking service, an encrypted
credential store, a bounded SQLite buffer, an OkHttp client with single-retry
token refresh, ML Kit QR pairing, CameraX preview, a seven-profile telemetry
simulator, a gravity-compensated motion detector, and a redacting debug console
compiled out of release builds.

Notable behaviour:

- The foreground notification names the vehicle and cannot be dismissed. It *is*
  the privacy disclosure §46 asks for, in the one place a driver will see it.
- Harsh-braking flags require GPS to corroborate the accelerometer, because a
  phone sliding across a dashboard is not the truck braking.
- Simulated engine data is compiled out of release builds, not merely
  switched off — a setting can be switched back on.
- `ACCESS_BACKGROUND_LOCATION` is deliberately not requested: a foreground
  service covers what a vehicle device needs, and the extra permission is more
  capability than the app has a reason for.

---

## Tests

| Suite | Result |
|---|---|
| API integration | **469 passed** (was 434 before this work; 68 new) |
| Shared domain unit | **207 passed** |
| Typecheck (shared, api, web) | clean |
| Lint | clean apart from one pre-existing error (see below) |
| Production build (shared, api, web) | clean |

The 68 new tests are mostly about what a device must *not* be able to do:

- an enrolled identity reaches no tenant data before anyone approved it
- a pairing code is spent exactly once, even by two devices racing
- an expired, revoked or superseded code is refused
- a fleet cannot claim provisioned hardware with the pairing grant
- one fleet's code is refused to another fleet's device, reported as invalid
  rather than as a tenant mismatch
- unpairing revokes outstanding tokens immediately
- suspending a device kills its token on the next request
- a wrong secret and an unknown device are indistinguishable
- a retried batch is stored once, cache or no cache
- simulated engine values are marked without branding the real position
- historical telemetry stays with the vehicle that produced it across a
  reassignment
- a device that keeps reporting after removal has the refusal recorded against it
- a gateway ticket cannot be forged, edited, replayed after expiry, used on
  another stream, used in the wrong direction, or used after its session closed
- every gateway refusal returns an identical body, so the endpoint cannot be
  used to work out which check failed

The pairing and ingestion flows were additionally exercised end to end against
the running development server and the live database; test rows were removed
afterwards and the five demo devices are untouched.

### Two defects the tests caught, and one the review caught

1. **A fleet could create a pairing code but not cancel it** — the revoke route
   required `devices.assign`. Cancelling now takes the same grant as issuing,
   because a fleet that cannot withdraw a code it accidentally showed has no way
   to react.
2. **A spent code reported "in use by another device" for 60 seconds** — the
   Redis claim outlived the transaction. It is now released either way, so the
   next attempt gets the accurate "already been used".
3. **`.env.example` would have stopped the API booting.** `VIDEO_GATEWAY_URL=`
   with an empty value fails `z.string().url().optional()`, because blank is not
   undefined — so anyone copying the example would have hit a validation error
   on first run. Fixed with a `blankAsUnset` helper and verified by booting the
   config against the example file.

---

## Known limitations

**The Android app has not been run on a physical device.** It compiles cleanly
with zero warnings and produces installable APKs, but nobody has yet held a
phone, paired it and watched the stream arrive. Expect the usual first-run
friction: codec negotiation against a particular gateway, and ICE on a
particular network.

**Audio is not published.** The specification says "microphone where required",
and for a road-facing camera it is not. A cabin microphone streaming without a
separate, explicit decision is a much bigger step than video, and it should be
somebody's choice rather than a default.

**Server→device commands are transported but not all acted on.** Queue,
delivery, acknowledgement and expiry are complete and tested.
`CHANGE_REPORTING_INTERVAL` takes effect through the heartbeat echo, and
`START_CAMERA`/`STOP_CAMERA` now work end to end. `REQUEST_LOCATION`, `PING` and
`UPDATE_CONFIGURATION` are acknowledged without a behaviour attached yet.

**No Android unit tests.** The logic worth testing — the simulator, the buffer,
the motion filter — is testable and should be tested. It has not been.

**The bundled gateway is for development.** MediaMTX behind the `video` compose
profile is right for a yard and a LAN. A production deployment needs it behind
TLS, with TURN for phones on mobile networks, and with the authorisation
endpoint reachable only from the gateway.

**One pre-existing lint error remains**, unrelated to this work:
`packages/shared/src/domain/route-intelligence.ts` has an unused
`distanceToSegment`. Also pre-existing: `apps/api/tests/sticker-layout.test.ts`
imports `jsqr`, which is declared in no `package.json` and not installed, so
that one test file cannot load. Both were left alone as out of scope; say the
word and I will fix them.

---

## Production migration requirements

Configuration and infrastructure, not code.

| Requirement | How |
|---|---|
| Device token signing key | `DEVICE_JWT_SECRET` — **enforced**, production refuses to start without it |
| Redis | `CACHE_DRIVER`/`PUBSUB_DRIVER`/`QUEUE_DRIVER`/`LOCK_DRIVER=redis` — device status and command queues become cross-instance |
| Video gateway | `docker compose --profile video up -d` for MediaMTX, or point at your own WHIP/WHEP server. Set `VIDEO_PROVIDER=device` + `VIDEO_GATEWAY_URL` + `VIDEO_GATEWAY_SECRET` (all three enforced together) |
| NAT traversal | `VIDEO_ICE_SERVERS` — STUN is enough on most networks, TURN is needed for phones behind carrier-grade NAT |
| Gateway isolation | `/api/v1/video-gateway/authorize` should be reachable only from the gateway. Nothing it returns is useful without a valid signed ticket, but it does not need to be public |
| HTTPS | already enforced device-side by `network_security_config.xml`; cleartext is permitted only to `10.0.2.2` and `localhost` |
| Simulated telemetry | `DEVICE_SIMULATION_ALLOWED=false`; also compiled out of release APKs |
| Self-enrolment | `DEVICE_SELF_ENROLMENT=false` to require administrator provisioning instead |
| App signing, crash reporting, Play distribution | not configured — no signing material belongs in this repository |
| Telemetry volume | `telemetry_readings` is the highest-volume table; the existing retention sweep applies, and partitioning by `recordedAt` is the next step when it is needed |

The app already supports development, staging and production without a rebuild:
the API base URL is read from the pairing QR, so a tester scanning a staging code
gets a device on staging.
