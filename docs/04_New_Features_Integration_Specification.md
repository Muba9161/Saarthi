# SAARTHI — New Features Integration & Expansion Specification
## Version 1.0 — Existing Project Extension

> **Purpose:** Extend the existing Saarthi application with new ecosystem capabilities without rebuilding or fragmenting the existing product.

---

# 1. IMPLEMENTATION AGENT — READ THIS FIRST

You are extending an **already-built Saarthi project**.

This is NOT a greenfield project.

Before changing code, you MUST:

1. Inspect the entire existing repository.
2. Read the existing `CLAUDE.md`.
3. Read all existing Saarthi product, architecture and roadmap MD files.
4. Read every additional feature MD file supplied with this task.
5. Compare the documentation against the actual implementation.
6. Identify what is already implemented.
7. Identify what is partially implemented.
8. Identify what is missing.
9. Identify architectural conflicts.
10. Identify duplicated functionality.
11. Identify database/schema changes required.
12. Identify frontend, backend, realtime and security changes required.
13. Produce an implementation-impact assessment before making destructive changes.

Do NOT assume that a feature described here does not already exist.

Do NOT blindly recreate existing modules.

Do NOT replace working functionality simply because a newer design is proposed.

The existing application is the codebase to be extended.

This document defines the new requirements and architectural direction.

---

# 2. CRITICAL PRODUCT PRINCIPLE — ONE PLATFORM

Saarthi must remain:

> **One website. One application. One account ecosystem. One login system. One platform.**

Do NOT create separate websites for:

- Truck management
- Taxi services
- Travel
- Truck associations
- Suppliers
- Customers
- Drivers
- Vehicle owners

These are different roles/capabilities inside the same Saarthi platform.

The user should never feel that they have entered a separate taxi, travel or association website.

Use:

```text
                         SAARTHI
                            |
                    SINGLE WEB PLATFORM
                            |
                     SINGLE AUTH SYSTEM
                            |
                   SINGLE USER IDENTITY
                            |
                 ROLE / CAPABILITY SYSTEM
                            |
        ------------------------------------------------
        |             |             |                  |
      Driver       Owner         Supplier          Customer
        |             |             |                  |
      Taxi          Fleet        Materials        Orders
      Truck         Vehicles     Orders            Bookings
      Other         Trips        Delivery          Tracking
        |
        +---------------- Truck Association
        |
        +---------------- Travel / Tour Provider
        |
        +---------------- Hardware / IoT
```

A user may have more than one capability.

For example:

```text
One User
  ├── Truck Owner
  ├── Taxi Owner
  └── Travel Provider
```

Do not force unnecessary duplicate accounts.

---

# 3. NEW SAARTHI DIRECTION

Saarthi is evolving from a fleet management system into a broader:

> **Transportation, Mobility, Logistics, Safety and Vehicle Intelligence Platform.**

Existing capabilities remain core:

- Fleet management
- Truck management
- Driver management
- Customer marketplace
- Supplier management
- Material orders
- Trips
- Live tracking
- Documents
- Verification
- Driver scoring
- SOS
- Nearby services
- Analytics
- Subscriptions
- AI

New capabilities:

1. Truck Association accounts
2. Association emergency network
3. Generalized Vehicle architecture
4. Taxi/vehicle registration
5. Travel/tour services
6. Travel/tour packages
7. Customer travel booking
8. Hardware/device management
9. Freematics ONE+ Model H integration architecture
10. Vehicle telemetry
11. Device-to-vehicle assignment
12. Hardware-specific data ingestion
13. Telemetry alerts
14. Future hardware extensibility
15. Unified mobility ecosystem

---

# 4. ACCOUNT MODEL

Saarthi must use one registration system.

After registration, the user can select or be assigned appropriate capabilities:

```text
Create Saarthi Account
        |
        +-- Driver
        +-- Vehicle Owner
        +-- Supplier
        +-- Customer
        +-- Truck Association Representative
        +-- Taxi / Mobility Provider
        +-- Travel / Tour Provider
        +-- Organization Representative
```

Use the existing authentication and RBAC architecture where possible.

Do not introduce a second login system.

---

# 5. ROLE VS ORGANIZATION VS CAPABILITY

Prefer a flexible architecture such as:

```text
User
  |
  +-- Membership
        |
        +-- Organization
        +-- Role
        +-- Permissions
```

Where relevant:

```text
User
  |
  +-- Provider Profile
        |
        +-- Service Types
              +-- Freight
              +-- Taxi
              +-- Travel
              +-- Tour
```

Respect the existing Saarthi implementation rather than creating unnecessary complexity.

---

# 6. TRUCK ASSOCIATION ACCOUNTS

Truck associations become a first-class account/organization type inside Saarthi.

Purpose:

> Allow verified truck associations in a district/area to receive relevant alerts about truck and driver incidents so they can coordinate assistance.

Possible association registration fields:

- Association name
- District
- State
- Address
- Registration information
- Official contact number
- Official email
- Authorized representative
- Representative contact
- Emergency contact
- Coverage area
- Office location
- Supporting documents
- Logo
- Verification status

Verification states:

```text
PENDING
UNDER_REVIEW
VERIFIED
REJECTED
SUSPENDED
```

---

# 7. ASSOCIATION DASHBOARD

The association dashboard should provide a district/coverage-area operational view.

Sections:

### Overview

- Active incidents
- SOS incidents
- Accidents
- Breakdown incidents
- Security incidents
- Members requiring help
- Active trucks in area
- Open emergency cases
- Resolved incidents

### Emergency Map

Show authorized incidents geographically.

### Incident Management

Association users can:

- View incidents
- Acknowledge incidents
- Assign responders
- Coordinate assistance
- Add notes
- Update response
- Escalate
- Resolve incidents

All access must respect privacy and association scope.

---

# 8. ASSOCIATION EMERGENCY NETWORK

Example:

```text
DRIVER
   ↓
SOS
   ↓
SAARTHI
   ↓
+-------------------+-------------------+
↓                   ↓                   ↓
OWNER          NEARBY SAARTHI       ASSOCIATION
TRUCKS                              NETWORK
                                      ↓
                              DISTRICT RESPONSE
```

For an accident, assault/security emergency or other SOS:

1. Capture authorized location.
2. Alert owner.
3. Identify eligible nearby Saarthi responders.
4. Alert relevant association.
5. Create incident record.
6. Track acknowledgement.
7. Track assistance.
8. Escalate if necessary.
9. Record resolution.
10. Preserve audit history.

---

# 9. ASSOCIATION PRIVACY

Associations must NOT automatically see:

- Full customer information
- Private documents
- Financial data
- Full trip history
- Raw vehicle telemetry
- Sensitive driver information

unless explicitly authorized.

Associations should receive only what is needed to respond.

Use:

- RBAC
- Geographic scope
- Incident scope
- Data minimization
- Audit logging

---

# 10. GENERALIZE TRUCK INTO VEHICLE

This is a major architectural requirement.

If the current implementation is truck-centric, introduce a generalized:

# Vehicle

Supported types may include:

```text
TRUCK
TAXI
CAR
BUS
VAN
SUV
OTHER
```

Do NOT remove truck functionality.

Instead:

```text
Vehicle
  |
  +-- Type = TRUCK
```

The same core architecture should support both trucks and passenger vehicles.

---

# 11. VEHICLE CAPABILITIES

Avoid hard-coding business logic throughout the application.

A vehicle type can define capabilities such as:

```text
Supports Freight
Supports Passenger Transport
Supports Travel Packages
Supports Live Tracking
Supports Cargo Capacity
Supports Passenger Capacity
Supports Hardware
Supports Telemetry
```

This allows future expansion without rewriting the domain.

---

# 12. TAXI / MOBILITY PROVIDER

Taxi operators should register on the same Saarthi platform.

A provider can:

- Register
- Verify identity/business
- Register vehicles
- Register drivers
- Define service area
- Define availability
- Configure pricing
- Receive bookings
- Manage bookings
- Track active vehicles
- View earnings
- View ratings

Do not create a separate taxi application.

---

# 13. TRAVEL & TOUR SERVICES

Saarthi should support:

- Travel providers
- Tour operators
- Taxi providers offering tours
- Vehicle owners offering travel services

Supported offerings may include:

- Local sightseeing
- Intercity travel
- Multi-day tours
- Airport transfers
- Custom trips
- Vehicle-inclusive tours
- Driver-inclusive travel

---

