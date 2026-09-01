# SAARTHI TERMINAL --- Complete Android Application Specification

## 1. Purpose

Build a **new Android application named `Saarthi Terminal`** for a
dedicated vehicle-mounted phone/tablet. It is a driver-facing digital
cockpit integrated with the existing Saarthi platform.

This is separate from the existing **Saarthi Device** application, which
remains a local development/testing application.

The Terminal must integrate with the **existing Saarthi backend,
authentication, database, APIs, Redis, realtime infrastructure, maps,
vehicle/driver modules, maintenance, documents and Gemini
capabilities**. Do not create a parallel backend.

------------------------------------------------------------------------

## 2. Mandatory First Step: Analyze the Existing Saarthi Project

Before implementing anything:

1.  Analyze the complete existing repository.
2.  Inspect frontend, backend, Prisma schema and migrations.
3.  Inspect existing authentication and role/permission models.
4.  Inspect vehicle, driver, QR, device, enrollment and assignment
    modules.
5.  Inspect existing realtime/WebSocket implementation.
6.  Inspect Redis/cache implementation.
7.  Inspect maps/navigation implementation.
8.  Inspect vehicle passport, documents, maintenance and service-record
    modules.
9.  Inspect existing Gemini/AI implementation.
10. Read all relevant existing MD/specification files.
11. Identify APIs and components that can be reused.
12. Identify what genuinely needs to be extended or created.
13. Do not duplicate existing business logic.
14. Do not break existing functionality.
15. Run tests/build/type checks after implementation.

Produce an implementation map before making major changes.

------------------------------------------------------------------------

## 3. Application Identity

### Name

**Saarthi Terminal**

Use this consistently for the Android application, splash screen,
launcher, documentation and device identity.

### Logo

Use the **existing official Saarthi project logo** already present in
the repository.

Do not invent a new logo.

Locate existing logo/brand assets and reuse appropriate variants for:

-   splash screen
-   launcher icon
-   dark UI
-   light UI

Reuse existing brand tokens/colors if available.

------------------------------------------------------------------------

## 4. Relationship With Existing Applications

### Existing Saarthi Web Platform

Used by fleet owners, mobility providers, drivers, truck associations,
administrators and other authorized roles.

### Existing Saarthi Device

Keep it as the local testing application for:

-   phone GPS
-   phone camera
-   sensors
-   realtime connectivity
-   future Bluetooth OBD
-   telemetry testing

Do not convert it into Saarthi Terminal.

### New Saarthi Terminal

A dedicated driver-facing Android application for a mounted
tablet/phone.

It provides:

-   permanent vehicle identity
-   terminal-to-vehicle pairing
-   driver arrival
-   driver verification
-   selfie
-   owner/provider approval
-   pre-trip checklist
-   live vehicle data
-   maps/navigation
-   nearby services
-   SOS
-   vehicle passport
-   maintenance
-   documents
-   driver information
-   Gemini voice assistant
-   voice-driven services
-   realtime status

------------------------------------------------------------------------

# 5. Core Product Philosophy

Saarthi Terminal is the **digital cockpit of the vehicle**.

It should feel like a modern automotive interface rather than a
traditional enterprise app.

Prioritize:

-   map-first experience
-   glanceable information
-   large touch targets
-   minimal clutter
-   contextual cards
-   voice-first interaction
-   smooth animations
-   excellent readability
-   responsive tablet layouts
-   accessibility
-   safe interaction while driving

Use the provided Android Auto-style screenshot as a **design reference
for information hierarchy and interaction simplicity**, not as something
to copy.

------------------------------------------------------------------------

# 6. Technology

Preferred native Android stack:

-   Kotlin
-   Jetpack Compose
-   Material 3
-   Android SDK
-   Coroutines
-   Flow/StateFlow
-   ViewModel
-   Navigation
-   CameraX where appropriate
-   Android location APIs
-   Bluetooth/BLE APIs
-   secure Android storage
-   WorkManager where appropriate
-   foreground services where legitimate continuous location/telemetry
    operation requires them

Integrate with the existing Saarthi backend/API architecture.

Never embed backend secrets in the APK.

------------------------------------------------------------------------

# 7. Responsive and Modern UI

Support:

-   Android phones
-   7-inch tablets
-   8-inch tablets
-   10-inch tablets
-   compatible larger vehicle displays

Tablet layouts must not simply stretch the phone layout.

Use adaptive layouts.

### Visual direction

Use:

-   modern typography
-   rounded cards
-   sophisticated spacing
-   subtle glassmorphism
-   controlled gradients
-   soft depth/shadows
-   smooth transitions
-   micro-interactions
-   animated status indicators
-   dark mode
-   light mode where appropriate

Do not overuse glassmorphism. Speed, navigation, warnings and SOS must
remain highly readable in bright sunlight and at night.

