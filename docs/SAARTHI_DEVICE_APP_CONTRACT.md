# Saarthi Device — API contract

The wire contract between the Saarthi Device app and the Saarthi backend.

Two languages cannot share a type, so they share this document. When
`packages/shared/src/validation/device-client.ts` changes, this file and
`apps/device-android/.../network/Dto.kt` change with it.

| Side | Authority |
|---|---|
| Backend | [`packages/shared/src/validation/device-client.ts`](../packages/shared/src/validation/device-client.ts) |
| Android | [`Dto.kt`](../apps/device-android/app/src/main/java/com/saarthi/device/network/Dto.kt) |
| Constants | [`packages/shared/src/domain/device-client.ts`](../packages/shared/src/domain/device-client.ts) |

---

## Three rules the whole contract rests on

**No request names a vehicle.** No schema on the device surface accepts a
`vehicleId`, `truckId` or `driverId`. The backend resolves all three from the
device's active assignment. A field the phone could set is a field a compromised
phone could set to somebody else's truck.

**Absent is not zero.** Every optional sensor value is genuinely optional. A GPS
fix indoors has no bearing; a cold start has no speed. Sending `0` for either
corrupts the speed series the harsh-driving rules run on.

**Simulated data announces itself.** A phone's GPS, motion and battery are real
measurements. Its RPM, fuel, coolant temperature and trouble codes are produced
by an on-device simulator, travel in a separate `simulated` object, and are
recorded per metric so nothing downstream can present them as measured.

---

## Base URL

```
{apiUrl}/api/v1/device-gateway
```

`apiUrl` is learned from the pairing QR, not compiled in, so one build serves
development, staging and production.

## Authentication

| Form | Header | Used by |
|---|---|---|
| Bearer token | `Authorization: Bearer <deviceAccessToken>` | the app, for everything |
| Header pair | `X-Device-Id` + `X-Device-Secret` | firmware; the app, for `/token` |
| HTTP Basic | `Authorization: Basic base64(id:secret)` | firmware behind a header-stripping proxy |

The token is short-lived (15 minutes by default) and carries the credential
version it was minted under. Rotating the secret, suspending the device,
retiring it or unpairing it raises that version, and every outstanding token
stops working on its next request rather than at its next expiry.

Every authentication failure — unknown identifier, wrong secret, expired token,
suspended device — returns the same `401` with the same message, so the surface
cannot be used to discover which devices exist.

---

## Endpoints

### `POST /enroll` — claim an identity

The only unauthenticated route. Creates no tenant data: an enrolment has an
identifier and a secret and belongs to nobody until it redeems a pairing code.
Idempotent on `installationId`. Rate limited by address.

```jsonc
// request
{
  "installationId": "url-safe-random-24-bytes",   // generated on the device
  "platform": "ANDROID",
  "deviceModel": "Google Pixel 7a",
  "osVersion": "Android 14",
  "appVersion": "1.0.0",
  "deviceType": "MOBILE_TEST_DEVICE"
}

// 201
{
  "deviceIdentifier": "SAARTHI-DEV-001",
  "enrolmentId": "uuid",
  "secret": "returned exactly once",
  "token": { "accessToken": "...", "expiresIn": 900, "tokenType": "Bearer" },
  "status": "PENDING",
  "expiresAt": "2026-08-30T05:26:08.207Z",
  "nextStep": "Scan the pairing QR from Vehicle → Hardware…"
}
```

`installationId` must not be derived from `ANDROID_ID` or an IMEI: both are
spoofable, and the first survives a factory reset on some devices while changing
on others.

### `POST /token` — exchange the secret for an access token

Credentials in headers or in the body. An empty JSON body is accepted.

```jsonc
{ "deviceIdentifier": "SAARTHI-DEV-001", "secret": "…" }
→ { "accessToken": "…", "expiresIn": 900, "tokenType": "Bearer" }
```

### `GET /me` — identity and assignment

Answers for a pending enrolment too, so the app's first screen can show an
identity and an unpaired state before there is anything to pair to.

```jsonc
{
  "deviceId": "uuid | null",
  "deviceIdentifier": "SAARTHI-DEV-001",
  "provider": "MOBILE | null",
  "role": "TELEMETRY | CAMERA | AUXILIARY | null",
  "status": "ACTIVE",
  "paired": true,
  "organizationId": "uuid | null",
  "vehicle": { "id": "uuid", "registrationNumber": "UP32AB1234", "vehicleType": "TRUCK", "assignedAt": "…" },
  "cameras": [{ "id": "uuid", "channel": 1, "position": "FRONT", "label": "Road-facing camera" }],
  "lastSeenAt": "…",
  "lastTelemetryAt": "…"
}
```

