# Saarthi Terminal — Implementation Map

Produced from a full read of the existing repository before any code was written,
as required by sections 2, 64 (Phase 1) and 67 of
`SAARTHI_TERMINAL_APP_SPECIFICATION.md`.

---

## 1. Existing architecture (what was found)

| Area | Where it lives | Verdict |
| --- | --- | --- |
| API | Fastify 5 + Prisma 6 + PostgreSQL, `apps/api`, versioned at `/api/v1`, routes declared centrally in `src/server/routes.ts` | Reuse |
| Auth (people) | `src/auth/*`, bearer access token → `Session` row → `AuthContext` (tenant, permissions, entitlements, `driverId`) | Reuse |
| Auth (devices) | `src/modules/devices/device-auth.ts` — separate credential population, separate signing key (`DEVICE_JWT_SECRET`), secret → short-lived JWT, `credentialVersion` for instant revocation | Reuse |
| Device lifecycle | `DeviceEnrolment` (identity with no tenant) → pairing token → `HardwareDevice` + `DeviceAssignment` | Reuse |
| Device client surface | `/api/v1/device-gateway/*` — enroll, token, me, config, pair, unpair, heartbeat, location, telemetry, commands, sos, camera | Reuse |
| Vehicle pairing QR | `src/modules/devices/pairing.service.ts` — opaque single-use token, 5 min, hashed at rest, `{v,kind,api,token}` payload | Reuse |
| Permanent vehicle QR | `src/modules/qr/qr.service.ts` — `QrCode(subjectType=VEHICLE)`, opaque token, scope-intersected server-side resolution, revocable, rotatable | Reuse — **this is the Terminal's vehicle QR** |
| Telemetry | `src/modules/telemetry/gateway.service.ts` `ingest()`, `TelemetryReading` with a per-reading `metrics[]` + `simulatedMetrics[]` | Reuse |
| Realtime | `src/realtime/*` — one WebSocket gateway, channel authorisation, Redis pub/sub fan-out, plus a device-only socket | Reuse |
| Redis | `src/infra/*` — cache, lock, pubsub, queue, all driver-swappable | Reuse |
| SOS | `src/modules/sos/sos.service.ts`, incl. `triggerSosFromDevice()` and association routing | Reuse |
| Maintenance / service history | `src/modules/maintenance/*` | Reuse |
| Documents / compliance | `src/modules/documents/*`, `complianceSummary()` | Reuse |
| Vehicle passport | `analytics.service.ts::truckPassport()` at `GET /analytics/trucks/:id/passport` | Reuse |
| Nearby services | `src/modules/nearby/*`, Overpass/local providers, `NearbyCategory` | Reuse |
| Media (photos) | `src/modules/media/*`, polymorphic owner, visibility, moderation | Reuse — selfie + issue photos |
| AI | `src/modules/ai/*` + `providers/ai/{gemini,anthropic,development}`, controlled tool registry with per-tool permission + entitlement checks and provenance | Reuse |
| Maps | MapLibre GL + OpenFreeMap vector tiles, no key; ORS for routing | Reuse (same style URLs on Android) |
| Routing | ORS, browser-side only (`VITE_ORS_API_KEY`) | **Extend** — a terminal cannot hold the key (§6), so a server-side provider was added and the key stays on the server |
| Brand | `apps/web/public/vorldx-saarthi.png`, `vorldx-mark.png`; `apps/api/src/modules/qr/assets/logo-{mark,lockup}.png`; tokens in `apps/web/src/styles/globals.css` | Reuse |
| Saarthi Device (Android) | `apps/device-android`, Kotlin + Compose + Material 3, `com.saarthi.device` | **Untouched.** Terminal is a new, separate Gradle project. |

## 2. Mapping the spec's "potential entities" onto what already exists

Section 40 asks for new entities *only if no equivalent exists*.

| Spec entity | Resolution |
| --- | --- |
| `Terminal` | **`HardwareDevice`** with `deviceType = VEHICLE_TERMINAL` (new enum member) and `role = TELEMETRY`. No new table. |
| `TerminalVehicleAssignment` | **`DeviceAssignment`**. No new table. |
| `DriverVehicleAssignment` | **`TruckAssignment`**. No new table — an approval opens one. |
| `DriverApprovalRequest` + `TerminalSession` | **`TerminalSession`** (new) — one row spans request → selfie → approval → checklist → trip → end, because they are one lifecycle and splitting them would need a join for every read. |
| `ChecklistSubmission` / `ChecklistItemResult` | **`TerminalChecklistSubmission` / `TerminalChecklistItemResult`** (new). |
| `TelemetrySnapshot` | **`TelemetryReading`**. No new table. |

New tables added: `terminal_sessions`, `terminal_session_events`,
`terminal_checklist_templates`, `terminal_checklist_template_items`,
`terminal_checklist_submissions`, `terminal_checklist_item_results`,
`terminal_issue_reports`. Nothing about vehicles, drivers, organizations,
maintenance or documents is duplicated.

