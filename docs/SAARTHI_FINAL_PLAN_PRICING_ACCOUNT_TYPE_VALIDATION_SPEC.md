# SAARTHI --- FINAL PLAN, PRICING & ACCOUNT-TYPE VALIDATION SPECIFICATION

## Purpose

Use this document as a validation specification for Claude Code.

The goal is to inspect the existing Saarthi implementation and determine
whether the current pricing, plans, account types, vehicle rules,
tracker rules, trial, and feature applicability match the latest
business requirements.

**Do not rebuild the system.** First inspect and report what is correct,
partial, incorrect, missing, duplicated, or conflicting. Make changes
only when explicitly authorized.

------------------------------------------------------------------------

## 1. Current Source of Truth

### Latest Pricing Correction

The latest pricing decision supersedes the previous ₹117/₹235/₹176/₹70 calculations.

The customer-facing final amounts are intentionally rounded to attractive prices ending in **9**:

- Personal: **₹119/month, GST included**
- Business: **₹239/month, GST included**
- Supplier: **₹179/month, GST included**
- Additional vehicle: **₹99/month, GST included**

Do not expose the underlying 18% GST calculation on normal pricing cards.


These requirements supersede older Saarthi pricing assumptions:

-   Paid plans have a **30-day trial**.
-   Customer-facing pricing shows **rounded final payable amounts**.
-   Do **not** show the 18% GST calculation separately on normal pricing
    cards.
-   **Plan and Account Type are separate concepts.**
-   Plans must NOT be used as a feature-restriction matrix.
-   Account Type must NOT be inferred solely from Plan.
-   Vehicle-dependent functionality is applicable when the account has
    an eligible vehicle.
-   Fleet Owners must have a tracker.
-   Tracker products: **₹599** and **₹1,999**. Their GST treatment is
    not yet specified here; do not assume it.
-   Driver App is provided to drivers.
-   Additional vehicle top-up: **₹99/month (GST included)**, displayed to customers
    as **₹99/vehicle/month**.
-   Marketplace order payment remains **30% at confirmation + 70% after
    delivery**.

------------------------------------------------------------------------

## 2. Customer-Facing Pricing

The customer should see only rounded final prices.

### Current displayed prices

  Product                Base   GST   Exact total   Customer-facing price
  -------------------- ------ ----- ------------- -----------------------
  Personal                ₹99   18%       ₹119          **₹119/month**
  Business               ₹199   18%       ₹239          **₹239/month**
  Supplier               ₹149   18%       ₹179          **₹179/month**
  Additional Vehicle      ₹59   18%        ₹99   **₹99/vehicle/month**

Do not show pricing-card text such as:

-   ₹119/month (GST included)
-   ₹239/month (GST included)
-   ₹179/month (GST included)
-   ₹99/month (GST included)

Instead show:

-   **Personal --- ₹119/month**
-   **Business --- ₹239/month**
-   **Supplier --- ₹179/month**
-   **Additional Vehicle --- ₹99/month**

### Important billing distinction

The rounded amount is a **customer-facing presentation rule**.

Do not blindly replace the underlying accounting/tax calculation with
the rounded display value.

Inspect the current architecture and distinguish:

1.  Base commercial price
2.  Tax calculation
3.  Customer-facing rounded display price
4.  Actual payment amount
5.  Invoice/accounting amount

If the current implementation charges the rounded amount rather than the
exact configured/tax amount, report it for business confirmation instead
of silently changing it.

------------------------------------------------------------------------

# 3. Plans

## FREE

Commercial plan: **FREE**

Free contexts include:

-   Customer
-   Driver

Free users do not pay a subscription fee.

Operational behavior must come from the existing account-type/RBAC
architecture.

## PERSONAL

Customer-facing price:

**₹119/month**

Underlying commercial price:

**₹119/month (GST included)**

Includes:

-   1 vehicle

Rules:

-   Personal use
-   Normal/personal vehicles
-   No trucks
-   User may act as their own driver
-   Tracker is optional
-   Driver App is available where applicable

