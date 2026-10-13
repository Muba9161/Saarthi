# SAARTHI — SALESMAN, SALES, REFERRAL & CUSTOMER ONBOARDING SPECIFICATION

## 1. Purpose

Define the production implementation for Saarthi's Saarthi Rahi-led and digital sales workflow.

The system must support:

1. Physical sales — Saarthi Rahi visits a prospect, demonstrates Saarthi, closes the sale, provides the Saarthi tracker, and demonstrates the already-existing vehicle/tracker/Driver App/OBD connection flow on one vehicle.
2. Digital sales — Saarthi Rahi shares a referral link/QR; the customer signs up and purchases remotely.

Both channels use the same Saarthi customer, subscription, payment, referral attribution, tracker and commission systems.

---

## 2. Non-Negotiable Architecture

Use **one Saarthi platform**.

Do NOT create:
- a separate public Sales Portal
- a separate Saarthi Rahi website
- a separate Saarthi Rahi APK
- a separate Saarthi Rahi authentication system
- a separate Saarthi Rahi database
- a duplicate customer onboarding system
- a duplicate tracker activation system
- a duplicate Driver App
- a duplicate OBD integration
- a duplicate vehicle pairing system

Instead:

```text
SAARTHI
├── Customer / Fleet Owner
├── Driver
├── Saarthi Rahi
└── Admin / Operations
```

Saarthi Rahi is an authenticated Saarthi role with role-specific navigation, permissions and workflows.

---

## 3. GODWeb Relationship

GODWeb is an existing working project and must NOT be modified.

Saarthi treats GODWeb as an external identity source for Saarthi Rahi identity.

```text
GODWeb
   │
 Existing GODID
   ▼
Saarthi GODWeb Integration
   │
 Validate
   ▼
Saarthi Rahi Profile
```

Saarthi must not:
- modify GODWeb
- create Saarthi Rahi accounts in GODWeb
- directly query the GODWeb database
- duplicate GODWeb identity/account functionality
- trust a GODID without verification

Use an approved read-only GODWeb API/integration. If the required validation API does not exist, document the dependency rather than inventing a GODWeb-side system.

---

## 4. Saarthi Rahi Identity

A Saarthi Rahi has a Saarthi Rahi Profile linked to a verified GODID.

Conceptually:

```text
SalesmanProfile
├── id
├── godId
├── externalSalespersonId (if supplied)
├── name
├── phone
├── email
├── status
├── verifiedAt
├── createdAt
└── updatedAt
```

Reconcile these fields with the existing Saarthi schema before implementation.

GODWeb owns Saarthi Rahi identity. Saarthi owns Saarthi-side sales activity, leads, referrals, attribution, subscriptions, commissions and tracker handover.

---

## 5. Saarthi Rahi Navigation

Expose a Sales section inside the existing Saarthi application:

```text
Sales
├── Dashboard
├── Leads
├── Customers
├── Demo
├── Referrals
├── Tracker Handover
└── Commission
```

Follow existing Saarthi authentication, RBAC, routing, design system and UI conventions.

---

## 6. Saarthi Rahi Dashboard

The dashboard should show:

- leads
- follow-ups
- demos
- conversions
- active customers
- pending tracker handovers
- pending/approved/paid commission

Example:

```text
SALES DASHBOARD

My Leads              24
Demos                  17
Conversions             8
Active Customers        7
Tracker Handovers       3 Pending
Commission              ₹XX,XXX
```

All values must be real records. Never fabricate metrics.

---

## 7. Physical Sales

### 7.1 Lead

The Saarthi Rahi can create/open a lead:

```text
Lead
├── Customer / Contact Name
├── Business Name
├── Phone Number
├── City
├── Fleet Size
├── Vehicle Types
├── Interested Plan
├── Notes
└── Next Follow-up
```

Reuse any existing lead/customer functionality instead of duplicating entities.

### 7.2 Lead Lifecycle

Recommended:

```text
NEW
 ↓
CONTACTED
 ↓
DEMO_SCHEDULED
 ↓
DEMO_COMPLETED
 ↓
INTERESTED
 ↓
SIGNUP_PENDING
 ↓
PAYMENT_PENDING
 ↓
SUBSCRIBED
 ↓
TRACKER_PENDING
 ↓
ONBOARDING
 ↓
ACTIVATED
```