------------------------------------------------------------------------

# 8. Terminal State Machine

Implement explicit states:

``` text
UNPAIRED
  ↓
PAIRING
  ↓
VEHICLE_PAIRED
  ↓
AWAITING_DRIVER
  ↓
DRIVER_IDENTIFIED
  ↓
SELFIE_SUBMITTED
  ↓
PENDING_APPROVAL
  ↓
APPROVED
  ↓
CHECKLIST_REQUIRED
  ↓
READY
  ↓
TRIP_ACTIVE
  ↓
TRIP_COMPLETED
  ↓
AWAITING_DRIVER
```

Rejected:

``` text
PENDING_APPROVAL → REJECTED → AWAITING_DRIVER
```

Do not rely on scattered UI booleans to represent this lifecycle.

------------------------------------------------------------------------

# 9. Vehicle Pairing

The Terminal must be assigned to a specific vehicle.

Support:

1.  Scanning the vehicle's original Saarthi QR.
2.  Entering a vehicle pairing code.

Example:

``` text
SAARTHI

Connect this terminal to a vehicle

[ SCAN VEHICLE QR ]

OR

Enter vehicle pairing code

[ STH-XXXX-XXXX ]

[ CONNECT ]
```

After pairing:

``` text
✓ VEHICLE CONNECTED

UP32 AB 1234

This terminal is assigned to this vehicle.
```

------------------------------------------------------------------------

# 10. CRITICAL QR RULE

The vehicle already has an **original permanent Saarthi vehicle QR**.

That QR is the vehicle's identity.

### Do NOT:

-   generate a temporary driver-session QR
-   generate a new QR for every driver
-   replace the original vehicle QR during driver assignment

After pairing, the Terminal displays the **same original vehicle QR**.

The QR should contain an opaque/signed identifier resolved by the
backend, not confidential vehicle data.

------------------------------------------------------------------------

# 11. Permanent Vehicle Identity Screen

After pairing:

``` text
┌─────────────────────────────────────────────────────┐
│ SAARTHI                                  ● ONLINE   │
├────────────────────────┬────────────────────────────┤
│                        │                            │
│      VEHICLE QR        │  🚛 UP32 AB 1234           │
│                        │                            │
│                        │  Vehicle Type: Truck       │
│                        │  Status: Ready             │
│                        │  Terminal: Online          │
│                        │  GPS: Connected            │
│                        │  Vehicle Data: Connected   │
│                        │                            │
└────────────────────────┴────────────────────────────┘
```

Use existing Saarthi vehicle APIs.

Respect existing masking/privacy rules.

------------------------------------------------------------------------

# 12. Driver Arrival and Assignment

The driver uses their **existing Saarthi account**.

The driver does not generate a new session QR.

The driver scans the **original vehicle QR displayed on the Terminal**
using the Saarthi website/account.

Flow:

``` text
Driver's Saarthi Account
        ↓
Scan original vehicle QR
        ↓
Vehicle identified
        ↓
Driver assignment request
        ↓
Selfie
        ↓
Owner/provider approval
```

The backend must associate:

-   driver
-   vehicle
-   terminal
-   owner/provider organization
-   request
-   timestamp
-   status

------------------------------------------------------------------------

# 13. Selfie Verification

After the vehicle is identified:

``` text
DRIVER VERIFICATION

Vehicle
UP32 AB 1234

Driver
[Driver Name]

Take a selfie to verify your arrival.

[ CAMERA ]

[ RETAKE ]

[ SUBMIT FOR APPROVAL ]
```

Securely upload the selfie through existing backend infrastructure.

Do not create unnecessary duplicate image storage.

------------------------------------------------------------------------

# 14. Owner/Mobility Provider Approval

The fleet owner or mobility provider receives the request.

Show:

-   driver
-   vehicle
-   selfie
-   license verification status where available
-   request time
-   relevant authorized assignment history

Actions:

``` text
[ REJECT ]       [ APPROVE ]
```

The Terminal must receive approval/rejection in realtime when possible.

------------------------------------------------------------------------

# 15. 15-Minute Approval Requirement

The owner/provider should be expected to respond within approximately 15
minutes.

This is an SLA/escalation mechanism.

**Do not automatically approve after 15 minutes.**

If unanswered:

``` text
Request submitted
 ↓
Reminder
 ↓
15-minute escalation
 ↓
Secondary authorized workflow
```

Only explicit authorization should activate the driver.

------------------------------------------------------------------------

# 16. Approval UX

On approval:

``` text
✓ VERIFIED

Welcome, [Driver]

You are assigned to

🚛 UP32 AB 1234

Before starting your trip,
complete the vehicle safety check.

[ START CHECKLIST ]
```

Use a smooth, premium transition.

------------------------------------------------------------------------

# 17. Mandatory 10-Point Pre-Trip Checklist

Initial checklist:

