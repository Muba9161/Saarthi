# SAARTHI DEVICE APP — COMPLETE IMPLEMENTATION SPECIFICATION
## Version 1.0 — Android Telematics, GPS, Camera & Hardware-Test Application

> This document defines the Android application that turns a phone into a Saarthi test/telematics device.
> It integrates with the existing Saarthi backend. It is NOT a second fleet-management product.
>
> Claude MUST first read `CLAUDE.md`, all existing Saarthi MD files, `SAARTHI_COMPLETE_CURRENT_PRODUCT_FEATURE_SPECIFICATION_v3.0.md`, and the actual repository before coding.

---

# 1. PURPOSE

The Saarthi Device App is a local-development and hardware-testing client that allows an Android phone to behave like a temporary Saarthi vehicle device.

It must test:
- secure device registration
- vehicle-device pairing
- GPS/location
- speed and heading
- camera/live video
- microphone where required
- phone sensors
- network state
- device heartbeat
- telemetry
- SOS
- Redis live-state flow
- WebSocket realtime updates
- PostgreSQL historical storage
- vehicle/device assignment
- Gemini intelligence using collected data

Later the same backend architecture must accept:
- Freematics ONE+ H
- YC06
- other telematics/IoT devices

without requiring the Saarthi web dashboard to be rebuilt.

---

# 2. ARCHITECTURE

```text
ANDROID PHONE
   |
   | HTTPS / WebSocket
   v
SAARTHI DEVICE GATEWAY
   |
   +-------------------+
   |                   |
   v                   v
 REDIS              POSTGRESQL
   |                   |
   v                   v
WebSocket         Historical Data
   |
   v
SAARTHI WEB DASHBOARD
```

Video must use a dedicated streaming path:

```text
Android Camera
      |
      v
Video Gateway
      |
      v
WebRTC / Appropriate Streaming
      |
      v
Saarthi Dashboard
```

The mobile app must NEVER connect directly to Redis or PostgreSQL.

---

# 3. TECHNOLOGY

Use the existing project's conventions first.

Recommended Android stack:
- Kotlin
- Jetpack Compose
- Android Jetpack
- Coroutines
- Flow
- Google Play Services Location
- CameraX
- secure local storage
- HTTP/WebSocket client

Existing Saarthi backend remains:
- Node.js
- TypeScript
- PostgreSQL
- Redis
- WebSocket
- workers/queues
- existing authentication
- existing provider architecture

If the repository already mandates another mobile framework, inspect it and follow the established decision rather than introducing unnecessary technology.

---

# 4. APP IDENTITY

Application name:

**Saarthi Device**

It is a device/telematics client, not the main Saarthi fleet-management application.

---

# 5. FIRST LAUNCH

Show:

```text
SAARTHI DEVICE

Turn your phone into a
Saarthi vehicle test device.

[ Connect Device ]
```

Generate a secure device identity.

Example:

```text
Device ID
SAARTHI-DEV-001
```

Do not depend solely on an easily spoofed hardware identifier.

---

# 6. DEVICE REGISTRATION

Register through the existing Saarthi backend.

Device record should contain, where supported:

```text
deviceId
deviceType
platform
appVersion
deviceModel
osVersion
status
createdAt
lastSeenAt
```

Example:

```text
deviceType = MOBILE_TEST_DEVICE
platform = ANDROID
```

---

# 7. VEHICLE-DEVICE PAIRING

The web dashboard creates the vehicle.

Example:

```text
Vehicle:
UP32 AB 1234
```

Then:

```text
Vehicle
→ Hardware
→ Add Device
→ Mobile Test Device
→ Generate Pairing QR
```

The pairing QR contains only a short-lived secure pairing token.

It must NOT contain sensitive vehicle/driver/financial information.

---

# 8. PAIRING FLOW

