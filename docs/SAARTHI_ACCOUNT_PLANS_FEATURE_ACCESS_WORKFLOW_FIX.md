# SAARTHI — ACCOUNT PLANS, ACCOUNT TYPES & FEATURE ACCESS WORKFLOW
## Product Workflow Fix Specification

**Purpose:** Establish one clear source of truth for Saarthi account creation, plan selection, business-type selection, feature access, verification, vehicle/tracker requirements, and role-specific workflows.

> This document is based on the account/plan rules discussed and the handwritten Saarthi notes provided. It is intended to fix incorrect workflow behavior in the existing software, not to redesign already-working technical systems.

---

# 1. Core Principle

Saarthi must not treat every user as a vehicle/fleet user.

There are **three plans**:

```text
SAARTHI PLANS
│
├── PERSONAL
├── FREE
└── BUSINESS
```

**Business** then requires a business type:

```text
BUSINESS
│
├── FLEET OWNER
├── MOBILITY PROVIDER
└── SUPPLIER
```

The selected plan and, where applicable, business type determine what the user can access.

---

# 2. Account / Plan Structure

```text
                         SAARTHI
                            │
                  ┌─────────┼─────────┐
                  │         │         │
               PERSONAL    FREE    BUSINESS
                                      │
                         ┌────────────┼────────────┐
                         │            │            │
                    FLEET OWNER  MOBILITY      SUPPLIER
                                 PROVIDER
```

Do not collapse these into one generic "business/fleet" workflow.

---

# 3. PERSONAL PLAN

## Purpose

For an individual using Saarthi for personal purposes.

## Confirmed characteristics

- Personal use.
- Aadhaar verification only.
- Owner can also be the driver.
- 14-day trial.
- No business-related services.
- Telemetry is available.
- Personal users with vehicle/telemetry use the vehicle/tracker ecosystem.

## Personal workflow

```text
PERSONAL
   ↓
Aadhaar Verification
   ↓
Personal Profile
   ↓
Vehicle Setup
   ↓
Saarthi Tracker / Existing Vehicle Flow
   ↓
Telemetry
```

## Personal must NOT require

- Business verification.
- Business documents.
- Supplier onboarding.
- Fleet-owner business onboarding.
- Mobility-provider business onboarding.

## Personal owner/driver

The owner may also act as the driver.

Do not force a separate driver account where the personal workflow permits the owner to drive.

---

# 4. FREE PLAN

## Purpose

The Free plan is for basic consumer/location/order-related Saarthi functionality.

It does NOT require the user to operate a vehicle.

## Confirmed Free features

- Nearby Services.
- Location-related services.
- Active Order Tracking / tracking an order.
- Other basic free consumer functionality already supported by Saarthi.

## Free must NOT require

```text
Vehicle              NO
Tracker              NO
Telemetry             NO
Business verification NO
Business documents    NO
Paid subscription     NO
```

The Free user must be able to use relevant location/service/order functionality without being pushed into vehicle onboarding.

## Free workflow

```text
FREE
 ↓
Basic Profile
 ↓
Nearby Services
Location Services
Order Tracking
Other Free Features
```

Do NOT show:

```text
Add Vehicle
Connect Tracker
Connect OBD
Fleet Setup
Business Verification
```

unless the user explicitly upgrades/converts into a workflow that requires them.

---

# 5. BUSINESS PLAN

## Purpose

For users operating a business on Saarthi.

Business users must choose their business type:

```text
BUSINESS
   ↓
Choose Business Type
   ├── Fleet Owner
   ├── Mobility Provider
   └── Supplier
```

The business type is critical because the three business types have different requirements and features.

---

# 6. BUSINESS — FLEET OWNER

## Purpose

For businesses operating:

- Trucks.
- Tippers.
- Other heavy commercial vehicles.

## Confirmed features

Fleet Owner receives:

- All relevant fleet features.
- Backhaul.
- Truck-related terminology/features.
- Load-related functionality.
- Ton/quantity concepts where applicable.
- Telemetry features.
- Business verification.
- Business documents.
- Option to generate a joining code for drivers.
- Ability to let drivers join.

## Fleet Owner workflow

```text
BUSINESS
 ↓
FLEET OWNER
 ↓
Business Details
 ↓
Business Verification
 ↓
Business Documents
 ↓
Fleet Setup
 ↓
Vehicles / Trucks
 ↓
Saarthi Tracker / Existing Device Flow
 ↓
Telemetry
 ↓
Drivers
 ↓
Trips / Loads / Backhaul
```

## Fleet terminology

The Fleet Owner workflow can use terms such as:

- Truck.
- Tipper.
- Load.
- Ton.
- Backhaul.
- Fleet.

Do not force these terms into Mobility Provider or Supplier workflows.

---

# 7. BUSINESS — MOBILITY PROVIDER

## Purpose

For businesses operating passenger/mobility vehicles.

Examples from the notes include:

- Cars.
- SUVs.
- Other mobility vehicles.

## Confirmed features

Mobility Provider receives:

- Mobility vehicle management.
- Fleet-related functionality applicable to mobility.
- Telemetry.
- Business verification.
- Business documents.
- Option to generate a joining code for drivers.
- Driver joining/invitation capability.
- Ability to offer tour/travel packages.

## Mobility Provider workflow

```text
BUSINESS
 ↓
MOBILITY PROVIDER
 ↓
Business Details
 ↓
Business Verification
 ↓
Business Documents
 ↓
Vehicle Setup
 ↓
Cars / SUVs / Mobility Vehicles
 ↓
Saarthi Tracker / Existing Device Flow
 ↓
Telemetry
 ↓
Drivers
 ↓
Mobility / Tour / Travel Services
```

## Mobility terminology

Use mobility/passenger terminology.

Do not expose heavy-freight-only concepts such as:

- Backhaul.
- Ton.
- Load-for-truck workflows.

unless a separately defined feature explicitly requires them.

---

# 8. BUSINESS — SUPPLIER

## Purpose

For businesses that sell/provide materials.

## Confirmed features

Supplier receives:

- Material listing/posting.
- Material details.
- Price.
- Quality.
- Other relevant material information.
- Business verification.
- Business documents.
- Order Management.

## Critical rule

**Supplier does NOT operate a Saarthi vehicle/fleet under this workflow.**

Therefore:

```text
SUPPLIER
│
├── Vehicle          NO
├── Truck            NO
├── Tracker          NO
├── Telemetry        NO
├── Driver onboarding NO
└── Fleet setup      NO
```

## Supplier workflow

```text
BUSINESS
 ↓
SUPPLIER
 ↓
Business Details
 ↓
Business Verification
 ↓
Business Documents
 ↓
Supplier Profile
 ↓
Material Listings
 ↓
Order Management
```

Do NOT send a Supplier through:

```text
Add Vehicle
Connect Tracker
Connect OBD
Fleet Setup
Driver Setup
```

---

# 9. BUSINESS TYPE FEATURE MATRIX

| Capability | Fleet Owner | Mobility Provider | Supplier |
|---|---:|---:|---:|
| Business account | Yes | Yes | Yes |
| Business verification | Yes | Yes | Yes |
| Business documents | Yes | Yes | Yes |
| Vehicles | Yes | Yes | No |
| Trucks / Tippers | Yes | No | No |
| Mobility cars / SUVs | No / not primary | Yes | No |
| Saarthi tracker requirement | Yes, where vehicle telemetry is used | Yes, where vehicle telemetry is used | No |
| Telemetry | Yes | Yes | No |
| Drivers | Yes | Yes | No |
| Driver joining code | Yes | Yes | No |
| Backhaul | Yes | No | No |
| Load / Ton concepts | Yes | No | No |
| Tour / Travel packages | No / not primary | Yes | No |
| Material listings | No | No | Yes |
| Order Management | Yes, where applicable | Yes, where applicable | Yes |
| Vehicle/fleet onboarding | Yes | Yes | No |