1.  Tyres / Air Pressure
2.  Coolant
3.  Engine Oil
4.  Brakes
5.  Lights
6.  Battery
7.  Fuel
8.  Mirrors
9.  Emergency Equipment
10. Documents

The list must eventually be configurable from the backend rather than
hard-coded permanently.

------------------------------------------------------------------------

# 18. Intelligent Checklist

Combine:

-   driver inspection
-   available telemetry
-   maintenance records
-   service history
-   vehicle alerts
-   document validity

Example:

``` text
COOLANT

Vehicle data
86°C

✓ NORMAL
```

Example:

``` text
ENGINE

RPM       0
DTC       None
Battery   27.3 V

✓ NORMAL
```

For unavailable parameters:

``` text
TYRES / AIR PRESSURE

Manual inspection required

○ Good
○ Needs Attention
```

Never claim that a generic OBD adapter provides a parameter when it does
not.

------------------------------------------------------------------------

# 19. Current Testing Without OBD

The physical OBD adapter has been ordered but is not currently
available.

Therefore implementation must **not wait for the adapter**.

Initially use:

-   phone/tablet GPS
-   Android location speed
-   heading/bearing
-   device sensors where appropriate
-   device battery
-   network state
-   camera
-   simulated OBD-only parameters

Example development status:

``` text
GPS
✓ Connected

Speed
52 km/h

Heading
NE

Camera
✓ Available

Network
4G

Battery
78%

OBD
○ Not connected

RPM
1,850 [SIMULATED]

Coolant
86°C [SIMULATED]

Fuel
64% [SIMULATED]
```

Simulated data must be clearly marked in development diagnostics and
must not be presented as real ECU data in production mode.

------------------------------------------------------------------------

# 20. Telemetry Abstraction

Create a provider abstraction so the dashboard/backend does not care
where telemetry originated.

Conceptually:

``` text
TelemetryProvider
 ├── PhoneTelemetryProvider
 ├── SimulatedTelemetryProvider
 ├── BluetoothObdTelemetryProvider
 └── FutureProductionProvider
```

The UI consumes normalized data.

------------------------------------------------------------------------

# 21. OBD Integration Later

When the ordered adapter arrives, add direct Bluetooth/BLE integration.

Expected flow:

``` text
Vehicle ECU
    ↓
Bluetooth OBD Adapter
    ↓
Saarthi Terminal
    ↓
Telemetry Normalization
    ↓
Saarthi Backend
```

The Terminal should support:

-   scan
-   discover
-   connect
-   reconnect
-   disconnect
-   connection status
-   supported parameters
-   unavailable parameters
-   error handling
-   offline buffering

Do not depend on the manufacturer's application.

The architecture must allow the current simulated/phone provider to be
replaced by the real OBD provider without redesigning the dashboard.

------------------------------------------------------------------------

# 22. Main Dashboard

After driver approval and checklist completion, show a modern automotive
dashboard.

Design reference:

-   large map
-   next navigation instruction
-   speed
-   fuel
-   trip information
-   vehicle status
-   quick actions
-   SOS
-   AI assistant

Example:

``` text
┌─────────────────────────────────────────────────────┐
│ SAARTHI                         🔔  78%    10:42     │
├─────────────────────────────────────────────────────┤
│                                                     │
│                       MAP                           │
│                                                     │
│                         🚛                          │
│                                                     │
│               ← 1.2 km                             │
│               Turn left                             │
│                                                     │
├─────────────────────────────────────────────────────┤
│  52 km/h          64%          184,230 km            │
│  SPEED            FUEL         ODOMETER              │
├─────────────────────────────────────────────────────┤
│ [ SERVICES ] [ VEHICLE ] [ TRIP ] [ DOCUMENTS ]    │
│                                                     │
│                         🚨 SOS                      │
│                                                     │
│                    ● SAARTHI AI                     │
└─────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 23. Driving Mode

When moving, simplify the interface.

Prioritize:

-   map
-   navigation
-   speed
-   next turn
-   trip
-   fuel
-   warnings
-   SOS
-   voice assistant

When stationary, allow:

-   maintenance
-   documents
-   vehicle passport
-   detailed vehicle information
-   service discovery
-   trip details

Avoid encouraging complex interaction while driving.

------------------------------------------------------------------------

# 24. Vehicle Passport

Reuse the existing Saarthi vehicle passport system.

Show relevant information such as:

-   registration
-   vehicle type
-   insurance status
-   fitness
-   PUC
-   permit
-   last service
-   next service
-   important alerts

Respect data masking/privacy rules.

------------------------------------------------------------------------

# 25. Driver Information

Allow the driver to view their own authorized information:

-   name
-   license status
-   license validity
-   current vehicle
-   current assignment

Do not expose unnecessary private information.

------------------------------------------------------------------------

# 26. Maintenance

Expose:

-   next service
-   engine oil status
-   coolant
-   brake inspection
-   tyre status
-   service history
-   issue reporting

Example:

``` text
MAINTENANCE

