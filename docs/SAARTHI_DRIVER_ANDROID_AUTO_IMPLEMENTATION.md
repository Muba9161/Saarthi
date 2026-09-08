# Saarthi Driver — Android Auto Compatibility & Vehicle Onboarding
## Implementation Specification / Claude Code Prompt

### Objective

Extend the **existing Saarthi Driver Android APK** to support Android Auto while preserving the existing phone experience, shared `:core` architecture, authentication, vehicle assignment, pairing, OBD, telemetry, trips, and backend.

**Do not create a second Driver APK.**

Existing structure:

```text
apps/terminal-android/
├── :core
├── :terminal
└── :driver
```

`:core` remains the shared implementation layer.

---

## 1. Mandatory First Step — Inspect Before Coding

Before modifying anything:

1. Read `CLAUDE.md`.
2. Read all relevant `.md` documentation.
3. Inspect the complete `apps/terminal-android` structure.
4. Inspect `:core`, `:terminal`, and `:driver`.
5. Inspect Gradle configuration and dependencies.
6. Inspect Android manifests.
7. Inspect authentication and token persistence.
8. Inspect `/terminal/assignments/*`.
9. Inspect QR/vehicle assignment flows.
10. Inspect vehicle pairing.
11. Inspect OBD and telemetry.
12. Inspect GPS/location.
13. Inspect cockpit/trip state.
14. Inspect offline outbox.
15. Inspect existing navigation/maps.
16. Inspect existing tests.

For every requested item, classify it as:

- Already implemented
- Partially implemented
- Missing
- Conflicting
- Requires refactor

**Do not rebuild existing functionality.**

---

## 2. One APK Requirement

There must be only one Driver APK.

### Phone Mode

- Login/register
- Persistent authentication
- Scan vehicle QR
- Enter vehicle number
- Vehicle assignment
- Fleet approval
- Vehicle pairing
- Trips
- Cockpit
- OBD
- GPS
- Telemetry
- Documents
- SOS
- Profile/settings

### Android Auto Mode

Where permitted by Android Auto:

- Active trip
- Trips
- Navigation
- Nearby services
- SOS
- Vehicle health
- Driver/vehicle status

Both modes must use the same:

- Driver identity
- Authentication
- Vehicle association
- Assignment
- Pairing
- Trip state
- Backend
- Repositories
- OBD service
- Telemetry
- Offline outbox

Do not duplicate business logic.

---

## 3. Vehicle Selection — QR OR Vehicle Number

The driver must be able to identify a vehicle using either:

1. **Scan Vehicle QR**
2. **Enter Vehicle Number**

The driver must not be forced to use QR only.

Desired phone flow:

```text
Saarthi Driver
      ↓
Sign in / Restore Session
      ↓
Select / Scan Vehicle
      ↓
┌───────────────────────────────┐
│ Scan Vehicle QR               │
│                               │
│ OR                            │
│ Enter Vehicle Number          │
└───────────────────────────────┘
```

### QR Flow

```text
Scan QR
   ↓
Decode vehicle identifier
   ↓
Lookup vehicle
   ↓
Create/continue assignment
   ↓
Wait for fleet approval
   ↓
Approved
   ↓
Vehicle pairing
   ↓
Shared cockpit
```

### Vehicle Number Flow

```text
Enter vehicle registration number
   ↓
Normalize input
   ↓
Validate
   ↓
Lookup vehicle using existing Saarthi API
   ↓
Verify driver eligibility
   ↓
Create/continue assignment
   ↓
Wait for fleet approval
   ↓
Approved
   ↓
Vehicle pairing
   ↓
Shared cockpit
```

### Security Rule

Vehicle identification is **NOT authorization**.

- QR possession does not authorize a driver.
- Knowing a vehicle number does not authorize a driver.
- Fleet approval remains the authorization decision.
- Existing RBAC/assignment rules remain authoritative.

Do not create a second authorization model.

---

## 4. Vehicle Number Input

Support Indian registration numbers.

Normalize:

- case
- spaces
- common formatting variations

For example:

```text
DL 01 AB 1234
DL01AB1234
```

should normalize consistently where supported by the backend.

Prefer existing backend vehicle-number validation/normalization if one exists.

Do not create a conflicting second validation system.

Handle:

- invalid number
- vehicle not found
- unauthorized vehicle
- pending approval
- already assigned
- already paired
- network failure

---

## 5. Authentication

Preserve existing native authentication behavior.

Native clients already identify themselves using:

```text
X-Saarthi-Client
```

Native login/register/refresh may return the refresh token in the response body.

Browser authentication must remain unchanged.

The Driver app must:

- persist authentication securely
- restore session after app restart
- refresh access token when necessary
- restore active assignment
- restore active vehicle
- restore active trip/cockpit state

The server remains authoritative.

Do not require the driver to log in every shift.

---

## 6. Existing Vehicle Pairing

Preserve the existing endpoint:

```text
POST /terminal/assignments/:id/vehicle-pairing
```

The existing approval is the authorization.