Where a cell says "where applicable", reuse the existing Saarthi feature rules rather than inventing a new rule.

---

# 10. PLAN COMPARISON

| Feature / Requirement | Personal | Free | Business |
|---|---:|---:|---:|
| Personal account | Yes | No | No |
| Basic location services | Yes, as applicable | Yes | Yes, as applicable |
| Nearby Services | Yes, as applicable | Yes | Yes, as applicable |
| Active Order Tracking | Yes, as applicable | Yes | Yes, as applicable |
| Aadhaar verification | Yes | Not required by current notes | Business verification instead |
| Business verification | No | No | Yes |
| Business documents | No | No | Yes |
| Vehicle required | Yes for vehicle/telemetry use | No | Depends on business type |
| Tracker required | Yes for telemetry workflow | No | Fleet Owner/Mobility Provider only where vehicle telemetry is used |
| Telemetry | Yes | No | Fleet Owner/Mobility Provider |
| 14-day trial | Yes | N/A | Yes |
| Business services | No | No | Yes |
| Supplier functionality | No | No | Yes, Supplier type |
| Fleet functionality | No | No | Yes, Fleet Owner type |
| Mobility-provider functionality | No | No | Yes, Mobility Provider type |

**Important:** This matrix only captures rules established in the supplied notes/discussion. Existing Saarthi specifications should be inspected for additional features before removing or granting any existing capability.

---

# 11. CUSTOMER ACCOUNT VS BUSINESS ACCOUNT

The term "Customer" should not be treated as synonymous with one particular plan.

A customer may use Saarthi as:

```text
PERSONAL
```

or:

```text
FREE
```

or:

```text
BUSINESS
```

If Business is selected:

```text
BUSINESS
 ↓
Business Type
```

The system must determine the correct workflow from the selected plan/type.

---

# 12. COMMUNICATION FLOW

The supplied notes define the intended communication boundary as:

```text
CUSTOMER
     ↓
FLEET OWNER / MOBILITY PROVIDER
     ↓
SUPPLIER
```

The notes specifically indicate:

- No direct customer-to-driver communication.
- No direct customer-to-supplier communication.

Therefore the product should not expose unrestricted direct communication from Customer to Driver or Customer to Supplier if this rule is part of the existing communication implementation.

The exact messaging implementation should be reconciled against the current Saarthi communication system.

---

# 13. DRIVER ACCOUNT — SEPARATE FROM PLANS

Driver is an operational role, not one of the three Saarthi plans.

## Confirmed Driver characteristics

- Can join with or without a joining code.
- Requires Aadhaar, PAN, Voter ID and Driving Licence verification.
- No business verification.
- No business documents.
- No paid plan.
- Full access to nearby services.
- No general vehicle-owner telemetry access.
- Only trip-related telemetry/data is allowed.
- Can use the existing Driver App.
- SOS.
- Scoring system.

## Driver access boundary

```text
VEHICLE OWNER
   ↓
Owns vehicle telemetry

DRIVER
   ↓
Uses assigned vehicle
   ↓
Gets permitted trip-related data
```

Do not expose the owner's complete telemetry history to a driver unless explicitly authorized by an existing Saarthi rule.

---

# 14. VEHICLE / TRACKER RULE

The tracker requirement is **not simply "paid plan = tracker".**

It depends on the account type.

### No tracker requirement

```text
FREE
SUPPLIER
DRIVER
```

### Tracker/vehicle ecosystem

```text
PERSONAL
FLEET OWNER
MOBILITY PROVIDER
```

The exact tracker activation/connection mechanism already exists in Saarthi and must be reused.

---

# 15. EXISTING TRACKER / DRIVER / OBD SYSTEM — DO NOT REBUILD

The existing technical flow is the source of truth.