Next Service
1,240 km

Engine Oil
✓ Good

Coolant
✓ Good

Brake Inspection
⚠ Due Soon

Tyres
✓ Checked

[ SERVICE HISTORY ]
[ REPORT PROBLEM ]
```

Reuse the existing Saarthi maintenance/service-record APIs.

------------------------------------------------------------------------

# 27. Issue Reporting

Driver can report:

-   engine issue
-   tyre issue
-   brake issue
-   electrical issue
-   accident
-   other vehicle problem

Support:

-   text
-   photo
-   voice description

Example:

``` text
REPORT VEHICLE ISSUE

Category
[ Engine ▼ ]

Description
[................]

Photo
[ Add ]

Voice
[ 🎙 ]

[ SUBMIT ]
```

------------------------------------------------------------------------

# 28. Nearby Services

Provide vehicle-aware nearby services:

-   petrol pumps
-   diesel stations
-   truck-compatible fuel stations
-   mechanics
-   service centres
-   tyre shops
-   battery service
-   truck parking
-   hospitals
-   emergency services
-   food/rest stops
-   roadside assistance
-   towing

Prefer services suitable for the actual vehicle.

------------------------------------------------------------------------

# 29. Voice Service Discovery

Example:

> "Hey Saarthi, I'm on low fuel. Take me to the nearest petrol pump."

Flow:

``` text
Wake Word
 ↓
Voice Capture
 ↓
Speech-to-Text
 ↓
Gemini
 ↓
Intent
 ↓
Saarthi Tools
 ↓
Current GPS + actual fuel if available
 ↓
Nearby suitable services
 ↓
Navigation
```

Example response:

> "The nearest suitable fuel station is 3.2 kilometres away. I've
> started navigation."

Ask for confirmation when appropriate.

------------------------------------------------------------------------

# 30. Gemini AI

Gemini is Saarthi's conversational intelligence layer.

Use it for:

-   natural-language understanding
-   intent detection
-   service discovery
-   navigation requests
-   vehicle information questions
-   maintenance questions
-   document questions
-   trip questions
-   vehicle-health explanations
-   driver assistance
-   summarization of alerts

Gemini must not be the source of truth for live vehicle data.

------------------------------------------------------------------------

# 31. Controlled Gemini Tool Layer

Do not allow Gemini direct database access.

Use:

``` text
Driver
 ↓
Gemini
 ↓
Intent
 ↓
Saarthi Tool
 ↓
Permission Validation
 ↓
Backend/API
 ↓
Real Data
 ↓