Possible terminal states:

```text
LOST
CANCELLED
DISQUALIFIED
```

Reconcile with any existing CRM state model.

---

## 8. Demo Mode

Saarthi Rahi must be able to demonstrate Saarthi without touching real customer data.

Use a clearly labelled:

```text
DEMO MODE
```

Demo can show existing Saarthi capabilities such as:

- fleet
- vehicles
- drivers
- live tracking
- trips
- vehicle health
- documents
- analytics

Demo data must be controlled/simulated and clearly identified as demo data.

Demo mode must never:
- create real subscriptions
- charge real customers
- modify real vehicles
- modify real telemetry
- create real commissions
- alter real tracker state

Reuse existing Saarthi UI wherever possible.

---

## 9. Physical Conversion

When a prospect purchases:

```text
Lead
 ↓
Customer Registration
 ↓
Subscription Selection
 ↓
Customer Payment
 ↓
Subscription Active
```

Customer should authenticate and authorize their own account/payment.

Saarthi Rahi may assist but must not collect/store:
- passwords
- OTPs
- payment credentials
- card details
- UPI PINs

### Assisted Signup

```text
Saarthi Rahi
 ↓
Start Assisted Signup
 ↓
Customer receives OTP
 ↓
Customer verifies
 ↓
Customer creates/approves account
 ↓
Customer authorizes payment
```

---

## 10. Saarthi Tracker Policy

Saarthi provides the tracker.

Customers cannot substitute their own tracker.

**The tracker itself does NOT have a QR code.**

Do not build a tracker-QR activation workflow.

The existing Saarthi tracker/terminal, Driver App, vehicle pairing and OBD flow remain the technical source of truth.

---

## 11. Physical Tracker Handover

For physical sales, a Saarthi Rahi may be given tracker inventory.

Conceptually:

```text
Saarthi Inventory
      ↓
Saarthi Rahi Inventory
      ↓
Customer Handover
```

Reuse the existing hardware/device registry if one already exists.

The system should record, where applicable:

```text
Tracker
Customer
Saarthi Rahi
Handover Date
Handover Status
```

Do not create a second tracker/device registry.

---

## 12. First Vehicle Demonstration

The Saarthi Rahi does **one complete real vehicle setup** to teach the customer.

Example: customer has 10 vehicles.

```text
Vehicle 1
 ↓
Saarthi Rahi completes setup
 ↓
Vehicle becomes live
 ↓
Customer learns process

Vehicles 2–10
 ↓
Customer/driver repeats existing process
```

The Saarthi Rahi does not need to install every vehicle.

---

## 13. Existing Technical Onboarding — DO NOT REBUILD

The already-built flow is:

```text
Vehicle
   ↓
Saarthi Tracker / terminal
   ↓
Driver installs/opens existing Saarthi Driver App
   ↓
Driver connects to vehicle
   ├── Scan vehicle QR
   └── OR enter vehicle number
   ↓
OBD connects to driver's phone
   ↓
Phone receives vehicle telemetry
   ↓
Existing Saarthi telemetry pipeline
   ↓
Saarthi Backend
   ↓
Fleet Dashboard
```

Do not add:
- tracker QR
- new tracker pairing
- new OBD connection mechanism
- new Driver App
- new vehicle pairing backend
- duplicate terminal logic
- duplicate telemetry pipeline

---

## 14. Saarthi Rahi First-Vehicle Demonstration

The Saarthi Rahi:

1. Plugs the Saarthi tracker/terminal into the vehicle adapter.
2. Gets the owner/driver to install/open the existing Saarthi Driver App.
3. Connects the Driver App to the correct vehicle using vehicle QR or vehicle number.
4. Connects the existing OBD to the driver's phone.
5. Verifies telemetry reaches Saarthi.
6. Shows the owner the live vehicle in Saarthi.

The purpose is to teach:

> The same process can be repeated for every remaining vehicle.

---

## 15. First Vehicle Completion