# 14. TRAVEL PACKAGE MODEL

A package may contain:

```text
Package
 ├── Title
 ├── Description
 ├── Images
 ├── Provider
 ├── Destinations
 ├── Duration
 ├── Start location
 ├── End location
 ├── Vehicle
 ├── Passenger capacity
 ├── Price
 ├── Pricing model
 ├── Inclusions
 ├── Exclusions
 ├── Itinerary
 ├── Availability
 ├── Cancellation policy
 ├── Booking rules
 └── Status
```

Example:

```text
Lucknow → Ayodhya → Varanasi

Duration: 3 Days
Vehicle: SUV
Capacity: 6
Price: ₹18,000

Includes:
- Vehicle
- Driver
- Fuel
- Sightseeing

Excludes:
- Hotel
- Meals
- Personal expenses
```

---

# 15. CUSTOMER TRAVEL BOOKING

Customer flow:

```text
Customer
  ↓
Search Travel
  ↓
Select Destination / Dates
  ↓
Browse Packages
  ↓
Compare Providers
  ↓
View Vehicle / Driver
  ↓
View Price
  ↓
Book
  ↓
Payment
  ↓
Confirmation
  ↓
Trip
  ↓
Tracking
  ↓
Completion
  ↓
Rating
```

The customer uses the same Saarthi account.

Local development should use a mock payment provider.

---

# 16. UNIFIED CUSTOMER DASHBOARD

A customer should be able to see:

```text
My Orders
My Freight
My Travel
My Bookings
My Trips
Live Tracking
Documents
Payments
Saved Providers
Ratings
Support
```

Freight and travel should feel like modules of one platform.

---

# 17. UNIFIED SERVICE DISCOVERY

Eventually Saarthi should be able to understand multiple service requests:

```text
"I need 20 tons of sand"
```

```text
"I need a taxi to the airport"
```

```text
"I want a 3-day Ayodhya tour"
```

Use a common discovery/search foundation while retaining domain-specific rules.

---

# 18. HARDWARE / IoT PLATFORM

Saarthi must support hardware connected to individual vehicles.

Architecture:

```text
Vehicle
   |
   +-- Device Assignment
          |
          +-- Hardware Device
                 |
                 +-- Telemetry
```

The device is not the vehicle itself.

---

# 19. HARDWARE DEVICE ENTITY

Support fields such as:

- Device ID
- Serial number
- IMEI where applicable
- Manufacturer
- Model
- Device type
- Firmware version
- SIM information where appropriate
- Status
- Last seen
- Installation date
- Activation date
- Deactivation date

Protect sensitive identifiers.

---

# 20. DEVICE-TO-VEHICLE ASSIGNMENT

Never permanently hard-code one device into the vehicle.

Use an assignment/history model:

```text
Device A
   ↓
Truck UP11AB1234
   ↓
Assigned: Jan 2026
   ↓
Removed: Aug 2026

Device B
   ↓
Truck UP11AB1234
   ↓
Assigned: Aug 2026
```

The vehicle retains historical device/telemetry relationships.

---

# 21. FREEMATICS ONE+ MODEL H INTEGRATION

Initial hardware target:

> **Freematics ONE+ Model H**

Do not spread Freematics-specific logic across the application.

Use:

```text
Freematics Device
       ↓
Freematics Adapter
       ↓
Device Gateway
       ↓
Authentication
       ↓
Telemetry Normalizer
       ↓
Vehicle Mapping
       ↓
Telemetry Storage
       ↓
Realtime Events
       ↓
Saarthi
```

The exact telemetry available depends on the vehicle, protocol and device capabilities.

Never assume every vehicle exposes every parameter.

---

# 22. TELEMETRY CAPABILITIES

Where supported, design for:

### Location

- Latitude
- Longitude
- Speed
- Heading
- GPS timestamp
- GPS accuracy

### Vehicle

- RPM
- Coolant temperature
- Fuel-related information
- Battery/voltage
- Vehicle identification
- Diagnostic information
- OBD data
- CAN/J1939 data

### Motion

- Accelerometer
- Harsh braking
- Harsh acceleration
- Sudden movement

The system must use a capability model so unavailable values are not presented as fake data.

---

# 23. TELEMETRY NORMALIZATION

Different providers may send different formats.