```text
Saarthi Web
   |
Generate temporary pairing token
   |
Display QR
   |
   v
Android Device
   |
Scan QR
   |
Send deviceId + pairingToken
   |
   v
Saarthi Backend
   |
Validate token
Check expiry
Check authorization
Check device state
Check existing assignment
   |
   v
Create DeviceAssignment
   |
   v
Return vehicle/device configuration
```

Result:

```text
SAARTHI-DEV-001
        |
        v
UP32 AB 1234
```

Pairing tokens should be:
- short-lived
- scoped
- single-use where practical
- revocable

---

# 9. DEVICE ASSIGNMENT MODEL

Do NOT store only a permanent `vehicleId` inside the device.

Use:

```text
Vehicle
   |
   | 1:N over time
   v
DeviceAssignment
   |
   v
Device
```

This allows:

```text
UP32 AB 1234
├── SAARTHI-DEV-001
├── Freematics FM-0001
└── YC06 CAM-0001
```

A device can later be reassigned.

Close old assignments with an end/unassigned timestamp so historical telemetry remains associated with the correct vehicle.

---

# 10. DEVICE TYPES

Support:

```text
MOBILE_TEST_DEVICE
TELEMATICS
CAMERA
OTHER_IOT
```

Phone:

```text
MOBILE_TEST_DEVICE
```

Future:

```text
Freematics → TELEMATICS
YC06 → CAMERA
```

---

# 11. DEVICE HOME SCREEN

After pairing:

```text
SAARTHI DEVICE

● CONNECTED

Device
SAARTHI-DEV-001

Assigned Vehicle
🚛 UP32 AB 1234

GPS
● Active

Camera
● Available

Network
● Connected

Last Sync
2 seconds ago

[Start Device]
[Camera]
[Test GPS]
[Telemetry]
[Settings]

        🚨 SOS
```

Show clear status for:
- backend
- GPS
- camera
- network
- WebSocket

---

# 12. GPS / LOCATION

Use Android location services.

Collect where available:

```text
latitude
longitude
speed
heading
altitude
accuracy
timestamp
```

If a field is unavailable, return `null` rather than inventing it.

Request permissions progressively and explain why location is required.

If continuous background tracking is required, use the correct Android foreground-service architecture and permissions.

---

# 13. LOCATION REPORTING

Make the interval configurable.

Example presets:

```text
Testing: 1 second
Normal: 5 seconds
Battery Saver: 15 seconds
Custom
```

Use throttling/change detection/batching where appropriate.

Do not transmit unnecessary duplicate events.

---

# 14. LOCATION PAYLOAD

Conceptually:

```json
{
  "deviceId": "SAARTHI-DEV-001",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "speed": 48.2,
  "heading": 82,
  "accuracy": 5.0,
  "timestamp": "2026-08-29T10:18:00Z"
}
```

The backend must resolve the active vehicle assignment. Do not blindly trust a client-supplied vehicleId.

---

# 15. DEVICE AUTHENTICATION

Every device request must be authenticated.

Use the existing Saarthi device-authentication architecture where available.

Do NOT use `deviceId` alone as authentication.

Credentials/tokens must be stored securely and never logged.

---

# 16. LIVE LOCATION

Preferred:

```text
GPS
 ↓
Android App
 ↓
Device Gateway
 ↓
Redis
 ↓
Redis Pub/Sub
 ↓
WebSocket Gateway
 ↓
Saarthi Dashboard
```

Redis live key example:

```text
saarthi:{env}:vehicle:{vehicleId}:live
```

Store current:
- latitude
- longitude
- speed
- heading
- accuracy
- timestamp
- deviceStatus

Use TTL/last-seen logic.

---

# 17. HISTORICAL LOCATION

Historical data should flow:

```text
Device
 ↓
Gateway
 ↓
Queue/Buffer
 ↓
Worker
 ↓
PostgreSQL
```

Store:
- vehicleId
- deviceId
- timestamp
- latitude
- longitude
- speed
- heading
- accuracy
- source

Use proper indexes and time-range queries.

---

# 18. OFFLINE BUFFERING

If internet is lost:

```text
GPS
 ↓
Local bounded queue
 ↓
Network lost
 ↓
Temporary storage
 ↓
Network restored
 ↓
Upload
```

Every event should have an event ID/idempotency key.

Prevent duplicates.

Do not allow unlimited local storage.

---

# 19. CAMERA

Use CameraX or the project's approved camera implementation.

Support:
- permission
- preview
- front/rear camera
- start/stop
- stream status
- reconnect
- error state

The phone camera is the first live-video test source.

---

# 20. LIVE VIDEO

Do NOT send video through normal JSON telemetry APIs.

Preferred:

```text
Android Camera
 ↓
Video Encoder
 ↓
Video Gateway
 ↓
WebRTC / appropriate streaming
 ↓
Saarthi Dashboard
```

Do not store live video frames in PostgreSQL.

Store metadata separately.

---

# 21. CAMERA-VEHICLE ASSOCIATION

The camera inherits the active device-to-vehicle assignment.

Example:

```text
SAARTHI-DEV-001
       |
       v
UP32 AB 1234
       |
       +── GPS
       +── Camera
```

The web dashboard therefore shows:

```text
UP32 AB 1234
📹 Live Camera
```

not merely the device ID.

---

# 22. PHONE SENSORS

Where available:
- accelerometer
- gyroscope
- orientation
- motion

Use for:
- crash/event testing
- movement
- harsh motion testing
- future driver-safety features

Do not claim phone sensors are equivalent to vehicle CAN data.

---

# 23. MOCK VEHICLE TELEMETRY

A phone cannot naturally provide all engine data.

Create a simulator for:

```text
RPM
Fuel
Coolant Temperature
Battery Voltage
Engine Status
Diagnostics
```

Example:

```text
RPM: 1850
Fuel: 64%
Coolant: 87°C
Battery: 27.3V
Engine: NORMAL
```

Every simulated value must be clearly marked:

```text
Source: SIMULATED
```

Simulation modes:

```text
Normal
High RPM
Overheating
Low Fuel
Low Battery
Engine Warning
Custom
```

---

# 24. NORMALIZED TELEMETRY

Use one normalized telemetry contract:

```text
Telemetry
├── location
├── speed
├── heading
├── rpm
├── fuel
├── coolantTemperature
├── batteryVoltage
├── engineStatus
├── diagnostics
└── source
```

The Saarthi web UI should not care whether data came from:
- phone
- Freematics
- another device

---

# 25. FREEMATICS COMPATIBILITY

Future:

```text
Freematics ONE+ H
        ↓
Device Gateway
        ↓
Normalized Telemetry
        ↓
Saarthi
```

The phone test client must use compatible concepts so the migration later does not require rebuilding the frontend.

Do not assume every vehicle exposes every telemetry field.

Preserve source and availability.

---

# 26. YC06 COMPATIBILITY

Future architecture:

```text
Vehicle
├── Freematics
│   └── Telemetry
└── YC06
    ├── Camera 1
    ├── Camera 2
    ├── Camera 3
    └── Camera 4
```

The phone app is the initial GPS/camera testing implementation.

---

# 27. SOS

Provide a prominent SOS control.

Use an accidental-activation safeguard such as:

```text
Tap
 ↓
Countdown/confirmation
 ↓
Send
```

unless an emergency mode explicitly requires immediate activation.

SOS payload may include:

```text
eventId
deviceId
vehicleId resolved by backend
driverId if authorized
timestamp
latitude
longitude
speed
heading
cameraAvailability
networkStatus
batteryLevel
incidentType
```

Do not send unnecessary sensitive information.

---

# 28. SOS REALTIME FLOW

```text
Phone
 ↓
SOS API
 ↓
Incident Service
 ↓
Redis Pub/Sub
 ↓
WebSocket
 ├── Fleet Owner
 ├── Authorized Manager
 ├── Truck Association
 └── Nearby authorized Saarthi vehicles
```

