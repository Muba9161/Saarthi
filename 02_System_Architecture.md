# Saarthi — System Architecture & Technical Specification

**Document:** `02_System_Architecture.md`  
**Version:** 1.0  
**Project:** Saarthi  
**Purpose:** Technical blueprint for building Saarthi locally first while preserving a clean path to production.

---

# 1. Architecture Goals

Saarthi must be:

- Modular
- Secure
- Testable
- Observable
- Real-time capable
- Local-first
- Production-ready by design
- Provider-agnostic where external services may change
- Role-aware
- Subscription-aware
- API-driven
- Maintainable by AI coding agents

The local environment must provide complete end-to-end functionality without requiring paid cloud services.

---

# 2. Technology Stack

Saarthi will use the following technology stack for the initial local implementation and future production deployment.

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- React Router
- TanStack Query
- React Hook Form
- Zod

### Frontend Responsibilities

- Role-based dashboards
- Fleet management
- Driver application
- Customer marketplace
- Supplier marketplace
- Live maps
- Trip tracking
- SOS interface
- Document management
- Analytics
- Subscription UI
- AI interfaces

---

## Backend

- Node.js
- TypeScript
- Fastify
- REST API
- WebSockets
- Zod
- JWT / secure session authentication

### Backend Responsibilities

- Authentication
- Authorization
- RBAC
- Tenant isolation
- Fleet management
- Drivers
- Trucks
- Orders
- Trips
- Tracking
- Documents
- Verification
- SOS
- Notifications
- Subscriptions
- Analytics
- AI services

---

## Database

- PostgreSQL
- Prisma ORM
- SQL
- Redis

### PostgreSQL

PostgreSQL is the primary source of truth for Saarthi's relational data.

Prisma will be used for:

- Schema management
- Type-safe database access
- Migrations
- Relations
- Transactions

Redis may be used for:

- Caching
- Realtime state
- Rate limiting
- Temporary location data
- Background job coordination

---

## Realtime

- WebSockets
- Redis where required for scaling
- Event-driven architecture

Realtime functionality includes:

- Truck movement
- Trip updates
- SOS events
- Notifications
- Order updates
- Admin events

---

## Maps

Saarthi must use a provider-independent map abstraction.

The application should support:

- 2D maps
- 3D maps
- Routing
- Geocoding
- Reverse geocoding
- Nearby places
- Distance calculation
- Traffic information

Possible providers include:

- Mapbox
- MapLibre
- Other compatible providers

The provider must never be tightly coupled to business logic.

---

## GPS

### Local

- Mock GPS Simulator

### Production

- Real GPS tracking devices
- GPS provider APIs
- Device-direct integrations where supported

Both local and production GPS systems must use the same normalized tracking interface.

---

## Background Jobs

- BullMQ
- Redis

Background jobs may handle:

- Document expiry alerts
- Notifications
- Trip processing
- Analytics aggregation
- Maintenance reminders
- SOS escalation
- Scheduled tasks

---

## Forms & Validation

- React Hook Form
- Zod

Validation must exist on both:

- Frontend
- Backend

Frontend validation must never replace backend validation.

---

## Data Fetching

- TanStack Query

Use TanStack Query for:

- API requests
- Server-state management
- Caching
- Refetching
- Mutation handling
- Loading/error states

---

## UI System

- Tailwind CSS
- shadcn/ui
- Accessible reusable components

The UI should be:

- Modern
- Premium
- Professional
- Enterprise-grade
- Responsive
- Accessible
- Mobile-friendly

---

## Charts & Analytics

Use a suitable TypeScript-compatible charting library such as:

- Recharts
- Apache ECharts

The final library should be selected based on actual project requirements.

---

## Testing

### Unit / Integration

- Vitest
- Backend API testing

### End-to-End

- Playwright

Testing must cover:

- Authentication
- RBAC
- Tenant isolation
- Fleet
- Drivers
- Trucks
- Documents
- Orders
- Trips
- Tracking
- SOS
- Subscriptions
- Customer marketplace

---

## Development Environment

- Docker
- Docker Compose
- Node.js
- PostgreSQL
- Redis

The complete Saarthi application must be runnable locally without requiring production infrastructure.

---

## Production Infrastructure

Production implementations may use:

- Managed PostgreSQL
- Redis
- Object storage
- Real GPS providers
- Production map provider
- Email/SMS/push providers
- Payment gateway
- AI provider
- Monitoring
- Logging
- HTTPS
- CI/CD

The architecture must allow these services to replace local/mock implementations without rewriting the core business logic.

---

# 3. High-Level Architecture

```text
                    ┌────────────────────────┐
                    │       React App        │
                    │       TypeScript       │
                    └───────────┬────────────┘
                                │
                         HTTPS / REST
                                │
                    ┌───────────▼────────────┐
                    │     Node.js API        │
                    │ Auth / RBAC / Domain   │
                    └───────┬───────┬────────┘
                            │       │
                    ┌───────▼───┐ ┌─▼────────────┐
                    │ PostgreSQL│ │ Realtime      │
                    │           │ │ WebSockets    │
                    └───────────┘ └──────┬────────┘
                                         │
                         ┌───────────────┼──────────────┐
                         │               │              │
                    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
                    │ GPS     │    │ SOS      │    │ Alerts  │
                    │Simulator│    │ Engine   │    │ Engine  │
                    └─────────┘    └─────────┘    └─────────┘

                    Future Production Integrations
                    ──────────────────────────────
                    GPS Devices
                    Maps
                    Object Storage
                    Notifications
                    AI Provider
                    Payment Provider
```

---

# 4. Monorepo Structure

Recommended structure:

```text
saarthi/
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── shared/
│   ├── types/
│   ├── validation/
│   ├── config/
│   ├── api-client/
│   ├── ui/
│   └── domain/
│
├── infrastructure/
│   ├── docker/
│   ├── database/
│   └── deployment/
│
├── docs/
│
├── scripts/
│
├── tests/
│
├── .env.example
├── docker-compose.yml
├── package.json
└── README.md
```

A simpler two-application repository is acceptable if the monorepo introduces unnecessary complexity. Do not sacrifice maintainability merely to follow the structure literally.

---

# 5. Frontend Architecture

Recommended:

```text
apps/web/src/
├── app/
│   ├── router/
│   ├── providers/
│   └── config/
│
├── components/
│   ├── common/
│   ├── forms/
│   ├── maps/
│   ├── tables/
│   └── charts/
│
├── features/
│   ├── auth/
│   ├── verification/
│   ├── fleet/
│   ├── trucks/
│   ├── drivers/
│   ├── documents/
│   ├── orders/
│   ├── trips/
│   ├── tracking/
│   ├── sos/
│   ├── nearby/
│   ├── maintenance/
│   ├── subscriptions/
│   ├── analytics/
│   └── ai/
│
├── layouts/
├── pages/
├── hooks/
├── services/
├── lib/
├── types/
└── styles/
```

Each feature should own its UI, API hooks, types, validation, and domain-specific utilities where practical.

---

# 6. Backend Architecture

Recommended:

```text
apps/api/src/
├── config/
├── server/
├── middleware/
├── auth/
├── modules/
│   ├── users/
│   ├── verification/
│   ├── organizations/
│   ├── trucks/
│   ├── drivers/
│   ├── documents/
│   ├── suppliers/
│   ├── customers/
│   ├── materials/
│   ├── orders/
│   ├── trips/
│   ├── tracking/
│   ├── nearby/
│   ├── sos/
│   ├── maintenance/
│   ├── scoring/
│   ├── notifications/
│   ├── subscriptions/
│   ├── analytics/
│   ├── ai/
│   └── admin/
│
├── database/
├── events/
├── jobs/
├── integrations/
├── storage/
├── realtime/
├── utils/
└── tests/
```