Create a normalized Saarthi telemetry model.

Conceptually:

```json
{
  "deviceId": "DEVICE-123",
  "vehicleId": "VEHICLE-456",
  "timestamp": "...",
  "location": {
    "latitude": 26.8467,
    "longitude": 80.9462,
    "speed": 54,
    "heading": 120
  },
  "vehicleData": {
    "rpm": 1450,
    "coolantTemperature": 87,
    "fuelLevel": 62
  },
  "motion": {
    "harshBraking": false,
    "harshAcceleration": false
  }
}
```

This is a conceptual normalized structure, not a requirement that the hardware produce this exact payload.

---

# 24. DEVICE GATEWAY

Create a dedicated ingestion layer.

Responsibilities:

- Authenticate device
- Validate device
- Identify device
- Determine assigned vehicle
- Parse provider payload
- Normalize telemetry
- Reject invalid data
- Validate timestamps
- Store telemetry
- Emit realtime events
- Trigger rules/alerts

Raw hardware payloads must not directly modify business tables.

---

# 25. HARDWARE SECURITY

Implement:

- Device authentication
- Device identity
- Credential rotation where appropriate
- Replay protection where appropriate
- Rate limiting
- Payload validation
- Timestamp validation
- Assignment validation
- Tenant isolation
- Audit logs

A device can submit telemetry only for its authorized identity.

---

# 26. LOCAL MOCK DEVICE

Before physical hardware is connected, build:

# Mock Device Simulator

It should simulate:

- Device identity
- GPS
- Speed
- Heading
- RPM
- Temperature
- Fuel
- Motion
- Diagnostic events
- Harsh braking
- Harsh acceleration
- Device disconnect/reconnect

Important:

```text
Mock Device
     ↓
Same Device Gateway
     ↓
Same Telemetry Pipeline
     ↓
Same Dashboard
```

When physical Freematics hardware is available, only the provider/device adapter should need to change.

---

# 27. VEHICLE TELEMETRY DASHBOARD

Vehicle detail should support:

### Live

- Location
- Speed
- Heading
- Device status
- Connection status

### Engine

- RPM
- Temperature
- Supported parameters

### Fuel

- Supported fuel metrics
- Efficiency where calculable

### Diagnostics

- DTCs where available
- Warning events

### Motion

- Harsh braking
- Harsh acceleration
- Other supported events

### History

- Telemetry timeline
- Trips
- Incidents
- Maintenance
- Device history

---

# 28. TELEMETRY ALERTS

Support configurable alerts:

- Overspeed
- Harsh braking
- Harsh acceleration
- Excessive idling
- Engine temperature anomaly
- Low voltage where supported
- Device offline
- Route deviation
- Geofence breach
- Diagnostic fault
- Unusual behavior

Severity:

```text
INFO
WARNING
CRITICAL
```

---

# 29. HARDWARE + DRIVER SCORE

Hardware telemetry may contribute to driver scoring:

- Harsh braking
- Harsh acceleration
- Overspeed
- Excessive idling
- Route compliance

Scores must be explainable.

A driver must be able to understand why a score changed.

---

# 30. HARDWARE + MAINTENANCE

Telemetry may support rule-based maintenance recommendations:

```text
Vehicle telemetry anomaly
        ↓
Maintenance recommendation
        ↓
Owner notification
        ↓
Workshop recommendation
        ↓
Maintenance record
```

Do not claim predictive maintenance until sufficient data exists.

Start with deterministic rules.

---

# 31. HARDWARE + AI

Once telemetry becomes reliable, AI may analyze:

- Fleet health
- Vehicle anomalies
- Driver behavior
- Fuel efficiency
- Maintenance patterns
- Route performance
- Idle time
- Device health

Examples:

> Which trucks have unusual telemetry?

> Which vehicles should be inspected?

> Which drivers have repeated harsh braking?

> Which vehicles have excessive idle time?

AI must operate through authorized services and never receive unrestricted database access.

---

# 32. ASSOCIATION + HARDWARE

Associations receive incident-level information, not raw telemetry by default.

Example:

Association sees:

```text
Truck: UP11AB1234
Incident: Accident
Location: Authorized location
Severity: Critical
Status: Assistance required
```

Association does not automatically see:

```text
RPM
Fuel
Engine temperature
Full route history
Personal driver information
```

unless explicitly authorized.

---

# 33. UNIFIED VEHICLE PROFILE

Every vehicle should have:

```text
Vehicle
 |
 +-- Identity
 +-- Owner
 +-- Driver
 +-- Documents
 +-- Verification
 +-- Device
 +-- Live Location
 +-- Telemetry
 +-- Trips
 +-- Orders
 +-- Maintenance
 +-- Fuel
 +-- Incidents
 +-- Driver Events
 +-- Analytics
```

This must work for trucks, taxis and future vehicle types.

---

# 34. TRAVEL VEHICLE TRACKING

If a travel/taxi booking uses a supported connected device:

Customers can see an authorized simplified view of:

- Vehicle location
- Driver status
- Trip progress
- ETA

Do not expose raw vehicle telemetry to customers.

---

# 35. NOTIFICATION SYSTEM

Extend the existing notification system to support:

- Customer
- Driver
- Owner
- Supplier
- Association
- Travel provider
- Admin

Potential channels:

- In-app
- Web push
- Email
- SMS
- Future integrations

Use a mock notification provider locally.

---

# 36. DOMAIN MODULES

Recommended module boundaries:

```text
auth
users
organizations
roles
permissions

vehicles
vehicle-types
drivers
owners

fleet
orders
bookings
trips

suppliers
materials
customers

travel
tour-packages
mobility-services

documents
verification

tracking
maps
geofencing

devices
device-providers
telemetry

sos
incidents
associations

maintenance
fuel
analytics

subscriptions
payments

notifications

ai
audit
```

Use the existing project's conventions if they are already sound.

---

# 37. FRONTEND INFORMATION ARCHITECTURE

One Saarthi application can expose:

```text
Home
Dashboard
Fleet
Vehicles
Drivers
Orders
Bookings
Marketplace
Travel
Suppliers
Associations
Live Map
Safety
Documents
Maintenance
Analytics
Devices
Telemetry
AI
Billing
Settings
```

Navigation must dynamically adapt to permissions and capabilities.

Do not show irrelevant modules.

---

# 38. SUBSCRIPTION IMPACT

New features should use the existing entitlement system.

Potential future structure:

### Basic

- Core fleet
- Basic tracking
- Documents
- Orders

### Pro

- Advanced tracking
- Driver scoring
- Advanced analytics
- Hardware connectivity

### Intelligence

- AI
- Predictive insights
- Advanced telemetry intelligence

### Enterprise

- Association integrations
- Large fleets
- Advanced APIs
- Advanced hardware management
- SSO
- Custom integrations

Travel/mobility can use appropriate commercial models such as:

- Provider commission
- Booking fee
- Subscription
- Featured listings
- Enterprise agreements

Do not force every service into the fleet subscription model.

---

# 39. UNIFIED BOOKING / ORDER FOUNDATION

Where appropriate, establish shared concepts:

```text
Request
Order
Booking
Trip
Service
Provider
Vehicle
Driver
Customer
```

Do not force freight and passenger travel into identical business logic when their rules differ.

Use shared infrastructure with domain-specific extensions.

---

# 40. API REQUIREMENTS

Follow existing API conventions.

New APIs will likely include:

```text
Associations
Association incidents
Travel providers
Travel packages
Travel bookings
Vehicle types
Devices
Device assignments
Telemetry
Telemetry alerts
Hardware status
```

Use:

- Authentication
- Authorization
- Validation
- Pagination
- Filtering
- Sorting
- Consistent errors
- Audit logging where appropriate

---

# 41. REALTIME EVENTS

Extend existing WebSockets/realtime infrastructure.

Potential events:

```text
vehicle.location.updated
vehicle.telemetry.updated
vehicle.device.online
vehicle.device.offline

trip.started
trip.updated
trip.completed

booking.created
booking.confirmed
booking.cancelled

sos.triggered
sos.acknowledged
sos.assistance_assigned
sos.resolved

incident.created
incident.updated

association.alert.created

telemetry.alert.created
```

All channels must be authorized.

---

# 42. TESTING

## Unit

Test:

- Vehicle type rules
- Device assignment
- Telemetry normalization
- Alert rules
- Association routing
- Booking state transitions
- Package pricing
- Permissions

## Integration