The phone can mint/redeem the existing pairing token through the ordinary device gateway.

Do not create another pairing mechanism.

Preserve:

- existing slot rules
- audit trail
- authorization
- device gateway behavior

---

## 7. Fix Pairing Release

Current known gap:

```text
Approval
  ↓
Vehicle pairing
  ↓
Active session
  ↓
Cockpit sign-off
  ↓
Terminal session ends
  ↓
Pairing may remain active
```

Desired:

```text
Approval
  ↓
Vehicle pairing
  ↓
Active session
  ↓
Cockpit sign-off
  ↓
Session ends
  ↓
Vehicle pairing released
  ↓
Vehicle available according to existing rules
```

The server must be authoritative.

The release operation must be idempotent.

Handle:

- duplicate sign-off
- duplicate release
- app crash
- phone shutdown
- network failure
- retry
- reconnect
- reassignment race conditions

Never release a vehicle that has already been safely reassigned to another authorized session.

Inspect the existing lifecycle before implementation.

---

## 8. Arrival Selfie

The existing upload path exists, but the Driver app currently lacks the camera capture UI.

Implement:

```text
Arrival Selfie Required
        ↓
Open Camera
        ↓
Capture
        ↓
Preview
   ┌────┴────┐
 Retake   Confirm
             ↓
          Upload
             ↓
        Submit
```

Reuse the existing upload/storage abstraction.

Handle:

- camera permission
- permission denied
- camera unavailable
- upload failure
- retry
- offline state
- duplicate submission

If the fleet requires an arrival selfie, the driver must not be able to bypass it.

---

## 9. Android Auto Integration

Make the existing `:driver` APK Android Auto compatible.

Do NOT:

- create a second APK
- create a second Driver application
- mirror the phone UI
- expose arbitrary phone screens
- use arbitrary WebViews
- bypass Android Auto restrictions

Use the Android for Cars / Android Auto compatible APIs and templates supported by the project's SDK/toolchain.

The Android Auto interface must be a simplified driving interface.

The phone remains the primary compute and hardware gateway.

---

## 10. Android Auto Feature Set

Expose appropriate features through Android Auto where permitted.

### Active Trip

Display concise information such as:

- active trip
- origin
- destination
- trip status
- vehicle
- driver
- progress where supported

### Trips

Expose relevant:

- upcoming trips
- assigned trips
- active trip

Keep the UI concise.

### Navigation

Reuse the existing Saarthi map/navigation abstraction.

Do not duplicate the map engine.

If Android Auto requires a separate adapter, put it around the existing navigation/domain layer.

Do not place provider-specific logic into business logic.

### Nearby Services

Where supported, expose existing nearby services such as:

- fuel stations
- workshops
- service centres
- tyre services
- parking
- emergency services

Reuse the existing Saarthi service.

### SOS

Expose an easy-to-reach SOS action.

Use the existing Saarthi SOS backend/service.

Avoid accidental activation and follow Android Auto interaction constraints.

### Vehicle Health

Expose concise read-only vehicle health where supported:

- OBD connected/disconnected
- engine status
- coolant temperature
- RPM
- speed
- engine load
- throttle position
- diagnostic information where already supported

Do not generate simulated readings.

Driver builds must keep simulation disabled.

### Driver / Vehicle Status

Display concise:

- driver
- vehicle
- registration number
- assignment status
- pairing status
- trip status

Do not expose administrative controls.

---

## 11. Phone-Only Features

Keep complex workflows on the phone.

Examples:

- QR scanning
- vehicle-number entry
- registration
- detailed document management
- selfie capture
- approval submission
- complex settings
- detailed profile editing
- complex trip configuration
- administrative functions
- accounting/payment screens

Android Auto is a driving interface, not a second copy of the full Driver application.

---

## 12. QR Scanning

QR scanning belongs to the phone.

Do not attempt to use the car screen as a QR scanner.

Android Auto should direct the driver to complete vehicle selection on the phone when necessary.

The phone handles:

- camera
- QR scan
- QR validation
- vehicle lookup
- assignment creation

Android Auto reflects the resulting state.

---

## 13. OBD Architecture

Preserve the existing shared OBD implementation.

Required architecture:

```text
Vehicle ECU
    ↓
OBD-II
    ↓
ELM327
    ↓ Bluetooth
Android Phone
    ↓
Saarthi Driver :core
    ↓
Telemetry
    ↓
Saarthi Backend
```

Android Auto must NOT connect directly to the ELM327.

The phone owns:

- Bluetooth connection
- ELM327 communication
- PID polling
- parsing
- reconnect
- telemetry
- offline buffering

Android Auto consumes read-only vehicle state from the shared application.

Do not create a second OBD connection.

Preserve:

- auto-reconnect
- connected/disconnected state
- "Connect adapter" behavior
- real-data requirement

---

## 14. Phone ↔ Android Auto State

Both interfaces must remain synchronized.

Example:

```text
Phone:
Vehicle = DL01AB1234
Assignment = APPROVED
Pairing = ACTIVE
Trip = IN_PROGRESS
OBD = CONNECTED
```

