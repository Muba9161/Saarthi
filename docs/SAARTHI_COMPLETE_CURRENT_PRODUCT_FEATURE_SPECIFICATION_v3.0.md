# SAARTHI — COMPLETE CURRENT PRODUCT & FEATURE IMPLEMENTATION SPECIFICATION
## Version 3.0 — Unified Amendment for Existing Saarthi Project

> This document is the current consolidated implementation specification for Saarthi.
> It must be used together with the existing `CLAUDE.md` and any earlier Saarthi MD files supplied with the project.
>
> IMPORTANT: Claude MUST NOT rebuild Saarthi blindly. First inspect the repository and reconcile this document with the existing implementation. Reuse, extend and refactor existing modules wherever possible.
>
> This document consolidates the current requirements discussed for:
> - Fleet and logistics
> - Vehicle intelligence
> - Vehicle/driver QR identity and privacy
> - Loans and EMI management
> - Complete service history
> - Truck associations
> - Taxi/travel/tour services
> - Freematics hardware integration
> - YC06 multi-camera integration
> - Live tracking and mock local hardware
> - Fuel/toll/FASTag integrations
> - SOS and emergency assistance
> - Gemini AI intelligence and Gemini Voice
> - Subscriptions and vehicle top-ups
> - Responsive and interactive UX
> - Redis and performance optimization
> - Local-first development and future production migration
>
> Vehicle/truck resale is explicitly DEFERRED and is not part of the current implementation.

---

# 1. NON-NEGOTIABLE IMPLEMENTATION RULES

Before coding:

1. Read `CLAUDE.md`.
2. Read all existing Saarthi MD files.
3. Read this document.
4. Inspect the actual repository.
5. Inspect package manifests and existing framework choices.
6. Inspect database schema and migrations.
7. Inspect authentication, authorization and tenant/organization architecture.
8. Inspect existing vehicle, driver, customer, trip, order, service, maintenance, document, QR, subscription, AI, notification and hardware modules.
9. Inspect existing Redis/queue/cache implementation if present.
10. Inspect existing marketing site.
11. Inspect existing mobile/device implementation if present.
12. Inspect existing APIs/provider adapters.
13. Produce an impact report before changing code.

Classify requirements:

```text
ALREADY IMPLEMENTED
PARTIALLY IMPLEMENTED
NEW
DUPLICATE
CONFLICT
REQUIRES REFACTOR
```

Then implement incrementally.

## Never:

- rebuild an existing feature unnecessarily;
- create duplicate models/services/pages;
- create a separate Saarthi application for each capability;
- create a separate login for each role;
- bypass existing RBAC;
- expose sensitive data through QR;
- put secrets in the frontend;
- let Gemini directly access the database;
- hard-code provider-specific logic into UI components;
- rely on frontend-only subscription enforcement;
- silently convert AI/external-provider output into verified facts;
- treat simulated data as real data;
- implement vehicle resale in the current release.

---

# 2. PRODUCT VISION

Saarthi is one unified platform:

> Transportation + Logistics + Mobility + Vehicle Intelligence + Safety + AI

The platform should serve different roles from the same site and authentication system.

There should NOT be separate sites for:

- fleet owners
- drivers
- customers
- truck associations
- taxi operators
- travel operators
- administrators

Role-specific experiences are controlled by RBAC, entitlements and contextual navigation.

---

# 3. CURRENT PRODUCT SCOPE

## Logistics

- Fleet management
- Vehicle management
- Driver management
- Customer management
- Orders
- Trips
- Suppliers
- Return loads
- Fleet analytics

## Vehicle Intelligence

- Vehicle Passport
- RC/vehicle verification
- Vehicle documents
- Driver assignment
- QR Identity
- QR privacy/masking
- Maintenance
- Service history
- Loan/EMI management
- Fuel
- FASTag
- Toll
- Telemetry
- Hardware/device management
- Vehicle incidents
- Vehicle analytics

## Mobility

- Taxi operators
- Travel agencies
- Tours
- Travel packages
- Bookings
- Customer travel flows

## Safety

- SOS
- Truck associations
- Accident alerts
- Driver emergency assistance
- Nearby Saarthi vehicles
- Nearby petrol pumps
- Nearby food/dhaba locations
- Nearby workshops
- Important nearby locations
- Incident management

## AI

- Gemini AI
- Gemini Voice/Live
- Fleet intelligence
- Vehicle intelligence
- Service intelligence
- Loan/EMI intelligence
- Fuel intelligence
- Toll intelligence
- Route intelligence
- Driver coaching
- Anomaly detection/explanation
- Document intelligence
- Natural-language analytics
- Daily fleet brief
- AI-assisted recommendations
- AI provenance and safety

## Subscription

- 1 vehicle
- 5 vehicles
- 20 vehicles
- 50 vehicles
- +1 vehicle top-up

## Hardware

- Local phone-as-device testing
- Freematics ONE+ H integration
- YC06 four-camera integration
- Device-to-vehicle association
- Telemetry ingestion
- Live camera ingestion
- Hardware health

---

# 4. DEFERRED FEATURE — VEHICLE/TRUCK RESALE

Vehicle/truck resale is NOT a current feature.

Do not implement:

- resale marketplace
- buyer/seller listings
- resale search
- resale offers
- resale negotiation
- resale checkout
- resale valuation
- resale-specific AI
- resale-specific navigation
- resale-specific subscription entitlement
- resale marketing

Preserve reusable vehicle-history information because it may support resale in a future version.

If resale code already exists, disable it safely using existing feature flags/capabilities rather than destructively deleting shared vehicle data.

---

# 5. TECHNOLOGY ARCHITECTURE

Use the existing project stack where already established.

Target architecture:

```text
Frontend
├── React
├── TypeScript
├── Tailwind CSS
├── Existing component/design system
└── Maps / charts / realtime UI

Backend
├── Node.js
├── TypeScript
├── REST APIs
├── WebSocket/realtime layer
├── Background workers
└── Provider adapters

Database
├── PostgreSQL
├── Prisma or existing ORM
└── Proper indexing/query optimization

Caching / Realtime
├── Redis
├── Redis Pub/Sub
├── Redis caching
├── Redis rate limiting
└── Redis-backed queues where appropriate

AI
├── Gemini
├── Gemini Live/Voice
├── AIProvider abstraction
├── Tool registry
└── AI provenance/cost controls

Hardware
├── Freematics ONE+ H
├── YC06
├── Device Gateway
└── Mock Device Gateway for local development

Media
├── Existing media library
├── Object storage abstraction
└── WebRTC/video gateway where applicable
```

Use the project's actual installed framework choices if they differ, unless a change is explicitly required.

---

# 6. LOCAL-FIRST DEVELOPMENT

Saarthi must be fully functional locally before production deployment.

Local environment:

```text
Developer PC
├── React frontend
├── Node.js backend
├── PostgreSQL
├── Redis
├── Workers
├── WebSocket
├── Mock external providers
├── Mock hardware
└── Mock AI
```

Everything possible should work without paid external services.

Use `.env.example` and local `.env`.

Never commit secrets.

---

# 7. MOCK HARDWARE / PHONE-AS-VEHICLE DEVICE

Before buying hardware, an Android phone can simulate a vehicle device.

The phone should provide:

- GPS
- latitude
- longitude
- speed
- heading
- altitude
- accuracy
- camera
- microphone
- accelerometer
- gyroscope
- connectivity status
- SOS

Architecture:

```text
Android Phone
├── GPS
├── Camera
├── Sensors
└── Device Identity
       ↓
4G/Wi-Fi
       ↓
Saarthi Device Gateway
       ↓
Redis
       ↓
PostgreSQL / WebSocket / WebRTC
       ↓
Saarthi Dashboard
```

The phone should be treated like a real device, not as a special frontend shortcut.

Do not write directly from phone to PostgreSQL.

---

# 8. MOCK VEHICLE TELEMETRY

Phone GPS cannot provide actual:

- RPM
- CAN/J1939
- fuel level
- coolant temperature
- engine load
- diagnostic trouble codes
- real engine data

Create a mock telemetry provider for local development.

Example:

```text
RPM: 1850
Fuel: 64%
Coolant: 87°C
Battery: 27.3V
Engine: NORMAL
```

Clearly label simulated values:

```text
Source: SIMULATED
```

Later replace:

```text
Mock Telemetry
      ↓
Freematics ONE+ H
```

without changing the Saarthi UI contract.

---

# 9. FREEMATICS ONE+ H INTEGRATION

Freematics is the vehicle telemetry hardware.

Expected responsibilities:

- GPS
- CAN/J1939 where supported
- engine telemetry
- RPM
- vehicle diagnostics
- fuel-related telemetry where available
- vehicle health
- device status

Architecture:

```text
Freematics
   ↓
Device Gateway
   ↓
Protocol Adapter
   ↓
Normalized Vehicle Telemetry
   ↓
Redis Live State
   ↓
PostgreSQL History
   ↓
WebSocket
   ↓
Saarthi UI
```

Every hardware device must be associated with exactly the intended vehicle/device relationship.

Do not assume that all Freematics sensors/fields are available on every vehicle. Preserve source and availability.

---

# 10. YC06 FOUR-CAMERA INTEGRATION

Use the selected YC06 as the first physical multi-camera prototype.

The YC06 is treated as the video device.

Expected architecture:

```text
YC06
├── Camera 1
├── Camera 2
├── Camera 3
└── Camera 4
       ↓
4G
       ↓
Saarthi Video Gateway
       ↓
WebRTC / video delivery
       ↓
Saarthi Dashboard
```

The four cameras are wired to the YC06.

The YC06 and Freematics can be associated with the same vehicle:

```text
Vehicle
├── Freematics
│   └── telemetry
└── YC06
    ├── camera 1
    ├── camera 2
    ├── camera 3
    └── camera 4
```

The system should not assume the camera device provides GPS if Freematics is the designated vehicle telemetry source.

Store device association independently from vehicle identity.

---

# 11. LIVE TRACKING

Vehicle live tracking must support:

- current location
- speed
- heading
- online/offline state
- last update
- GPS accuracy
- trip status
- device health

Map markers should use real visual vehicle/truck markers rather than generic pins where practical.

Marker orientation should follow heading.

Example:

```text
🚛 →
```

not a generic static pin.

Live state should be read from Redis rather than repeatedly querying PostgreSQL.

Historical tracks should come from PostgreSQL/optimized historical storage.

---

# 12. NEARBY SERVICES

While a vehicle is traveling, show relevant nearby locations:

- petrol pumps
- dhabas/food
- workshops
- hospitals/emergency facilities
- parking
- rest areas
- important landmarks
- nearest Saarthi vehicle

The feature belongs inside:

```text
Live Trip / Live Tracking
```

rather than creating separate top-level applications.

Use map/location providers through an abstraction:

```text
PlacesProvider
├── ExternalPlacesProvider
└── MockPlacesProvider
```

Cache stable place information appropriately.

Do not fabricate live availability.

---

# 13. SOS AND EMERGENCY RESPONSE

Driver can press:

```text
🚨 SOS
```

Flow:

```text
Driver Device
 ↓
SOS Event
 ↓
Saarthi Device Gateway
 ↓
Redis Pub/Sub
 ↓
Incident Service
 ↓
Realtime Alerts
 ├── Fleet Owner
 ├── Authorized Manager
 ├── Truck Association
 └── Nearby Saarthi Vehicles
```