Show a completion state based on real existing system state:

```text
FIRST VEHICLE DEMONSTRATION

✓ Tracker connected
✓ Vehicle connected
✓ Driver App connected
✓ OBD connected
✓ Telemetry received
✓ Vehicle visible in Saarthi

[Complete Onboarding]
```

Do not create fake technical confirmations if existing device/telemetry state can be queried.

---

## 16. Customer Self-Onboarding for Remaining Vehicles

The customer/driver repeats the existing process:

```text
1. Connect Saarthi tracker
2. Open Saarthi Driver App
3. Scan vehicle QR or enter vehicle number
4. Connect OBD
5. Confirm telemetry
```

Saarthi may provide help/instructions, but must not duplicate the technical implementation.

---

## 17. Digital Sales

Each Saarthi Rahi gets a personal referral mechanism:

```text
Saarthi Rahi
GODID: GOD-7F42K

[Copy Referral Link]
[Show QR]
[Share]
```

Example:

```text
https://saarthi.vorldx.com/r/GOD-7F42K
```

Use the real Saarthi domain/configuration in production.

The referral may be shared through:
- WhatsApp
- SMS
- Email
- social media
- digital brochure
- QR
- direct link

Flow:

```text
Saarthi Rahi
 ↓
Referral Link / QR
 ↓
Customer
 ↓
Saarthi Signup
 ↓
Referral Attribution
 ↓
Subscription
 ↓
Payment
 ↓
Commission Qualification
```

---

## 18. Referral Attribution

Backend must be authoritative.

Conceptually:

```text
ReferralAttribution
├── id
├── godId
├── salespersonExternalId
├── customerId
├── leadId
├── source
├── capturedAt
├── status
├── subscriptionId
└── commissionId
```

Possible sources:

```text
PHYSICAL
REFERRAL_LINK
REFERRAL_QR
ASSISTED_SIGNUP
MANUAL_GODID
```

Manual GODID remains a fallback and must be validated through the approved GODWeb integration.

---

## 19. Attribution Rules

Recommended:

### First valid attribution wins

Saarthi Rahi B cannot overwrite Saarthi Rahi A's valid attribution simply by entering another GODID later.

### Attribution must persist

If a customer enters through a referral and does not immediately subscribe, retain attribution according to the business-defined attribution window.

Do not silently invent an attribution-window duration.

---

## 20. Commission Lifecycle

Referral and commission are different concepts.

```text
Referral
= who brought the customer

Commission
= financial result of a qualifying paid subscription
```

Recommended lifecycle:

```text
REFERRAL_ENTERED
 ↓
VALIDATING
 ↓
VERIFIED
 ↓
CUSTOMER_REGISTERED
 ↓
SUBSCRIPTION_CREATED
 ↓
PAYMENT_SUCCESS
 ↓
COMMISSION_PENDING
 ↓
COMMISSION_APPROVED
 ↓
COMMISSION_PAYABLE
 ↓
COMMISSION_PAID
```

Do not make commission payable merely because a subscription record exists.

Use actual successful payment/subscription state.

---

## 21. Commission Model

Conceptually:

```text
CommissionRule
├── product
├── subscriptionPlan
├── commissionType
├── commissionRate
├── fixedAmount
├── qualificationPeriod
└── active
```

```text
Commission
├── id
├── salespersonExternalId
├── godId
├── customerId
├── subscriptionId
├── paymentId
├── baseAmount
├── commissionRate
├── commissionAmount
├── status
├── eligibleAt
├── approvedAt
└── paidAt
```

Exact commission rates/amounts are business configuration and must not be hard-coded unless already defined.

---

## 22. Digital Tracker Fulfillment

For digital sales:

```text
Customer
 ↓
Subscription Purchase
 ↓
Saarthi Tracker Fulfillment
 ↓
Warehouse / Dispatch
 ↓
Courier
 ↓
Customer
 ↓
Existing Driver App / Vehicle Setup
```

Saarthi supplies the tracker.

Do not introduce a new tracker activation protocol.

---

## 23. Unified Physical vs Digital Model

Only acquisition and tracker delivery differ.

### Physical