Recipient authorization is determined by the Saarthi backend, not the phone.

---

# 29. HEARTBEAT

Send periodic device heartbeat:

```text
deviceId
assignment status
battery
network
gpsStatus
cameraStatus
appVersion
timestamp
```

Backend maintains `lastSeenAt`.

Redis stores current device status.

---

# 30. DEVICE TEST CENTER

Create:

```text
Device Test Center

GPS
✓ Permission
✓ Signal
✓ Location
✓ Speed

Camera
✓ Permission
✓ Preview
✓ Streaming

Backend
✓ Authentication
✓ API

Realtime
✓ WebSocket

Redis
✓ Live update

Telemetry
✓ Simulation

SOS
✓ Test Event

Battery
✓ Reading
```

This must make local debugging straightforward.

---

# 31. DEBUG CONSOLE

Developer/debug builds may show:

```text
10:18:01 GPS UPDATE SENT
10:18:02 HEARTBEAT SENT
10:18:03 WEBSOCKET CONNECTED
10:18:04 CAMERA STREAM STARTED
10:18:05 TELEMETRY ACK
```

Never show:
- access tokens
- passwords
- API keys
- sensitive personal data

Allow debug mode to be disabled for production builds.

---

# 32. DEVICE SETTINGS

Include:

```text
Device ID
Assigned Vehicle
Backend Environment
Reporting Interval
Camera Quality
Video Mode
Telemetry Simulation
Location Mode
Debug Mode
Battery Optimization Guidance
Unpair Device
```

Protected production endpoints cannot be changed by ordinary users.

---

# 33. UNPAIR

From the web dashboard:

```text
Vehicle
→ Hardware
→ Device
→ Unpair
```

The device becomes:

```text
UNASSIGNED
```

It must stop sending telemetry for that vehicle.

App shows:

```text
Device Unpaired

Scan a new pairing QR to connect.
```

---

# 34. REASSIGNMENT

Example:

```text
SAARTHI-DEV-001

Old:
UP32 AB 1234

New:
DL01 AB 5678
```

Close the old assignment and create a new assignment.

Historical data remains attached to the correct vehicle.

---

# 35. MULTI-DEVICE VEHICLE

Support:

```text
UP32 AB 1234
├── Freematics
├── YC06
└── Mobile Test Device
```

Show all active devices in:

```text
Vehicle
→ Hardware
```

---

# 36. REDIS RULE

The mobile app must NEVER connect directly to Redis.

Correct:

```text
Mobile
 ↓
Device Gateway
 ↓
Redis
```

Redis is internal Saarthi infrastructure.

Use Redis for:
- live vehicle state
- device heartbeat
- Pub/Sub
- WebSocket fan-out
- rate limiting where appropriate
- idempotency
- distributed locks
- temporary state

---

# 37. POSTGRESQL RULE

The mobile app must NEVER connect directly to PostgreSQL.

Correct:

```text
Mobile
 ↓
Saarthi API
 ↓
PostgreSQL
```

---

# 38. API CONTRACT

Reuse existing endpoints if present.

Potential APIs:

```text
POST /devices/register
POST /devices/pair
POST /devices/heartbeat
POST /devices/telemetry
POST /devices/location
POST /devices/sos
POST /devices/unpair
GET  /devices/me
GET  /devices/status
```

Do not create duplicates if the existing backend already has equivalent APIs.

---

# 39. WEBSOCKET

If WebSocket is used, support concepts such as:

```text
device:connected
device:heartbeat
device:telemetry
device:command
device:unpaired
device:error
```

All messages must be authenticated and authorized.

---

# 40. SERVER → DEVICE COMMANDS

If required:

```text
START_CAMERA
STOP_CAMERA
CHANGE_REPORTING_INTERVAL
REQUEST_LOCATION
PING
UPDATE_CONFIGURATION
```

Commands must:
- authenticate
- authorize
- acknowledge
- timeout safely
- retry safely where appropriate
- be idempotent where appropriate

---