Gemini Response
```

Potential tools:

``` text
getCurrentVehicle()
getCurrentLocation()
getCurrentSpeed()
getFuelStatus()
getVehicleHealth()
getActiveTrip()
getVehiclePassport()
getMaintenanceStatus()
getDriverProfile()
findNearbyFuelStations()
findNearbyMechanics()
findNearbyParking()
findNearbyHospitals()
startNavigation()
reportVehicleIssue()
getDocuments()
triggerEmergencyWorkflow()
```

Reuse existing APIs wherever possible.

Every tool must enforce authorization.

------------------------------------------------------------------------

# 32. Gemini Data Safety

Gemini must never:

-   invent telemetry
-   invent document status
-   invent maintenance records
-   approve a driver
-   override permissions
-   bypass checklist rules
-   falsely declare a vehicle safe
-   expose confidential data
-   bypass emergency/security policies

For unavailable data, explicitly say it is unavailable.

Safety-critical decisions remain deterministic and policy-controlled.

------------------------------------------------------------------------

# 33. Wake Word

Support:

**"Hey Saarthi"**

Prefer local wake-word detection where practical.

Do not continuously upload private audio merely to detect the wake
phrase.

Full voice capture should begin after wake detection.

------------------------------------------------------------------------

# 34. Animated Saarthi AI Blob

A persistent AI interaction surface should live near the bottom of the
dashboard.

States:

### Idle

Small, subtle animated blob.

### Listening

Soft pulsating/expanding animation.

### Processing

Flowing/rotating animation.

### Speaking

React to speech amplitude.

The visual language should communicate:

``` text
Idle
Listening
Thinking
Speaking
Error
```

The blob must feel like the Saarthi assistant, not a generic microphone
icon.

------------------------------------------------------------------------

# 35. Voice Examples

Support natural requests such as:

> "Hey Saarthi, I'm on low fuel. Take me to the nearest petrol pump."

> "Hey Saarthi, find truck parking near me."

> "Hey Saarthi, find a mechanic nearby."

> "Hey Saarthi, when is my next service?"

> "Hey Saarthi, is my vehicle okay?"

> "Hey Saarthi, how far is my destination?"

> "Hey Saarthi, is my fitness certificate valid?"

> "Hey Saarthi, what is my current fuel level?"

> "Hey Saarthi, SOS."

Emergency intent must trigger the controlled emergency workflow without
unnecessary conversational delay.

------------------------------------------------------------------------

# 36. SOS

SOS must always be easy to access.

Use:

-   persistent large SOS control
-   voice trigger
-   appropriate accidental-activation protection

On activation, provide authorized responders with relevant information
such as:

-   driver
-   vehicle
-   terminal
-   current location
-   timestamp
-   active trip
-   relevant telemetry
-   camera/device availability
-   emergency type where known

Reuse the existing Saarthi SOS/notification/truck-association workflows.

Do not create a separate emergency backend.

------------------------------------------------------------------------

# 37. Truck Association Integration

Where the existing Saarthi platform supports truck associations,
relevant emergency/vehicle incidents may be routed to authorized
association users.

Respect:

-   organization boundaries
-   district/region permissions
-   privacy
-   event severity

Do not expose every event to every association.

------------------------------------------------------------------------

# 38. Realtime

Reuse existing Saarthi realtime/WebSocket infrastructure.

Use realtime where appropriate for:

-   driver approval
-   rejection
-   vehicle alerts
-   trip changes
-   owner messages
-   emergency status
-   maintenance alerts
-   vehicle telemetry
-   terminal presence

Do not create a second realtime architecture.

------------------------------------------------------------------------

# 39. Redis

Reuse the existing Redis implementation.

Appropriate uses:

-   realtime telemetry
-   transient vehicle state
-   terminal presence
-   approval state
-   active trip state
-   WebSocket fan-out
-   short-lived pairing information
-   caching
-   rate limiting

Redis is not the permanent source of truth.

Persistent business records remain in PostgreSQL.

------------------------------------------------------------------------

# 40. PostgreSQL

Reuse the existing Prisma/PostgreSQL schema.

Potential entities only if equivalent entities do not already exist:

``` text
Terminal
TerminalVehicleAssignment
DriverVehicleAssignment
DriverApprovalRequest
TerminalSession
ChecklistSubmission
ChecklistItemResult
TelemetrySnapshot
```

Do not duplicate:

-   vehicles
-   drivers
-   organizations
-   maintenance records
-   documents

when existing entities already support them.

------------------------------------------------------------------------

# 41. Terminal Heartbeat

The Terminal should periodically report health:

``` json
{
  "terminalId": "terminal-id",
  "vehicleId": "vehicle-id",
  "status": "ONLINE",
  "battery": 78,
  "network": "4G",
  "gps": true,
  "camera": true,
  "vehicleData": true,
  "appVersion": "1.0.0"
}
```

Use reasonable intervals and avoid excessive network traffic.

------------------------------------------------------------------------

# 42. Offline Handling

Support:

-   offline indicator
-   essential local state
-   cached vehicle information
-   telemetry buffering
-   queued non-destructive events
-   automatic retries
-   duplicate prevention
-   state reconciliation

Never tell the driver something was submitted if the server did not
receive it.

------------------------------------------------------------------------

# 43. Camera

Terminal camera may be used for:

-   driver selfie
-   QR scanning
-   document capture where authorized
-   issue-report photos

The Terminal camera is not the same as the future YC06/production camera
system.

Keep those architectures separate.

------------------------------------------------------------------------

# 44. Navigation

Reuse existing Saarthi maps/navigation.

Support:

-   current position
-   destination
-   route
-   ETA
-   next turn
-   rerouting
-   service destination
-   trip destination
-   vehicle-compatible service filtering

Do not duplicate the existing map implementation unnecessarily.

------------------------------------------------------------------------

# 45. Kiosk / Dedicated Device Mode

The Terminal is intended for a mounted dedicated tablet.

Production deployment should support Android dedicated-device/kiosk
mechanisms.

Requirements where device-owner policy permits:

-   auto-launch Saarthi
-   restrict unrelated applications
-   restrict casual Play Store access
-   restrict system settings
-   control Home/Recents behavior
-   return to Saarthi after reboot
-   maintain vehicle assignment

Use supported Android enterprise/dedicated-device mechanisms. Do not use
unsafe security hacks.

------------------------------------------------------------------------

# 46. Development / Admin / Driver Modes

Implement controlled modes:

## DEVELOPMENT

-   debugging
-   simulator
-   logs
-   developer tools

## DRIVER

-   Saarthi-only experience
-   normal vehicle/driver workflow

## ADMIN

Protected access to:

-   pairing
-   telemetry source
-   Bluetooth diagnostics
-   terminal diagnostics
-   network configuration
-   logs
-   app version
-   backend status

Do not expose admin functionality to ordinary drivers.

------------------------------------------------------------------------

# 47. Power and Restart

The application must:

-   restore vehicle pairing after restart
-   recover safely after crash
-   restore valid state
-   show low battery warning
-   handle screen on/off
-   release camera resources
-   handle network reconnection
-   avoid stale driver authorization

Do not retain an expired/revoked driver as active merely because the app
restarted.

------------------------------------------------------------------------

# 48. Data Normalization

Use a normalized telemetry model similar to:

``` json
{
  "vehicleId": "vehicle-id",
  "terminalId": "terminal-id",
  "timestamp": "ISO-8601",
  "source": "PHONE|SIMULATED|OBD|PRODUCTION",
  "location": {
    "latitude": 0,
    "longitude": 0,
    "speedKph": 0,
    "heading": 0
  },
  "vehicle": {
    "rpm": null,
    "coolantTemperature": null,
    "fuelLevel": null,
    "engineLoad": null,
    "throttlePosition": null,
    "batteryVoltage": null,
    "odometer": null
  },
  "diagnostics": {
    "dtcs": []
  }
}
```

Only populate fields actually available.

------------------------------------------------------------------------

# 49. Development Telemetry Simulator

Until OBD arrives, developer mode should simulate:

-   speed
-   RPM
-   coolant
-   engine load
-   throttle
-   fuel
-   battery voltage
-   odometer
-   DTCs

Scenarios:

``` text
NORMAL
LOW FUEL
HIGH COOLANT
ENGINE WARNING
LOW BATTERY
NO NETWORK
NO GPS
OBD DISCONNECTED
```

Make the simulator inaccessible from normal Driver Mode.

------------------------------------------------------------------------

# 50. Security

Implement:

-   secure terminal identity
-   token authentication
-   secure local storage
-   encrypted secrets
-   TLS
-   server-side authorization
-   terminal revocation
-   audit logging
-   role/tenant validation

A terminal must not be able to switch vehicles by simply changing a
client-side vehicle ID.

------------------------------------------------------------------------

# 51. QR Security

The original vehicle QR should:

-   identify the vehicle through an opaque/signed identifier
-   not expose sensitive vehicle information
-   be validated server-side
-   respect vehicle/organization permissions
-   support revocation

The QR is a vehicle identity mechanism, not a password.

------------------------------------------------------------------------

# 52. Driver Authorization Security

Scanning a vehicle QR does not itself authorize the driver.

Authorization requires:

``` text
Driver account
+
Vehicle
+
Owner/provider permission
+
Selfie
+
Approval
```

Only after approval should the driver enter the active state.

------------------------------------------------------------------------

# 53. Privacy and Masking

Protect:

-   driver selfie
-   driver license information
-   personal information
-   vehicle confidential data
-   owner information
-   trip history

Reuse the existing Saarthi masking/privacy model.

------------------------------------------------------------------------

# 54. Performance

Optimize for low-resource Android hardware.

Requirements:

-   avoid unnecessary recompositions
-   avoid memory leaks
-   efficient image loading
-   efficient map rendering
-   limited background work
-   efficient state management
-   correct camera lifecycle
-   reasonable GPS frequency
-   network batching where appropriate
-   caching
-   long-running session stability

The app should run reliably for long shifts.

------------------------------------------------------------------------

# 55. Main Navigation

Do not create a cluttered enterprise-style menu.

Primary areas can be:

``` text
Home
Navigate
Vehicle
Services
```

SOS should be globally accessible.

AI should be globally accessible.

Maintenance/documents can be contextual under Vehicle.

------------------------------------------------------------------------

# 56. Contextual Information

Do not show 30 buttons at once.

While driving:

``` text
Map
Navigation
Speed
Trip
Fuel
Warnings
SOS
AI
```

When stopped:

``` text
Vehicle Passport
Maintenance
Documents
Services
Detailed vehicle information
```

The UI should adapt to the vehicle state.

------------------------------------------------------------------------

# 57. Animation and Interaction Quality

Implement polished:

-   splash animation
-   QR scan success
-   pairing success
-   selfie verification
-   approval transition
-   checklist progress
-   dashboard transitions
-   map transitions
-   AI blob states
-   service discovery
-   SOS states
-   connection states

Animations must be smooth and purposeful.

Do not create distracting animations while driving.

------------------------------------------------------------------------

# 58. Splash Screen

Use the existing Saarthi logo and brand.

Example:

``` text
[ SAARTHI LOGO ]