## BUSINESS

Customer-facing price:

**₹239/month**

Underlying commercial price:

**₹239/month (GST included)**

Includes:

-   1 eligible vehicle/truck according to Account Type

Business operational contexts:

### Fleet Owner

-   Trucks only
-   Tracker mandatory
-   Fleet/vehicle operations
-   Driver operations where applicable

### Tour / Travel / Mobility Provider

-   Vehicles only
-   No truck/freight-only workflow
-   Mobility/tour/travel operations

**Business plan does not itself decide which operational workflow
applies. Account Type does.**

## SUPPLIER

Customer-facing price:

**₹179/month**

Underlying commercial price:

**₹179/month (GST included)**

Rules:

-   No vehicle
-   No truck
-   No fleet setup
-   Material-related functionality
-   Supplier/order/material workflows

Supplier must not inherit vehicle/fleet functionality because of shared
code or Business-like abstractions.

------------------------------------------------------------------------

# 4. 30-Day Trial

The paid subscription trial is:

**30 days**

This replaces the old 14-day assumption.

Search the repository for semantic legacy references such as:

-   `14 days`
-   `14-day`
-   trial duration constants
-   trial calculations
-   Cashfree trial configuration
-   pricing-page trial text
-   backend trial logic
-   subscription tests

Do not blindly replace unrelated occurrences of the number 14.

Expected concept:

``` text
Paid Plan
  ↓
Subscription
  ↓
30-Day Trial
  ↓
Trial Active
  ↓
Recurring Billing
```

Verify the actual Cashfree implementation rather than assuming the UI
text is authoritative.

------------------------------------------------------------------------

# 5. PLAN ≠ ACCOUNT TYPE

This is a critical architecture requirement.

## Plan

Plan is the **commercial/billing layer**.

It answers:

-   What subscription does the account have?
-   What is its price?
-   What billing cycle applies?
-   What trial applies?
-   What base quantity is included?
-   What additional vehicle charge applies?

Examples:

``` text
FREE
PERSONAL
BUSINESS
SUPPLIER
```

## Account Type

Account Type is the **operational identity layer**.

Examples:

``` text
CUSTOMER
DRIVER
FLEET_OWNER
MOBILITY_PROVIDER / TOUR_TRAVEL
SUPPLIER
```

It answers:

-   What does this account do?
-   What onboarding applies?
-   What entities can it create?
-   What operational workflows apply?
-   What vehicle category is allowed?
-   What permissions/RBAC apply?

------------------------------------------------------------------------

# 6. Never Use Plan as an Account-Type Substitute

Do not implement logic like:

``` ts
if (plan === "BUSINESS") {
    showFleetFeatures();
}
```

That is incorrect.

Operational behavior should conceptually be determined by:

``` text
PLAN
+
ACCOUNT TYPE
+
RESOURCE / ENTITY STATE
+
RBAC / PERMISSION
```

Examples:

``` text
BUSINESS + FLEET_OWNER + TRUCK
```

and:

``` text
BUSINESS + MOBILITY_PROVIDER + CAR
```

may share the same commercial subscription but have different
operational functionality.

------------------------------------------------------------------------

# 7. No Plan-Based Feature Degradation

Saarthi is NOT:

``` text
Free = fewer features
Personal = medium features
Business = all features
```

Do not arbitrarily hide functionality because a plan is cheaper.

Instead:

> A feature is applicable according to the user's role/account type,
> permissions, and required resources.

Telemetry is the clearest example.

Incorrect:

``` text
Business → telemetry
Personal → telemetry disabled
```

Correct:

``` text
Eligible Vehicle
      ↓
Vehicle ecosystem
      ↓
Telemetry becomes applicable
```

A user without a vehicle has no applicable vehicle telemetry.

A Personal user with an eligible vehicle can use vehicle-dependent
functionality according to the existing architecture.

------------------------------------------------------------------------

# 8. Vehicle-Level Validation