# 41. GEMINI INTEGRATION

The phone app should not bypass the main Saarthi AI architecture.

Correct:

```text
Phone
 ↓
Saarthi Backend
 ↓
Telemetry / History
 ↓
Authorized Gemini Tool Registry
 ↓
Gemini
```

After a test drive, users can ask:

```text
"Summarize this vehicle's trip."

"How fast did it travel?"

"Was there unusual telemetry?"

"What was the maximum speed?"

"How long was the vehicle moving?"

"Did the device lose connection?"

"Was there unusual motion?"
```

Gemini must use actual Saarthi tool results and never invent data.

---

# 42. PERFORMANCE

Optimize for:
- low-end Android devices
- long-running operation
- poor networks
- high-frequency GPS
- camera streaming
- background operation
- battery usage

Avoid:
- excessive wake locks
- unnecessary network requests
- excessive recomposition
- memory leaks
- unbounded local logs
- unnecessary camera processing

---

# 43. BATTERY

Use:
- configurable GPS frequency
- appropriate foreground service
- minimal unnecessary background work
- stop camera when not required
- release sensors when unused
- Android battery-optimization guidance

Do not sacrifice safety/realtime requirements simply to save battery.

---

# 44. NETWORK RESILIENCE

Support:

```text
ONLINE
→ NETWORK LOST
→ BUFFER
→ RECONNECT
→ RESEND
```

Use exponential backoff.

Avoid infinite retry loops.

Display:

```text
Network ● Offline
GPS ● Active
Buffered Events: 17
```

---

# 45. SECURITY

Mandatory:
- HTTPS
- secure credentials
- device authentication
- token expiration/rotation
- revocation
- secure pairing
- rate limiting
- tenant isolation
- backend authorization
- no secrets in source
- no sensitive logs

Do not use device IDs as secrets.

---

# 46. PRIVACY

Clearly tell the user:

> Your location is being shared with Saarthi for the assigned vehicle.

Camera/location permissions must be explicit.

Collect only required data.

---

# 47. DEVICE APP API FLOW

```text
Registration
    ↓
Authentication
    ↓
Pairing
    ↓
Assignment
    ↓
Heartbeat
    ↓
GPS / Telemetry
    ↓
Redis Live State
    ↓
WebSocket
    ↓
Dashboard

Separately:

Camera
    ↓
Video Gateway
    ↓
Dashboard

SOS
    ↓
Incident Service
    ↓
Redis Pub/Sub
    ↓
Authorized Alerts
```

---

# 48. DATABASE CONCEPTS

Inspect existing schema before adding anything.

Potential entities only if absent:

```text
Device
DeviceAssignment
DeviceCredential
DeviceEvent
```

Reuse existing:
- Vehicle
- Driver
- Incident
- Telemetry
- Media

Do not create duplicate vehicle/device tables.

---

# 49. LOCAL TEST ENVIRONMENT

Run:

```text
Saarthi Web
Saarthi Backend
PostgreSQL
Redis
Workers
WebSocket Gateway
Video Gateway
Android Saarthi Device App
```

Use a physical Android phone for reliable camera/GPS testing where emulator capabilities are insufficient.

---

# 50. COMPLETE TEST SCENARIO

## Step 1

Start:

```text
PostgreSQL
Redis
Backend
Workers
WebSocket
Web
```

## Step 2

Create:

```text
UP32 AB 1234
```

## Step 3

Go to:

```text
Vehicle
→ Hardware
→ Add Device
```

## Step 4

Generate pairing QR.

## Step 5

Open Saarthi Device on Android.

## Step 6

Scan QR.

## Step 7

Confirm:

```text
SAARTHI-DEV-001
→ UP32 AB 1234
```

## Step 8

Enable GPS/camera/telemetry simulation.

## Step 9

Place phone inside the vehicle.

## Step 10

Move around.

## Step 11

Verify:

```text
Live map
Speed
Heading
Camera
Device status
Telemetry
```

