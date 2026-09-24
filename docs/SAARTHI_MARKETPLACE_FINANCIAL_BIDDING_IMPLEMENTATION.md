# SAARTHI — MARKETPLACE FINANCIAL, BIDDING & TOUR/TRAVEL IMPLEMENTATION

## Purpose

Use this specification to implement the latest Saarthi marketplace financial model in the existing project.

It covers:
- Fleet Owner bidding
- Supplier discovery/procurement
- Customer 30%/70% payments
- Business/Supplier bank-account connection
- Penny validation
- Fleet Owner profit calculation
- Tour & Travel/Mobility package and trip flow
- 2% Saarthi commission on provider profit
- Commission visibility
- Settlement/reconciliation
- Separation from SaaS subscriptions, generic referrals, and GODID salesman commissions

**Inspect the existing project first. Reuse existing systems. Do not rebuild working authentication, orders, vehicles, trackers, telemetry, payments, or Driver App systems. Do not modify GODWeb.**

---

# 1. Current Source of Truth

### Marketplace commission

Saarthi charges:

**2% of the provider's profit.**

This is NOT:
- 2% of gross customer payment
- 2% of gross order value
- 0.5% of order value

The old 0.5% model is superseded.

For a Fleet Owner:

```text
Customer Selling Amount
        -
Authoritative Procurement / Eligible Cost
        =
Fleet Owner Profit Basis

Fleet Owner Profit Basis × 2%
        =
Saarthi Commission
```

For a Tour & Travel / Mobility Provider:

```text
Customer Payment
        -
Authoritative Package / Trip Costs
        =
Provider Profit Basis

Provider Profit Basis × 2%
        =
Saarthi Commission
```

The provider must clearly see the calculation.

---

# 2. Fleet Owner Bidding Workflow

This is the canonical freight workflow.

```text
CUSTOMER
  ↓
Posts Requirement
  ↓
FLEET OWNER sees requirement
  ↓
Fleet Owner looks for suitable Supplier(s)
  ↓
Checks:
  • Material / item
  • Availability
  • Current stock
  • Supplier offered price
  • Relevant supplier details
  ↓
Fleet Owner calculates own economics
  ↓
Fleet Owner bids Customer at chosen higher rate
  ↓
CUSTOMER ACCEPTS BID
  ↓
ORDER CONFIRMED
  ↓
30% Customer Payment
  ↓
Fleet Owner procures material from Supplier
  ↓
Supplier Procurement / Payment
  ↓
Loading / Verification
  ↓
Truck Trip
  ↓
Delivery / Unloading / Verification
  ↓
70% Customer Payment
  ↓
Customer Payment Completed
  ↓
Fleet Owner Profit Finalized
  ↓
2% Saarthi Commission
  ↓
Settlement / Reconciliation
  ↓
ORDER COMPLETED
```

Do not replace this with a generic checkout-only flow.

---

# 3. Customer Requirement

A customer can post a requirement using the existing Saarthi requirement model.

Possible existing fields include:
- Material/item
- Required quantity
- Unit
- Pickup information
- Delivery location
- Time/window
- Other fields already supported by Saarthi

**Inspect the current model and reuse it. Do not create duplicate requirement entities.**

---

# 4. Supplier Discovery

Fleet Owner must be able to locate suppliers relevant to the requirement and inspect available information, including where supported:

- Material/item
- Availability
- Stock
- Supplier offered price
- Supplier verification/status
- Relevant supplier details

Supplier listed price is the Fleet Owner's procurement reference.

It is not automatically the customer selling price.

---

# 5. Fleet Owner Bid

The Fleet Owner sets the customer bid.

Example:

```text
Supplier price:          ₹2,000/ton
Required:                25 tons
Procurement reference:   ₹50,000
Customer bid:            ₹62,500
```

The system must keep these amounts distinct:

```text
Supplier / Procurement Amount
Customer / Selling Amount
```

The accepted customer amount becomes the authoritative order price.

The browser must not be able to manipulate the final accepted amount.

---

# 6. 30% / 70% Customer Payment