```text
Vehicle
 ↓
Saarthi Tracker / Terminal
 ↓
Existing Saarthi Driver App
 ↓
Vehicle connection
 ├── Vehicle QR
 └── Vehicle Number
 ↓
Existing OBD connection
 ↓
Phone receives telemetry
 ↓
Existing Saarthi telemetry pipeline
 ↓
Saarthi Backend
 ↓
Fleet Dashboard
```

Do NOT introduce:

- Tracker QR.
- New tracker activation flow.
- New OBD system.
- New Driver App.
- New vehicle pairing system.
- New telemetry pipeline.

This document only determines **which account types are allowed/required to enter that existing flow**.

---

# 16. REGISTRATION / ONBOARDING DECISION TREE

The signup workflow should behave like:

```text
START
  ↓
Choose Plan
  │
  ├── PERSONAL
  │      ↓
  │   Aadhaar verification
  │      ↓
  │   Personal onboarding
  │      ↓
  │   Vehicle/telemetry setup
  │
  ├── FREE
  │      ↓
  │   Basic account
  │      ↓
  │   Nearby Services / location / order tracking
  │
  └── BUSINESS
         ↓
     Choose Business Type
         │
         ├── FLEET OWNER
         │      ↓
         │   Business verification
         │      ↓
         │   Business documents
         │      ↓
         │   Fleet / vehicle setup
         │
         ├── MOBILITY PROVIDER
         │      ↓
         │   Business verification
         │      ↓
         │   Business documents
         │      ↓
         │   Mobility vehicle setup
         │
         └── SUPPLIER
                ↓
             Business verification
                ↓
             Business documents
                ↓
             Supplier setup
                ↓
             Material listings / Orders
```

---

# 17. UI RULES FOR PLAN SELECTION

The initial plan-selection screen should clearly show:

```text
Choose your Saarthi plan

[ PERSONAL ]
For individual use

[ FREE ]
For basic location and service features

[ BUSINESS ]
For businesses
```

Do not force users to choose Fleet Owner/Mobility Provider/Supplier before choosing Business.

After Business is selected:

```text
What type of business are you?

[ Fleet Owner ]
Trucks, tippers and heavy commercial vehicles

[ Mobility Provider ]
Cars, SUVs and mobility services

[ Supplier ]
Materials and supplier marketplace
```

---

# 18. CONDITIONAL ONBOARDING

The application must dynamically change onboarding based on selection.

### Example: Supplier

After selecting Supplier:

```text
Business Details
 ↓
Business Verification
 ↓
Business Documents
 ↓
Supplier Profile
 ↓
Material Listing
```

Stop there.

Do not ask:

```text
How many vehicles?
Which truck?
Tracker ID?
OBD?
Driver?
```

### Example: Fleet Owner

```text
Business Details
 ↓
Verification
 ↓
Documents
 ↓
Fleet Setup
 ↓
Vehicles
 ↓
Existing Tracker/Driver/OBD Flow
```

### Example: Mobility Provider

```text
Business Details
 ↓
Verification
 ↓
Documents
 ↓
Mobility Vehicles
 ↓
Existing Tracker/Driver/OBD Flow
```

---

# 19. UPGRADE / PLAN CHANGE

Plan changes must be handled deliberately.

Examples:

```text
FREE
 ↓
PERSONAL
```

or:

```text
FREE
 ↓
BUSINESS
 ↓
Fleet Owner
```

or:

```text
FREE
 ↓
BUSINESS
 ↓
Supplier
```

When a user changes account type, Saarthi must:

1. Preserve existing account identity.
2. Preserve allowed existing data.
3. Apply the new permissions.
4. Trigger only the verification/onboarding steps required by the new plan/type.
5. Never expose features before required verification.
6. Never require irrelevant vehicle/tracker setup.

Do not create a second account just because the user changes plan/type unless the existing architecture explicitly requires it.

---

# 20. SALESMAN IMPACT

The Salesman must sell the correct plan and account type.