Avoid a giant controller file.

Business rules belong in domain/service layers.

---

# 7. Core Domain Model

The major entities are:

```text
User
Role
Organization
Membership
VerificationCase
Document
DocumentVersion

Truck
TruckAssignment
TruckLocation
TruckEvent

Driver
DriverScore
DriverScoreEvent
DriverAchievement

Supplier
Material
Customer

Order
OrderItem
Trip
TripEvent
TripStop

MaintenanceRecord
FuelRecord

NearbyPlace
SOSIncident
SOSResponder
SOSEvent

Notification
NotificationPreference

SubscriptionPlan
Subscription
FeatureEntitlement

AuditLog
AIConversation
AIInsight
```

---

# 8. User & Role Model

Use a role-based permission system.

Recommended roles:

```text
PLATFORM_ADMIN
FLEET_OWNER
FLEET_MANAGER
DRIVER
SUPPLIER
CUSTOMER
DISPATCHER
SUPPORT_AGENT
```

Do not rely only on a single role string if the product eventually supports multiple memberships.

A user may belong to an organization.

---

# 9. Organization Model

An organization represents a business/fleet/supplier entity.

Example:

```text
Organization
- id
- name
- type
- registrationNumber
- phone
- email
- address
- verificationStatus
- createdAt
- updatedAt
```

Types:

- FLEET_OWNER
- SUPPLIER
- CUSTOMER
- ENTERPRISE

---

# 10. Database Design

Use UUIDs or another robust non-sequential identifier strategy.

Every major table should have:

- id
- createdAt
- updatedAt

Use soft deletion only where business/audit requirements justify it.

Never use database deletion casually for records that must remain auditable.

---

# 11. User Tables

## users

```text
id
email
phone
passwordHash
firstName
lastName
avatarUrl
status
lastLoginAt
createdAt
updatedAt
```

Possible statuses:

- ACTIVE
- PENDING
- SUSPENDED
- DISABLED

## roles

```text
id
name
```

## user_roles

```text
userId
roleId
```

## memberships

```text
id
userId
organizationId
role
status
createdAt
```

---

# 12. Verification Tables

## verification_cases

```text
id
subjectType
subjectId
verificationType
status
reviewedBy
reviewedAt
rejectionReason
createdAt
updatedAt
```

## verification_documents

```text
id
verificationCaseId
documentId
```

Verification should be a workflow, not a boolean field.

---

# 13. Document Tables

## documents

```text
id
ownerType
ownerId
documentType
documentNumber
issueDate
expiryDate
storageKey
mimeType
fileSize
verificationStatus
uploadedBy
createdAt
updatedAt
```

## document_versions

```text
id
documentId
versionNumber
storageKey
uploadedBy
createdAt
```

Document types should be configurable.

---

# 14. Truck Tables

## trucks

```text
id
organizationId
registrationNumber
truckType
manufacturer
model
year
capacity
fuelType
status
verificationStatus
currentDriverId
createdAt
updatedAt
```

## truck_assignments

```text
id
truckId
driverId
assignedAt
unassignedAt
status
```

## truck_locations

```text
id
truckId
latitude
longitude
speed
heading
accuracy
source
timestamp
```

Use indexing suitable for location/time queries.

---

# 15. Driver Tables

## drivers

```text
id
userId
licenseNumber
licenseExpiryDate
experienceYears
emergencyContact
verificationStatus
currentTruckId
createdAt
updatedAt
```

## driver_scores

```text
id
driverId
overallScore
safetyScore
reliabilityScore
timelinessScore
complianceScore
vehicleCareScore
calculatedAt
```

## driver_score_events

```text
id
driverId
category
points
reason
sourceType
sourceId
createdAt
```

Every score change should be explainable.

---

# 16. Supplier & Material Tables

## suppliers

