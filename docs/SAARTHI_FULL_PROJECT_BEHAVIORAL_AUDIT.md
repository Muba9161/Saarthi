# SAARTHI --- FULL PROJECT PLAN, PRICING & BEHAVIORAL AUDIT

## Purpose

This document is an **audit specification for Claude Code**.

Claude must analyze the **entire existing Saarthi project** and verify
whether the real implementation behaves according to the latest
business, pricing, plan, account-type, vehicle, tracker, subscription,
telemetry, driver, and payment requirements.

This is a **read-only audit first**.

> **Do not modify, refactor, rebuild, migrate, rename, delete, or
> replace anything during the audit.**

The first objective is to understand the current project and identify
whether it actually works according to the requirements below.

Only make implementation changes after the audit report is complete and
Sir explicitly authorizes them.

------------------------------------------------------------------------

# 1. Latest Business Source of Truth

Use these values and rules as the current source of truth.

## Customer-facing prices

GST is included in the displayed final price.

  Product / Plan         Customer-facing price
  -------------------- -----------------------
  Personal                      **₹119/month**
  Business                      **₹239/month**
  Supplier                      **₹179/month**
  Additional Vehicle             **₹99/month**

### Pricing display rule

Do NOT show the 18% GST calculation separately on normal pricing cards.

Do NOT show:

``` text
₹99 + 18% GST
₹199 + 18% GST
₹149 + 18% GST
₹59 + 18% GST
```

Show only:

``` text
Personal       ₹119/month
Business       ₹239/month
Supplier       ₹179/month
Additional     ₹99/month
```

The tax/accounting breakdown may exist internally and on
invoices/receipts if required, but it must not be presented as a
separate GST calculation on normal pricing cards.

------------------------------------------------------------------------

# 2. Trial

Paid plans use a:

**30-day trial**

The old 14-day trial is obsolete.

Claude must search the whole project for legacy assumptions such as:

``` text
14 days
14-day
14 day
30 months
30-month
```

Do not blindly replace every numeric occurrence. Determine the semantic
meaning first.

Expected behavior:

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

Verify the actual backend/payment behavior, not just the pricing-page
text.

------------------------------------------------------------------------

# 3. Critical Architecture Rule

## PLAN ≠ ACCOUNT TYPE

This distinction must remain intact throughout the entire project.

### Plan

Plan is the **commercial/billing layer**.

It determines things such as:

-   Subscription
-   Billing cycle
-   Base price
-   Trial
-   Included vehicle quantity
-   Additional vehicle billing
-   Subscription status

Current plans:

``` text
FREE
PERSONAL
BUSINESS
SUPPLIER
```

### Account Type

Account Type is the **operational identity/workflow layer**.

Examples:

``` text
CUSTOMER
DRIVER
FLEET_OWNER
MOBILITY_PROVIDER / TOUR_TRAVEL
SUPPLIER
```

It determines:

-   Onboarding
-   Operational workflow
-   Role
-   Permissions
-   Allowed entities
-   Vehicle category
-   Business operations
-   Dashboard context

------------------------------------------------------------------------

# 4. Plan and Account Type Must Never Collide

Do not use:

``` ts
if (plan === "BUSINESS") {
    enableFleetOwnerFeatures();
}
```

as the general authorization model.

Business can contain different operational account types.

For example:

``` text
BUSINESS + FLEET_OWNER
```

and:

``` text
BUSINESS + MOBILITY_PROVIDER
```

have the same commercial plan but different operational workflows.

Similarly:

``` text
FREE + CUSTOMER
```

and:

``` text
FREE + DRIVER
```

are different operational contexts.

The audit must find every place where Plan is incorrectly being used as:

-   Account Type
-   Role
-   Permission
-   Vehicle category
-   Dashboard type
-   Feature eligibility
-   Workflow selector

Also find the reverse problem where Account Type is incorrectly being
used as:

-   Subscription plan
-   Price
-   Billing
-   Trial
-   Payment amount

------------------------------------------------------------------------

# 5. No Artificial Plan-Based Feature Restriction