Test:

- Device ingestion
- Vehicle assignment
- Association notifications
- Travel booking
- Provider registration
- Customer booking
- Realtime events

## E2E — Association

```text
Register Association
→ Verification
→ Dashboard
→ SOS Received
→ Acknowledge
→ Respond
→ Resolve
```

## E2E — Travel

```text
Provider Registration
→ Vehicle Registration
→ Package Creation
→ Customer Search
→ Booking
→ Confirmation
→ Trip
→ Tracking
→ Completion
→ Rating
```

## E2E — Hardware

```text
Register Device
→ Assign Device to Vehicle
→ Send Mock Telemetry
→ Receive Telemetry
→ Display Live Data
→ Trigger Alert
→ Verify Owner Notification
```

---

# 43. LOCAL DEVELOPMENT

Everything must work locally before production integrations.

Local components:

```text
React
Node.js
PostgreSQL
Redis
WebSockets
Mock GPS
Mock Device
Mock Notifications
Mock Payments
Local Document Storage
Development AI Adapter
```

Create seed data for:

- Truck owner
- Driver
- Truck
- Taxi owner
- Taxi driver
- Travel provider
- Customer
- Supplier
- Association
- Vehicle
- Mock hardware device
- Orders
- Bookings
- Trips
- Incidents
- Telemetry

---

# 44. DEMO SCENARIO — TRUCK EMERGENCY

```text
Driver starts trip
        ↓
Truck moves using GPS simulator
        ↓
Driver triggers SOS
        ↓
Owner receives alert
        ↓
Nearby Saarthi trucks identified
        ↓
Truck Association receives district alert
        ↓
Association acknowledges
        ↓
Assistance assigned
        ↓
Incident resolved
        ↓
Audit trail created
```

---

# 45. DEMO SCENARIO — TRAVEL

```text
Travel provider registers
        ↓
Vehicle registered
        ↓
Driver registered
        ↓
Tour package created
        ↓
Customer searches
        ↓
Customer books
        ↓
Mock payment succeeds
        ↓
Provider confirms
        ↓
Trip created
        ↓
Vehicle tracking begins
        ↓
Customer sees authorized tracking
        ↓
Trip completed
        ↓
Customer rates provider
```

---

# 46. DEMO SCENARIO — HARDWARE

```text
Mock Freematics device created
        ↓
Device assigned to truck
        ↓
Mock telemetry starts
        ↓
GNSS + vehicle data arrives
        ↓
Device Gateway validates
        ↓
Telemetry normalized
        ↓
Vehicle dashboard updates
        ↓
Overspeed simulated
        ↓
Alert generated
        ↓
Owner notified
        ↓
Driver score event created
```

---

# 47. FUTURE HARDWARE PROVIDERS

Freematics ONE+ Model H is the initial target.

Architecture must later support:

- GPS trackers
- OBD devices
- CAN devices
- J1939 devices
- Telematics providers
- Fleet tracking vendors
- Manufacturer APIs
- Other IoT hardware

Use provider interfaces/adapters.

Do not scatter vendor-specific conditionals throughout the application.

---

# 48. DATA STORAGE STRATEGY

Telemetry can become high-volume.

Analyze:

- Sampling rate
- Retention
- Aggregation
- Indexing
- Partitioning
- Hot/cold data

PostgreSQL remains the primary relational source of truth.

If telemetry volume later requires a specialized time-series system, introduce it behind an abstraction.

Keep local development simple.

---

# 49. PERFORMANCE

Pay special attention to:

- Realtime events
- Telemetry volume
- Map rendering
- Large fleets
- Association incident feeds
- Booking search
- Notifications

Use:

- Pagination
- Aggregation
- Caching
- Event filtering
- Appropriate indexes

Do not broadcast raw high-frequency telemetry to every client.

---

# 50. SECURITY

New modules must preserve:

- RBAC
- Tenant isolation
- Association geographical scope
- Customer privacy
- Provider privacy
- Driver privacy
- Device ownership
- Secure telemetry

Never rely on frontend filtering as the security boundary.

---

# 51. AUDIT LOGGING

Audit:

- Association verification
- Driver verification
- Vehicle verification
- Document approval
- Device assignment
- Device removal
- SOS
- Incident updates
- Booking
- Cancellation
- Payment events
- Subscription changes
- Permission changes
- Sensitive data access