```text
id
organizationId
verificationStatus
businessDescription
createdAt
updatedAt
```

## materials

```text
id
supplierId
name
description
unit
price
availableQuantity
status
createdAt
updatedAt
```

---

# 17. Customer Tables

Customers may be represented through organizations or individual users.

Support:

```text
customers
- id
- organizationId
- userId
- verificationStatus
```

Do not unnecessarily duplicate customer identity data.

---

# 18. Order Tables

## orders

```text
id
customerId
supplierId
materialId
quantity
unit
price
originAddress
originLatitude
originLongitude
destinationAddress
destinationLatitude
destinationLongitude
status
assignedTruckId
assignedDriverId
tripId
createdAt
updatedAt
```

## order_events

```text
id
orderId
type
description
metadata
createdAt
```

---

# 19. Trip Tables

## trips

```text
id
orderId
truckId
driverId
origin
destination
plannedDistance
actualDistance
plannedDuration
actualDuration
plannedStartAt
actualStartAt
plannedArrivalAt
actualArrivalAt
status
price
createdAt
updatedAt
```

## trip_events

```text
id
tripId
type
latitude
longitude
metadata
createdAt
```

## trip_stops

```text
id
tripId
type
name
latitude
longitude
plannedArrival
actualArrival
status
```

---

# 20. Maintenance Tables

## maintenance_records

```text
id
truckId
type
description
odometer
cost
scheduledAt
completedAt
status
serviceProvider
createdAt
updatedAt
```

## fuel_records

```text
id
truckId
tripId
quantity
price
totalCost
odometer
stationName
latitude
longitude
recordedAt
```

---

# 21. SOS Data Model

## sos_incidents

```text
id
driverId
truckId
tripId
type
latitude
longitude
status
description
triggeredAt
resolvedAt
```

## sos_responders

```text
id
incidentId
truckId
driverId
distance
status
notifiedAt
acknowledgedAt
arrivedAt
```

## sos_events

```text
id
incidentId
eventType
actorId
metadata
createdAt
```

---

# 22. Notification Model

## notifications

```text
id
userId
type
title
body
priority
data
readAt
createdAt
```

## notification_preferences

```text
id
userId
channel
eventType
enabled
```

---

# 23. Subscription Model

## subscription_plans

```text
id
name
description
priceMonthly
priceYearly
active
```

## features

```text
id
key
description
```

## plan_features

```text
planId
featureId
limits
```

## subscriptions

```text
id
organizationId
planId
status
startsAt
endsAt
```

Backend entitlement checks should resolve:

```text
organization → subscription → plan → feature → entitlement
```

---

# 24. Audit Model

## audit_logs

```text
id
actorUserId
organizationId
action
entityType
entityId
beforeData
afterData
ipAddress
userAgent
createdAt
```

Do not store sensitive secrets in audit logs.

---

# 25. API Design

Use versioned APIs.

Example:

```text
/api/v1/auth
/api/v1/users
/api/v1/organizations
/api/v1/trucks
/api/v1/drivers
/api/v1/documents
/api/v1/orders
/api/v1/trips
/api/v1/tracking
/api/v1/sos
/api/v1/notifications
/api/v1/subscriptions
/api/v1/analytics
/api/v1/ai
```

---

# 26. Authentication APIs

Examples:

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Use secure session/token handling.

Never return password hashes.

---

# 27. Truck APIs

Examples:

```text
GET    /api/v1/trucks
POST   /api/v1/trucks
GET    /api/v1/trucks/:id
PATCH  /api/v1/trucks/:id
DELETE /api/v1/trucks/:id

GET    /api/v1/trucks/:id/documents
GET    /api/v1/trucks/:id/location
GET    /api/v1/trucks/:id/trips
GET    /api/v1/trucks/:id/maintenance
GET    /api/v1/trucks/:id/history
```

---

# 28. Driver APIs