Salesman flow:

```text
Prospect
 ↓
Understand use case
 ↓
Select appropriate plan
 │
 ├── Personal
 ├── Free
 └── Business
       ↓
    Fleet Owner
    Mobility Provider
    Supplier
 ↓
Customer signup
 ↓
Correct onboarding
```

### Physical sale

For a Personal/Fleet Owner/Mobility Provider customer where vehicle telemetry is part of the offering:

```text
Subscription
 ↓
Saarthi tracker supplied
 ↓
Salesman demonstrates first vehicle
 ↓
Existing Driver App
 ↓
Vehicle QR / Vehicle Number
 ↓
Existing OBD flow
 ↓
Telemetry verified
```

The salesman does not need to install every vehicle.

For Supplier:

```text
Subscription
 ↓
Business verification
 ↓
Supplier setup
 ↓
Material listings / Orders
```

No tracker or vehicle demonstration.

For Free:

```text
Free account
 ↓
Nearby Services
Location features
Order tracking
```

No tracker sale/installation.

---

# 21. DIGITAL SALES IMPACT

Digital referral flow:

```text
Salesman referral
 ↓
Customer opens Saarthi
 ↓
Referral attribution
 ↓
Choose plan
 ↓
Correct onboarding
 ↓
Subscription/payment where applicable
 ↓
Correct account type
```

The salesman must not force every referred customer into a Business/Fleet workflow.

The customer chooses the plan/type that matches their actual use case.

---

# 22. COMMISSION IMPACT

Commission is tied to the qualifying subscription/payment event, not merely to a referral.

```text
Referral
 ↓
Valid GODID
 ↓
Customer signup
 ↓
Correct plan/type
 ↓
Qualifying subscription/payment
 ↓
Commission
```

Supplier subscriptions are eligible for commission if the configured commission rules say so.

Do not assume every plan has the same commission rate.

Commission rules must be configurable.

---

# 23. WORKFLOW BUGS THIS SPECIFICATION SHOULD FIX

Claude Code should specifically test for these classes of bugs:

### Bug 1 — Free user being asked for vehicle

Expected:

```text
FREE → no vehicle requirement
```

### Bug 2 — Supplier being asked for tracker

Expected:

```text
SUPPLIER → no vehicle/tracker/telemetry
```

### Bug 3 — Supplier being shown Fleet Owner features

Expected:

```text
SUPPLIER → supplier features only
```

### Bug 4 — Mobility Provider being shown truck features

Expected:

```text
MOBILITY PROVIDER → mobility features
```

### Bug 5 — Fleet Owner missing truck features

Expected:

```text
FLEET OWNER → fleet + truck + load + backhaul + telemetry
```

### Bug 6 — Personal user being forced through business verification

Expected:

```text
PERSONAL → Aadhaar verification
```

### Bug 7 — Driver receiving owner telemetry

Expected:

```text
DRIVER → permitted trip-related data only
```

### Bug 8 — Driver being forced to purchase a plan

Expected:

```text
DRIVER → no paid plan requirement
```

### Bug 9 — Owner unable to act as driver in Personal

Expected:

```text
PERSONAL OWNER → may also be DRIVER
```

### Bug 10 — Salesman selling the wrong workflow

Expected:

```text
Salesman → plan/type → correct onboarding
```

---

# 24. IMPLEMENTATION INSTRUCTIONS

Before changing code:

1. Read `CLAUDE.md`.
2. Read all existing Saarthi MD/specification files.
3. Inspect current signup flow.
4. Inspect plan/subscription models.
5. Inspect account/role models.
6. Inspect RBAC.
7. Inspect customer/business profiles.
8. Inspect Fleet Owner/Mobility Provider/Supplier implementation.
9. Inspect Driver onboarding.
10. Inspect vehicle setup.
11. Inspect tracker/device implementation.
12. Inspect OBD/telemetry implementation.
13. Inspect order tracking.
14. Inspect Nearby Services.
15. Inspect business verification/document flows.
16. Inspect existing Salesman/referral/commission work.
17. Search the entire repository for feature flags and conditional rendering related to:
    - personal
    - free
    - business
    - fleet owner
    - mobility provider
    - supplier
    - driver
    - vehicle
    - tracker
    - telemetry
    - order tracking
    - nearby services