Vehicle eligibility must be validated when the user adds/onboards a
vehicle.

### Personal

Allowed:

-   Normal/personal vehicles

Not allowed:

-   Trucks

### Business Fleet Owner

Allowed:

-   Trucks

Required:

-   Tracker

### Business Tour/Travel/Mobility

Allowed:

-   Eligible non-truck vehicles

Not allowed:

-   Truck/freight-only workflow

### Supplier

Allowed:

-   No vehicle onboarding

The system should stop invalid onboarding at the vehicle/entity boundary
rather than implementing unrelated global feature restrictions.

------------------------------------------------------------------------

# 9. Telematics

Telemetry is vehicle-dependent.

Correct:

``` text
Account
  ↓
Eligible Vehicle
  ↓
Vehicle / Tracker / Telemetry setup
  ↓
Telemetry applicable
```

Incorrect:

``` text
Business plan
  ↓
Telemetry automatically enabled
```

Also incorrect:

``` text
Personal plan
  ↓
Telemetry permanently disabled
```

Telemetry should not be treated as a plan-exclusive feature.

------------------------------------------------------------------------

# 10. Tracker Rules

Current tracker products:

``` text
Tracker A = ₹599
Tracker B = ₹1,999
```

**Do not assume these prices include or exclude GST.** That needs
separate confirmation.

### Fleet Owner

Tracker is mandatory.

Conceptually:

``` text
Fleet Owner
  ↓
Truck
  ↓
Tracker Required
  ↓
Vehicle onboarding completion
```

### Personal

Tracker is optional.

Do not force tracker purchase merely because the account is Personal.

------------------------------------------------------------------------

# 11. Driver App

Driver App is provided to drivers.

It is not a premium-plan feature.

Do not create logic such as:

``` text
Business → Driver App
Personal → No Driver App
```

Driver access must use the existing Driver role/authentication/RBAC
architecture.

Do not rebuild the existing Driver App.

Do not create a second driver app.

Do not create a separate driver subscription merely for the Driver App.

------------------------------------------------------------------------

# 12. Additional Vehicle Top-Up

Base:

**₹99 per additional vehicle/month (GST included)**

Exact calculated amount:

**₹99**

Customer-facing rounded amount:

**₹99/month**

Conceptually:

``` text
Included Vehicle
    ↓
Additional Vehicle
    ↓
₹99/month displayed
```

Prefer quantity/add-on billing where the existing architecture supports
it.

Do not create dozens of plans such as:

``` text
Personal-2
Personal-3
Business-2
Business-3
...
```

unless the existing architecture has a demonstrated reason for doing so.

------------------------------------------------------------------------

# 13. Examples of Correct Separation

## Personal with no vehicle

``` text
Plan = PERSONAL
Account Type = personal/owner context
Vehicles = 0
```

Result:

-   Subscription exists
-   Vehicle telemetry is not applicable
-   User can be prompted to add a vehicle
-   Do not say telemetry is disabled because Personal is a lower plan

## Personal with one car

``` text
Plan = PERSONAL
Account Type = personal/owner context
Vehicle = 1 car
```

Result:

-   Personal subscription
-   Vehicle functionality applies
-   Telemetry can become applicable
-   Tracker remains optional

## Business Fleet Owner

``` text
Plan = BUSINESS
Account Type = FLEET_OWNER
Vehicle = Truck
```

Result:

-   Business subscription
-   Fleet Owner workflow
-   Truck workflow
-   Tracker mandatory
-   Driver/fleet operations applicable

## Business Mobility Provider

``` text
Plan = BUSINESS
Account Type = MOBILITY_PROVIDER
Vehicle = Car/SUV
```

Result:

-   Business subscription
-   Mobility workflow
-   Vehicle operations
-   No truck/freight-only workflow

## Supplier

``` text
Plan = SUPPLIER
Account Type = SUPPLIER
Vehicle = None
```

Result:

-   Supplier subscription
-   Material functionality
-   Supplier order workflow
-   No vehicle/fleet/telemetry setup