Current payment rule:

```text
Order Confirmed
     ↓
30% Customer Payment
     ↓
Procurement + Loading + Trip
     ↓
Delivery / Verification
     ↓
70% Customer Payment
```

Expected state concept:

```text
ORDER_CONFIRMED
→ PAYMENT_30_REQUIRED
→ PAYMENT_30_SUCCESS
→ PROCUREMENT
→ LOADING
→ TRIP_STARTED
→ IN_TRANSIT
→ DELIVERY
→ PAYMENT_70_REQUIRED
→ PAYMENT_70_SUCCESS
→ FINANCIAL_FINALIZATION
→ ORDER_COMPLETED
```

The 70% stage must not be released merely because a trip started.

Use the existing authoritative delivery/verification logic.

---

# 7. Supplier Procurement

The Fleet Owner's supplier payment is a separate financial leg.

```text
Fleet Owner
    ↓
Supplier
    ↓
Material Procurement
    ↓
Supplier Payment
```

Do NOT confuse:

```text
Customer Payment
```

with:

```text
Supplier Procurement Payment
```

They must remain separately traceable in the financial system.

---

# 8. Bank Account Connection

Business-side providers and Suppliers participating in applicable financial transactions must connect their own bank accounts.

The bank account is used for approved:
- Receiving funds
- Sending funds where applicable
- Supplier procurement
- Provider settlement
- Other authorized marketplace financial operations

Use the existing/approved payment-provider integration.

Do not create a fake internal wallet.

Do not represent a database balance as real money unless it corresponds to an actual supported settlement mechanism.

---

# 9. Penny Validation

A connected bank account must be verified using penny validation before it is marked usable for restricted financial operations.

Expected lifecycle:

```text
BANK NOT CONNECTED
       ↓
BANK DETAILS SUBMITTED
       ↓
PENNY VALIDATION
       ↓
VERIFICATION RESULT
       ↓
BANK VERIFIED
       ↓
FINANCIAL USE ALLOWED
```

Recommended statuses:

```text
NOT_CONNECTED
PENDING_VERIFICATION
VERIFIED
FAILED
BLOCKED
```

Do not mark the account verified merely because the user entered bank details.

Do not allow a restricted financial action while bank status is:
- PENDING_VERIFICATION
- FAILED
- BLOCKED

The authoritative result must come from the approved payment/bank-verification integration.

---

# 10. Bank Data Security

Never expose:
- Full bank account number
- Payment-provider secret keys
- Sensitive verification credentials

Display masked information where appropriate:

```text
Bank Account
XXXX XXXX 4321

Status
Verified
```

Bank-account operations must be server-authorized and scoped to the correct account owner.

---

# 11. Fleet Owner Profit Calculation

The 2% commission is based on the Fleet Owner's profit.

Baseline:

```text
Customer Selling Amount
        -
Supplier Procurement Amount
        -
Other recorded eligible transaction costs
        =
Fleet Owner Profit Basis
```

Then:

```text
Saarthi Commission
=
2% × Fleet Owner Profit Basis
```

Example:

```text
Customer Amount                    ₹62,500
Supplier Procurement              ₹50,000
Other recorded eligible costs          ₹0
-----------------------------------------
Profit Basis                       ₹12,500

Saarthi Commission (2%)               ₹250
```

Do NOT calculate:

```text
2% × ₹62,500
```

That would be incorrect under the current model.

---

# 12. Profit Definition

Do not invent a business profit formula.

Claude must inspect the current Saarthi financial/order data and identify which costs are authoritative.

Use existing cost records where available.

If the current system lacks a necessary cost component:
1. Report the gap.
2. Do not fabricate a value.
3. Add only the minimum required financial data model if implementation is authorized.

Make the commission rule configurable/versioned.

---

# 13. Commission Visibility

The Fleet Owner must see the calculation.

Example UI:

```text
Order Financial Summary

Customer Payment
₹62,500

Procurement Cost
₹50,000

Profit Basis
₹12,500

Saarthi Commission (2%)
₹250

Net After Saarthi Commission
₹12,250
```