Then classify every relevant implementation:

```text
CORRECT — KEEP
INCORRECT — FIX
PARTIAL — COMPLETE
DUPLICATE — REUSE
CONFLICT — REQUIRES DECISION
MISSING — IMPLEMENT
```

---

# 25. Do Not Blindly Rebuild

This is a workflow correction task.

The objective is to make the existing Saarthi software correctly enforce the account/plan rules.

Do not rebuild working:

- authentication
- Driver App
- tracker/terminal
- OBD
- telemetry
- vehicle pairing
- order tracking
- Nearby Services
- payment infrastructure

unless the repository inspection proves that a component is missing or incompatible with these rules.

---

# 26. Data / Permission Model

At minimum, the application must be able to distinguish:

```text
planType
  PERSONAL
  FREE
  BUSINESS
```

and for Business:

```text
businessType
  FLEET_OWNER
  MOBILITY_PROVIDER
  SUPPLIER
```

Driver should remain an operational role rather than being incorrectly treated as one of the three plans.

Use the existing schema if equivalent fields already exist.

Do not add duplicate columns/entities without checking the existing model.

---

# 27. Feature Gating

Feature access should be determined server-side and enforced in the frontend.

Frontend hiding alone is insufficient.

Example:

```text
if FREE:
    nearbyServices = allowed
    orderTracking = allowed
    vehicleManagement = not required
    telemetry = not allowed

if PERSONAL:
    personalVehicleFeatures = allowed
    telemetry = allowed
    businessFeatures = not allowed

if BUSINESS + FLEET_OWNER:
    fleetFeatures = allowed
    truckFeatures = allowed
    telemetry = allowed
    backhaul = allowed

if BUSINESS + MOBILITY_PROVIDER:
    mobilityFeatures = allowed
    telemetry = allowed
    tourTravel = allowed

if BUSINESS + SUPPLIER:
    supplierFeatures = allowed
    materialListings = allowed
    orderManagement = allowed
    vehicleFeatures = not required
    tracker = not required
    telemetry = not required
```

These are product rules, not literal implementation syntax. Use the project's existing authorization architecture.

---

# 28. Verification Matrix

| Account | Verification |
|---|---|
| Personal | Aadhaar |
| Free | No business verification |
| Business / Fleet Owner | Business verification + business documents |
| Business / Mobility Provider | Business verification + business documents |
| Business / Supplier | Business verification + business documents |
| Driver | Aadhaar + PAN + Voter ID + Driving Licence |

Use the existing verification provider/workflow where available.

---

# 29. Final Acceptance Test Matrix

## Personal

- [ ] User can select Personal.
- [ ] Only required Aadhaar verification is requested.
- [ ] User is not asked for business documents.
- [ ] User can own a vehicle.
- [ ] Owner can also act as driver.
- [ ] Vehicle/telemetry workflow is available.
- [ ] 14-day trial is applied according to existing subscription rules.
- [ ] Business-only services are unavailable.

## Free

- [ ] User can create Free account.
- [ ] No vehicle is required.
- [ ] No tracker is required.
- [ ] No telemetry is required.
- [ ] Nearby Services works.
- [ ] Location-related services work.
- [ ] Active Order Tracking works.
- [ ] User is not forced into business verification.
- [ ] User is not forced into vehicle onboarding.

## Business / Fleet Owner

- [ ] Business verification required.
- [ ] Business documents required.
- [ ] Trucks/tippers/heavy commercial vehicles supported.
- [ ] Fleet features available.
- [ ] Backhaul available.
- [ ] Load/ton functionality available where defined.
- [ ] Telemetry available.
- [ ] Driver joining functionality available.
- [ ] Tracker/vehicle flow uses existing implementation.