Saarthi is NOT intended to operate as:

``` text
Free = fewer features
Personal = medium features
Business = all features
```

Do not interpret plans as arbitrary feature tiers.

A feature is applicable according to:

``` text
Account Type
+
RBAC / Permission
+
Resource State
+
Workflow
```

while Plan handles commercial billing.

------------------------------------------------------------------------

# 6. Vehicle-Dependent Functionality

Vehicle functionality is controlled at the **vehicle/entity level**.

Example:

``` text
User
 ↓
No Vehicle
 ↓
Vehicle telemetry is not applicable
```

After:

``` text
User
 ↓
Adds eligible Vehicle
 ↓
Vehicle exists
 ↓
Vehicle-dependent functionality becomes applicable
```

Telemetry is therefore NOT a Business-only feature.

Do not implement:

``` text
Business → telemetry
Personal → telemetry disabled
```

Instead:

``` text
Eligible Vehicle
+
Applicable device/telemetry setup
 ↓
Telemetry applicable
```

The audit must verify this across:

-   UI
-   API
-   Backend
-   Database
-   RBAC
-   Telemetry services
-   OBD
-   Tracker
-   WebSocket/realtime
-   Dashboard

------------------------------------------------------------------------

# 7. Plan Details

## FREE

Free is a commercial plan.

Current Free operational contexts include:

### Free Customer

-   No paid subscription
-   No vehicle requirement
-   Can post requirements
-   Can use applicable order/customer functionality

### Free Driver

-   Driver workflow
-   Driver App
-   Driver-specific operations

Do not turn Free into a generic "feature restricted" plan.

------------------------------------------------------------------------

# 8. PERSONAL

Customer-facing price:

**₹119/month --- GST included**

Underlying business pricing was ₹99 + 18% GST, but the customer-facing
amount is ₹119.

Includes:

-   1 vehicle

Rules:

-   Personal use
-   Cars/normal eligible vehicles
-   No trucks
-   User may act as own driver
-   Tracker optional
-   Driver App where applicable
-   Vehicle-dependent functionality becomes applicable after vehicle
    exists

Personal is not a "low-feature" plan.

------------------------------------------------------------------------

# 9. BUSINESS

Customer-facing price:

**₹239/month --- GST included**

Includes:

-   1 eligible vehicle/truck according to Account Type

Business operational contexts include:

## Fleet Owner

-   Trucks only
-   Tracker mandatory
-   Fleet operations
-   Vehicle operations
-   Driver operations where applicable

## Mobility / Tour / Travel Provider

-   Vehicles only
-   No truck/freight-only workflow
-   Mobility/tour/travel operations

The Business plan does not itself decide whether an account is a Fleet
Owner or Mobility Provider.

Account Type does.

------------------------------------------------------------------------

# 10. SUPPLIER

Customer-facing price:

**₹179/month --- GST included**

Rules:

-   No vehicle
-   No truck
-   No fleet setup
-   No vehicle telemetry setup
-   Material-related functionality
-   Supplier/order/material workflow

Supplier must not accidentally inherit vehicle/fleet functionality
because of shared abstractions.

------------------------------------------------------------------------

# 11. Additional Vehicle

Customer-facing price:

**₹99/month --- GST included**

This is an additional recurring vehicle charge.

Conceptually:

``` text
Plan
 ↓
Included Vehicle
 ↓
Additional Vehicle
 ↓
₹99/month
```

Do not create separate plans such as:

``` text
Personal-2
Personal-3
Personal-4
Business-2
Business-3
Business-4
```

unless the existing architecture has a strong technical reason.

Prefer quantity/add-on logic where supported.

Verify:

-   Quantity calculation
-   Backend authority
-   Database representation
-   Cashfree representation
-   Adding vehicles
-   Removing vehicles
-   Billing changes
-   Duplicate charging prevention

------------------------------------------------------------------------

# 12. Vehicle Rules

## Personal

Allowed:

-   Eligible personal/normal vehicles

Rejected:

-   Trucks

## Business Fleet Owner

Allowed:

-   Trucks

Tracker:

-   **Mandatory**

## Business Mobility Provider

Allowed:

-   Eligible non-truck vehicles

Rejected:

-   Truck/freight-only workflow

## Supplier

Vehicle onboarding:

-   Not applicable
-   Must be rejected server-side if attempted

The authoritative backend must enforce these rules.

Frontend hiding alone is insufficient.

------------------------------------------------------------------------

# 13. Tracker Rules

Current tracker products:

``` text
Tracker A = ₹599
Tracker B = ₹1,999
```

The GST treatment of these tracker prices is not defined by this
specification.

Do not invent or silently alter their tax treatment.

## Fleet Owner

Tracker is mandatory.

Expected concept:

``` text
Fleet Owner
 ↓
Truck
 ↓
Tracker required
 ↓
Vehicle onboarding completion
```

Verify that the requirement cannot be bypassed through direct API calls.

## Personal

Tracker is optional.

Do not force a tracker for Personal merely because the account has a
vehicle.

------------------------------------------------------------------------

# 14. Driver App

The Driver App is provided to drivers.

It is not a premium feature.

Do not create:

``` text
Business → Driver App
Personal → No Driver App
```

Driver access should come from the existing Driver
role/authentication/RBAC architecture.

Do not:

-   Rebuild the Driver App
-   Create another Driver App
-   Create a separate driver subscription
-   Duplicate driver authentication

Inspect the existing implementation.

------------------------------------------------------------------------

# 15. Marketplace Order Payments

Marketplace order payments are separate from SaaS subscriptions.

Current order payment model:

``` text
Order Confirmed
      ↓
30% Payment
      ↓
Delivery
      ↓
70% Payment
```

Do not mix:

``` text
Subscription
Tracker Purchase
Additional Vehicle
Marketplace Order
```

into one financial model unless the existing business specification
explicitly requires it.

------------------------------------------------------------------------

# 16. Full Project Audit

Claude must analyze the COMPLETE repository, not only pricing files.

Inspect:

-   Frontend applications
-   Backend applications
-   API routes
-   Services
-   Controllers
-   Database schema
-   Migrations
-   Seed data
-   Authentication
-   RBAC
-   Plan models
-   Account Type models
-   Registration
-   Onboarding
-   Vehicle management
-   Tracker management
-   Driver management
-   Telemetry
-   OBD
-   WebSockets
-   Orders
-   Marketplace
-   Subscription
-   Billing
-   Cashfree
-   Webhooks
-   Ledger
-   Notifications
-   Emails
-   Dashboards
-   Navigation
-   Tests
-   Documentation

------------------------------------------------------------------------

# 17. Build an Architecture Map

Create a current implementation map:

``` text
User
 ↓
Registration
 ↓
Plan Selection
 ↓
Account Type
 ↓
Verification
 ↓
Subscription
 ↓
Vehicle / Supplier / Driver Setup
 ↓
Resource Creation
 ↓
Feature Applicability
 ↓
Orders
 ↓
Payments
 ↓
Telemetry
 ↓
Dashboard
```

For each stage identify:

-   Frontend route/component
-   API endpoint
-   Backend service
-   Database model/table
-   Authorization guard
-   External provider
-   Webhook
-   Tests

------------------------------------------------------------------------

# 18. Trace Every Account Workflow

Audit end-to-end:

## Free Customer

``` text
Registration
 → Free
 → Customer
 → Customer functionality
```

## Free Driver

``` text
Registration
 → Free
 → Driver
 → Driver verification
 → Driver App
```

## Personal

``` text
Registration
 → Personal
 → 30-day trial
 → Vehicle validation
 → Vehicle
 → Optional tracker
 → Vehicle functionality
 → Telemetry when applicable
```

## Business Fleet Owner

``` text
Registration
 → Business
 → Fleet Owner
 → 30-day trial
 → Truck validation
 → Tracker requirement
 → Vehicle
 → Driver
 → Telemetry
```

## Business Mobility Provider

``` text
Registration
 → Business
 → Mobility/Tour/Travel
 → 30-day trial
 → Vehicle validation
 → Mobility workflow
```