## Free Customer

``` text
Plan = FREE
Account Type = CUSTOMER
Vehicle = None
```

Result:

-   No paid subscription
-   Customer workflows
-   Requirement/order functionality according to existing implementation
-   No vehicle required merely to use Free Customer functionality

------------------------------------------------------------------------

# 14. Marketplace Order Payments

Subscription billing is separate from marketplace order payments.

Current marketplace rule:

``` text
ORDER CONFIRMED
      ↓
30% PAYMENT
      ↓
DELIVERY
      ↓
70% PAYMENT
```

Do not mix:

-   SaaS subscription billing
-   Tracker purchase
-   Additional vehicle billing
-   Marketplace order payment

They are separate financial flows.

------------------------------------------------------------------------

# 15. Cashfree Validation

If Cashfree is already integrated, inspect the existing implementation.

Verify:

### Subscription

-   Correct plan mapping
-   Correct amount
-   30-day trial
-   Monthly billing
-   Customer/account mapping
-   Cashfree subscription ID
-   Webhook handling
-   Idempotency
-   Renewal
-   Failed payment handling
-   Cancellation
-   Expiry
-   Reconciliation

### Additional vehicles

Determine how the existing system implements additional vehicle billing:

-   Subscription quantity
-   Subscription modification
-   Add-on
-   Separate recurring charge
-   Existing billing mechanism

Do not invent a new mechanism if an existing one is correct.

### Tracker

Keep tracker purchase separate from recurring subscription billing
unless the business design explicitly says otherwise.

------------------------------------------------------------------------

# 16. Pricing UI Audit

Inspect:

-   Homepage
-   Pricing
-   Registration
-   Plan selection
-   Checkout
-   Subscription confirmation
-   Billing page
-   Upgrade/downgrade
-   Additional vehicle UI
-   Tracker purchase UI
-   Emails/notifications containing pricing

Customer-facing subscription prices should be:

``` text
Personal
₹119/month

Business
₹239/month

Supplier
₹179/month

Additional Vehicle
₹99/month
```

Do not show the 18% GST calculation separately on normal pricing cards.

Invoices/receipts may have tax breakdowns if required by the accounting
design; that is separate from the pricing-card presentation.

------------------------------------------------------------------------

# 17. Legacy Value Audit

Search for legacy assumptions:

``` text
14-day
14 days
₹75
₹499
30 months
30-month
₹119/month (GST included)
₹239/month (GST included)
₹179/month (GST included)
₹99/month (GST included)
```

Inspect:

-   Constants
-   Database seed
-   Prisma/schema
-   Migrations
-   API validation
-   Registration
-   Billing services
-   Pricing configuration
-   Cashfree integration
-   Tests
-   Fixtures
-   Documentation
-   Translations
-   Emails
-   Notifications
-   Checkout summaries

Do not blindly replace every numeric occurrence.

------------------------------------------------------------------------

# 18. Required Validation Matrix

Produce this table in the audit:

  Area                         Expected               Current   Status
  ---------------------------- ---------------------- --------- --------
  Personal display             ₹119/month                       
  Business display             ₹239/month                       
  Supplier display             ₹179/month                       
  Additional vehicle display   ₹99/month                        
  Trial                        30 days                          
  Plan/account separation      Independent                      
  Personal truck restriction   Blocked                          
  Fleet Owner truck            Required                         
  Fleet Owner tracker          Mandatory                        
  Personal tracker             Optional                         
  Supplier vehicle             Not allowed                      
  Driver App                   Available to drivers             
  Telemetry                    Vehicle-dependent                
  Marketplace payment          30% + 70%                        
  Tracker ₹599                 Present                          
  Tracker ₹1,999               Present                          

------------------------------------------------------------------------

# 19. Required Test Matrix

### Plans

-   Free Customer
-   Free Driver
-   Personal
-   Business Fleet Owner
-   Business Mobility Provider
-   Supplier

### Vehicles