SAARTHI
TERMINAL
```

Use a short, polished entrance animation.

Do not delay startup unnecessarily.

------------------------------------------------------------------------

# 59. Error States

Create polished states for:

-   invalid QR
-   already paired terminal
-   revoked terminal
-   vehicle unavailable
-   driver rejected
-   pending approval
-   backend offline
-   GPS unavailable
-   camera unavailable
-   Bluetooth unavailable
-   OBD disconnected
-   service search unavailable
-   AI unavailable

Every error should explain the next action.

------------------------------------------------------------------------

# 60. Accessibility

Support:

-   scalable text
-   strong contrast
-   large touch targets
-   semantic labels
-   voice interaction
-   reduced-motion option
-   non-color-only status indicators

------------------------------------------------------------------------

# 61. API Integration Rules

Before adding APIs:

1.  Search existing Saarthi endpoints.
2.  Reuse existing endpoints.
3.  Extend existing endpoints if necessary.
4.  Follow existing auth.
5.  Follow existing validation.
6.  Follow existing error conventions.
7.  Document genuinely new endpoints.

Potential endpoint categories:

``` text
terminal pairing
terminal status
driver assignment
selfie
approval status
checklists
vehicle passport
maintenance
documents
services
issues
current trip
telemetry
heartbeat
```

These are categories, not instructions to duplicate existing APIs.

------------------------------------------------------------------------

# 62. Realtime Events

Potential events, adapting to existing conventions:

``` text
driver.assignment.requested
driver.assignment.approved
driver.assignment.rejected
vehicle.status.updated
vehicle.telemetry.updated
vehicle.alert.created
trip.started
trip.updated
trip.completed
maintenance.alert
document.alert
sos.created
sos.updated
terminal.connected
terminal.disconnected
```

Reuse existing event conventions if different.

------------------------------------------------------------------------

# 63. Testing

Test:

### Pairing

-   valid QR
-   invalid QR
-   revoked QR
-   pairing code
-   already paired terminal
-   wrong organization

### Driver

-   valid driver
-   invalid driver
-   selfie
-   pending approval
-   approval
-   rejection
-   escalation

### Checklist

-   all passed
-   warning
-   critical issue
-   missing telemetry
-   simulated telemetry

### Telemetry

-   GPS
-   simulated OBD
-   OBD later
-   Bluetooth disconnect
-   GPS loss
-   network loss

### AI

-   wake word
-   listening
-   processing
-   speaking
-   tool call
-   unavailable data
-   permission denial
-   SOS

### UI

-   phone
-   7-inch tablet
-   10-inch tablet
-   portrait
-   landscape
-   dark mode
-   light mode
-   accessibility
-   reduced motion

### Long-running

-   multi-hour session
-   repeated navigation
-   repeated telemetry
-   reconnect
-   app restart
-   device reboot

------------------------------------------------------------------------

# 64. Implementation Phases

## Phase 1 --- Analyze Existing Saarthi

Produce:

-   architecture map
-   reusable APIs
-   reusable models
-   existing QR flow
-   device architecture
-   existing driver/vehicle workflows
-   existing Redis/realtime
-   existing Gemini
-   missing pieces

Do not code blindly.

## Phase 2 --- Android Foundation

Build:

-   Saarthi Terminal project
-   existing logo
-   splash
-   navigation
-   adaptive UI
-   secure terminal identity
-   development mode

## Phase 3 --- Vehicle Pairing

Build:

-   QR scan
-   vehicle code
-   secure pairing
-   permanent vehicle QR display
-   pairing persistence

## Phase 4 --- Driver Workflow

Build:

-   scan original vehicle QR from driver's Saarthi account
-   driver identification
-   selfie
-   owner/provider approval
-   realtime approval/rejection
-   15-minute escalation
-   welcome screen

## Phase 5 --- Checklist

Build:

-   10-point checklist
-   device GPS data
-   simulated OBD data
-   maintenance/document context
-   warnings

## Phase 6 --- Dashboard

Build:

-   map
-   navigation
-   vehicle data
-   services
-   vehicle passport
-   maintenance
-   documents
-   SOS
-   driving mode
-   modern responsive card UI

## Phase 7 --- Gemini

Build:

-   Gemini integration
-   controlled tool layer
-   wake-word architecture
-   voice capture
-   animated AI blob
-   service commands
-   navigation commands
-   vehicle information commands

## Phase 8 --- OBD

When adapter arrives:

-   Bluetooth/BLE connection
-   OBD provider
-   supported PID reading
-   reconnect
-   normalization
-   diagnostics

Do not redesign the app around OBD.

## Phase 9 --- Kiosk

Build/document:

-   dedicated-device mode
-   auto-launch
-   driver mode
-   admin mode
-   reboot recovery

## Phase 10 --- Hardening

Run:

-   unit tests
-   integration tests
-   UI tests
-   build
-   static checks
-   performance tests
-   offline tests
-   long-session tests

------------------------------------------------------------------------

# 65. Definition of Done

The Terminal is not complete until:

-   it builds successfully
-   it installs on a physical Android device
-   Saarthi branding is correct
-   existing APIs are reused appropriately
-   vehicle pairing works
-   original vehicle QR is displayed
-   no temporary driver QR is created
-   driver can scan the original vehicle QR
-   selfie submission works
-   owner/provider approval works
-   approval reaches the Terminal
-   checklist works
-   phone/tablet GPS works
-   simulated telemetry works
-   camera works
-   map works
-   vehicle passport works
-   maintenance works
-   documents work
-   services work
-   SOS works
-   Gemini tools work
-   AI blob states work
-   offline behavior works
-   Redis/realtime integration works
-   kiosk strategy is documented
-   known build/test errors are resolved

------------------------------------------------------------------------

# 66. Critical Constraints

1.  New app name: **Saarthi Terminal**.
2.  Use the existing Saarthi project logo.
3.  Keep Saarthi Device as a separate local-testing application.
4.  Do not create a new backend.
5.  Do not duplicate existing APIs unnecessarily.
6.  The original vehicle QR is permanent vehicle identity.
7.  Never create a temporary driver-session QR for this workflow.
8.  Driver scans the original vehicle QR from their existing Saarthi
    account.
9.  Selfie is required before approval.
10. Fleet owner/mobility provider approves or rejects.
11. 15 minutes is an escalation/reminder SLA, not automatic approval.
12. Checklist must be completed before starting a trip.
13. OBD is currently unavailable.
14. Use phone/tablet GPS and simulated vehicle telemetry initially.
15. When OBD arrives, plug it into the telemetry abstraction.
16. Do not depend on the manufacturer's OBD app.
17. Gemini uses controlled Saarthi tools.
18. Gemini cannot invent live vehicle data.
19. SOS must remain accessible.
20. Use existing Redis and PostgreSQL architecture.
21. Reuse existing realtime infrastructure.
22. Preserve roles, permissions, tenancy and security.
23. Respect existing masking/privacy.
24. Terminal is vehicle-centric; driver authorization is temporary.
25. Support dedicated-device/kiosk deployment.
26. UI must be modern, animated, responsive and premium without
    sacrificing readability or driver safety.

------------------------------------------------------------------------

# 67. First Command to Claude Code

After receiving this specification, do not immediately generate large
amounts of code.

First:

``` text
Analyze the entire existing Saarthi repository.