The alert should show:

- vehicle
- driver
- current location
- speed
- time
- incident type
- camera availability
- nearby vehicles
- nearby workshop
- nearby hospital/emergency location
- nearby food/rest point if relevant

The nearest Saarthi vehicles can receive an assistance alert based on authorized location data.

---

# 14. TRUCK ASSOCIATION ACCOUNT

Add Truck Association accounts to the same Saarthi platform.

Associations can register by district/coverage area.

They should receive authorized alerts for:

- accidents
- driver SOS
- driver assault/security incident
- breakdown
- emergency assistance
- other configured incidents in their area

Association dashboard:

```text
Active Emergencies
Nearby Incidents
Vehicles Requiring Help
Response Status
Incident History
Coverage Map
```

Associations should not see unrelated:

- loan data
- private financial data
- confidential documents
- complete fleet history
- private owner information

---

# 15. TAXI / TRAVEL / TOUR SERVICES

The same Saarthi site should support:

- taxi vehicle registration
- taxi driver registration
- travel operator registration
- tour packages
- travel packages
- customer booking
- package management
- booking status
- operator dashboard
- customer booking history

Do not create a separate application.

Use role-aware navigation and contextual modules.

---

# 16. VEHICLE + DRIVER QR IDENTITY

Every eligible vehicle can have a secure QR.

The QR must contain an opaque/signed token, not raw information.

Relationship:

```text
Vehicle
 ↓
Active Driver Assignment
 ↓
Driver
 ↓
Verified Driving Licence
```

Scanning:

```text
Scan
 ↓
Token validation
 ↓
Authorization
 ↓
Privacy policy
 ↓
Masking
 ↓
Authorized vehicle + driver data
```

Example:

```text
SAARTHI VEHICLE

🚛 UP32 AB 1234

Tata Prima
2022
Active

Driver:
Ramesh Kumar
✓ Verified

Service:
Healthy

[View Authorized Details]
```

---

# 17. QR PRIVACY AND MASKING

Owner/admin can decide which fields are visible.

Fields:

```text
Vehicle
- registration
- make/model
- type
- status

Driver
- name
- phone
- address
- licence number
- verification

Documents
- RC number
- chassis number
- engine number
- insurance number

Finance
- loan number
- EMI
- outstanding

FASTag
- reference
- balance
```

Mask examples:

```text
9876543210
→ 98******10

DL-123456789012
→ DL-1234****9012

LOAN-123456789
→ LOAN-*****6789
```

Privacy profiles:

```text
PUBLIC
BASIC_VERIFIED
OPERATIONAL
OWNER
ADMIN
```

Implement:

- token expiration
- rotation
- revocation
- scan logging
- rate limiting
- abuse detection
- tenant isolation
- backend authorization

Never trust a frontend parameter to reveal confidential fields.

---

# 18. VEHICLE PASSPORT

Vehicle Passport remains the central vehicle intelligence record.

```text
Vehicle Passport
├── Identity
├── RC
├── Documents
├── Driver
├── Insurance
├── Fitness
├── PUCC
├── Permit
├── Hardware
├── Live Location
├── Telemetry
├── Trips
├── Orders
├── Maintenance
├── Service History
├── Fuel
├── FASTag/Toll
├── Incidents
├── Loan & Finance
├── Analytics
└── QR Identity
```

---

# 19. LOAN AND EMI MANAGEMENT

Add a contextual:

```text
Vehicle Details
└── Loan & Finance
```

Fields:

```text
Loan Number
Lender
Borrower
Vehicle
Loan Type
Principal
Disbursed Amount
Interest Rate
Interest Type
Tenure
Start Date
End Date
EMI Amount
Frequency
Next EMI Date
Outstanding Principal
Outstanding Interest
Total Outstanding
Paid Installments
Remaining Installments
Auto Debit Date
Mandate Reference
Status
```

Provider architecture:

```text
LoanProvider
├── InternalLoanProvider
├── MockLoanProvider
└── ExternalLoanProviderAdapter
```

Important:

A loan number alone does not guarantee that external loan data can be retrieved. Retrieval requires a supported provider, authorization and applicable access.

Support manual entry, import and provider sync where available.

Installments:

```text
number
dueDate
principal
interest
totalDue
status
paidAt
paymentReference
source
```

Statuses:

```text
UPCOMING
DUE_SOON
DUE_TODAY
PAID
OVERDUE
PARTIALLY_PAID
WAIVED
UNKNOWN
```

Default reminders:

```text
T-4 days
T-1 day
T+1 overdue check
```

Allow configurable reminder timing.

---

# 20. SERVICE HISTORY

Extend the existing service/maintenance system.

Record:

```text
serviceId
vehicleId
serviceDate
odometer
engineHours
serviceType
category
workshop
address
mechanic/provider
parts
labourCost
partsCost
totalCost
invoiceNumber
invoiceMedia
photos
notes
nextServiceDate
nextServiceOdometer
warrantyUntil
replacedComponents
diagnosticCodes
source
provider
verificationStatus
createdBy
createdAt
updatedAt
```

Show a complete timeline.

External provider:

```text
ServiceHistoryProvider
├── Internal
├── External
└── Mock
```

External records must preserve:

```text
provider
source
retrievedAt
verificationStatus
```

Conflicts should be surfaced for review.

Use existing media library for invoices/photos.

Gemini may extract draft information from invoices, but extracted information must be verified before becoming trusted data.

---

# 21. TABLE / CARD VIEW SYSTEM

Reusable:

```text
ViewModeToggle
├── Table
└── Cards
```

Apply to:

- vehicles
- drivers
- service records
- loans
- trips
- orders
- suppliers
- bookings
- incidents
- maintenance
- fuel
- toll
- documents
- hardware

Tables:

- sorting
- filtering
- search
- pagination
- column visibility
- responsive behavior
- row actions

Cards:

- concise summary
- status
- contextual actions
- role-authorized fields

Persist user preference where possible.

---

# 22. GEMINI AI — CORE SAARTHI INTELLIGENCE LAYER

Gemini is a core Saarthi intelligence system, NOT simply a chatbot.

Architecture:

```text
User
 ↓
Saarthi AI UI / Voice
 ↓
Gemini
 ↓
Intent + reasoning
 ↓
Authorized Tool Registry
 ↓
Saarthi Services
 ↓
Database / Providers / Analytics
 ↓
Normalized Tool Results
 ↓
Gemini
 ↓
Answer / Recommendation / Explanation
```

Gemini MUST:

- use authorized tools;
- respect RBAC;
- respect tenant boundaries;
- never directly query PostgreSQL;
- never fabricate Saarthi data;
- never bypass provider/business logic;
- clearly distinguish data from inference.

---

# 23. GEMINI PROVIDER ARCHITECTURE

```text
AIProvider
├── MockAIProvider
└── GeminiAIProvider
```

Local development must work using MockAIProvider.

Production uses Gemini.

The frontend should not contain provider-specific logic.

---

# 24. GEMINI FLEET INTELLIGENCE

Users can ask:

- "How healthy is my fleet today?"
- "Which trucks need attention?"
- "Which vehicles are offline?"
- "Which trucks have service due?"
- "Which trucks have EMI due?"
- "Which trucks have abnormal fuel consumption?"
- "What are my biggest fleet problems today?"

Tools:

```text
get_fleet_summary
get_fleet_health
get_fleet_service_status
get_fleet_fuel_summary
get_fleet_toll_summary
get_fleet_loan_summary
get_fleet_driver_scores
get_fleet_device_health
get_fleet_anomalies
```

Example:

```text
Today's Fleet Brief

72 active vehicles
4 service recommendations
3 low FASTag balances
2 fuel anomalies
1 route deviation
7 upcoming EMIs

Priority:
1. Truck 42 — service overdue
2. Truck 17 — fuel anomaly
3. Truck 31 — EMI due in 4 days
```

All values must originate from tools.

---

# 25. GEMINI VEHICLE INTELLIGENCE

Tools:

```text
get_vehicle_summary
get_vehicle_health
get_vehicle_service_history
get_vehicle_service_record
get_vehicle_maintenance_status
get_vehicle_documents
get_vehicle_driver_assignment
get_vehicle_telemetry_summary
get_vehicle_incidents
get_vehicle_fuel_summary
get_vehicle_toll_summary
```

Questions:

- "Give me the complete health status."
- "When was the last service?"
- "What changed this month?"
- "Why is this vehicle showing a warning?"
- "What should I inspect?"

Separate:

```text
Observed Data
Rule Result
AI Inference
Recommendation
```

---

# 26. GEMINI MAINTENANCE INTELLIGENCE

Gemini can summarize service history and identify patterns.

Examples:

- repeated brake repairs
- increasing service costs
- recurring components
- overdue maintenance
- unusual maintenance frequency

Gemini must not claim a mechanical diagnosis without appropriate evidence.

---

# 27. GEMINI LOAN / EMI INTELLIGENCE

Tools:

```text
get_vehicle_loan_summary
get_upcoming_loan_emis
get_loan_payment_history
get_loan_outstanding_balance
get_monthly_loan_obligations
get_overdue_loan_payments
```

Questions:

- "Which trucks have EMI due this week?"
- "How much EMI do I need this month?"
- "Which vehicle has the highest outstanding loan?"
- "Show overdue EMIs."

Financial data must be role-authorized.

---

# 28. GEMINI DRIVER INTELLIGENCE

Tools:

```text
get_driver_score
get_driver_events
get_driver_trip_summary
get_driver_safety_events
```

Examples:

- driving behavior summary
- harsh braking
- rapid acceleration
- speeding
- coaching suggestions

Never fabricate events.

---

# 29. GEMINI FUEL / TOLL INTELLIGENCE

Tools:

```text
get_fuel_summary
get_fuel_anomalies
get_fuel_efficiency
get_toll_summary
get_toll_variance
get_trip_cost_summary
```

Gemini can explain cost changes and anomalies but must distinguish possible explanations from verified causes.

---

# 30. GEMINI ROUTE INTELLIGENCE

Maintain deterministic route logic first.

Gemini explains:

- route choices
- route cost
- possible delays
- route deviations
- nearby services
- trip optimization

Do not let Gemini invent map/traffic data.

---

# 31. GEMINI RETURN-LOAD INTELLIGENCE

Use deterministic matching:

```text
destination
capacity
cargo
time
pickup distance
price
```

Gemini explains why a load is a good match.

---

# 32. GEMINI ANOMALY INTELLIGENCE

Detect anomalies using deterministic rules and analytics.

Examples:

```text
Fuel > tank capacity
Unexpected location
Unusual fuel economy
Unexpected spending
Repeated harsh events
Unexpected downtime
Service overdue
Loan overdue
Telemetry anomalies
Device anomalies
```

Gemini explains possible causes.

---

# 33. GEMINI DOCUMENT INTELLIGENCE

Use Gemini for:

- invoice extraction
- service receipt extraction
- RC assistance
- insurance document extraction
- maintenance document extraction
- loan statement extraction where supported

Flow:

```text
Document
 ↓
Media Library
 ↓
Gemini extraction
 ↓
Structured Draft
 ↓
Validation
 ↓
Verification
 ↓
Saarthi Record
```

Never mark AI-extracted data verified automatically.