---

# 52. PROJECT ANALYSIS REQUIREMENT

Before implementation, analyze the actual repository.

### Frontend

Inspect:

- Routes
- Components
- Layouts
- State management
- API client
- Maps
- Design system
- Existing dashboards

### Backend

Inspect:

- Modules
- Routes/controllers
- Services
- Repositories
- Middleware
- Authentication
- RBAC
- WebSockets
- Background jobs

### Database

Inspect:

- Users
- Organizations
- Roles
- Vehicles/trucks
- Drivers
- Orders
- Trips
- Documents
- SOS
- Subscriptions

### Infrastructure

Inspect:

- Docker
- PostgreSQL
- Redis
- Environment variables
- Storage
- Tests
- CI/CD

---

# 53. ADDITIONAL MD FILES PROVIDED LATER

The project owner may provide other MD files containing new feature requirements.

The implementation agent MUST read every supplied MD file before implementation.

For each one:

1. Extract requirements.
2. Compare with current architecture.
3. Detect duplicates.
4. Detect conflicts.
5. Detect missing dependencies.
6. Identify database changes.
7. Identify API changes.
8. Identify UI changes.
9. Identify realtime changes.
10. Identify security implications.
11. Integrate compatible requirements.
12. Ask only if a genuine unresolved architectural conflict exists.

Do not blindly follow contradictory instructions.

---

# 54. CONFLICT RESOLUTION

When requirements conflict, use this order:

```text
1. Security
2. Existing CLAUDE.md
3. Existing Saarthi architecture
4. Existing working functionality
5. This specification
6. Additional feature MD files
7. Implementation convenience
```

If an additional MD represents a newer approved business decision, update the architecture accordingly and document the decision.

---

# 55. NO UNNECESSARY REBUILD

Do not rebuild Saarthi from scratch.

Do not replace the current framework without a strong reason.

Do not replace the database.

Do not replace working modules.

Refactor only when required for:

- Correctness
- Security
- Scalability
- Maintainability
- New feature compatibility

---

# 56. DATABASE MIGRATION SAFETY

All schema changes must:

- Use migrations
- Preserve existing data
- Provide safe defaults
- Handle existing records
- Avoid destructive changes unless explicitly approved
- Have a rollback strategy where practical

Before destructive migrations, stop and request confirmation.

---

# 57. UI/UX PRINCIPLE

New modules must not make Saarthi feel like multiple unrelated products.

Use a common:

- Navigation
- Design system
- Typography
- Components
- Notifications
- Account system
- Search
- Maps
- Profile
- Settings

The user should feel:

> "I am using Saarthi."

not:

> "I entered another website."

---

# 58. BRAND ARCHITECTURE

Primary brand:

# SAARTHI

Possible internal labels:

- Saarthi Fleet
- Saarthi Travel
- Saarthi Safety
- Saarthi Connect
- Saarthi Intelligence

These are modules/capabilities, NOT separate websites.

---

# 59. PRODUCTION DIRECTION

The local version should use:

```text
Mock GPS
Mock Device
Mock Notifications
Mock Payments
Local Storage
Development AI
```

Production should replace them with real providers without rewriting the core business layer.

For hardware:

```text
Mock Device
    ↓
Same Device Gateway
    ↓
Same Telemetry Pipeline
    ↓
Freematics Adapter
    ↓
Real Hardware
```

Later providers can use the same abstraction.

---

# 60. FREEMATICS IMPLEMENTATION SAFETY

Before connecting physical hardware:

1. Verify the exact Model H hardware.
2. Verify communication method.
3. Verify supported protocols.
4. Verify payload format.
5. Verify authentication requirements.
6. Verify firmware/API requirements.
7. Verify SIM/network requirements.
8. Verify required telemetry parameters on target vehicles.
9. Test with mock payloads.
10. Connect the physical device.
11. Validate telemetry against the vehicle.
12. Confirm device-to-vehicle assignment.
13. Confirm realtime dashboard updates.
14. Confirm alerts.

Never assume every vehicle exposes every metric.

---

# 61. RECOMMENDED IMPLEMENTATION ORDER

### Phase A
Existing-project analysis

### Phase B
Architecture reconciliation with all supplied MD files