## Step 12

Press test SOS.

## Step 13

Verify authorized owner/association/nearby responder alerts.

## Step 14

Stop network and verify buffering.

## Step 15

Restore network and verify synchronization.

## Step 16

Unpair and reassign to another vehicle.

Verify historical data remains correct.

---

# 51. ACCEPTANCE CRITERIA

### Pairing

```text
Phone
→ QR
→ Correct vehicle
```

### GPS

```text
Phone moves
→ Map moves
```

### Speed

```text
Phone moves
→ Speed changes
```

### Realtime

```text
GPS
→ Gateway
→ Redis
→ Pub/Sub
→ WebSocket
→ Dashboard
```

### History

```text
GPS
→ Queue
→ Worker
→ PostgreSQL
```

### Camera

```text
Phone Camera
→ Video Gateway
→ Dashboard
```

### SOS

```text
Phone SOS
→ Incident
→ Authorized recipients
```

### Offline

```text
Network loss
→ Buffer
→ Reconnect
→ Sync
```

### Reassignment

```text
Vehicle A
→ Unpair
→ Vehicle B
```

Historical records must remain correct.

---

# 52. FUTURE HARDWARE MIGRATION

Final architecture:

```text
             SAARTHI DEVICE GATEWAY
                       |
       ┌───────────────┼───────────────┐
       |               |               |
       v               v               v
     PHONE         FREEMATICS         YC06
      GPS           TELEMETRY        CAMERAS
      Camera        GPS              VIDEO
      Sensors       CAN
```

All devices produce normalized Saarthi data.

---

# 53. PRODUCTION READINESS

The app starts as local/test software but must use environment/configuration abstractions.

Support:

```text
development
staging
production
```

Production migration should later be configuration/infrastructure work rather than a rewrite.

Production concerns:
- secure API URLs
- secure device authentication
- managed Redis
- managed PostgreSQL
- production video infrastructure
- monitoring
- crash reporting
- app versioning
- device revocation
- secure secrets
- HTTPS

---

# 54. IMPLEMENTATION PHASES

### Phase 1 — Audit
Read all Saarthi specifications and inspect repository.

### Phase 2 — Device identity
Implement device registration/authentication.

### Phase 3 — Pairing
Implement QR pairing, assignment, reassignment and unpairing.

### Phase 4 — GPS
Implement location, reporting, buffering and realtime.

### Phase 5 — Camera
Implement CameraX, preview and live streaming.

### Phase 6 — Telemetry
Implement simulated vehicle telemetry.

### Phase 7 — SOS
Implement incident and realtime alert flow.

### Phase 8 — Test Center
Implement diagnostics/debugging.

### Phase 9 — Redis/WebSocket
Verify live-state architecture.

### Phase 10 — Historical storage
Verify PostgreSQL persistence.

### Phase 11 — Gemini
Verify authorized AI access to collected data.

### Phase 12 — Testing
Perform end-to-end, security, offline, camera, GPS and performance testing.

---

# 55. DEFINITION OF DONE

The app is NOT complete because the Android screens compile.

It is complete only when:

```text
Android App
     ↓
Device Registration
     ↓
Secure Pairing
     ↓
Vehicle Assignment
     ↓
GPS
     ↓
Redis Live State
     ↓
WebSocket
     ↓
Saarthi Dashboard
     ↓
Historical PostgreSQL
     ↓
Camera
     ↓
SOS
     ↓
Telemetry Simulation
     ↓
Gemini Intelligence
```

all work end-to-end.

Claude's final report must include:

```text
Files Created
Files Modified
APIs Used
Database Changes
Redis Keys
Cache Strategy
WebSocket Channels
Queue/Worker Changes
Device Authentication
QR Pairing Flow
Camera Architecture
GPS Architecture
Offline Strategy
SOS Flow
Gemini Integration
Tests
Performance Results
Known Limitations
Production Migration Requirements
```

# END OF SAARTHI DEVICE APP SPECIFICATION
