# Saarthi — Implementation Roadmap, Execution Rules & Production Migration

**Document:** `03_Implementation_Roadmap.md`  
**Version:** 1.0  
**Project:** Saarthi  
**Purpose:** Give Claude a precise execution plan for building Saarthi completely on a local PC first and later preparing the same codebase for production.

---

# 1. How Claude Must Use This Document

This document works together with:

- `01_Project_Vision.md`
- `02_System_Architecture.md`
- Existing project `CLAUDE.md`

Priority order:

1. Existing `CLAUDE.md`
2. `01_Project_Vision.md`
3. `02_System_Architecture.md`
4. This document
5. Explicit instructions from the user in the current conversation

If any instruction conflicts, follow the higher-priority instruction.

Claude must not silently remove or weaken a requirement because it is difficult.

If a feature cannot be implemented fully on the local machine because it requires a real external service, implement a **real local abstraction/simulation** that uses the same domain/API contract planned for production.

---

# 2. Core Development Philosophy

Saarthi must be built as a real product, not a visual prototype.

### Required

- Real database
- Real authentication
- Real authorization
- Real CRUD
- Real workflows
- Real validation
- Real document management
- Real trip state management
- Real tracking pipeline
- Real realtime updates
- Real notifications
- Real subscription entitlements
- Real analytics based on database data
- Real tests
- Real error handling

### Not acceptable

- Fake buttons that do nothing
- Hard-coded dashboard numbers
- Static JSON pretending to be a database
- Frontend-only authorization
- Mock APIs where local business logic can be implemented
- TODO placeholders for core features
- Empty pages created only to make navigation look complete

---

# 3. Development Strategy

Build Saarthi in vertical slices.

Do not build every frontend screen first and backend later.

For each major module:

```text
Database
→ Backend domain logic
→ API
→ Validation
→ Authorization
→ Frontend
→ Realtime/events if needed
→ Tests
→ Demo flow
```

A module is not considered complete until the entire slice works.

---

# 4. Phase 0 — Project Foundation

## Objectives

Create a clean development foundation.

### Tasks

- Initialize repository structure.
- Configure TypeScript.
- Configure frontend.
- Configure backend.
- Configure PostgreSQL.
- Configure ORM.
- Configure migrations.
- Configure environment variables.
- Create `.env.example`.
- Configure linting.
- Configure formatting.
- Configure type checking.
- Configure test framework.
- Configure Docker Compose if useful.
- Create README.
- Create local setup documentation.
- Create health endpoint.

### Acceptance Criteria

- Project installs successfully.
- Frontend starts locally.
- Backend starts locally.
- PostgreSQL connects.
- Migration runs.
- Seed infrastructure exists.
- Health endpoint works.
- TypeScript passes.
- Lint passes.
- Test runner works.

---

# 5. Phase 1 — Database Foundation

Implement:

- Users
- Roles
- Organizations
- Memberships
- Audit logs

Create proper migrations.

Add indexes for:

- Email
- Phone
- Organization
- Status
- Created timestamps

### Acceptance Criteria

A local database can be created from zero using migrations.

No manual database editing should be required.

---

# 6. Phase 2 — Authentication

Implement:

- Registration
- Login
- Logout
- Session/token handling
- Current-user endpoint
- Password hashing
- Password reset foundation
- Authentication middleware

### Security Requirements

- Never store plain passwords.
- Never expose password hashes.
- Validate credentials server-side.
- Rate-limit authentication endpoints.
- Protect authenticated APIs.

### Acceptance Criteria

A user can:

```text
Register
→ Login
→ Access dashboard
→ Refresh session
→ Logout
→ Lose protected access
```

---

# 7. Phase 3 — RBAC & Organization Access

Implement:

- Platform admin
- Fleet owner
- Fleet manager
- Driver
- Supplier
- Customer
- Dispatcher
- Support agent

Implement permission checks at backend level.

Example:

```text
fleet.trucks.read
fleet.trucks.create
fleet.trucks.update
fleet.trucks.delete

drivers.read
drivers.manage

documents.read
documents.upload
documents.verify

trips.read
trips.manage

sos.read
sos.respond
```

### Acceptance Criteria

A user cannot access another organization's private records.

Frontend hiding alone must never be considered authorization.

---

# 8. Phase 4 — Verification

Build a real local verification workflow.

### Driver

- Profile
- Driving licence
- Documents
- Verification submission

### Truck

- Registration
- RC-related information
- Insurance
- Fitness
- Permit
- Pollution certificate
- Configurable documents

### Owner/Supplier/Customer

Support configurable verification records.

### Admin

Admin must be able to:

- Review
- Approve
- Reject
- Request correction
- View document
- View history

### Acceptance Criteria

A complete verification cycle works locally.

---

# 9. Phase 5 — Document Management

Implement:

- Upload
- Download
- Preview where supported
- Metadata
- Versioning
- Verification status
- Expiry tracking
- Admin review
- Secure authorization

Build document expiry detection.

Statuses:

```text
VALID
EXPIRING_SOON
EXPIRED
PENDING_VERIFICATION
REJECTED
```

### Acceptance Criteria

Upload a document, verify it, change its expiry date, and see the correct status reflected across the relevant dashboard.

---

# 10. Phase 6 — Truck Management

Implement:

- Add truck
- Edit truck
- View truck
- Archive truck
- Assign driver
- Unassign driver
- Truck status
- Truck documents
- Truck history

Statuses:

```text
AVAILABLE
ASSIGNED
ON_TRIP
LOADING
UNLOADING
IDLE
MAINTENANCE
OFFLINE
EMERGENCY
SUSPENDED
```

### Acceptance Criteria

Fleet owner can manage trucks without touching the database manually.

---

# 11. Phase 7 — Driver Management

Implement:

- Driver profile
- Verification
- Documents
- Truck assignment
- Trip history
- Performance profile
- Score foundation
- Achievements foundation

### Acceptance Criteria

Owner can add a driver, verify the driver, assign a truck, and view the driver's complete operational profile.

---

# 12. Phase 8 — Supplier & Material Management

Implement:

- Supplier profile
- Supplier verification
- Material CRUD
- Price
- Quantity
- Availability
- Supplier dashboard

### Acceptance Criteria

A supplier can create a material listing that is visible to authorized customers.

---

# 13. Phase 9 — Customer Management

Implement:

- Customer registration
- Profile
- Verification
- Order history
- Active order tracking
- Supplier discovery
- Truck availability discovery

---

# 14. Phase 10 — Orders

Implement:

```text
REQUESTED
→ CONFIRMED
→ ASSIGNED
→ PICKUP
→ IN_TRANSIT
→ DELIVERED
→ COMPLETED
```

Also support:

```text
CANCELLED
FAILED
```

Implement:

- Order creation
- Material selection
- Quantity
- Pricing
- Origin
- Destination
- Truck assignment
- Driver assignment
- Order events

### Acceptance Criteria

A customer can create an order and an authorized fleet/supplier user can process it through the lifecycle.

---

# 15. Phase 11 — Trips

Implement:

```text
DRAFT
→ ASSIGNED
→ LOADING
→ STARTED
→ IN_TRANSIT
→ ARRIVED
→ UNLOADING
→ COMPLETED
```

Support:

```text
DELAYED
CANCELLED
EMERGENCY
SUSPENDED
```

Trip must connect:

```text
Order
Truck
Driver
Owner
Supplier
Customer
Route
Tracking
```

### Acceptance Criteria

A trip can be created and completed through the UI with persistent state.

---

# 16. Phase 12 — Map Foundation

Create a map provider abstraction.

Local development must work without a paid map provider.

If an API key is configured, use the configured provider.

If not configured, use a local/mock map mode where necessary.

Map must support:

- Markers
- Routes
- Origin
- Destination
- Current truck
- Stops
- Nearby places

---

# 17. Phase 13 — Mock GPS Engine

This is one of the most important local features.

Build an actual simulator.

### Admin Controls

```text
Select truck
Select trip
Select route
Start
Pause
Resume
Stop
Reset
Speed multiplier
Simulation speed
Add delay
Add stop
Trigger route deviation
Trigger SOS
```

### Simulator Output

```text
truckId
latitude
longitude
speed
heading
accuracy
timestamp
source
```

---

# 18. Phase 14 — Realtime Tracking

Implement WebSockets.

When simulator produces a location:

```text
Simulator
→ Tracking API/Event
→ Validation
→ Database
→ Realtime broadcast
→ Dashboard
```

The truck marker must visibly move without refreshing the page.

### Acceptance Criteria

Start one simulated truck and watch it move live from the owner dashboard.

Open another authorized dashboard and verify that it receives the same permitted tracking updates.

---

# 19. Phase 15 — Trip Replay

Store enough tracking information to replay completed trips.

Implement:

- Play
- Pause
- Resume
- Timeline
- Speed multiplier
- Route history

This should work from locally stored data.

---

# 20. Phase 16 — Nearby Services

Implement a provider abstraction.

Categories:

- Fuel
- Food/Dhaba
- Workshop
- Tyre shop
- Parking
- Hospital
- Pharmacy
- Police
- Rest area
- EV charging
- Other

Local mode can use seeded/mock POIs.

The UI should calculate distance from the current simulated truck.

---

# 21. Phase 17 — Nearby Saarthi Trucks

Implement:

- Nearby active trucks
- Distance
- Availability
- Direction
- Privacy-aware display

Do not expose unnecessary personal information.

---

# 22. Phase 18 — SOS System

Implement:

```text
Triggered
→ Broadcasting
→ Acknowledged
→ Help Assigned
→ Assistance Arrived
→ Resolved
```

SOS should capture:

- Driver
- Truck
- Trip
- Location
- Time
- Category
- Description

Implement nearby responder matching.

### Acceptance Criteria

A simulated driver triggers SOS.

The system identifies nearby eligible Saarthi trucks.

The selected responders receive realtime alerts.

Admin/owner can monitor the incident.

---

# 23. Phase 19 — Driver Scoring

Implement configurable scoring.

Initial categories:

- Safety
- Reliability
- Timeliness
- Compliance
- Vehicle care

Create event-based score changes.

Every score change must have a reason.

### Acceptance Criteria

Completing a simulated trip can produce score events and update the driver's score.

---

# 24. Phase 20 — Driver Achievements

Implement achievement rules.

Examples:

```text
SAFE_DRIVER
ON_TIME_CHAMPION
100_TRIPS
ZERO_INCIDENT_STREAK
DOCUMENT_PERFECT
FUEL_EFFICIENT
CUSTOMER_FAVOURITE
EMERGENCY_HELPER
```

Do not hard-code achievements into UI.

---

# 25. Phase 21 — Maintenance

Implement:

- Maintenance records
- Service schedule
- Costs
- Odometer
- Service provider
- Maintenance status
- Reminders

Initial risk calculations may be rule-based.

AI predictive maintenance comes later.

---

# 26. Phase 22 — Fleet Analytics

Implement real calculations for:

- Fleet utilization
- Active trips
- Idle time
- Delivery performance
- Driver performance
- Revenue
- Expenses
- Maintenance cost
- Fuel cost

Do not use fake chart values.

---

# 27. Phase 23 — Subscription System

Implement:

- Plans
- Features
- Entitlements
- Organization subscription
- Subscription status
- Feature gating

Initial plans:

```text
Basic
Pro
Intelligence
Enterprise
```

Local development may use simulated subscription activation.

### Critical Rule

Feature restrictions must be enforced on the backend.

---

# 28. Phase 24 — AI Foundation