### `GET /config` — server-owned settings

Requires a paired device.

```jsonc
{
  "reportingIntervalSeconds": 5,
  "heartbeatIntervalSeconds": 30,
  "videoEnabled": false,       // whether a gateway exists to publish to
  "simulationAllowed": true,   // whether this environment accepts simulated data
  "maxBatchSize": 100,
  "maxBufferedEvents": 5000,
  "environment": "development",
  "serverTime": "…"
}
```

`videoEnabled` reflects whether the backend can accept a *publish*, not whether
it can display a camera. They are different capabilities, and a device told
otherwise opens its camera and sends frames into nothing.

### `POST /pair` — redeem a pairing code

The QR encodes exactly this and nothing else:

```jsonc
{ "v": 1, "kind": "saarthi.device.pair", "api": "https://…", "token": "…" }
```

No vehicle, no registration, no fleet name — a QR on a screen is photographed by
whoever walks past.

```jsonc
// request
{ "token": "…", "deviceModel": "…", "osVersion": "…", "appVersion": "…" }

// 201
{
  "identity": { /* as GET /me */ },
  "config":   { /* as GET /config */ },
  "token":    { "accessToken": "…", "expiresIn": 900 },
  "credentials": null
}
```

The `token` in the response is not optional to use. The pending-enrolment token
stops resolving the instant the enrolment is claimed, so a client that ignores
it succeeds at pairing and then gets an unexplained `401`.

Codes are single-use, five minutes by default, revocable, and superseded by the
next code issued for the same vehicle.

### `POST /unpair`

```jsonc
{ "reason": "Driver handed the phone back" }
```

Closes the assignment and raises the credential version, so the device stops
being able to report immediately. Historical telemetry stays attached to the
vehicle that produced it.

### `POST /location` — GPS only

```jsonc
{
  "points": [{
    "eventId": "url-safe, generated before buffering",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "speedKph": 48.2,     // omit when the fix has none
    "heading": 82,        // omit when the fix has none
    "altitude": 216,
    "accuracy": 5.0,
    "satellites": 11,
    "recordedAt": "2026-08-29T10:18:00.000Z"   // UTC, always
  }]
}
```

### `POST /telemetry` — full frames

Shared with fitted hardware. Accepts this batch form *or* the firmware envelope
(`{ deviceId, sequence, payload }`), so there is one ingestion path rather than
two that drift apart.

```jsonc
{
  "frames": [{
    "eventId": "…",
    "recordedAt": "2026-08-29T10:18:00.000Z",
    "sequence": 4213,
    "location": { "latitude": 28.6139, "longitude": 77.2090, "speedKph": 52, "heading": 90 },
    "motion":   { "accelerationX": 0.1, "accelerationY": 0.02, "accelerationZ": 0.98,
                  "harshBraking": false, "harshAcceleration": false, "suddenMovement": false },
    "health":   { "signalStrength": -78, "networkType": "CELLULAR",
                  "batteryPercent": 64, "batteryCharging": true },

    // Everything below is invented by the app. Recorded per metric as simulated.
    "simulated": {
      "mode": "NORMAL",
      "rpm": 1850, "fuelLevel": 64, "coolantTemperature": 87, "batteryVoltage": 27.3
    }
  }]
}
```

Both ingestion endpoints answer:

```jsonc
{ "accepted": 2, "rejected": 0, "duplicates": 0, "alerts": 0, "reasons": [] }
```

`duplicates` is a success, not a failure: Saarthi already holds the event. A
client must drop those from its buffer, and must not count them as errors.

**Idempotency.** `eventId` is generated *before* the event is buffered. A batch
that is uploaded, times out and is retried is stored once. The guarantee is held
by a unique index on `(deviceId, clientEventId)`, so it survives a cache flush
and a day-old replay.

### `POST /heartbeat`

Every 30 seconds while running. Distinct from telemetry: silence in telemetry
means the vehicle is parked, silence in heartbeat means Saarthi has lost the
device.