```text
GET   /api/v1/drivers
POST  /api/v1/drivers
GET   /api/v1/drivers/:id
PATCH /api/v1/drivers/:id

GET   /api/v1/drivers/:id/score
GET   /api/v1/drivers/:id/achievements
GET   /api/v1/drivers/:id/documents
GET   /api/v1/drivers/:id/trips
```

---

# 29. Order & Trip APIs

```text
POST /api/v1/orders
GET  /api/v1/orders
GET  /api/v1/orders/:id
PATCH /api/v1/orders/:id

POST /api/v1/trips
GET  /api/v1/trips
GET  /api/v1/trips/:id
POST /api/v1/trips/:id/start
POST /api/v1/trips/:id/pause
POST /api/v1/trips/:id/resume
POST /api/v1/trips/:id/complete
```

State transitions must be validated on the backend.

---

# 30. Tracking API

Production-normalized location ingestion should use a provider-independent format.

Example:

```text
POST /api/v1/tracking/locations
```

Payload concept:

```json
{
  "truckId": "uuid",
  "latitude": 28.6139,
  "longitude": 77.209,
  "speed": 42.5,
  "heading": 90,
  "accuracy": 8,
  "timestamp": "2026-08-15T10:00:00Z",
  "source": "mock"
}
```

The backend must validate all fields.

---

# 31. Tracking Event Pipeline

```text
GPS Source
   ↓
Tracking Adapter
   ↓
Normalized Location Event
   ↓
Validation
   ↓
Persistence
   ↓
Realtime Publisher
   ↓
WebSocket Clients
   ↓
Owner Dashboard
Driver Dashboard
Admin Dashboard
```

The same pipeline should work for:

```text
MOCK
GPS_PROVIDER_A
GPS_PROVIDER_B
DEVICE_DIRECT
```

---

# 32. Mock GPS Simulator

The simulator is a critical local feature.

## Simulator architecture

```text
Simulation Configuration
        ↓
Route Generator
        ↓
Position Calculator
        ↓
Speed/Heading Generator
        ↓
Tracking Adapter
        ↓
Tracking API/Event Bus
        ↓
Realtime Updates
```

## Simulator controls

Admin should be able to:

- Select truck
- Select trip
- Select route
- Start
- Pause
- Resume
- Stop
- Reset
- Set speed
- Set simulation multiplier
- Add random stops
- Add delays
- Trigger route deviation
- Trigger emergency
- Replay trip

---

# 33. Simulation Speed

For demos, allow accelerated time.

Example:

```text
1x
2x
5x
10x
25x
50x
100x
```

The UI should clearly indicate that the truck is simulated.

Never allow simulated location to be mistaken for real production GPS.

---

# 34. Route Simulation

A simulation route can be represented as:

```text
[
  { lat, lng },
  { lat, lng },
  { lat, lng }
]
```

The simulator interpolates positions between points.

For realistic behavior:

- Vary speed
- Calculate heading
- Add pauses
- Add minor location noise
- Respect route order
- Emit timestamps
- Detect route deviation

---

# 35. WebSocket Architecture

Use WebSockets for:

- Truck movement
- Trip updates
- SOS updates
- Notifications
- Order updates
- Admin events

Example channels:

```text
fleet:{organizationId}
truck:{truckId}
trip:{tripId}
sos:{incidentId}
user:{userId}
```

Authorization must occur before joining private channels.

Never expose another organization's private fleet stream.

---

# 36. Map Provider Abstraction

Create an internal interface such as:

```text
MapProvider
├── renderMap()
├── geocode()
├── reverseGeocode()
├── route()
├── nearbySearch()
├── distanceMatrix()
└── trafficInfo()
```

The frontend should use a Saarthi map service rather than hard-coding provider-specific logic throughout components.

---

# 37. Nearby Services Architecture

Nearby search should accept:

```text
latitude
longitude
category
radius
```

Categories:

```text
fuel
food
parking
workshop
hospital
pharmacy
police
rest_area
tyre_shop
charging
other
```

For local development, use mock nearby data if no external map API is configured.

---

# 38. SOS Matching Algorithm

Basic local algorithm:

1. Find active trucks with recent location updates.
2. Calculate distance from incident.
3. Filter trucks within configured radius.
4. Exclude unavailable/suspended trucks.
5. Rank by distance and availability.
6. Notify nearest eligible responders.
7. Expand search radius if required.

Example:

```text
Radius 1: 5 km
Radius 2: 10 km
Radius 3: 25 km
```

Production behavior should be configurable.

---

# 39. Driver Scoring Architecture

Scoring must be event-driven.

Example events:

```text
TRIP_COMPLETED_ON_TIME
TRIP_COMPLETED_LATE
SPEED_VIOLATION
HARSH_BRAKING
HARSH_ACCELERATION
ROUTE_DEVIATION
DOCUMENT_EXPIRED
CUSTOMER_POSITIVE_RATING
CUSTOMER_NEGATIVE_RATING
INCIDENT
VEHICLE_CARE_EVENT
```

Each event produces a configurable score effect.

Do not hard-code score calculations into UI components.

---

# 40. Score Calculation

Example:

```text
Overall Score =
  Safety × 0.30
+ Reliability × 0.20
+ Timeliness × 0.20
+ Compliance × 0.15
+ Vehicle Care × 0.15
```

Weights must be configuration-driven.

The exact production scoring formula should be validated with real operational data.

---

# 41. AI Architecture

AI should sit behind an internal service interface.

```text
AIService
├── chat()
├── summarize()
├── recommend()
├── explain()
├── classify()
└── predict()
```

This allows future providers to be changed without changing business logic.

---

# 42. AI Permission Boundary

Before sending information to an AI model:

1. Authenticate user.
2. Resolve organization.
3. Resolve role.
4. Resolve permissions.
5. Retrieve only authorized records.
6. Minimize sensitive information.
7. Build structured context.
8. Send context to AI provider.
9. Validate response.
10. Return response.

Never give the AI unrestricted database access.

---

# 43. AI Fleet Copilot

Example request:

> Which trucks need attention today?

Backend process:

```text
User
 ↓
Permission Check
 ↓
Fleet Query
 ↓
Risk/Alert Aggregation
 ↓
Structured Context
 ↓
AI
 ↓
Validated Explanation
 ↓
UI
```

The AI response should include source records/links where practical.

---

# 44. AI Output Types

Support:

- Summary
- Recommendation
- Warning
- Forecast
- Explanation
- Action suggestion

Avoid allowing AI to directly perform destructive operations.

For sensitive actions, require explicit confirmation.

---

# 45. Document Intelligence

Future document AI may:

- Extract metadata
- Detect document type
- Read expiry date
- Identify missing information
- Flag suspicious inconsistencies
- Assist verification

AI extraction must remain an assistance layer until verified.

---

# 46. Background Jobs

Use a job abstraction for:

- Document expiry checks
- Notifications
- Score recalculation
- Analytics aggregation
- AI report generation
- Trip summaries
- Maintenance reminders
- Cleanup jobs

Local mode can use an in-process queue initially.

Production can move to Redis/managed queues without changing domain code.

---

# 47. Caching

Use caching selectively for:

- Dashboard aggregates
- Frequently requested fleet state
- Nearby searches
- Subscription entitlements
- Static configuration

Do not use cache as the source of truth for critical records.

PostgreSQL remains authoritative for transactional state.

---

# 48. File Storage Abstraction

Create:

```text
StorageProvider
├── upload()
├── download()
├── delete()
├── exists()
└── getSignedUrl()
```

Local implementation:

```text
LocalStorageProvider
```

Production implementation:

```text
ObjectStorageProvider
```

Potential production object storage can be configured later.

---