Identify:
1. current architecture
2. existing Android/device work
3. vehicle APIs
4. driver APIs
5. QR implementation
6. device/enrollment implementation
7. assignment/approval implementation
8. maintenance/service APIs
9. document/passport APIs
10. maps/navigation
11. Redis
12. WebSocket/realtime
13. Gemini
14. authentication
15. permissions/tenancy
16. existing logo/brand assets
17. existing tests
18. existing relevant MD/specifications

Then produce:
- what can be reused
- what must be extended
- what must be newly created
- any conflicts or assumptions
- a phased implementation plan

Only after that should implementation begin.

After every major phase:
- run build/type checks
- run relevant tests
- inspect failures
- fix regressions
- report exactly what changed

Do not claim completion while known build/test errors remain.
```

------------------------------------------------------------------------

# 68. Final Architecture

``` text
                         SAARTHI PLATFORM
                                │
                ┌───────────────┼────────────────┐
                │               │                │
                ▼               ▼                ▼
             Web App      Saarthi Terminal      APIs
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
                  GPS        Camera      Telemetry
                    │           │           │
                    │           │     ┌─────┴────────┐
                    │           │     │              │
                    │           │  Simulated       OBD
                    │           │     │              │
                    └───────────┼─────┴──────────────┘
                                │
                                ▼
                         Saarthi Backend
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                 Redis      PostgreSQL    Realtime
                    │                       │
                    └───────────┬───────────┘
                                ▼
                           Gemini AI
                                │
                                ▼
                     Controlled Saarthi Tools
```

### Initial development hardware

``` text
Android Phone/Tablet
├── GPS
├── Camera
├── Internet
└── Simulated vehicle telemetry
```

### After OBD arrives

``` text
Android Tablet
├── GPS
├── Camera
├── Internet
└── Bluetooth OBD
       ↓
   Real vehicle data
```

The same dashboard, backend, Redis and realtime architecture should
continue to work.

------------------------------------------------------------------------

# 69. Product Outcome

The final experience should be:

**A vehicle-mounted Saarthi digital cockpit.**

The driver:

1.  arrives at the vehicle
2.  scans the vehicle's permanent QR using their Saarthi account
3.  submits a selfie
4.  waits for owner/provider approval
5.  receives a welcome
6.  completes the safety checklist
7.  enters the Saarthi cockpit
8.  navigates
9.  checks vehicle information
10. accesses services
11. views maintenance/documents
12. uses SOS when required
13. communicates naturally with Saarthi using:

> **"Hey Saarthi..."**

The goal is for the Terminal to make Saarthi feel like an intelligent
assistant that is **attached to the vehicle and available throughout the
journey**, while business rules, security, permissions and factual
vehicle data remain controlled by the Saarthi platform.