---

# 34. GEMINI QR INTELLIGENCE

After QR privacy/authorization is applied, Gemini can summarize authorized data.

Examples:

- "Summarize this truck."
- "When was it last serviced?"
- "Is anything due?"
- "Who is the assigned driver?"

Gemini must receive only the authorized dataset.

---

# 35. GEMINI SUBSCRIPTION INTELLIGENCE

Tools:

```text
get_subscription
get_vehicle_subscription_capacity
get_vehicle_topups
get_subscription_usage
```

Questions:

- "How many vehicles can I add?"
- "Am I at my limit?"
- "Should I buy a top-up or upgrade?"

Gemini must query actual entitlement state.

---

# 36. NATURAL LANGUAGE ANALYTICS

Users should be able to ask:

```text
How much did we spend on fuel this month?

Which truck costs the most?

Which vehicles need service?

Which EMIs are due next week?

Which drivers have the most safety events?

Show everything requiring attention today.
```

Gemini can orchestrate multiple tools.

---

# 37. GEMINI DAILY FLEET BRIEF

Provide a concise operational brief:

```text
Today's Saarthi Brief

Fleet:
72 active vehicles

Attention:
4 service issues
2 fuel anomalies
1 device offline
7 upcoming EMIs
3 low FASTag balances

Priority:
Truck 42
Truck 17
Truck 31
```

Make this a dashboard card and notification, not a separate application.

---

# 38. GEMINI VOICE / LIVE

Maintain voice/live capability.

Architecture:

```text
Driver Microphone
 ↓
Saarthi Voice
 ↓
Gemini Live
 ↓
Authorized Tools
 ↓
Saarthi Services
 ↓
Gemini
 ↓
Voice Response
```

Use cases:

- trip assistant
- live map
- customer lookup
- owner dashboard
- association desk

Voice cannot bypass permissions.

Financial/destructive actions require explicit confirmation.

---

# 39. AI PROVENANCE

For important AI responses store:

```text
answer
toolCalls
dataSources
generatedAt
userRole
authorizationContext
```

Where useful show:

```text
Based on:
42 trips
18 fuel transactions
6 service records
```

AI output types:

```text
SOURCE DATA
RULE RESULT
AI INFERENCE
RECOMMENDATION
```

If information is unavailable:

```text
I don't have enough verified data to answer that.
```

Never guess.

---

# 40. AI COST CONTROL

Support:

- organization AI limits
- user AI limits
- plan entitlements
- token tracking
- cost tracking
- tool-call limits
- voice limits
- timeout policies
- retry policies
- model routing where appropriate

Use Redis for short-lived AI/tool result caching where safe.

Never cache sensitive results across tenants/users without an authorization-safe cache key.

---

# 41. SUBSCRIPTION PLANS

Plans:

```text
1 VEHICLE
5 VEHICLES
20 VEHICLES
50 VEHICLES
```

Top-up:

```text
+1 VEHICLE
```

Entitlements:

```text
vehicle_limit
vehicle_topup_limit
```

Effective:

```text
basePlanVehicleLimit + activeVehicleTopUps
```

Example:

```text
5-plan + 2 top-ups = 7 vehicles
```

Capacity must be enforced by backend entitlement service.

---

# 42. MARKETING SITE

Pricing section:

```text
1 Vehicle
5 Vehicles
20 Vehicles
50 Vehicles
+1 Vehicle Top-Up
```

Show:

- vehicle capacity
- feature availability
- AI availability
- hardware availability
- support
- upgrade path
- top-up

Marketing must match actual entitlements.

Remove resale from current marketing.

---

# 43. REDIS — FIRST-CLASS SAARTHI INFRASTRUCTURE

Redis is mandatory for the Saarthi architecture.

Redis should not be added merely as a generic cache. Define clear responsibilities.

## 43.1 Redis responsibilities

Use Redis for:

1. Live vehicle state
2. Latest telemetry
3. WebSocket fan-out
4. Pub/Sub
5. API caching
6. Provider response caching where safe
7. AI/tool result caching where safe
8. Rate limiting
9. Session/temporary state where appropriate
10. Background job queues where the selected queue architecture supports Redis
11. Distributed locks
12. Idempotency keys
13. Short-lived QR/security state
14. Temporary trip state
15. Device heartbeat state

## 43.2 Live vehicle state

Do NOT query PostgreSQL for every dashboard GPS update.

Use:

```text
vehicle:{vehicleId}:live
```

Example:

```json
{
  "lat": 26.8467,
  "lng": 80.9462,
  "speed": 48,
  "heading": 72,
  "accuracy": 4,
  "timestamp": "...",
  "deviceStatus": "ONLINE"
}
```

Use TTL/heartbeat logic.

## 43.3 Redis Pub/Sub

Example:

```text
vehicle:{vehicleId}:telemetry
vehicle:{vehicleId}:events
vehicle:{vehicleId}:sos
fleet:{fleetId}:alerts
```

Use Pub/Sub to distribute realtime events to WebSocket servers.

## 43.4 WebSocket architecture

```text
Device
 ↓
Node.js Device Gateway
 ↓
Redis
 ↓
Redis Pub/Sub
 ↓
WebSocket Gateway
 ↓
React
```

Do not broadcast every irrelevant update to every connected user.

Only publish to authorized tenant/fleet/vehicle channels.

## 43.5 Cache keys

Use namespaced keys:

```text
saarthi:{env}:vehicle:{id}:live
saarthi:{env}:vehicle:{id}:summary
saarthi:{env}:vehicle:{id}:service-summary
saarthi:{env}:vehicle:{id}:loan-summary
saarthi:{env}:fleet:{id}:summary
saarthi:{env}:subscription:{id}:entitlement
```