Only begin AI after core data is reliable.

Implement:

```text
AIService
```

with provider abstraction.

Start with:

- Fleet summaries
- Document summaries
- Trip summaries
- Operational Q&A

AI should use authorized structured data.

---

# 29. Phase 25 — AI Fleet Copilot

Support queries such as:

```text
Which trucks are idle?

Which documents expire soon?

Which driver performed best this month?

Which trucks are currently delayed?

What needs my attention today?

Which trucks have maintenance risk?
```

The answer should contain useful context and links to relevant records where possible.

---

# 30. Phase 26 — AI Recommendations

Add:

- Driver assignment recommendations
- Truck assignment
- Maintenance recommendations
- Route recommendations
- Fuel planning
- Rest-stop recommendations
- Risk alerts

Recommendations must include reasoning.

---

# 31. Phase 27 — AI Business Brain

Build executive analytics.

Example:

```text
Why did revenue fall this month?

Which routes are most expensive?

Which truck is most profitable?

Where are we losing time?

Which drivers are most reliable?

What should management focus on today?
```

---

# 32. Phase 28 — Production Readiness

Before any production deployment, complete:

### Security

- Authentication review
- Authorization review
- Tenant-isolation tests
- File security
- Rate limiting
- Secrets review
- Dependency audit
- HTTPS
- Secure cookies/tokens
- Production CORS

### Infrastructure

- Production database
- Object storage
- Realtime infrastructure
- Queue/workers
- Monitoring
- Backups
- Domain
- SSL

### Integrations

- Real GPS
- Map provider
- Notifications
- Payment gateway
- AI provider

---

# 33. Phase 29 — Production Migration

When the user explicitly says:

> Move Saarthi to production.

Claude must switch from development implementation to production preparation.

Do not rebuild the application.

Perform the following sequence.

## Step 1 — Production Audit

Inspect:

- Repository
- Environment variables
- Dependencies
- Database migrations
- API routes
- Authentication
- Authorization
- Storage
- Realtime
- Jobs
- GPS abstraction
- Map abstraction
- Notification abstraction
- Payment abstraction
- AI abstraction
- Logging
- Tests

Identify blockers.

---

## Step 2 — Production Configuration

Create/prepare:

```text
.env.production
```

or the target deployment platform's equivalent secret configuration.

Never put real secrets into committed files.

---

## Step 3 — Database

Configure managed PostgreSQL.

Run migrations.

Verify indexes.

Verify backups.

Never copy development credentials into production.

---

## Step 4 — Storage

Replace local file storage with production object storage.

Verify:

- Upload
- Download
- Private access
- Signed URLs
- Deletion
- Versioning where applicable

---

## Step 5 — GPS

Replace:

```text
MockGPSProvider
```

with:

```text
ProductionGPSProvider
```

without changing the frontend tracking contract.

---

## Step 6 — Maps

Configure production map provider.

Enable:

- Routing
- Geocoding
- Nearby places
- Traffic where supported
- 3D capabilities if subscription/product plan requires it

---

## Step 7 — Notifications

Configure production:

- Email
- SMS
- Push
- Other approved channels

---

## Step 8 — Payments

Replace local mock payment implementation with the chosen production payment provider.

Implement:

- Checkout
- Payment verification
- Subscription activation
- Renewal
- Cancellation
- Webhooks
- Failed payments

---

## Step 9 — AI

Configure production AI provider.

Implement:

- API key security
- Usage tracking
- Cost monitoring
- Rate limiting
- Prompt/version management
- Data minimization
- Role-aware context

---

## Step 10 — Realtime

Move WebSockets to production infrastructure capable of handling expected concurrency.

Test:

- Multiple trucks
- Multiple fleet owners
- Multiple simultaneous trips
- SOS events
- Reconnection
- Connection authorization

---

## Step 11 — Production Security

Run:

- Dependency audit
- Secret scan
- Authentication tests
- Authorization tests
- Tenant isolation tests
- API abuse tests
- File upload tests
- Rate-limit tests
- Security header checks

---

## Step 12 — Observability

Configure:

- Logs
- Error tracking
- Metrics
- Health checks
- Database monitoring
- GPS ingestion monitoring
- Queue monitoring
- AI usage monitoring
- Payment monitoring

---

## Step 13 — Production Smoke Test

Perform a controlled end-to-end test:

```text
Register
→ Verify
→ Add Truck
→ Add Driver
→ Add Documents
→ Create Order
→ Assign Trip
→ GPS Location
→ Live Tracking
→ Complete Delivery
→ Generate Report
→ Subscription Check
```

Also test:

```text
SOS
Document expiry
Unauthorized access
Tenant isolation
Payment flow
```

---

# 34. Definition of Done

A feature is DONE only when:

- Database model exists.
- Migration exists.
- Backend API exists.
- Backend validation exists.
- Authorization exists.
- Frontend UI exists.
- Error states exist.
- Loading states exist.
- Empty states exist.
- Database persistence works.
- Tests exist.
- Relevant audit logging exists.
- Realtime behavior exists if required.
- Documentation is updated.
- Local demo flow works.

---

# 35. UI Completion Rules

Every page must handle:

```text
Loading
Success
Empty
Error
Unauthorized
Not Found
```

Forms must handle:

```text
Initial
Editing
Submitting
Success
Validation error
Server error
```

Do not leave broken routes.

Do not create navigation links to nonexistent pages.

---

# 36. API Completion Rules

Every API endpoint must have:

- Validation
- Authentication requirement where appropriate
- Authorization
- Consistent response format
- Error handling
- Logging where appropriate
- Tests

---

# 37. Database Completion Rules

Every schema change must be:

- Migration-based
- Reproducible
- Tested

Never instruct the user to manually modify tables as the normal workflow.

---

# 38. Mock Data Rules

Mock data is allowed only where it represents a future external dependency or demo simulation.

Examples:

Allowed:

- GPS simulator
- Local map POIs
- Mock payment provider
- Local notification provider
- Seed demo accounts

Not allowed:

- Fake fleet metrics
- Fake orders
- Fake dashboard statistics that are not stored in PostgreSQL
- Fake trip states
- Fake documents presented as real records

---

# 39. Demo Scenario

Claude must eventually provide a one-command or simple local workflow that produces a compelling demonstration.

Example:

```text
Seed demo data
→ Login as fleet owner
→ Open Fleet Command Center
→ Start Demo Simulation
→ Multiple trucks begin moving
→ Open a truck
→ View live speed/location
→ Open trip
→ View order
→ View driver
→ View documents
→ Open nearby services
→ Trigger SOS
→ Nearby truck receives alert
→ Complete trip
→ View analytics
```

This should be the primary stakeholder demonstration.

---

# 40. Performance Rules

Do not fetch an entire fleet history into the browser.

Use:

- Pagination
- Filtering
- Server-side aggregation
- Indexed queries
- Lazy loading
- WebSocket subscriptions scoped to relevant data

Tracking history should be queried intelligently.

---

# 41. Realtime Rules

Do not broadcast every event to every user.

Broadcast only to authorized subscribers.

Examples:

```text
Fleet owner → their fleet
Driver → assigned truck/trip
Customer → their order/trip
Supplier → their orders
Admin → authorized operational scope
```

---

# 42. Error Handling Rules

Errors must be understandable.

Bad:

```text
Something went wrong.
```

Better:

```text
Unable to start the trip because the assigned truck is currently in maintenance.
```

Never expose internal stack traces to normal users.

---

# 43. Accessibility & Driver Safety

Driver UI must prioritize safety.

Avoid:

- Tiny buttons
- Dense forms while driving
- Complex interactions
- Excessive notifications

SOS must be easy to access.

Any future voice interaction must avoid encouraging unsafe device interaction while driving.

---