# 49. Notification Provider Abstraction

Create:

```text
NotificationProvider
├── sendInApp()
├── sendEmail()
├── sendSMS()
└── sendPush()
```

Local mode may use:

- Database notifications
- Console logs
- Local notification panel

Production providers can be added later.

---

# 50. Payment Provider Abstraction

Subscriptions should not directly depend on one payment provider.

Create:

```text
PaymentProvider
├── createCheckout()
├── verifyPayment()
├── cancelSubscription()
├── getSubscription()
└── handleWebhook()
```

Local mode can use simulated subscription activation.

Production can connect to an appropriate payment gateway.

---

# 51. Security Architecture

Required:

- Password hashing
- Secure authentication
- CSRF protection where applicable
- CORS configuration
- Request validation
- Rate limiting
- Authorization middleware
- File validation
- MIME/type checks
- File-size limits
- Secure document access
- SQL injection protection through ORM/parameterization
- XSS prevention
- Audit logging

Never trust frontend permission checks.

---

# 52. Multi-Tenant Data Isolation

Every organization-owned record must be scoped.

Example:

```text
organizationId
```

must be present where appropriate.

A user from Organization A must never be able to query Organization B's:

- Trucks
- Drivers
- Trips
- Orders
- Documents
- Locations
- Reports
- SOS data

Tenant isolation must be enforced server-side.

---

# 53. API Error Format

Use a consistent format.

Example:

```json
{
  "success": false,
  "error": {
    "code": "TRUCK_NOT_FOUND",
    "message": "The requested truck could not be found.",
    "details": {}
  }
}
```

Avoid exposing stack traces to clients.

---

# 54. Validation

Validate at multiple boundaries:

```text
Frontend validation
        +
Backend runtime validation
        +
Database constraints
```

Backend validation is mandatory.

---

# 55. Logging

Use structured logs.

Include:

- Timestamp
- Level
- Request ID
- User ID where appropriate
- Organization ID
- Module
- Action
- Error code

Never log:

- Passwords
- Authentication tokens
- Full sensitive identity documents
- Secrets

---

# 56. Testing Architecture

Minimum testing layers:

## Unit

Test:

- Scoring
- State transitions
- Distance calculations
- SOS ranking
- Entitlement logic
- Validation

## Integration

Test:

- Authentication
- Fleet operations
- Documents
- Orders
- Trips
- Tracking
- SOS

## End-to-End

Test complete flows:

```text
Register → Verify → Add Truck → Add Driver
→ Create Order → Create Trip → Start Simulator
→ Track Truck → Complete Trip → View History
```

---

# 57. Local Demo Seed

Provide a deterministic seed command.

Example:

```text
npm run db:seed
```

It should create:

- Admin
- Fleet owner
- Fleet manager
- Drivers
- Trucks
- Supplier
- Materials
- Customer
- Orders
- Trips
- Documents
- Locations
- Sample maintenance records
- Sample notifications
- Subscription plans

Seed credentials must be documented in local-only documentation and must never be reused in production.

---

# 58. Local Development Commands

The project should eventually expose simple commands such as:

```text
npm install
npm run dev
npm run db:migrate
npm run db:seed
npm run test
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

Exact package-manager commands may vary according to the final repository setup.

---

# 59. Environment Configuration

Use `.env.example`.

Typical configuration:

```text
NODE_ENV=development

DATABASE_URL=

JWT_SECRET=
SESSION_SECRET=

FRONTEND_URL=
API_URL=

MAP_PROVIDER=
MAP_API_KEY=

AI_PROVIDER=
AI_API_KEY=

STORAGE_PROVIDER=local

PAYMENT_PROVIDER=mock

GPS_PROVIDER=mock