## 43.6 Cache TTL

Choose TTL based on data freshness.

Examples:

```text
Live vehicle state:
seconds/minutes

Fleet dashboard aggregates:
short TTL

Places:
longer TTL

Service history:
minutes/hours depending on source

Loan data:
short/controlled TTL

Subscription entitlement:
short TTL + invalidation on billing changes
```

Never use a single TTL for all data.

## 43.7 Cache invalidation

Invalidate/update cache after:

- vehicle changes
- service record changes
- loan changes
- payment state changes
- subscription upgrades
- top-up purchases
- driver assignment changes
- device association changes

Avoid stale entitlement/financial information.

## 43.8 Redis distributed locks

Use locks for:

- EMI reminder jobs
- external sync jobs
- subscription renewals
- scheduled AI brief
- provider synchronization
- device assignment operations where needed

Prevent duplicate execution across workers.

## 43.9 Rate limiting

Redis-backed rate limiting for:

- login
- QR scans
- public QR endpoints
- device telemetry
- AI requests
- voice sessions
- sensitive APIs
- provider proxy endpoints

---

# 44. PERFORMANCE OPTIMIZATION — FIRST-CLASS REQUIREMENT

Saarthi must be optimized for:

- desktop
- mobile
- tablets
- low-end devices
- large fleets
- realtime data
- map-heavy screens
- AI workloads

Optimization is required in development, not only production.

---

# 45. FRONTEND OPTIMIZATION

Use:

- code splitting
- lazy loading
- route-level chunks
- component-level lazy loading where useful
- virtualization for large tables/lists
- memoization only where useful
- debounced search
- request cancellation
- pagination
- incremental loading
- optimized images
- responsive assets
- skeleton states
- minimal rerenders
- efficient state management

Do not render thousands of vehicle markers/components unnecessarily.

---

# 46. MAP OPTIMIZATION

For large fleets:

- cluster markers
- viewport-based rendering
- only fetch relevant vehicles
- throttle realtime updates
- batch marker updates
- avoid full-map rerender
- use optimized vehicle icons
- cache static map/place data where allowed

Do not create one React component update for the entire fleet every time one truck moves.

---

# 47. REALTIME OPTIMIZATION

Do not write every telemetry event directly to PostgreSQL synchronously.

Preferred:

```text
Device
 ↓
Gateway
 ↓
Redis Live State
 ↓
WebSocket
 ↓
Dashboard
```

Historical persistence:

```text
Telemetry
 ↓
Buffer / queue
 ↓
Worker
 ↓
PostgreSQL
```

Use batching where appropriate.

This reduces database load.

---

# 48. BACKEND OPTIMIZATION

Implement:

- async I/O
- pagination
- query batching
- proper indexes
- connection pooling
- response compression where appropriate
- request timeouts
- retries with backoff
- caching
- idempotency
- background processing
- streaming for large responses where appropriate

Avoid N+1 queries.

Use select/include carefully.

Do not return unnecessary fields.

---

# 49. POSTGRESQL OPTIMIZATION

Use indexes for common access paths such as:

```text
tenantId
vehicleId
driverId
timestamp
status
serviceDate
dueDate
subscriptionId
deviceId
```

Use composite indexes where justified.

Large telemetry/history queries should use:

- time ranges
- pagination
- partitioning strategy if scale requires it
- aggregation tables/materialized views if justified

Do not prematurely over-engineer partitioning for local development.

---

# 50. API OPTIMIZATION

Use:

- cursor pagination where useful
- normal pagination for manageable datasets
- field selection where appropriate
- response compression
- caching
- ETags where appropriate
- request deduplication
- debouncing
- batching
- consistent error formats

API responses should not return entire vehicle objects when only:

```text
vehicleId
name
status
location
```

is required.

---

# 51. AI PERFORMANCE OPTIMIZATION

Reduce Gemini cost/latency by:

- using concise tool outputs
- caching safe repeated tool results
- avoiding duplicate tool calls
- aggregating fleet queries
- setting token budgets
- using deterministic backend calculations before Gemini
- sending only necessary context
- using short-lived cache for repeated dashboard questions
- limiting tool execution loops
- using model routing where appropriate

Never cache a sensitive AI answer under a key that could be returned to another tenant/user.

Cache key must include appropriate authorization/tenant scope.

---

# 52. MEDIA / VIDEO OPTIMIZATION

Live video should NOT be routed through PostgreSQL.

Use:

```text
Phone/YC06
 ↓
Video Gateway
 ↓
WebRTC or appropriate streaming architecture
 ↓
Browser
```

Store metadata separately.

Use adaptive/appropriate video quality where supported.

Do not load full-resolution recordings into normal dashboard pages.

Use thumbnails/previews.

---

# 53. DEVICE TELEMETRY OPTIMIZATION

Devices may send frequent updates.

Implement:

- configurable reporting intervals
- batching where safe
- compression where supported
- deduplication
- heartbeat
- offline buffering
- reconnect handling
- exponential backoff
- device authentication
- per-device rate limits

Redis stores latest state.

PostgreSQL stores history.

---

# 54. OFFLINE / NETWORK RESILIENCE

Devices and frontend should tolerate temporary network failure.

Device:

```text
ONLINE
↓
NETWORK LOST
↓
BUFFER LOCALLY
↓
RECONNECT
↓
RESEND
```

Use event IDs/idempotency to avoid duplicate records.

Frontend:

- show last known state
- show stale indicator
- retry requests
- avoid infinite retry loops

---

# 55. PERFORMANCE MONITORING

Track:

Frontend:

```text
page load
route transition
API latency
JS errors
render performance
map performance
WebSocket health
```

Backend:

```text
request latency
error rate
throughput
DB query time
Redis latency
cache hit rate
queue delay
worker failures
```