-   Personal + valid car
-   Personal + truck → rejected
-   Fleet Owner + truck → accepted subject to tracker requirement
-   Mobility Provider + valid vehicle
-   Mobility Provider + truck → rejected if outside allowed category
-   Supplier + vehicle → rejected
-   Free Customer + no vehicle → valid

### Feature applicability

-   No vehicle → telemetry not applicable
-   Eligible vehicle → telemetry becomes applicable
-   Personal vehicle → vehicle ecosystem available
-   Fleet Owner truck → fleet/telemetry workflow available
-   Supplier → no vehicle workflow
-   Driver → Driver App workflow available

### Billing

-   Personal subscription
-   Business subscription
-   Supplier subscription
-   Additional vehicle
-   30-day trial
-   Trial expiry
-   Renewal
-   Payment failure
-   Duplicate webhook
-   Cancelled checkout
-   Refund/cancellation according to existing policy

------------------------------------------------------------------------

# 20. Do Not Rebuild

Preserve existing systems.

Do not rebuild:

-   Authentication
-   RBAC
-   Driver App
-   Vehicle management
-   Tracker architecture
-   OBD
-   Telemetry
-   Android Auto
-   Marketplace
-   Orders
-   Existing Cashfree integration
-   Existing subscription system
-   Existing database models

unless the audit proves a specific component is incompatible and a later
instruction authorizes the change.

------------------------------------------------------------------------

# 21. Final Architecture Principle

The implementation must maintain this separation:

``` text
                    SAARTHI ACCOUNT
                           │
             ┌─────────────┴─────────────┐
             │                           │
          PLAN                    ACCOUNT TYPE
       (Commercial)               (Operational)
             │                           │
       Billing/Trial              Role/Workflow
       Subscription               Permissions
       Base Quantity              Allowed Entities
             │                           │
             └─────────────┬─────────────┘
                           ↓
                    RESOURCE STATE
                           │
                  ┌────────┼────────┐
                  ↓        ↓        ↓
               Vehicle   Driver   Orders
                  │
                  ↓
             Tracker/OBD
                  │
                  ↓
              Telemetry
```

**Plan controls commercial billing.**

**Account Type controls operational identity.**

**Resources determine whether resource-dependent functionality is
applicable.**

**RBAC controls authorization.**

These concepts must remain separate throughout frontend, backend,
database, API, billing, entitlement, and UI layers.

------------------------------------------------------------------------

# 22. Claude Audit Procedure

Before changing anything:

1.  Read `CLAUDE.md`.
2.  Read all relevant project MD/specification files.
3.  Inspect plan enums/schema/models.
4.  Inspect account-type/organization-type models.
5.  Inspect registration/onboarding.
6.  Inspect subscription/billing services.
7.  Inspect pricing configuration.
8.  Inspect vehicle onboarding.
9.  Inspect tracker purchase/assignment.
10. Inspect telemetry guards.
11. Inspect RBAC/permissions.
12. Inspect Cashfree integration.
13. Inspect tests.
14. Search for all legacy pricing/trial assumptions.
15. Compare implementation against this specification.
16. Produce an audit report.
17. **Do not make code changes until explicitly authorized after the
    audit.**

## Required final report sections

### A. Pricing Status

Every current price and whether it matches.

### B. Plan Status

Whether Free, Personal, Business and Supplier are correctly represented.

### C. Account Type Status

How Account Type is represented and whether it is independent from Plan.

### D. Collision Analysis

Identify places where Plan and Account Type are mixed incorrectly.

### E. Trial Status

Confirm whether the system actually implements 30 days.

### F. Pricing Display Status

Confirm whether users see rounded final prices without separate GST
calculation.

### G. Vehicle/Tracker Status

Confirm all vehicle and tracker rules.

### H. Cashfree Status

Confirm subscription, trial, renewal and payment implementation.

### I. Tests

List existing tests and missing tests.

### J. Recommended Changes

Only list changes actually required.

**Do not perform unrelated refactors.**