The UI must clearly distinguish:
- Customer payment
- Recorded costs
- Profit basis
- Saarthi commission
- Net after Saarthi commission

Do not call the full customer payment "profit".

Do not label the remaining amount "final business profit" if Saarthi has not captured all operating costs.

---

# 14. Commission Lifecycle

Recommended states:

```text
PROFIT_PENDING
→ PROFIT_FINALIZED
→ COMMISSION_CALCULATED
→ COMMISSION_PENDING
→ COMMISSION_PAYABLE
→ COMMISSION_SETTLED
```

Commission must not become payable before the underlying transaction reaches its required financial completion state.

Refunds, disputes, cancellation, partial delivery, or financial adjustments must affect the commission appropriately.

Use adjustment/reversal records instead of overwriting history.

---

# 15. Commission Ledger

Maintain an auditable record of:

- Customer revenue
- Procurement cost
- Eligible costs used
- Profit basis
- Commission rate
- Commission amount
- Refunds
- Reversals
- Adjustments
- Settlement
- Reconciliation

Historical commission calculations must remain traceable.

Example:

```text
commissionRate = 2%
commissionRuleVersion = MARKETPLACE_PROFIT_V1
basisAmount = 12500
commissionAmount = 250
```

Do not silently change historical commissions when future rates change.

---

# 16. Tour & Travel / Mobility Provider

Tour & Travel is a separate operational workflow from freight.

### Fleet Owner freight

```text
Customer Requirement
→ Supplier Discovery
→ Fleet Owner Bid
→ Material
→ Truck
→ Delivery
```

### Tour & Travel

```text
Mobility Provider
→ Creates Trip / Package
→ Customer Views
→ Customer Books
→ Customer Pays
→ Trip / Package Successfully Completed
→ Provider Costs Finalized
→ Provider Profit Finalized
→ Saarthi Commission = 2% of Profit
```

Both use the same 2% profit-based commission principle.

Their operational models remain different.

---

# 17. Tour & Travel Package Model

Inspect the existing Tour/Travel/Mobility implementation first.

Do not copy Fleet Owner freight semantics into it.

Where required by the existing design, package/trip data may include:

- Package/trip name
- Origin
- Destination
- Duration
- Vehicle
- Driver
- Passenger capacity
- Pickup/drop
- Included services
- Price
- Availability
- Booking status
- Completion status
- Recorded trip/package costs

Do NOT force Tour & Travel through:
- Supplier stock
- Material procurement
- Tonnage
- Freight
- Loading/unloading
- Truck-only concepts

unless the product specifically requires them for a particular package.

---

# 18. Tour & Travel Commission

The same 2% principle applies.

Example:

```text
Customer Package Payment       ₹20,000
Recorded Trip/Package Costs     ₹12,000
-----------------------------------------
Provider Profit Basis            ₹8,000

Saarthi Commission (2%)            ₹160
```

The commission becomes payable only after:
- Customer payment is successfully received according to the applicable payment lifecycle
- Trip/package is successfully completed
- Relevant provider costs are finalized

The provider must see the commission.

Do not automatically apply 2% to gross customer payment.

---

# 19. Keep Freight and Tour/Travel Separate

Maintain distinct business semantics:

```text
FREIGHT
├── Requirement
├── Bid
├── Supplier
├── Stock
├── Procurement
├── Truck
├── Loading
├── Delivery
└── 30/70 payment

TOUR/TRAVEL
├── Package
├── Trip
├── Booking
├── Passenger
├── Service
└── Completion
```

Shared infrastructure is allowed:

- Customer accounts
- Payment provider
- Ledger
- Commission engine
- Settlement
- Notifications
- Common order infrastructure where appropriate

But do not collapse their business logic into one confusing workflow.

---

# 20. Plan and Account Type Separation

This financial implementation must respect the existing rule:

**Plan ≠ Account Type**

Plan controls:
- Subscription
- Billing
- Trial
- Base quantity
- Additional vehicle billing

Account Type controls:
- Operational identity
- Workflow
- Permissions
- Allowed entities
- Vehicle category