```jsonc
// request
{
  "batteryPercent": 64, "batteryCharging": true,
  "networkType": "WIFI | CELLULAR | ETHERNET | OFFLINE | UNKNOWN",
  "gpsStatus":    "OK | DEGRADED | PERMISSION_DENIED | UNAVAILABLE | UNKNOWN",
  "cameraStatus": "OK | DEGRADED | PERMISSION_DENIED | UNAVAILABLE | UNKNOWN",
  "bufferedEvents": 17,
  "appVersion": "1.0.0",
  "deviceTime": "…"    // UTC; used to detect a skewed device clock
}

// 200
{ "acknowledgedAt": "…", "nextHeartbeatInSeconds": 30,
  "reportingIntervalSeconds": 5, "pendingCommands": 0 }
```

`reportingIntervalSeconds` is echoed on every beat, so a change made in the
dashboard reaches the device within one heartbeat without it polling anything.

The three subsystem statuses are kept distinct because the fix differs: a denied
permission needs the user, an unavailable sensor needs an engineer.

### `POST /sos`

```jsonc
{
  "eventId": "…", "type": "BREAKDOWN | ACCIDENT | MEDICAL | …",
  "latitude": 28.61, "longitude": 77.20,
  "speedKph": 0, "heading": null, "accuracy": 8,
  "description": null,
  "cameraAvailable": true, "networkType": "CELLULAR", "batteryPercent": 12,
  "triggeredAt": "…"
}
```

No vehicle, no driver, no recipients. All are resolved by the backend, because
recipient selection is a decision about people's safety and does not belong on a
handset. A second SOS while one is open is folded into the existing incident.

### `GET /commands` and `POST /commands/:id/ack`

```jsonc
// GET → collected commands are marked DELIVERED
[{ "id": "uuid", "type": "START_CAMERA", "payload": { "channel": 1 },
   "issuedAt": "…", "expiresAt": "…" }]

// POST ack
{ "success": true, "result": { }, "error": null }
```

Types: `START_CAMERA`, `STOP_CAMERA`, `CHANGE_REPORTING_INTERVAL`,
`REQUEST_LOCATION`, `PING`, `UPDATE_CONFIGURATION`.

Commands expire. A device back from a two-hour tunnel must not start its camera
because somebody asked at breakfast.

### `POST /camera/publish-ticket`

```jsonc
// request
{ "channel": 1 }

// 201
{
  "sessionId": "uuid",
  "ingestUrl": "https://gateway/whip/uuid",
  "token": "…",
  "protocol": "whip | mock",
  "expiresAt": "…",
  "constraints": { "maxWidth": 1280, "maxHeight": 720, "maxFrameRate": 15, "maxBitrateKbps": 800 },
  "simulated": false
}
```

Video never passes through Saarthi. The session is recorded in the same access
log that records every time a person watched a camera — a lens pointed at a
driver is accountable only if the record is complete.

`POST /camera/sessions/:id/end` closes it cleanly.

---

## Realtime

```
GET {apiUrl}/ws/device?token=<deviceAccessToken>
```

A separate endpoint from the user socket, with no subscribe message and no
channel authorisation: a device socket is joined to `device:{id}` at the
handshake and can never be joined to anything else.

One-way. `ping` is answered with `pong`; everything else is refused, because
telemetry and acknowledgements go over HTTP where they are validated, rate
limited and idempotent.

| Event | Meaning |
|---|---|
| `connected` | handshake accepted; queued commands follow immediately |
| `device.command` | an instruction for this device |
| `device.config.updated` | configuration to adopt now |
| `vehicle.device.unpaired` | this device has been removed from its vehicle |

---

## Limits

| Constant | Value |
|---|---|
| Reporting interval | 1–300 s, default 5 |
| Heartbeat interval | 30 s |
| Heartbeat timeout | 180 s |
| Buffer ceiling | 5,000 events, oldest dropped first |
| Batch size | 100 events |
| Buffered event max age | 24 h |
| Access token TTL | 15 min |
| Pairing code TTL | 5 min |
| Unclaimed enrolment TTL | 24 h |

## Errors

| Status | Meaning for the client |
|---|---|
| `0` (no HTTP) | network unreachable — buffer and retry with backoff |
| `401` | credentials rejected — refresh once, then stop |
| `403` | device suspended, retired or inactive — stop |
| `409` | already known or in use — treat as final |
| `422` | not paired, code spent or expired — stop and tell the user |
| `429` | rate limited — back off |

The message field is written for a person to read and should be shown as-is
rather than reworded.