## Supplier

``` text
Registration
 → Supplier
 → 30-day trial
 → Supplier/material workflow
```

Supplier must never be pushed through vehicle/tracker/fleet onboarding.

------------------------------------------------------------------------

# 19. Trace Vehicle Lifecycle

Audit:

``` text
Add Vehicle
 ↓
Account Type Validation
 ↓
Vehicle Type Validation
 ↓
Subscription/Quantity Validation
 ↓
Tracker Requirement
 ↓
Create Vehicle
 ↓
Device/Telemetry Setup
 ↓
Vehicle Dashboard
```

Test:

``` text
Personal + Car
→ Allowed

Personal + Truck
→ Rejected

Fleet Owner + Truck
→ Allowed only when tracker requirement is satisfied

Mobility Provider + Car/SUV
→ Allowed

Mobility Provider + Truck
→ Rejected if outside defined vehicle category

Supplier + Vehicle
→ Rejected
```

------------------------------------------------------------------------

# 20. Trace Telemetry

Verify:

``` text
Vehicle
 ↓
Device/Tracker/OBD
 ↓
Telemetry
 ↓
Backend ingestion
 ↓
Persistence
 ↓
Realtime/WebSocket
 ↓
Dashboard
```

Check:

-   GPS
-   OBD
-   Tracker
-   Device pairing
-   Reconnection
-   Offline handling
-   Telemetry persistence
-   Realtime updates
-   Dashboard rendering

Do not rebuild the existing telemetry system.

------------------------------------------------------------------------

# 21. Trace Subscription and Cashfree

Verify the complete lifecycle.

## Personal

``` text
₹119/month
GST included
30-day trial
1 vehicle
```

## Business

``` text
₹239/month
GST included
30-day trial
1 included vehicle
```

## Supplier

``` text
₹179/month
GST included
30-day trial
```

## Additional Vehicle

``` text
₹99/month
GST included
```

Check:

-   Pricing UI
-   Backend price authority
-   Subscription creation
-   Trial
-   Cashfree request
-   Customer mapping
-   Subscription ID
-   Webhooks
-   Signature verification
-   Idempotency
-   Renewal
-   Failed payment
-   Cancellation
-   Expiry
-   Reconciliation
-   Database state
-   Entitlement/account state

Never trust frontend payment success alone.

------------------------------------------------------------------------

# 22. Trial Audit

Trace:

``` text
Signup
 ↓
Subscription
 ↓
Trial starts
 ↓
Trial end stored
 ↓
Trial active
 ↓
Trial expires
 ↓
Recurring payment
 ↓
Cashfree webhook
 ↓
Subscription renewal
```

Verify that the actual backend behavior is 30 days.

------------------------------------------------------------------------

# 23. Pricing Consistency Audit

Search all pricing surfaces:

-   Homepage
-   Pricing page
-   Registration
-   Plan selection
-   Checkout
-   Billing
-   Subscription confirmation
-   Upgrade
-   Downgrade
-   Vehicle top-up
-   Tracker purchase
-   Emails
-   Notifications
-   API responses
-   Database seeds
-   Tests
-   Translations

Expected customer-facing prices:

``` text
Personal        ₹119/month
Business        ₹239/month
Supplier        ₹179/month
Additional      ₹99/month
```

Do not show separate GST calculation on normal pricing cards.

------------------------------------------------------------------------

# 24. Legacy Pricing Audit

Search the entire project for:

``` text
14 days
14-day
30 months
30-month
₹75
₹499
₹117
₹235
₹176
₹70
₹99 + GST
₹199 + GST
₹149 + GST
₹59 + GST
```

Also search semantic equivalents in:

-   Constants
-   Config
-   Database
-   Migrations
-   Seed
-   APIs
-   Services
-   Tests
-   UI
-   Translations
-   Emails
-   Notifications
-   Cashfree
-   Documentation

Do not blindly replace every match.

Determine whether each occurrence is current, legacy, unrelated, or
intentional.

------------------------------------------------------------------------