Examples:

```text
BUSINESS + FLEET_OWNER
```

and:

```text
BUSINESS + MOBILITY_PROVIDER
```

share Business commercial billing but have different operational workflows.

Do not use:

```text
plan === BUSINESS
```

as a shortcut for Fleet Owner behavior.

---

# 21. Generic Referral and GODID Separation

Do not merge marketplace 2% profit commission with:

- Generic Saarthi referral commission
- GODID salesman commission

Keep commission source distinguishable:

```text
COMMISSION_SOURCE
├── MARKETPLACE_PROFIT
├── GENERIC_REFERRAL
└── SALESMAN_GODID
```

Generic referral commission remains undefined until separately decided.

The GODWeb project must not be modified.

---

# 22. Subscription Billing Separation

Keep SaaS subscription transactions separate from marketplace financial transactions.

Do not merge:

```text
SaaS Subscription
Tracker Purchase
Additional Vehicle
Marketplace Customer Payment
Supplier Procurement
Provider Commission
```

into one undifferentiated payment record.

They may share a common payment/ledger infrastructure but need distinct transaction types and business states.

---

# 23. Payment Provider Architecture

Reuse the existing payment-provider abstraction.

Conceptually:

```text
Saarthi Financial Layer
    │
    ├── Subscription Payments
    ├── Marketplace Customer Payments
    ├── Supplier Payments
    ├── Bank Verification
    └── Provider Settlement
             │
             ↓
       Approved Payment Provider
```

If Cashfree is the current approved provider, extend the existing Cashfree integration.

Do not create duplicate:
- Payment clients
- Webhook processors
- Settlement services
- Ledger writers
- Customer payment services

---

# 24. Webhooks

Financial webhooks must:

1. Validate authenticity/signature.
2. Be idempotent.
3. Find the correct Saarthi transaction.
4. Validate the allowed state transition.
5. Update financial state.
6. Write the corresponding ledger event.

Never activate financial state based only on a browser redirect.

Duplicate webhooks must not create:
- Duplicate payments
- Duplicate commissions
- Duplicate settlements

---

# 25. Exceptional Cases

Inspect and handle, using the existing project architecture:

- Order cancellation
- Supplier unavailable
- Stock insufficient
- Bid rejected
- Bid expired
- Truck breakdown
- Partial delivery
- Quantity mismatch
- Damaged/rejected quantity
- Customer refusal
- Payment failure
- Delayed webhook
- Duplicate webhook
- Refund
- Partial refund
- Dispute
- Settlement failure
- Reconciliation mismatch

For partial delivery:

```text
Expected Quantity
→ Actual Delivered Quantity
→ Final Customer Amount
→ Final Provider Revenue
→ Final Profit Basis
→ 2% Commission
```

Do not charge commission on money that was not finally earned.

---

# 26. Financial Completion Trigger

Fleet Owner:

```text
Delivery Verified
→ 70% Payment Successful
→ Customer Amount Finalized
→ Procurement/Cost Data Finalized
→ Profit Basis Calculated
→ 2% Commission
```

Tour & Travel:

```text
Trip/Package Completed
→ Customer Payment Successful
→ Provider Costs Finalized
→ Profit Basis Calculated
→ 2% Commission
```

Use the actual authoritative completion state already implemented by Saarthi.

---

# 27. UI Requirements

## Fleet Owner

Show financial outcome within order/transaction context:

```text
Customer Payment
Procurement Cost
Profit Basis
Saarthi Commission (2%)
Net After Saarthi Commission
```

## Mobility Provider

Show equivalent information in the package/trip financial summary.

The design should be:
- Clean
- Professional
- Transparent
- Non-confusing
- Responsive

Do not overload operational screens with unnecessary financial detail.

---

# 28. Bank Account UI

Provide a clean account/billing/financial area for:

```text
Bank Account
[Connect Bank Account]

Status:
Pending / Verified / Failed

XXXX XXXX 4321
```

Make verification state obvious.

Do not expose sensitive data.

Do not allow restricted actions while verification is incomplete.