Realtime:

```text
connected devices
connected WebSockets
messages/sec
dropped events
stale devices
```

AI:

```text
latency
token usage
cost
tool calls
failures
voice latency
```

---

# 56. OBSERVABILITY

Use the existing logging/monitoring architecture.

Every important operation should have structured logs.

Include:

```text
requestId
tenantId
userId where appropriate
vehicleId where appropriate
deviceId where appropriate
operation
duration
status
errorCode
```

Never log:

- passwords
- API keys
- raw financial credentials
- unnecessary licence data
- sensitive QR payloads

---

# 57. DATABASE MODELS

Inspect the existing schema first.

Potential new entities only if absent:

```text
VehicleLoan
LoanInstallment
LoanPayment
VehicleQRToken
QRPrivacyPolicy
QRScanEvent
VehicleSubscriptionTopUp
UserViewPreference
Device
DeviceVehicleAssignment
```

Service history should reuse the existing model.

All migrations:

- additive
- safe
- tenant-aware
- indexed
- backward-compatible
- non-destructive

---

# 58. PROVIDER ABSTRACTIONS

Maintain or implement:

```text
RCProvider
LoanProvider
ServiceHistoryProvider
FuelProvider
FastagProvider
TollProvider
PlacesProvider
MapProvider
DeviceProvider
VideoProvider
AIProvider
NotificationProvider
PaymentProvider
```

Each provider should normalize into Saarthi's internal format.

Provider-specific data must not leak into frontend components.

---

# 59. BACKGROUND JOBS

Reuse existing queue architecture.

Potential jobs:

```text
loan:sync
loan:emi-reminder
loan:overdue-check

service:sync
service:due-check

subscription:capacity-check
subscription:topup-renewal

qr:token-rotation
qr:scan-abuse-check

device:heartbeat-check
device:offline-detection
telemetry:persistence

ai:daily-fleet-brief
ai:scheduled-insight

cache:warm
cache:invalidate
```

Use Redis-backed locks/idempotency where required.

---

# 60. NOTIFICATIONS

Channels where already supported:

- in-app
- push
- email
- SMS
- WhatsApp/provider integration where available

Use role-aware notification rules.

Example EMI:

```text
T-4:
In-app + configured channel

T-1:
In-app

Overdue:
In-app + configured escalation
```

SOS should be higher priority.

---

# 61. SECURITY

Mandatory:

- authentication
- RBAC
- tenant isolation
- backend authorization
- device authentication
- signed QR tokens
- token rotation
- rate limiting
- encryption in transit
- appropriate encryption at rest
- audit logging
- secure secrets
- API validation
- input sanitization
- idempotency
- CSRF protection where applicable
- secure headers
- dependency/security scanning

Sensitive categories:

```text
Driving licence = sensitive identity data
Loan = sensitive financial data
Owner data = private
Device credentials = secret
AI context = authorization-sensitive
```

---

# 62. ROLE-AWARE EXPERIENCE

## Fleet Owner

Full authorized fleet intelligence.

## Fleet Manager

Operational fleet intelligence according to permissions.

## Driver

Only assigned vehicle/trip/driver-related information.

## Customer

Only explicitly shared order/trip/booking information.

## Truck Association

Emergency/operational information only.

## Taxi Operator

Vehicles, drivers, tours, packages, bookings.

## Travel Operator

Packages, schedules, vehicles, drivers, bookings.

## Admin

Platform administration according to existing RBAC.

Never solve permissions by hiding buttons only. Backend must enforce.

---

# 63. MARKETING SITE

Marketing site must be responsive and modern.

Required:

- animated hero where appropriate
- interactive feature sections
- responsive pricing
- mobile navigation
- polished login/register links
- modern registration/login UX
- splash/loading experience where appropriate
- optimized images
- accessible animations
- reduced-motion support

Do not make animations excessive.

Pricing:

```text
1 Vehicle
5 Vehicles
20 Vehicles
50 Vehicles
+1 Vehicle Top-Up
```

Marketing content must match actual product entitlements.

---

# 64. LOCAL TEST DATA

Provide realistic mock data for:

- trucks
- cars
- drivers
- customers
- trips
- orders
- service records
- loans
- EMI schedules
- fuel
- toll
- FASTag
- SOS
- incidents
- telemetry
- camera streams
- travel packages
- bookings
- subscriptions

Use a clear `SIMULATED` source marker.

---

# 65. TESTING REQUIREMENTS

## QR

- generate
- scan
- expiration
- revocation
- masking
- privacy
- authorization
- tenant isolation
- audit

## Loans

- create
- schedule
- reminders
- overdue
- provider sync
- failures
- masking
- authorization

## Service

- create
- update
- external retrieval
- save
- source
- verification
- conflict
- timeline
- documents

## AI

- tool authorization
- RBAC
- tenant isolation
- correct tool output
- no hallucinated numbers
- provenance
- cost tracking
- caching safety
- fleet intelligence
- vehicle intelligence
- service intelligence
- loan intelligence
- driver intelligence
- fuel/toll
- anomaly explanation
- document extraction
- voice
- daily brief

## Redis

- cache hit
- cache miss
- invalidation
- TTL
- Pub/Sub
- rate limits
- distributed locks
- idempotency
- failure/reconnect

## Performance

- large fleet table
- large fleet map
- realtime updates
- concurrent devices
- API load
- database query performance
- Redis performance
- WebSocket performance
- AI latency
- low-end mobile browser

## Subscription

- 1
- 5
- 20
- 50
- top-up
- multiple top-ups
- upgrade
- cancellation
- renewal
- billing failure
- capacity enforcement

---

# 66. DEFINITION OF DONE

A feature is NOT complete when a UI exists.

It is complete only when:

```text
Repository Analysis
↓
Architecture Reconciliation
↓
Database
↓
Backend
↓
Provider / Mock
↓
Business Logic
↓
RBAC
↓
Redis / Cache
↓
Queues / Jobs
↓
Realtime
↓
Frontend
↓
Marketing
↓
Gemini Tools
↓
Notifications
↓
Tests
↓
Performance Verification
↓
Local End-to-End Verification
```

Claude's completion report must include:

- files changed
- database migrations
- endpoints
- services
- providers
- components
- Redis keys
- cache strategy
- invalidation strategy
- queues/jobs
- WebSocket channels
- RBAC changes
- entitlement changes
- AI tools
- Gemini flows
- notifications
- tests
- performance tests
- known limitations
- production migration requirements
- deferred resale status

---

# 67. PRODUCTION MIGRATION REQUIREMENT

The current project is local-first, but the architecture must be production-ready.

When the user later says:

> "Move Saarthi to production."

Claude must NOT rebuild the project.

It should create a production migration plan covering:

```text
Local PostgreSQL
→ Managed PostgreSQL

Local Redis
→ Managed Redis

Local object/media storage
→ Production object storage

Local WebSocket
→ Scaled realtime gateway

Mock providers
→ Real providers

Mock AI
→ Gemini production configuration

Mock hardware
→ Freematics + YC06

Local video
→ Production video infrastructure

Local secrets
→ Production secret manager

Local monitoring
→ Production observability

Local domain
→ Production domain + HTTPS
```

The codebase should already use environment/configuration abstractions so this migration is configuration/infrastructure work rather than a rewrite.

---

# 68. FINAL ARCHITECTURE

```text
                         SAARTHI
                            │
              ┌─────────────┴─────────────┐
              │                           │
          React/TS                    Mobile/Device
              │                           │
          Tailwind                   Phone / Hardware
              │                           │
              └─────────────┬─────────────┘
                            │
                       Node.js API
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
       REST API         WebSocket          Device Gateway
          │                 │                  │
          │              Redis Pub/Sub         │
          │                 │                  │
          └────────────┬────┴──────┬───────────┘
                       │           │
                    Redis       Workers
                       │           │
                       └─────┬─────┘
                             │
                         PostgreSQL
                             │
          ┌──────────────────┼───────────────────┐
          │                  │                   │
       Providers          Gemini AI          Media/Video
          │                  │                   │
   RC/Loan/Service      Tool Registry          WebRTC
   Fuel/FASTag/Toll     Voice/Live             Storage
   Maps/Places           Analytics
          │                  │
          └──────────────────┼───────────────────┘
                             │
                       Saarthi UI
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
        Fleet             Vehicle             AI
          │                  │                  │
       Drivers           Passport           Gemini
       Orders            QR/Privacy          Voice
       Trips             Service             Insights
       Customers         Loan
       Suppliers         Telemetry
                         Hardware
```

---

# 69. FINAL CURRENT PRODUCT TREE

```text
SAARTHI
│
├── LOGISTICS
│   ├── Fleet
│   ├── Vehicles
│   ├── Drivers
│   ├── Customers
│   ├── Orders
│   ├── Trips
│   ├── Suppliers
│   └── Return Loads
│
├── VEHICLE INTELLIGENCE
│   ├── Vehicle Passport
│   ├── RC
│   ├── Documents
│   ├── Driver Assignment
│   ├── QR Identity
│   ├── QR Privacy
│   ├── Maintenance
│   ├── Service History
│   ├── Loan & EMI
│   ├── Fuel
│   ├── FASTag
│   ├── Toll
│   ├── Telemetry
│   ├── Hardware
│   ├── Incidents
│   └── Analytics
│
├── MOBILITY
│   ├── Taxi
│   ├── Travel
│   ├── Tours
│   └── Bookings
│
├── SAFETY
│   ├── SOS
│   ├── Truck Associations
│   ├── Incidents
│   └── Nearby Assistance
│
├── HARDWARE
│   ├── Phone Test Device
│   ├── Freematics ONE+ H
│   ├── YC06
│   ├── Device Registry
│   ├── Device-Vehicle Assignment
│   ├── Telemetry
│   └── Live Video
│
├── GEMINI AI
│   ├── Fleet Intelligence
│   ├── Vehicle Intelligence
│   ├── Service Intelligence
│   ├── Loan Intelligence
│   ├── Fuel Intelligence
│   ├── Toll Intelligence
│   ├── Route Intelligence
│   ├── Driver Coaching
│   ├── Anomaly Intelligence
│   ├── Document Intelligence
│   ├── QR Intelligence
│   ├── Subscription Intelligence
│   ├── Natural-Language Analytics
│   ├── Daily Fleet Brief
│   ├── Gemini Voice/Live
│   └── AI Provenance
│
├── SUBSCRIPTIONS
│   ├── 1 Vehicle
│   ├── 5 Vehicles
│   ├── 20 Vehicles
│   ├── 50 Vehicles
│   └── +1 Vehicle Top-Up
│
├── INFRASTRUCTURE
│   ├── PostgreSQL
│   ├── Redis
│   ├── WebSocket
│   ├── Queues
│   ├── Workers
│   ├── Caching
│   ├── Rate Limiting
│   ├── Observability
│   └── Performance Optimization
│
└── UX
    ├── Table/Card Toggle
    ├── Responsive UI
    ├── Interactive Dashboards
    ├── Mobile Optimization
    ├── Map Optimization
    ├── Secure QR
    └── Role-Aware Experiences

DEFERRED
└── Vehicle / Truck Resale Marketplace
```

# END OF SAARTHI COMPLETE CURRENT PRODUCT & FEATURE IMPLEMENTATION SPECIFICATION