## Business / Mobility Provider

- [ ] Business verification required.
- [ ] Business documents required.
- [ ] Cars/SUVs/mobility vehicles supported.
- [ ] Mobility functionality available.
- [ ] Tour/travel functionality available.
- [ ] Telemetry available.
- [ ] Driver joining functionality available.
- [ ] Truck-only features are not shown.

## Business / Supplier

- [ ] Business verification required.
- [ ] Business documents required.
- [ ] Supplier profile works.
- [ ] Material listings work.
- [ ] Price/quality/material details work.
- [ ] Order Management works.
- [ ] No vehicle requirement.
- [ ] No truck requirement.
- [ ] No tracker requirement.
- [ ] No telemetry requirement.
- [ ] No driver onboarding requirement.

## Driver

- [ ] Can join with or without joining code.
- [ ] Required identity documents are verified.
- [ ] No business verification.
- [ ] No paid plan.
- [ ] Nearby Services available.
- [ ] Driver App works.
- [ ] SOS available.
- [ ] Scoring available.
- [ ] Owner telemetry is not exposed beyond permitted trip-related data.

---

# 30. Final Product Model

```text
                              SAARTHI
                                 │
                   ┌─────────────┼─────────────┐
                   │             │             │
                PERSONAL        FREE        BUSINESS
                   │             │             │
              Vehicle +      Nearby/       Choose Type
              Telemetry      Location          │
                   │          + Order    ┌─────┼──────────┐
                   │                      │     │          │
                   │                  Fleet   Mobility   Supplier
                   │                  Owner   Provider
                   │                     │       │          │
                   │                     │       │          │
                   │                  Trucks   Cars       Materials
                   │                  Tippers  SUVs       Listings
                   │                  Backhaul Mobility   Orders
                   │                  Loads    Tours       Verification
                   │                  Telemetry Telemetry
                   │                     │       │
                   └─────────────────────┼───────┘
                                         │
                              Existing Driver/Tracker/
                                OBD/Telemetry System
                                         │
                                         ▼
                                  Saarthi Backend
```

---

# 31. Source-of-Truth Rules

For this workflow:

1. **Three plans only:** Personal, Free, Business.
2. **Business has three types:** Fleet Owner, Mobility Provider, Supplier.
3. **Supplier is paid Business but has no vehicle/tracker/telemetry requirement.**
4. **Free is a basic consumer/location/order-access plan and has no vehicle/tracker requirement.**
5. **Personal is for individual vehicle use and includes telemetry.**
6. **Fleet Owner is for trucks/tippers/heavy commercial vehicles and gets truck/fleet features, backhaul, load/ton concepts and telemetry.**
7. **Mobility Provider is for cars/SUVs/mobility and gets mobility/travel features and telemetry.**
8. **Driver is an operational role, not one of the three plans.**
9. **Driver does not receive the owner's general telemetry data; only permitted trip-related data.**
10. **Existing tracker, Driver App, vehicle QR/vehicle-number pairing, OBD and telemetry systems must be reused.**
11. **The tracker does not have a QR code.**
12. **GODWeb remains unchanged.**
13. **Salesman operates inside Saarthi and sells the appropriate plan/type.**
14. **Do not create a separate sales portal merely to implement these workflows.**

---

# 32. Required Final Claude Code Report

After implementation, Claude Code must report:

```text
1. Existing workflow inspected
2. Existing implementation reused
3. Incorrect workflow paths found
4. Changes made
5. Files changed
6. Database/schema changes
7. API changes
8. RBAC/permission changes
9. Frontend workflow changes
10. Tests added/updated
11. Existing tests run
12. Build status
13. Manual test matrix
14. Remaining gaps
15. Any business-rule conflicts requiring approval
```

No claim of completion should be made without build/test evidence.