---

# 29. Suggested Data Concepts

Reuse existing models where possible.

If missing, concepts may include:

```text
BankAccount
- id
- ownerType
- ownerId
- maskedAccount
- bankName
- verificationStatus
- verifiedAt
- providerReference

PaymentTransaction
- id
- order/booking reference
- owner/account
- direction
- amount
- stage
- provider
- providerReference
- status

ProfitSnapshot
- id
- transaction reference
- revenue
- costBasis
- profitBasis
- calculatedAt
- ruleVersion

Commission
- id
- transaction reference
- source
- basisAmount
- rate
- amount
- status
- ruleVersion
- calculatedAt

Settlement
- id
- transaction/commission reference
- recipient
- amount
- status
- providerReference
- settledAt
```

These are conceptual only.

Do not create duplicate models where equivalent existing models already exist.

---

# 30. API Requirements

Use existing Saarthi routing conventions.

Potential operations:

```text
POST /bank-accounts
POST /bank-accounts/:id/verify
GET  /bank-accounts

POST /requirements
POST /bids
POST /bids/:id/accept

POST /orders/:id/payment/confirmation
POST /orders/:id/payment/final

GET /orders/:id/financial-summary

GET /commissions
GET /commissions/:id

GET /settlements
```

These are conceptual examples.

Claude must use actual existing route conventions and avoid duplicate endpoints.

---

# 31. Security

Never trust frontend values for:

- Customer amount
- Supplier cost
- Profit
- Commission
- Bank verification
- Payment status
- Settlement status

Backend must be authoritative.

Server-side enforcement is required for:

```text
Customer
Fleet Owner
Supplier
Mobility Provider
Driver
```

Examples:

```text
Supplier → cannot create Fleet Owner bid

Customer → cannot perform Supplier procurement

Mobility Provider → does not gain Fleet Owner freight workflow

Driver → cannot control provider settlement

Unverified bank account → cannot perform restricted financial action
```

---

# 32. Audit Before Implementation

Before modifying code:

1. Read `CLAUDE.md`.
2. Read all relevant Saarthi MD/specification files.
3. Inspect current requirements/order/bid implementation.
4. Inspect supplier inventory.
5. Inspect Fleet Owner flow.
6. Inspect Tour/Travel/Mobility flow.
7. Inspect payment architecture.
8. Inspect Cashfree integration.
9. Inspect bank-account integration.
10. Inspect penny-validation support.
11. Inspect commission/ledger.
12. Inspect settlement/reconciliation.
13. Inspect RBAC.
14. Inspect frontend routes/components.
15. Inspect tests.
16. Identify what already works.
17. Identify exact gaps.
18. Produce a concise implementation plan.

Do not rebuild existing systems.

---

# 33. Implementation Order

After the audit, implement the smallest required changes in this order:

### Phase 1 — Financial Model
Support:
- Revenue
- Cost basis
- Profit basis
- Commission
- Payment stages
- Bank verification
- Settlement
- Reconciliation

### Phase 2 — Bank Verification
```text
Connect
→ Penny Validate
→ Verify
→ Usable
```

### Phase 3 — Fleet Owner Bidding
```text
Requirement
→ Supplier Discovery
→ Stock/Availability
→ Supplier Price
→ Fleet Owner Bid
→ Customer Acceptance
```

### Phase 4 — 30/70 Customer Payment
```text
30% Confirmation
→ Delivery
→ 70% Final
```

### Phase 5 — Profit / 2% Commission
```text
Final Revenue
+
Final Recorded Costs
→ Profit Basis
→ 2%
→ Commission
```

### Phase 6 — Tour & Travel
Implement its own:
- Package/trip
- Booking
- Payment
- Completion
- Cost
- Profit
- 2% commission

### Phase 7 — Exceptions / Reconciliation
Complete:
- Refunds
- Partial delivery
- Disputes
- Duplicate webhook handling
- Settlement failures
- Reconciliation

---

# 34. Testing Requirements

## Fleet Owner happy path