## 3. The QR rule (spec §10, §51) — how it is honoured

- The Terminal **displays the vehicle's existing permanent `QrCode`** (subject
  `VEHICLE`). `GET /device-gateway/terminal/vehicle-qr` resolves or provisions
  that one code and renders it; it never mints a per-driver code.
- The pairing QR (`DevicePairingToken`) is a *different artefact* used once, by
  the terminal, to learn which vehicle it belongs to. It is not shown to drivers.
- The driver scans the vehicle QR from their own Saarthi account. Resolution
  goes through the existing `qr.service.resolveToken`, so scopes, privacy policy
  and the scan audit log all apply unchanged.

## 4. New backend surface

**Terminal-authenticated** (device credentials, no user session), mounted under
the existing `/device-gateway` prefix so a terminal configures one base URL:

```
GET  /device-gateway/terminal/state        full terminal + session snapshot
GET  /device-gateway/terminal/vehicle-qr   the permanent vehicle QR
GET  /device-gateway/terminal/checklist    template + live telemetry context
POST /device-gateway/terminal/checklist    submit
POST /device-gateway/terminal/trip/start   READY → TRIP_ACTIVE
POST /device-gateway/terminal/trip/complete
POST /device-gateway/terminal/session/end
GET  /device-gateway/terminal/passport     vehicle passport (terminal projection)
GET  /device-gateway/terminal/maintenance
GET  /device-gateway/terminal/documents
GET  /device-gateway/terminal/driver
GET  /device-gateway/terminal/nearby       services, ranked by road distance
POST /device-gateway/terminal/route        route to the place the driver picked
POST /device-gateway/terminal/issues       report a vehicle issue
POST /device-gateway/terminal/ai/ask       Gemini via the controlled tool layer
```

Heartbeat, telemetry, location, SOS, commands and camera are **not re-declared** —
the terminal uses the existing `/device-gateway/*` endpoints.

**User-authenticated** (`/api/v1/terminal`):

```
POST /terminal/assignments/request         driver scans vehicle QR
POST /terminal/assignments/:id/selfie      multipart, stored via media service
POST /terminal/assignments/:id/submit      → PENDING_APPROVAL
GET  /terminal/assignments/mine            driver's own live request
POST /terminal/assignments/:id/cancel
GET  /terminal/assignments                 owner/provider queue
GET  /terminal/assignments/:id
POST /terminal/assignments/:id/approve
POST /terminal/assignments/:id/reject
GET  /terminal/terminals                   terminals in this fleet
GET  /terminal/checklist-template          configurable template (§17)
PUT  /terminal/checklist-template
```

## 5. Realtime (spec §38, §62)

No second architecture. One new event, `terminal.session.updated`, carrying a
`TerminalSessionPayload`, published on the existing channels:
`device:{terminalId}` (the terminal), `fleet:{organizationId}` (the owner
queue) and `driver:{driverId}` (the driver's phone/browser). Everything else —
telemetry, SOS, device heartbeat, alerts — already broadcasts and needs nothing.

## 6. Redis (spec §39)

Existing `cache`/`lock` drivers only. New keys, added to `cache-keys.ts`:
terminal live state, an approval-claim lock so two owners cannot approve the
same request twice, and a per-session AI rate key. Postgres stays the source of
truth.

## 7. 15-minute SLA (spec §15)

`runTerminalApprovalSweep()` registered in `src/jobs/index.ts`. It sends a
reminder, then escalates to owner-level roles at 15 minutes, then expires a
request that is never answered. **It never approves.** Only
`POST /terminal/assignments/:id/approve` by an authorised human activates a
driver.

## 8. Android — `apps/terminal-android`

New standalone Gradle project, `com.saarthi.terminal`, Kotlin + Compose +
Material 3, mirroring the conventions of `apps/device-android` without sharing
code (the two apps must be able to diverge). `apps/device-android` is not
modified.

Layers: `data` (secure identity store, settings, offline outbox) ·
`network` (Saarthi client + DTOs + realtime socket) · `telemetry`
(`TelemetryProvider` abstraction: phone / simulated / OBD placeholder) ·
`domain` (terminal state machine, checklist evaluation, voice intents) ·
`ui` (adaptive Compose surfaces) · `service` (foreground telemetry + heartbeat).

## 9. Deliberate non-goals

- OBD: the adapter has not arrived. `BluetoothObdTelemetryProvider` is a real,
  registered provider that reports `NOT_CONNECTED` and contributes no metrics.
  Nothing else in the app knows the difference (§19, §21).
- The YC06/production camera path is untouched (§43).
- Wake-word detection uses Android's on-device recogniser rather than a custom
  hotword model; audio is not uploaded to detect the phrase (§33).