```text
Saarthi Rahi visit
 ↓
Demo
 ↓
Subscription
 ↓
Saarthi Rahi gives tracker
 ↓
Saarthi Rahi demonstrates first vehicle
 ↓
Customer repeats setup
```

### Digital

```text
Referral link/QR
 ↓
Online signup
 ↓
Subscription
 ↓
Saarthi ships tracker
 ↓
Customer receives tracker
 ↓
Existing Driver App + vehicle + OBD flow
```

Both converge to:

```text
Customer
 ↓
Subscription
 ↓
Saarthi Tracker
 ↓
Vehicle
 ↓
Existing Driver App
 ↓
OBD
 ↓
Telemetry
 ↓
Saarthi
```

---

## 24. Saarthi Rahi Customer View

Saarthi Rahi should see customers/leads attributed to them, subject to RBAC.

Example:

```text
MY CUSTOMERS

ABC Transport
10 Vehicles
Subscription: Active
Trackers: 10
Live: 1 / 10

XYZ Logistics
5 Vehicles
Subscription: Active
Live: 5 / 5
```

Do not expose unnecessary sensitive customer information.

---

## 25. Saarthi Rahi Tracker View

If tracker inventory is assigned to Saarthi Rahis:

```text
MY TRACKERS

Available       12
Handed Over      8
Installed        5
```

Every transition must be auditable.

Example:

```text
INVENTORY
 ↓
ASSIGNED_TO_SALESMAN
 ↓
HANDED_TO_CUSTOMER
 ↓
INSTALLED
```

Reuse the existing device state machine if one exists.

---

## 26. Saarthi Rahi Commission View

Example:

```text
MY COMMISSION

Pending      ₹XX,XXX
Approved     ₹XX,XXX
Paid         ₹XX,XXX
```

And customer-level entries:

```text
ABC Transport
Subscription
Commission: ₹X,XXX
Status: Approved
```

Saarthi Rahi cannot edit commission amounts.

Commission calculations are server-side.

---

## 27. Anti-Fraud

Prevent:
- invalid/fake GODIDs
- Saarthi Rahi A overwriting Saarthi Rahi B's attribution
- frontend-generated commission amounts
- commission without qualifying payment
- duplicate commission for one subscription
- repeated subscription events generating multiple commissions
- unauthorized attribution changes

Use unique constraints/idempotency where appropriate.

---

## 28. Customer Experience

Customer should experience one Saarthi product:

```text
Saarthi
 ↓
Signup
 ↓
Subscription
 ↓
Tracker
 ↓
Vehicles
 ↓
Driver App
 ↓
Live Fleet
```

The Saarthi Rahi is only the acquisition/onboarding channel.

---

## 29. Backend Integration

Before adding endpoints, inspect existing APIs/services.

Potential routes are illustrative only:

```text
GET    /sales/dashboard
GET    /sales/leads
POST   /sales/leads
GET    /sales/customers
GET    /sales/referrals
POST   /sales/referrals/validate
GET    /sales/commission
GET    /sales/trackers
POST   /sales/tracker-handover
POST   /sales/onboarding/complete
```

Do not implement these blindly. Reuse existing services/routes wherever possible.

---

## 30. RBAC

Saarthi Rahi permissions should be explicit.

Potential permissions:

```text
sales:read
sales:write
leads:read
leads:write
referrals:read
referrals:create
commission:read
tracker_handover:write
demo:use
```

Follow the existing Saarthi RBAC model.

Saarthi Rahis must not automatically receive:
- admin permissions
- payment administration
- commission editing
- customer credential access
- unrestricted device inventory administration

---

## 31. Auditability

Record important actions:

```text
Lead created
Referral captured
GODID validated
Customer attributed
Subscription created
Payment qualified
Commission generated
Tracker assigned
Tracker handed over
First vehicle demonstrated
Onboarding completed
```

Use the existing audit/logging architecture where available.

---

## 32. Claude Code Implementation Protocol

Before coding:

1. Read `CLAUDE.md`.
2. Read all relevant `.md` files.
3. Inspect existing authentication/RBAC.
4. Inspect customer/fleet/driver models.
5. Inspect subscription/payment systems.
6. Inspect tracker/device inventory and terminal implementation.
7. Inspect Driver App and vehicle pairing.
8. Inspect telemetry/OBD flow.
9. Inspect GODWeb integration.
10. Search for existing lead/referral/commission/sales functionality.
11. Search existing roles and permissions.
12. Search existing customer onboarding.

Then produce:

```text
ALREADY IMPLEMENTED
PARTIALLY IMPLEMENTED
NEW REQUIRED
DUPLICATE — REUSE EXISTING
CONFLICT — REQUIRES DECISION
```

Do not code before this analysis.

---

## 33. Acceptance Criteria

### Saarthi Rahi
- [ ] Verified GODID can be associated with a Saarthi Rahi.
- [ ] Saarthi Rahi can access Sales inside existing Saarthi.
- [ ] Saarthi Rahi can create/manage leads.
- [ ] Saarthi Rahi can use safe Demo Mode.
- [ ] Saarthi Rahi can see attributed customers.
- [ ] Saarthi Rahi can see commission status.

### Physical sales
- [ ] Customer can register and subscribe.
- [ ] Saarthi Rahi can record tracker handover.
- [ ] Saarthi Rahi can complete one real first-vehicle demonstration.
- [ ] Existing Driver App is used.
- [ ] Existing vehicle QR/vehicle-number connection is used.
- [ ] Existing OBD flow is used.
- [ ] Telemetry reaches Saarthi.
- [ ] Customer can repeat the same process for remaining vehicles.

### Digital sales
- [ ] Saarthi Rahi has referral link.
- [ ] Saarthi Rahi has referral QR.
- [ ] Referral attribution is server-side.
- [ ] Customer can register and subscribe.
- [ ] Tracker fulfillment uses existing commerce/operations architecture.
- [ ] Existing Driver App/OBD setup is used after delivery.

### Commission
- [ ] Commission is calculated server-side.
- [ ] Commission is tied to correct Saarthi Rahi/GODID.
- [ ] Duplicate commissions are prevented.
- [ ] Saarthi Rahi cannot edit commission.
- [ ] Commission status is visible.
- [ ] Qualification uses actual successful payment/subscription rules.

### Architecture
- [ ] No separate Sales portal.
- [ ] No separate Saarthi Rahi APK.
- [ ] No GODWeb modification.
- [ ] No tracker QR workflow.
- [ ] No duplicate tracker activation.
- [ ] No duplicate Driver App.
- [ ] No duplicate OBD/telemetry implementation.
- [ ] Existing Saarthi design system and architecture preserved.

---

## 34. Final Target Architecture

```text
                         GODWeb
                           │
                     Existing GODID
                           │
                     READ / VALIDATE
                           │
                           ▼
                    ┌──────────────┐
                    │   SAARTHI    │
                    │ Auth + RBAC  │
                    └──────┬───────┘
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
         CUSTOMER       SALESMAN       ADMIN
             │             │             │
             │         Sales Module     │
             │             │             │
             │      ┌──────┼──────┐      │
             │      │      │      │      │
             │    Leads   Demo Referral  │
             │      │      │      │      │
             │      └──────┼──────┘      │
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                    Subscription
                           │
                         Payment
                           │
                    ┌──────┴──────┐
                    │             │
               PHYSICAL       DIGITAL
                    │             │
              Saarthi Rahi gives   Saarthi ships
                 tracker         tracker
                    │             │
                    └──────┬──────┘
                           ▼
                 EXISTING VEHICLE FLOW
                           │
                    Saarthi Tracker
                           │
                    Driver App
                           │
                Vehicle QR / Number
                           │
                         OBD
                           │
                      Telemetry
                           │
                           ▼
                    Saarthi Backend
                           │
                           ▼
                    Fleet Dashboard
                           │
                           ▼
                       Commission
```

## Core Principle

> **GODWeb owns Saarthi Rahi identity. Saarthi owns the entire Saarthi sale. The existing Driver App, tracker/terminal, OBD, vehicle pairing and telemetry systems remain the technical source of truth. The new work is the sales/referral/commission layer and the necessary handover/onboarding tracking around those existing systems.**