# 44. Documentation Requirements

Maintain:

```text
README.md
LOCAL_SETUP.md
API.md
DATABASE.md
DEMO.md
ENVIRONMENT.md
PRODUCTION.md
```

Update documentation when architecture changes.

---

# 45. AI Coding Agent Rules

Claude must:

1. Read the relevant documentation before coding.
2. Inspect the existing repository before modifying it.
3. Avoid unnecessary rewrites.
4. Reuse existing code when correct.
5. Keep modules cohesive.
6. Keep types synchronized.
7. Run tests after meaningful changes.
8. Run type checking.
9. Run linting.
10. Fix errors before moving forward.
11. Explain blockers clearly.
12. Never claim a feature is complete without verifying it.
13. Never silently replace a real requirement with a placeholder.
14. Preserve backward compatibility where practical.
15. Keep local functionality working after each phase.

---

# 46. Work Incrementally

Claude should not attempt to create the entire application in one uncontrolled operation.

Recommended cycle:

```text
Inspect
→ Plan
→ Implement
→ Test
→ Verify
→ Summarize
→ Continue
```

However, once the user explicitly asks to implement an entire phase, Claude may complete all tasks in that phase before stopping.

---

# 47. Never Break Existing Features

Before modifying a module:

1. Understand current behavior.
2. Identify dependencies.
3. Modify minimally.
4. Run affected tests.
5. Run broader tests where practical.

Do not rewrite working modules simply because a different implementation looks cleaner.

---

# 48. Production Migration Must Be One-Prompt Capable

The project must be structured so the user can eventually tell Claude:

> Prepare Saarthi for production deployment using the existing project documentation and current codebase. Audit the entire application, identify blockers, configure production infrastructure, replace local providers with production providers, secure the application, migrate the database, prepare deployment configuration, run all tests, and provide the final deployment checklist. Do not rewrite working business functionality unnecessarily.

Claude should then be able to follow the production migration sequence in this document.

---

# 49. Final Acceptance Test

Before declaring the local Saarthi MVP complete, verify all of the following:

- [ ] Application starts locally.
- [ ] PostgreSQL works.
- [ ] Migrations work from a clean database.
- [ ] Seed works.
- [ ] Registration works.
- [ ] Login works.
- [ ] Logout works.
- [ ] RBAC works.
- [ ] Organization isolation works.
- [ ] Driver verification works.
- [ ] Truck verification works.
- [ ] Document upload works.
- [ ] Document verification works.
- [ ] Document expiry works.
- [ ] Truck CRUD works.
- [ ] Driver CRUD works.
- [ ] Supplier works.
- [ ] Material management works.
- [ ] Customer works.
- [ ] Orders work.
- [ ] Trips work.
- [ ] Map works.
- [ ] Mock GPS works.
- [ ] Live tracking works.
- [ ] Trip replay works.
- [ ] Nearby services work.
- [ ] Nearby Saarthi trucks work.
- [ ] SOS works.
- [ ] SOS responder matching works.
- [ ] Driver score works.
- [ ] Achievements work.
- [ ] Maintenance works.
- [ ] Analytics use real data.
- [ ] Subscription entitlements work.
- [ ] Basic plan restrictions work.
- [ ] Pro plan features work.
- [ ] AI plan architecture works.
- [ ] Admin dashboard works.
- [ ] Notifications work locally.
- [ ] Audit logs work.
- [ ] Tests pass.
- [ ] Type checking passes.
- [ ] Linting passes.
- [ ] Production migration documentation exists.

---

# 50. Final Principle

Saarthi should be developed with one rule above all others:

> **Build the local product as the real product, not as a disposable prototype.**

The only things that should be simulated are capabilities that genuinely require external production infrastructure or hardware.

Everything else must be real.

The local version should be good enough to demonstrate the product to a stakeholder, while the architecture should be strong enough that production becomes an infrastructure/integration transition rather than a complete redevelopment.