Android Auto should show the same authoritative state.

Do not create separate Android Auto state.

Use the same repositories/domain state/API layer.

---

## 15. Background Operation

When Android Auto is active, the Driver app must continue required:

- GPS
- OBD
- telemetry
- realtime communication
- offline outbox
- synchronization
- authentication refresh

Follow current Android background/foreground-service rules.

Telemetry must not depend on the Android Auto UI process staying alive.

---

## 16. Offline Behavior

Reuse the existing offline outbox.

When offline:

- buffer telemetry
- preserve important state
- show offline status
- synchronize when connection returns

Do not create an unnecessary second offline database.

---

## 17. Safety

Android Auto must be optimized for driving.

Do NOT expose:

- long forms
- unrestricted text input
- dense dashboards
- complex configuration
- document editing
- camera capture
- QR scanning
- arbitrary WebViews
- administrative controls

Use safe, concise car-compatible interactions.

---

## 18. Backend/API Rules

Before creating an API:

1. Search for an existing endpoint.
2. Reuse it if possible.
3. Follow existing conventions if a new endpoint is genuinely required.
4. Preserve authentication.
5. Preserve RBAC.
6. Validate assignment/vehicle authorization.
7. Add audit logging where appropriate.
8. Add tests.

Do not create duplicate vehicle, assignment, pairing, trip, OBD, telemetry or document systems.

---

## 19. Existing Architecture Rules

Do NOT:

- create another Driver APK
- create another authentication system
- create another vehicle model
- create another pairing model
- duplicate OBD
- duplicate telemetry
- duplicate trips
- duplicate maps
- duplicate backend APIs
- bypass fleet approval
- authorize using only QR
- authorize using only vehicle number
- enable driver telemetry simulation
- mirror unrestricted phone UI onto Android Auto
- connect ELM327 directly to the car display
- weaken authentication
- break the existing terminal APK

---

## 20. Testing

Existing 19 unit tests must continue passing.

Add tests for:

### Authentication

- token persistence
- refresh
- session restoration

### Vehicle

- QR identification
- vehicle-number normalization
- vehicle-number lookup
- invalid vehicle number
- vehicle not found
- unauthorized vehicle
- pending approval
- approved assignment

### Pairing

- successful pairing
- duplicate pairing
- expired token
- already-paired vehicle
- pairing release
- duplicate release
- network failure during release
- reassignment race

### Arrival Selfie

- camera permission
- capture
- retake
- upload
- upload failure
- retry
- required-selfie enforcement

### OBD

- connection state
- reconnect
- disconnect
- no simulated driver telemetry

### Android Auto

- service initialization
- authenticated state
- unauthenticated state
- active trip
- trip list
- vehicle health
- SOS
- nearby services
- navigation integration where supported

Do not write tests that merely assert mocked success while the actual feature is missing.

---

## 21. Build Validation

Run:

- existing unit tests
- new tests
- `:core` build
- `:terminal` build
- `:driver` build

Verify:

- no terminal regressions
- driver simulation remains disabled
- Android Auto manifest/service declarations are valid
- required Android Auto metadata is valid
- dependencies are compatible

---

## 22. Physical Device Validation

Do NOT claim Android Auto compatibility merely because Gradle builds.

Prepare the Driver APK for physical testing against the existing backend/tunnel configuration.

Test:

1. Install Driver APK.
2. Sign in.
3. Kill/reopen app.
4. Confirm session persists.
5. Scan vehicle QR.
6. Confirm assignment.
7. Approve from fleet side.
8. Confirm approval on phone.
9. Pair vehicle.
10. Open cockpit.
11. Connect ELM327.
12. Confirm real OBD data.
13. Start/continue trip.
14. Connect Android phone to Android Auto.
15. Confirm Saarthi appears.
16. Open Saarthi on car screen.
17. Confirm active trip.
18. Test trip access.
19. Test navigation where implemented.
20. Test vehicle health.
21. Test nearby services.
22. Test SOS presentation.
23. Disconnect network.
24. Verify offline behavior.
25. Restore network.
26. Verify synchronization.
27. Sign off.
28. Verify pairing release.

Clearly distinguish:

- IMPLEMENTED + TESTED
- IMPLEMENTED + BUILD VERIFIED
- REQUIRES PHYSICAL DEVICE VALIDATION

Never claim a real-device feature works without testing it.

---

## 23. Final Implementation Report

At completion, report:

1. Files changed
2. Existing functionality reused
3. Android Auto components added
4. QR scanning status
5. Vehicle-number entry status
6. Pairing lifecycle status
7. Arrival selfie status
8. OBD status
9. Tests added
10. Tests passed
11. `:core` build result
12. `:terminal` build result
13. `:driver` build result
14. Android Auto limitations
15. Physical-device validation requirements
16. Exact Driver APK installation/testing steps

Be completely honest about implementation versus actual device validation.

**The goal is to extend the existing Saarthi Driver APK — NOT to rebuild Saarthi.**