REDIS_URL=
```

Secrets must never be committed.

---

# 60. Production Replacement Matrix

| Local | Production |
|---|---|
| PostgreSQL local | Managed PostgreSQL |
| Local file storage | Object storage |
| Mock GPS | GPS hardware/provider |
| Mock map data | Production map provider |
| Mock notifications | Email/SMS/Push provider |
| Mock payments | Payment gateway |
| Local AI/mock AI | Production AI provider |
| In-process jobs | Queue/worker infrastructure |
| Local WebSocket | Scalable realtime layer |
| Local logs | Centralized observability |

---

# 61. Production Migration Rules

Production migration should:

1. Create production environment.
2. Configure secrets.
3. Provision database.
4. Run migrations.
5. Configure storage.
6. Configure maps.
7. Configure GPS.
8. Configure notifications.
9. Configure payments.
10. Configure AI.
11. Configure realtime infrastructure.
12. Configure domain/HTTPS.
13. Configure monitoring.
14. Configure backups.
15. Run security checks.
16. Run production smoke tests.
17. Enable production subscriptions.
18. Disable demo/simulation capabilities unless explicitly authorized.

---

# 62. Demo Mode Security

Mock GPS and demo controls must be protected.

Recommended:

```text
DEMO_MODE=true
```

Local only.

Production should default to:

```text
DEMO_MODE=false
```

Production demo endpoints must not be exposed accidentally.

---

# 63. Data Lifecycle

Define retention policies for:

- GPS history
- Audit logs
- Documents
- Notifications
- AI conversations
- SOS events

Retention should be configurable and aligned with legal/business requirements.

---

# 64. Performance Targets

Initial local targets:

- Dashboard loads without unnecessary blocking requests.
- Tracking updates appear quickly.
- UI remains responsive with many simulated trucks.
- Pagination is used for large datasets.
- Database queries are indexed.
- Realtime subscriptions are scoped.

Production targets should be established after load testing.

Do not prematurely optimize without measurements.

---

# 65. Observability

Production should eventually include:

- Application logs
- API metrics
- Database metrics
- Error tracking
- WebSocket monitoring
- GPS ingestion monitoring
- Queue monitoring
- AI usage/cost monitoring
- Subscription/payment monitoring

Health endpoints:

```text
GET /health
GET /health/ready
GET /health/live
```

---

# 66. Disaster Recovery

Production should eventually support:

- Database backups
- Backup verification
- Document storage backups/versioning
- Recovery procedures
- Incident response documentation

Do not consider production ready until recovery has been tested.

---

# 67. Scalability Strategy

Scale in this order:

1. Optimize database queries.
2. Add indexes.
3. Cache high-read data.
4. Separate realtime workloads.
5. Introduce background workers.
6. Scale API horizontally.
7. Scale WebSocket infrastructure.
8. Partition/archive large tracking datasets if needed.

Do not introduce microservices merely for appearance.

Start as a modular monolith and split services only when operational scale justifies it.

---

# 68. Recommended Initial Architecture

The best initial implementation is:

```text
React + TypeScript
        ↓
Node.js + TypeScript
        ↓
Modular Monolith
        ↓
PostgreSQL
        ↓
WebSocket Realtime
        ↓
Mock GPS
```

This is sufficient for the first local milestone.

---

# 69. Future Service Boundaries

If Saarthi grows substantially, potential services include:

```text
Identity Service
Fleet Service
Trip Service
Tracking Service
Document Service
Notification Service
SOS Service
Analytics Service
AI Service
Billing Service
```

Do not split them into separate deployments until necessary.

Keep internal module boundaries clean from day one.

---

# 70. Final Architecture Rule

The most important architectural decision is:

> **Mock today, replace tomorrow — do not rebuild tomorrow.**

A mock GPS source must behave like a GPS source.

A local storage provider must behave like a storage provider.

A mock payment provider must behave like a payment provider.

A local notification system must behave like a notification system.

A development AI provider must behave like an AI provider.

This is what allows Saarthi to move from a local demonstration to a production product with controlled infrastructure changes rather than a complete rewrite.