```text
Customer posts requirement
→ Fleet Owner sees requirement
→ Supplier found
→ Stock available
→ Supplier price visible
→ Fleet Owner bids
→ Customer accepts
→ 30% succeeds
→ Procurement
→ Delivery
→ 70% succeeds
→ Profit finalized
→ 2% commission calculated
→ Commission visible
```

## Bank account

```text
Connect
→ Pending
→ Penny validation
→ Verified
→ Financial action allowed
```

Also test failed validation.

## Tour & Travel

```text
Package/Trip
→ Booking
→ Customer payment
→ Trip completion
→ Costs finalized
→ Profit
→ 2% commission
```

## Failure tests

- 30% payment failure
- 70% payment failure
- duplicate payment
- duplicate webhook
- supplier unavailable
- insufficient stock
- bid rejection
- bid expiry
- order cancellation
- partial delivery
- quantity mismatch
- refund
- dispute
- settlement failure
- reconciliation mismatch

---

# 35. Financial Integrity Tests

Given:

```text
Customer Amount = ₹62,500
Profit Basis    = ₹12,500
```

Commission must be:

```text
₹12,500 × 2% = ₹250
```

It must NOT be:

```text
₹62,500 × 2% = ₹1,250
```

Also verify:

- Commission isn't created before financial completion.
- Commission isn't duplicated by repeated webhooks.
- Settlement isn't duplicated.
- Historical commission remains immutable.
- Refunds/adjustments affect future payable amount correctly.

---

# 36. Acceptance Criteria

Implementation is complete only when:

1. Fleet Owners can see customer requirements.
2. Fleet Owners can search relevant Suppliers.
3. Supplier availability/stock and price are visible where supported.
4. Fleet Owners can set their customer bid.
5. Customer acceptance creates the authoritative order.
6. 30% customer payment occurs at confirmation.
7. Supplier procurement is a separate money flow.
8. 70% payment is triggered only after delivery-stage conditions.
9. Required Business/Supplier bank accounts can be connected.
10. Bank accounts undergo penny validation.
11. Unverified accounts cannot perform restricted financial operations.
12. Fleet Owner profit is calculated from authoritative revenue and recorded eligible costs.
13. Saarthi charges **2% of Fleet Owner profit**.
14. Fleet Owner sees the commission calculation.
15. Tour & Travel has a distinct package/trip workflow.
16. Tour & Travel uses **2% of provider profit** after successful completion/payment.
17. Freight and Tour/Travel logic do not collide.
18. Subscription billing remains separate.
19. Generic referral remains separate.
20. GODID salesman commission remains separate.
21. Financial records are auditable and idempotent.
22. Partial/refunded/disputed transactions are handled correctly.
23. Existing functionality is preserved.

---

# 37. Final Non-Negotiable Rules

- **2% is calculated on provider profit, not gross customer payment.**
- Fleet Owner profit comes from the customer selling amount versus authoritative procurement/cost data.
- Tour & Travel uses the same 2% profit principle but a distinct operational model.
- Customer payment and Supplier procurement payment are separate.
- Business/Supplier bank accounts must be penny validated before restricted financial use.
- 30% is collected at order confirmation.
- 70% is collected after delivery-stage completion.
- Commission is finalized only after the relevant transaction/profit is finalized.
- Commission must be transparently shown.
- SaaS subscriptions are separate from marketplace payments.
- Generic referral commission is separate.
- GODID salesman commission is separate.
- Do not build a fake internal wallet.
- Do not trust frontend financial values.
- Do not duplicate existing systems.
- Do not modify GODWeb.
- Do not perform Git operations unless Sir explicitly requests them.
- Preserve all existing working functionality.

---

# 38. Claude Code Execution Rule

Claude must:

1. Inspect first.
2. Understand the current architecture.
3. Map existing workflows.
4. Identify existing implementations that can be reused.
5. Identify gaps and conflicts.
6. Present the implementation plan.
7. Implement only the required changes.
8. Run relevant tests.
9. Report exact files/logic changed.
10. Report unresolved business assumptions.

Do not blindly rebuild the marketplace or payment system.