### Phase C
Vehicle abstraction

### Phase D
Account/capability architecture

### Phase E
Truck Association

### Phase F
Association emergency network

### Phase G
Travel/mobility provider

### Phase H
Travel packages

### Phase I
Customer booking

### Phase J
Hardware/device architecture

### Phase K
Mock device gateway

### Phase L
Freematics adapter

### Phase M
Telemetry dashboard

### Phase N
Telemetry alerts

### Phase O
Integration testing

### Phase P
Production-readiness preparation

Do not proceed blindly if the existing architecture suggests a safer sequence.

---

# 62. ACCEPTANCE CRITERIA

## Platform

- One Saarthi website
- One authentication system
- Multiple roles/capabilities
- Existing users remain functional

## Association

- Registration
- Verification
- Dashboard
- Incident feed
- SOS notifications
- Geographic filtering
- Response workflow

## Mobility

- Taxi provider registration
- Vehicle registration
- Driver registration
- Travel packages
- Customer discovery
- Booking
- Payment abstraction
- Trip
- Tracking
- Rating

## Hardware

- Device registration
- Device verification
- Device-to-vehicle assignment
- Mock device
- Freematics adapter architecture
- Telemetry gateway
- Normalized telemetry
- Live telemetry
- Alerts
- Device status
- History

## Vehicle

- Generalized vehicle model
- Truck remains supported
- Taxi supported
- Future vehicle types possible

## Security

- RBAC
- Tenant isolation
- Association scope
- Device authentication
- Secure telemetry
- Audit logs

## Quality

- Tests
- Type checking
- Linting
- Database migrations
- Documentation
- Local demo

---

# 63. REQUIRED IMPLEMENTATION PROCESS

Use:

```text
READ
 ↓
INSPECT
 ↓
COMPARE
 ↓
ARCHITECT
 ↓
MIGRATE
 ↓
IMPLEMENT
 ↓
TEST
 ↓
VERIFY
 ↓
DOCUMENT
 ↓
CONTINUE
```

Do not implement everything in one uncontrolled operation.

After each meaningful feature:

- Run tests.
- Run type checking.
- Run linting.
- Verify the database.
- Verify APIs.
- Verify authorization.
- Verify UI.
- Verify realtime functionality.
- Update documentation.
- Continue to the next feature.

---

# 64. FINAL SAARTHI VISION

After this expansion:

```text
                         SAARTHI
                            |
        ------------------------------------------------
        |              |              |               |
     LOGISTICS       MOBILITY       SAFETY        INTELLIGENCE
        |              |              |               |
   Trucks          Taxis          Associations       AI
   Drivers         Travel         SOS                 Analytics
   Suppliers       Tours          Incidents           Predictions
   Materials       Bookings       Assistance          Insights
   Customers       Vehicles       District Network    Recommendations
        \             |              |              /
         \            |              |             /
          ------------------------------------------
                         |
                   VEHICLE PLATFORM
                         |
                 HARDWARE / TELEMATICS
                         |
              FREEMATICS + FUTURE DEVICES
                         |
                      TELEMETRY
                         |
                     LIVE DATA
                         |
                    SAARTHI AI
```

The goal is NOT to create a collection of unrelated services.

The goal is:

> **One Saarthi platform connecting people, vehicles, services, safety and real-world transportation data.**

---

# 65. FINAL INSTRUCTION TO THE IMPLEMENTATION AGENT

You are extending an existing Saarthi implementation.

Do not assume the project is empty.

Do not assume documentation perfectly matches code.

Analyze the real project first.

Read all supplied MD files.

Compare documentation with implementation.

Preserve existing functionality.

Identify architecture gaps.

Implement new features incrementally.

Use one Saarthi platform and one account ecosystem.

Do not create separate websites.

Do not duplicate existing functionality.

Do not introduce unnecessary frameworks.

Do not hard-code Freematics-specific logic into the entire application.

Do not make hardware mandatory for local development.

Do not make AI mandatory for core functionality.

Do not expose sensitive telemetry or personal data unnecessarily.

Do not declare a feature complete until it works end-to-end.

The final result must be:

> **A fully integrated Saarthi platform where logistics, mobility, travel, truck associations, emergency response, vehicle intelligence and hardware telemetry operate together inside one secure application.**