# 25. Plan/Account-Type Collision Search

Explicitly search for code patterns where:

``` text
plan
```

controls:

-   Role
-   Account Type
-   Vehicle Type
-   Dashboard
-   Navigation
-   Permissions
-   Feature eligibility
-   Workflow

And where:

``` text
accountType
```

controls:

-   Subscription price
-   Billing
-   Trial
-   Cashfree plan
-   Payment amount

Every collision must be reported.

------------------------------------------------------------------------

# 26. API Security Audit

Attempt to reason through direct API access.

Test whether users can bypass UI restrictions.

Examples:

``` text
Supplier → create vehicle API
Personal → create truck API
Mobility Provider → create truck API
Fleet Owner → bypass tracker requirement
User → modify subscription amount
User → modify vehicle quantity
User → claim another account type
```

These must be protected server-side.

Frontend restrictions are not sufficient.

------------------------------------------------------------------------

# 27. UI/Backend Consistency Audit

For every major workflow compare:

``` text
UI
 ↓
API
 ↓
Backend
 ↓
Database
 ↓
External Provider
 ↓
Webhook
 ↓
UI State
```

Find mismatches such as:

-   UI allows, backend rejects
-   UI rejects, backend allows
-   UI price differs from backend
-   Trial differs
-   Account Type differs
-   Plan differs
-   Vehicle quantity differs
-   Tracker status differs
-   Subscription status differs

------------------------------------------------------------------------

# 28. Database Audit

Identify the authoritative source for:

``` text
Plan
Account Type
Subscription
Subscription Status
Trial Start
Trial End
Vehicle Count
Tracker Status
Payment Status
```

Check for:

-   Duplicate models
-   Conflicting enums
-   Legacy fields
-   Redundant plan representations
-   Redundant account-type representations
-   Incorrect relationships
-   Migration inconsistencies

------------------------------------------------------------------------

# 29. Test Audit

Inspect and run relevant existing tests.

Coverage should include:

-   Registration
-   Account Type
-   Plans
-   Subscription
-   Trial
-   Billing
-   Vehicle onboarding
-   Tracker
-   Driver
-   Telemetry
-   Orders
-   Payments
-   Webhooks
-   RBAC

Clearly distinguish:

``` text
New failure
Existing failure
Environment failure
Unrelated failure
```

Do not hide pre-existing failures.

Do not rewrite unrelated tests just to obtain a green result.

------------------------------------------------------------------------

# 30. Behavioral Matrix

Produce this table:

  Workflow                     Expected               Actual   Status
  ---------------------------- ---------------------- -------- --------
  Free Customer                Correct                         
  Free Driver                  Correct                         
  Personal signup              Correct                         
  Business Fleet Owner         Correct                         
  Business Mobility Provider   Correct                         
  Supplier signup              Correct                         
  Personal price               ₹119/month                      
  Business price               ₹239/month                      
  Supplier price               ₹179/month                      
  Additional vehicle           ₹99/month                       
  Trial                        30 days                         
  Personal + car               Allowed                         
  Personal + truck             Rejected                        
  Fleet + truck                Allowed with tracker            
  Fleet tracker                Mandatory                       
  Mobility + vehicle           Allowed                         
  Supplier + vehicle           Rejected                        
  No vehicle telemetry         Not applicable                  
  Vehicle telemetry            Applicable                      
  Driver App                   Available                       
  Subscription renewal         Correct                         
  Marketplace payment          30% + 70%                       

------------------------------------------------------------------------

# 31. Issue Classification

Every discovered issue must be classified as one of:

### CORRECT

Matches the current requirements.

### PARTIAL

Partially implemented.

### BROKEN

Existing behavior violates requirements.

### MISSING

Required behavior does not exist.

### CONFLICT

Two parts of the project implement contradictory rules.

### DUPLICATE

Multiple systems own the same behavior.

### LEGACY

Old business logic remains.

### UNKNOWN

Cannot be verified from the available repository/test environment.

------------------------------------------------------------------------

# 32. Required Final Claude Report

The final report must contain:

## A. Executive Summary

Short overview of whether the project currently follows the latest
business model.

## B. Architecture Understanding

Explain the current architecture relevant to plans, account types,
vehicles, billing and feature applicability.

## C. Plan Audit

Show current vs expected pricing and behavior.

## D. Account Type Audit

Show current vs expected operational workflows.

## E. Plan/Account-Type Collision Audit

List every discovered collision.

## F. Vehicle Audit

Validate vehicle rules and backend enforcement.

## G. Tracker Audit

Validate tracker products and Fleet Owner requirement.

## H. Telemetry Audit

Validate vehicle-dependent telemetry behavior.

## I. Driver Audit

Validate Driver App and driver workflow.

## J. Subscription/Cashfree Audit

Validate:

-   Pricing
-   Trial
-   Subscription
-   Renewal
-   Webhooks
-   Failures
-   Reconciliation

## K. Marketplace Payment Audit

Validate 30% + 70% flow independently from subscriptions.

## L. UI/Backend Consistency

List mismatches.

## M. Security/RBAC

List bypasses or weak server-side enforcement.

## N. Database

Identify authoritative models and conflicts.

## O. Test Results

Provide exact test results.

## P. Issues

List all issues classified as:

``` text
CORRECT
PARTIAL
BROKEN
MISSING
CONFLICT
DUPLICATE
LEGACY
UNKNOWN
```

## Q. Recommended Changes

Only recommend changes actually required by the audit.

Do not recommend unrelated improvements.

------------------------------------------------------------------------

# 33. Strict No-Modification Rule

During this audit:

**DO NOT:**

-   Modify source files
-   Modify database schema
-   Create migrations
-   Change pricing
-   Change Cashfree configuration
-   Change plan enums
-   Change account types
-   Change RBAC
-   Rebuild vehicle systems
-   Rebuild tracker systems
-   Rebuild telemetry
-   Rebuild Driver App
-   Delete existing functionality
-   Rename existing functionality
-   Perform unrelated refactors
-   Commit
-   Push
-   Merge
-   Create branches

The audit must remain read-only unless Sir explicitly authorizes
implementation work afterward.

------------------------------------------------------------------------

# 34. Final Principle

Saarthi must maintain four separate concepts:

``` text
                    SAARTHI ACCOUNT
                           │
             ┌─────────────┴─────────────┐
             │                           │
          PLAN                    ACCOUNT TYPE
       Commercial                 Operational
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
             Tracker / OBD
                  │
                  ↓
              Telemetry
```

### PLAN

Controls:

-   Commercial subscription
-   Billing
-   Trial
-   Base quantity
-   Additional vehicle billing

### ACCOUNT TYPE

Controls:

-   Operational identity
-   Workflow
-   Role
-   Permissions
-   Allowed entities
-   Vehicle category

### RESOURCE

Controls:

-   Whether vehicle-dependent functionality is applicable

### RBAC

Controls:

-   Whether the authenticated user is authorized to perform an action

These concepts must remain separate across:

-   Frontend
-   Backend
-   Database
-   APIs
-   Billing
-   Cashfree
-   Entitlements
-   RBAC
-   UI
-   Tests

------------------------------------------------------------------------

# 35. Audit Completion Requirement

Do not say the project is "working" merely because it builds or tests
pass.

The audit is complete only when Claude can explain:

1.  How a user registers.
2.  How Plan is selected.
3.  How Account Type is selected.
4.  How the two remain separate.
5.  How subscription/trial is created.
6.  How vehicle eligibility is enforced.
7.  How tracker requirements are enforced.
8.  How vehicle-dependent telemetry becomes applicable.
9.  How Driver App access works.
10. How additional vehicles are billed.
11. How Cashfree handles payment and renewal.
12. How marketplace 30/70 payments remain separate.
13. How the frontend and backend remain consistent.
14. How unauthorized API calls are blocked.
15. Which parts are correct, partial, broken, missing, conflicting,
    duplicated, legacy, or unknown.

**Only after producing this complete audit should implementation work be
considered.**
