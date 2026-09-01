# SAARTHI — COMMERCE & PAYMENTS UPDATE

## Production Payment Architecture, 30/70 Customer Payments, Supplier Procurement & Settlement

> **Purpose:** Introduce Saarthi's unified, production-oriented payment and commerce layer across logistics, marketplace, supplier procurement, travel/mobility and future services.
>
> **Core principle:** Saarthi owns the business/payment state machine and financial ledger. The regulated payment provider executes payment collection, payout and settlement operations.

---

## 1. Implementation Mandate

Claude Code MUST NOT rebuild Saarthi.

Before changing code:

1. Read `CLAUDE.md`.
2. Inspect the complete existing repository.
3. Inspect existing payment, billing, subscription, order, trip and supplier modules.
4. Inspect PostgreSQL schema and migrations.
5. Inspect RBAC/organization/capability architecture.
6. Inspect existing API/provider-adapter patterns.
7. Inspect Redis/cache/queue infrastructure.
8. Inspect notification and audit systems.
9. Identify what is already implemented.
10. Produce an impact report before coding.

Classify requirements as:

- `ALREADY_IMPLEMENTED`
- `PARTIALLY_IMPLEMENTED`
- `NEW`
- `DUPLICATE`
- `CONFLICT`
- `REQUIRES_REFACTOR`

Reuse and extend existing modules wherever possible.

### Never

- create a second Saarthi application;
- create separate payment pages for every role;
- create duplicate order/payment models;
- hard-code Cashfree calls into UI components;
- trust frontend payment success;
- store card/payment credentials Saarthi should not store;
- create an informal Saarthi wallet or escrow;
- bypass existing RBAC;
- accept an unverified webhook;
- process duplicate webhook events;
- expose provider secrets in the frontend;
- make Cashfree-specific assumptions part of core business logic.

The existing Saarthi architecture already follows provider abstraction for payments and is designed to replace local/mock infrastructure with production providers without rebuilding the product. Preserve that approach.

---

# 2. Why This Update Exists

Saarthi is evolving from a fleet-management product into a connected transportation, logistics, mobility and vehicle-intelligence ecosystem.

The existing product already covers fleet management, customers, suppliers, material orders, trips, tracking, documents, verification, subscriptions, AI and related operational workflows.

Payments must now become a **first-class commerce layer** connecting those workflows rather than a simple "Pay Now" button.

The payment system must support:

- customer marketplace payments;
- staged 30/70 order payments;
- supplier procurement;
- provider settlement;
- Saarthi's 0.5% platform fee;
- refunds;
- partial refunds;
- disputes;
- reconciliation;
- payment compliance;
- provider reserve/security controls;
- future travel/taxi/service transactions;
- subscriptions and future commerce products;
- strong auditability.

---

# 3. Final Payment Provider Decision

## Primary provider: Cashfree

Use **Cashfree as the primary production payment provider**, subject to written confirmation/approval of Saarthi's exact marketplace and settlement configuration.

Cashfree Easy Split is designed for marketplace payment collection, commission calculation, vendor/service-provider settlement, refunds and reconciliation.

Cashfree also provides vendor-payment capabilities appropriate for purchase-to-pay/supplier disbursements.

## Provider abstraction is mandatory

```text
Saarthi Commerce Engine
        |
        v
Payment Provider Interface
        |
        +---- Cashfree Adapter
        |
        +---- Future Razorpay Adapter
        |
        +---- Future Approved Provider
```

The business layer must not know whether the provider is Cashfree or another approved provider.

---

# 4. Regulatory / Compliance Boundary

Saarthi must NOT create an informal customer-money wallet or self-operated escrow.

The exact structure for customer collections, provider settlement, supplier payouts and any provider reserve/security mechanism must be approved by the payment provider and Saarthi's legal/compliance advisors.

RBI's payment-aggregator framework includes requirements around escrow and settlement arrangements. Saarthi should therefore rely on the regulated provider's supported mechanisms rather than inventing its own customer-money holding system.

### Provider Reserve

The proposed ₹2,000 provider reserve should be implemented only through a structure approved by Cashfree/legal/compliance.

Preferred terminology:

- `Provider Security Balance`
- `Provider Reserve`

Do **not** casually call it a Saarthi Wallet.

---

# 5. Central Financial Principle

One Saarthi order can contain multiple financial relationships.

Never model the order as:

```text
order.payment
```

Instead:

```text
ORDER
 |
 +-- Customer Charges
 |     +-- 30% Confirmation
 |     +-- 70% Final Settlement
 |
 +-- Supplier Purchase
 |     +-- Supplier Payment
 |
 +-- Saarthi Fee
 |
 +-- Provider Settlement
 |
 +-- Refunds
 |
 +-- Disputes
 |
 +-- Reconciliation
 |
 +-- Ledger Entries
```

This is the foundation of the payment architecture.

---

# 6. Saarthi 30/70 Model

## Customer pays exactly the agreed order amount.

Example:

```text
Quantity:       25 tons
Customer rate:  ₹2,500 / ton

Order value:
25 × ₹2,500 = ₹62,500
```

### Stage 1 — Order Confirmation Payment

```text
30%
₹18,750
```

Purpose:

> Confirm the order and authorize Saarthi's operational workflow to proceed.

### Stage 2 — Final Settlement Payment

```text
70%
₹43,750
```

Purpose:

> Complete the customer's financial obligation after delivery verification.

### Total

```text
₹18,750 + ₹43,750
= ₹62,500
```

The customer must NOT see an additional Saarthi platform fee.

---

# 7. 30/70 Is a Saarthi Business Rule

Do not depend on a gateway's generic partial-payment functionality as Saarthi's business state machine.

Saarthi must control when the second stage becomes payable.

Recommended model:

```text
PaymentPlan
 |
 +-- Stage 1
 |     type = ORDER_CONFIRMATION
 |     percentage = 30
 |     amount = calculated
 |     unlock = ORDER_ACCEPTED
 |
 +-- Stage 2
       type = FINAL_SETTLEMENT
       percentage = 70
       amount = calculated
       unlock = DELIVERY_VERIFIED
```

This allows future plans such as:

```text
20 / 80
30 / 70
40 / 60
50 / 50
20 / 50 / 30
```

without redesigning the payment engine.

---

# 8. Two Payment Transactions

Recommended production implementation:

```text
SAARTHI ORDER
SRT-2026-001234

+------------------------------+
| Payment 1                    |
| ORDER_CONFIRMATION           |
| ₹18,750                      |
| SUCCESS                      |
+------------------------------+

+------------------------------+
| Payment 2                    |
| FINAL_SETTLEMENT             |
| ₹43,750                      |
| LOCKED                       |
+------------------------------+
```

After delivery verification:

```text
LOCKED
  |
  v
PAYMENT_REQUIRED
  |
  v
PAYMENT_INITIATED
  |
  v
SUCCESS
```

This is preferable to allowing the customer to freely pay the remaining balance whenever they want.

---

# 9. Full Logistics + Payment Flow

```text
BID_ACCEPTED
     |
     v
ORDER_CREATED
     |
     v
30% PAYMENT REQUIRED
     |
     v
30% PAYMENT SUCCESS
     |
     v
SUPPLIER PROCUREMENT
     |
     v
SUPPLIER PAYMENT
     |
     v
DRIVER ASSIGNED
     |
     v
TRUCK ASSIGNED
     |
     v
LOADING VERIFICATION
     |
     v
LOADED
     |
     v
TRIP STARTED
     |
     v
IN TRANSIT
     |
     v
DESTINATION REACHED
     |
     v
UNLOADING VERIFICATION
     |
     v
DELIVERY VERIFIED
     |
     v
70% PAYMENT UNLOCKED
     |
     v
70% PAYMENT SUCCESS
     |
     v
FULL CUSTOMER AMOUNT COLLECTED
     |
     v
ORDER FINANCIAL RECONCILIATION
     |
     v
SAARTHI FEE CALCULATED
     |
     v
PROVIDER SETTLEMENT
     |
     v
ORDER COMPLETED
```

---

# 10. Supplier Procurement Is a Separate Financial Leg

Example:

Supplier sells:

```text
50 tons
₹2,000 / ton
```

Fleet Owner needs:

```text
25 tons
```

Supplier procurement:

```text
25 × ₹2,000
= ₹50,000
```

Financial relationship:

```text
FLEET OWNER
     |
     | ₹50,000
     v
SUPPLIER
```

This must NOT be treated as the customer's ₹62,500 payment.

Use Cashfree's supported vendor-payment/payout capability where approved.

---

# 11. Saarthi Fee

Saarthi charges:

```text
0.5%
```

on the successfully collected customer order value.

Example:

```text
Customer order value = ₹62,500

Saarthi fee:
₹62,500 × 0.5%
= ₹312.50
```

Customer pays:

```text
₹62,500
```

Provider settlement:

```text
Gross customer collection     ₹62,500.00
Saarthi fee                      ₹312.50
---------------------------------------
Provider net                   ₹62,187.50
```

Supplier procurement remains:

```text
₹50,000
```

No Saarthi fee is charged on the supplier procurement payment under the current model.

---

# 12. Fee Timing

Preferred business rule:

```text
30% collected
+
70% collected
+
order completion conditions satisfied
        |
        v
Calculate 0.5% fee
        |
        v
Provider settlement
```

Do not deduct or charge the customer a separate Saarthi fee.

The exact Cashfree configuration for aggregate commission and settlement timing MUST be confirmed with Cashfree before production.

---

# 13. Customer Payment UX

Payments must feel like part of the Saarthi logistics experience, not a generic gateway screen.

### Order payment card

```text
Saarthi Order
SRT-2026-001234

25 tons • Sand
Supplier → Delivery Site

₹62,500
Total Order Value

Payment Progress
██████████░░░░░░░░░░ 30%

₹18,750 paid
₹43,750 remaining

[ Complete Confirmation Payment ]
```

After delivery:

```text
DELIVERY VERIFIED ✓

Final Settlement
₹43,750

Your delivery has been verified.

[ Pay Final Settlement ]
```

---

# 14. Payment Timeline

Add a clean visual timeline:

```text
✓ Order Accepted
      |
✓ 30% Paid
      |
✓ Supplier Procured
      |
✓ Material Loaded
      |
✓ Trip Started
      |
✓ Delivered
      |
● 70% Payment
      |
○ Provider Settlement
      |
○ Order Complete
```

Use subtle motion when a state changes.

Do not use excessive animation.

---

# 15. Payment Locked Experience

Before delivery:

```text
FINAL SETTLEMENT

₹43,750

🔒 Payment Locked

Unlocks after:
✓ Delivery verification
✓ Quantity confirmation
✓ Unloading verification
```

Include a small **"Why is this locked?"** interaction explaining the protection workflow.

---

# 16. Payment Protection

Customer payment screens should communicate:

```text
SAARTHI PROTECTED PAYMENT

✓ Linked to your order
✓ Digitally recorded
✓ Delivery workflow connected
✓ Payment status tracked
✓ Receipt available
```

Also display:

> For your protection, complete payments through Saarthi. Payments made directly outside Saarthi may not be covered by Saarthi's transaction verification, transaction records and applicable dispute workflow.

Do not use threatening language.

---

# 17. Responsive Payment UI — Non-Negotiable

The payment experience must be:

- mobile-first;
- tablet-friendly;
- desktop-optimized;
- responsive;
- accessible;
- keyboard navigable;
- touch-friendly;
- fast;
- clutter-free;
- visually consistent with the existing Saarthi design system.

### Desktop

```text
+----------------------------------------------+
| Payment / Order Details | Payment Summary    |
|                         |                    |
| Timeline                | ₹62,500            |
| Verification            | 30% ✓              |
| Order information       | 70% 🔒             |
|                         |                    |
|                         | [ PAY ]            |
+----------------------------------------------+
```

### Mobile

Do NOT squeeze the desktop layout.

Use:

```text
Order Header
      ↓
Amount
      ↓
Payment Progress
      ↓
Current Stage
      ↓
Protection Information
      ↓
Primary CTA
      ↓
Payment Timeline
      ↓
Details / Receipt
```

Use a sticky bottom CTA where appropriate:

```text
₹18,750
[ Pay & Confirm Order ]
```

Ensure it does not obstruct content or device navigation.

---

# 18. UI Design Direction

The payment UI should feel:

- premium;
- modern;
- calm;
- trustworthy;
- operational;
- uncluttered.

Use:

- clean cards;
- restrained glassmorphism where it fits the existing Saarthi design;
- subtle gradients;
- strong typography hierarchy;
- soft shadows;
- compact status chips;
- meaningful icons;
- smooth transitions;
- skeleton loading;
- clear success/failure states;
- responsive grids;
- contextual information.

Avoid:

- excessive cards;
- giant dashboards;
- unnecessary charts;
- huge animations;
- flashing effects;
- excessive gradients;
- confusing payment terminology;
- redundant navigation items.

**Integrate payment into existing Orders, Trips, Marketplace, Finance/Billing and Provider workflows instead of creating unnecessary top-level navigation.**

---

# 19. Payment States

Customer payment:

```text
PENDING
PAYMENT_REQUIRED
INITIATED
PROCESSING
SUCCESS
FAILED
EXPIRED
CANCELLED
REFUND_REQUESTED
REFUND_PROCESSING
PARTIALLY_REFUNDED
REFUNDED
DISPUTED
```

Provider settlement:

```text
PENDING
ELIGIBLE
PROCESSING
SETTLED
FAILED
HELD
REVERSED
```

Supplier payment:

```text
PENDING
INITIATED
PROCESSING
SUCCESS
FAILED
REVERSED
```

Never reduce these to a boolean such as `paid = true`.

---

# 20. Webhook Security

Never trust:

```text
frontend -> payment successful
```

Correct flow:

```text
Payment Provider
       |
       v
Signed Webhook
       |
       v
Verify Signature
       |
       v
Validate Event
       |
       v
Check Idempotency
       |
       v
Persist Raw Event / Audit Record
       |
       v
Update Payment State
       |
       v
Update Ledger
       |
       v
Update Order State
       |
       v
Notify User
```

Payment state changes must be server-side.

---

# 21. Idempotency

Every payment operation and webhook must be idempotent.

If the same success webhook arrives three times:

```text
Webhook #1 → process
Webhook #2 → already processed
Webhook #3 → already processed
```

Never create duplicate ledger entries, settlements, refunds or notifications.

Use:

- provider event ID;
- payment ID;
- idempotency key;
- internal transaction ID.

---

# 22. Financial Ledger

Create an immutable/reconcilable ledger.

Example:

```text
ORDER SRT-001234

+ ₹18,750.00
Customer Confirmation Payment

+ ₹43,750.00
Customer Final Payment

- ₹50,000.00
Supplier Procurement

- ₹312.50
Saarthi Platform Fee

= ₹12,187.50
Provider Contribution Before Operating Costs
```

Do not call ₹12,187.50 "profit".

Use:

> Estimated Contribution

or:

> Estimated Margin Before Operating Costs

---

# 23. Financial Identifiers

Store all relevant identifiers:

```text
Saarthi Order ID
Saarthi Payment ID
Payment Stage ID
Provider Order ID
Provider Payment ID
Provider Settlement ID
Supplier Payment ID
Refund ID
Dispute ID
Webhook Event ID
Reconciliation ID
Ledger Entry ID
```

These must be searchable by authorized operations/admin users.

---

# 24. Payment Reconciliation

Build automated reconciliation:

```text
Saarthi Ledger
      ↕
Cashfree Transactions
      ↕
Cashfree Settlements
      ↕
Bank Settlement Records
```

Detect:

- missing payments;
- duplicate payments;
- unexpected amounts;
- settlement mismatches;
- failed payouts;
- refunds not reflected;
- commission mismatches;
- webhook/payment state mismatches.

Create a reconciliation record for every discrepancy.

Never silently "fix" financial data.

---

# 25. Payment Health

Every order should have a simple Payment Health indicator.

### Healthy

```text
🟢 HEALTHY

30% received
Supplier payment completed
Delivery verified
70% payment pending
No issues
```

### Attention

```text
🟡 ATTENTION

Final payment pending
2 hours remaining
```

### Action Required

```text
🔴 ACTION REQUIRED

Final payment failed
Customer action required
```

This should be visible without overwhelming the user.

---

# 26. Payment Retries

If a payment fails:

```text
Payment didn't go through.

Try another payment method.

[ UPI ]
[ Card ]
[ Net Banking ]

Your order remains reserved until 14:32.
```

Do not make users restart the entire order.

Respect provider retry limits and avoid accidental duplicate charges.

---

# 27. Order Payment Reservation

When the customer is required to make the 30% payment:

```text
Order Confirmation Required

₹18,750

Complete within:
14:32
```

This is an operational reservation, not a Saarthi-held wallet balance.

If the customer does not pay:

```text
PAYMENT EXPIRED
```

Then release/reopen the order according to business rules.

---

# 28. Smart Reminders

Avoid notification spam.

Customer:

```text
Order accepted
→ confirmation payment reminder

Delivery verified
→ final payment reminder

Final payment overdue
→ escalation
```

Provider:

```text
Supplier payment pending
→ reminder

Customer final payment pending
→ operational notification

Fee reconciliation issue
→ action notification
```

---

# 29. Quantity Adjustments

Bulk logistics cannot assume ordered quantity always equals delivered quantity.

Example:

```text
Ordered:    25 tons
Loaded:     25 tons
Delivered:  23 tons
Accepted:   22.5 tons
Rejected:   0.5 ton
```

Before final payment:

```text
Delivery verification
       ↓
Quantity confirmation
       ↓
Adjustment calculation
       ↓
Customer sees revised final amount
       ↓
Customer confirms
       ↓
Final payment
```

Never silently change the amount.

---

# 30. Partial Delivery

Support:

- partial delivery;
- quantity shortage;
- rejected quantity;
- damaged quantity;
- quality dispute;
- agreed adjustment;
- additional charges where contractually applicable.

Financial calculation must be based on the final approved commercial state.

---

# 31. Disputes

Create a proper dispute object.

```text
PAYMENT DISPUTE

Order: SRT-001234
Amount under dispute: ₹5,000
Reason: Material quality

Status:
UNDER_REVIEW
```

Possible states:

```text
OPEN
UNDER_REVIEW
CUSTOMER_ACTION_REQUIRED
PROVIDER_ACTION_REQUIRED
RESOLVED
REJECTED
REFUND_APPROVED
CLOSED
```

Do not freeze every unrelated transaction automatically.

---

# 32. Refunds

Support:

- full refund;
- partial refund;
- staged-payment refund;
- cancellation refund;
- dispute refund;
- failed settlement reversal.

Flow:

```text
REFUND_REQUESTED
      ↓
ELIGIBILITY_CHECK
      ↓
APPROVED
      ↓
PROVIDER_REFUND
      ↓
PROCESSING
      ↓
REFUNDED
```

Every refund must link to:

- original payment;
- original order;
- refund reason;
- initiator;
- amount;
- provider reference;
- timestamp;
- audit record.

---

# 33. Provider Reserve / Security Balance

Preferred minimum:

```text
₹2,000
```

Purpose:

- reduce payment-bypass risk;
- provide contractual recovery capacity for unresolved Saarthi obligations;
- protect operational continuity.

Rules:

```text
Reserve >= ₹2,000
→ eligible for new orders

Reserve < ₹2,000
→ block NEW orders

Existing active trip
→ do not automatically terminate
```

Withdrawal:

```text
Withdrawable =
Reserve Balance
-
Active Trip Locks
-
Outstanding Recoverable Obligations
```

Withdrawal should be blocked while:

- an active trip is in progress;
- a legitimate payment reconciliation is unresolved;
- an outstanding recoverable obligation exists.

The exact reserve funding, custody, withdrawal and recovery mechanism must be approved by Cashfree/legal/compliance.

---

# 34. Offline Payment / Bypass Protection

Saarthi should discourage direct cash/off-platform payment.

Customer message:

> For your protection, complete payments through Saarthi. Payments made directly outside Saarthi may not be covered by Saarthi's transaction verification, transaction records and applicable dispute workflow.

Provider compliance signals may include:

- repeated off-platform payment complaints;
- unresolved payment mismatches;
- unusual cancellation patterns;
- repeated payment failures;
- customer reports;
- suspicious order/payment behavior.

Do not automatically accuse providers.

Use:

```text
ANOMALY
→ RECONCILIATION
→ NOTIFICATION
→ GRACE PERIOD
→ RESOLUTION
→ CONTRACTUAL RECOVERY/RESTRICTION
```

---

# 35. Provider Payment Compliance Score

Example:

```text
Payment Compliance
98 / 100
Excellent
```

Signals:

- successful on-platform payments;
- unresolved payment incidents;
- disputes;
- cancellations;
- payment failures;
- reconciliation history;
- confirmed compliance with Saarthi payment policy.

---

# 36. Order Economics

Fleet Owners should be able to see:

```text
CUSTOMER ORDER
₹62,500

Supplier procurement
₹50,000

Saarthi fee
₹312.50

Estimated contribution
₹12,187.50
```

Optionally allow:

```text
Fuel estimate
Driver cost
Tolls
Other operating costs
Estimated contribution after costs
```

This should be contextual, not a giant finance dashboard.

---

# 37. Transaction Passport

Each completed transaction should have a permanent record:

```text
SAARTHI TRANSACTION PASSPORT

Order
SRT-2026-001234

Commercial
25 tons
₹2,500 / ton
₹62,500

Customer Payments
30%  ₹18,750 ✓
70%  ₹43,750 ✓

Supplier Procurement
₹50,000 ✓

Saarthi Fee
₹312.50

Provider Settlement
₹62,187.50

Verification
Loading ✓
Delivery ✓
Quantity ✓
Payment ✓
```

Provide:

- view;
- download/print;
- share where appropriate;
- audit reference.

Protect sensitive financial and personal information.

---

# 38. Provider Settlement Dashboard

Integrate this into the existing provider finance/order experience.

```text
SETTLEMENTS

Pending       ₹1,24,500
Processing      ₹42,000
Settled       ₹8,42,500

Saarthi Fees    ₹4,250
Refunds          ₹12,500
```

Clicking a settlement shows:

- order;
- customer;
- gross collection;
- Saarthi fee;
- adjustments;
- net settlement;
- settlement status;
- provider reference;
- settlement date.

---

# 39. Customer Payment History

```text
Payments

Order SRT-001234
₹18,750
Order Confirmation
✓ Paid

₹43,750
Final Settlement
✓ Paid

Total
₹62,500
```

Avoid exposing unnecessary internal provider information.

---

# 40. Admin / Operations Payment Center

Operations needs a powerful but uncluttered view.

Filters:

- date;
- payment status;
- order;
- provider;
- customer;
- supplier;
- settlement;
- refund;
- dispute;
- reconciliation status.

Key metrics:

```text
Today's Collection
₹18.42L

Successful
₹17.95L

Pending
₹32.5K

Failed
₹15K

Reconciliation Issues
2
```

Add anomaly alerts without overwhelming the screen.

---

# 41. Payment Notifications

Use the existing notification infrastructure.

Events:

```text
30% PAYMENT REQUIRED
30% PAYMENT SUCCESS
SUPPLIER PAYMENT SUCCESS
DELIVERY VERIFIED
70% PAYMENT UNLOCKED
70% PAYMENT REQUIRED
70% PAYMENT SUCCESS
SETTLEMENT PROCESSING
SETTLEMENT COMPLETED
PAYMENT FAILED
REFUND INITIATED
REFUND COMPLETED
DISPUTE OPENED
DISPUTE RESOLVED
RECONCILIATION ISSUE
```

Notifications must be deduplicated and idempotent.

---

# 42. Redis Usage

Use existing Redis only for transient/high-read/payment-operational state such as:

- payment session status cache;
- rate limiting;
- webhook deduplication;
- short-lived locks;
- payment countdown state;
- realtime UI updates;
- reconciliation job coordination.

**PostgreSQL/ledger remains the source of truth.**

Never make Redis the permanent financial record.

---

# 43. Observability

Payment production monitoring must include:

- payment success rate;
- failure rate;
- webhook latency;
- webhook verification failures;
- duplicate webhook events;
- settlement latency;
- refund latency;
- supplier payout failures;
- reconciliation mismatches;
- provider API errors;
- payment provider availability;
- queue/job failures;
- suspicious payment activity.

Payment incidents should have correlation IDs.

---

# 44. Security

Never store:

- card CVV;
- raw card credentials;
- provider secrets in frontend bundles.

Use secure secret management.

Implement:

- RBAC;
- audit logs;
- request validation;
- signature verification;
- rate limits;
- idempotency;
- secure webhook endpoints;
- secure redirects;
- HTTPS;
- least-privilege provider credentials.

Follow the payment provider's current security requirements and applicable Indian regulations.

---

# 45. Payment API Abstraction

Create or extend a provider-neutral interface similar to:

```ts
interface PaymentProvider {
  createCustomerPayment(input): Promise<PaymentIntent>;
  getPayment(paymentId): Promise<PaymentStatus>;
  verifyPayment(paymentId): Promise<PaymentVerification>;
  refundPayment(input): Promise<RefundResult>;
  createSupplierPayout(input): Promise<PayoutResult>;
  getSettlement(settlementId): Promise<Settlement>;
  verifyWebhook(input): Promise<WebhookVerification>;
}
```

Exact interfaces must match Saarthi's existing architecture.

Do not blindly create duplicates.

---

# 46. Suggested Domain Modules

Use existing modules if present; otherwise introduce modular boundaries:

```text
commerce/
  orders/
  payment-plans/
  customer-charges/
  supplier-procurement/
  supplier-payments/
  provider-settlements/
  fees/
  refunds/
  disputes/
  reconciliation/
  ledger/
  reserve/
  compliance/
  notifications/
  providers/
```

Keep this inside the existing modular monolith unless scale requires separation.

---

# 47. Subscriptions Must Reuse the Commerce Layer

Existing Saarthi subscriptions should reuse the payment abstraction.

Plans may include:

- Basic;
- Pro;
- Intelligence;
- Enterprise;
- vehicle/truck quantity limits;
- top-ups.

Do not create a separate payment engine for subscriptions.

The commerce layer should support:

```text
ORDER PAYMENT
SUBSCRIPTION PAYMENT
TOP-UP
SERVICE PAYMENT
TRAVEL BOOKING
TAXI BOOKING
FUTURE MARKETPLACE TRANSACTION
```

---

# 48. Travel / Taxi / Services

The same payment engine must eventually support:

```text
Travel Booking
Taxi Booking
Tour Package
Service Booking
Freight Order
Material Order
```

Examples:

```text
Taxi:
100% at booking

Tour:
30/70

Freight:
30/70

Material procurement:
Provider → Supplier payout

Subscription:
Recurring billing
```

The UI adapts to transaction type while the financial foundation remains unified.

---

# 49. Payment UX Must Not Create Navigation Clutter

Do NOT add:

```text
Payments
Payments Management
Transactions
Wallet
Settlements
Billing
Finance
Commerce
```

all as separate sidebar items.

Instead integrate:

### Customer

```text
Orders
  → Order
     → Payments
```

### Fleet Owner

```text
Orders
  → Order Economics
  → Payment
  → Settlement
```

### Supplier

```text
Orders
  → Payment Status
```

### Admin

Use a dedicated operational Finance/Payments area only if the existing admin navigation supports it.

---

# 50. Mobile Payment Experience

On mobile:

- large readable amount;
- one primary CTA;
- no dense tables;
- collapsible details;
- sticky action;
- clear status;
- accessible touch targets;
- minimal scrolling;
- no unnecessary animation;
- clear retry path.

Example:

```text
₹43,750
Final Settlement

Delivery Verified ✓

Payment Progress
30% ✓
70% ●

[ Pay ₹43,750 ]

Order Details
Payment Protection
Receipt
```

---

# 51. Animation Guidelines

Use subtle animations for:

- payment progress;
- stage transitions;
- success;
- failure;
- loading;
- receipt generation;
- settlement status;
- timeline progression.

Avoid:

- constant floating particles;
- heavy 3D;
- blocking animations;
- excessive motion;
- animations while the user is trying to pay.

Respect `prefers-reduced-motion`.

---

# 52. Accessibility

Payment flows must support:

- keyboard navigation;
- screen readers;
- visible focus;
- semantic labels;
- sufficient contrast;
- error messages tied to fields;
- accessible status announcements;
- reduced motion;
- touch accessibility.

Never communicate payment status by color alone.

Use icon + text + color.

---

# 53. Payment Failure UX

Bad:

```text
ERROR 400
```

Good:

```text
Payment could not be completed.

Your order is still safe.

[ Try Again ]
[ Use Another Method ]

Reference:
SRT-PAY-839201
```

If money may have been debited but confirmation is pending:

```text
Payment verification in progress.

Do not pay again.

We are checking the payment status.
```

This is critical for preventing double payment.

---

# 54. Double-Payment Protection

If a customer attempts another payment while a previous transaction is processing:

```text
Payment already processing.

Please wait while Saarthi confirms the result.

Do not make another payment.
```

Backend must enforce this as well.

---

# 55. Payment Session Expiry

Payment sessions should have:

- creation time;
- expiry;
- status;
- retry policy.

Expired sessions must not accidentally change order state.

---

# 56. Audit Logging

Audit:

- payment creation;
- payment state changes;
- webhook events;
- refunds;
- disputes;
- manual adjustments;
- provider settlement changes;
- reserve changes;
- reconciliation actions;
- admin actions.

Store:

```text
actor
timestamp
action
entity
before
after
reason
correlation_id
```

Financial audit records must not be casually deleted.

---

# 57. Manual Admin Actions

Manual financial actions must be heavily controlled.

Examples:

```text
Refund
Manual reconciliation
Fee adjustment
Settlement hold
Dispute resolution
Reserve adjustment
```

Require:

- permission;
- reason;
- audit log;
- confirmation;
- optional second approval for high-value operations.

Never allow arbitrary amount edits.

---

# 58. High-Value Transaction Controls

For unusually large transactions, optionally require:

- additional KYC/business verification;
- customer confirmation;
- provider confirmation;
- operations review;
- payment risk review.

Thresholds must be configurable and compliant.

Do not hard-code arbitrary thresholds.

---

# 59. Payment Risk Engine

Use operational signals:

```text
Order value
Customer history
Provider history
Payment failures
Refund history
Dispute history
Account age
Verification status
Device/session anomalies
Velocity
```

Output:

```text
LOW
MEDIUM
HIGH
```

Use risk to trigger additional verification or operations review.

Do not automatically reject legitimate users solely because of one risk signal.

---

# 60. Payment Analytics

Add analytics to Saarthi's existing business intelligence.

Metrics:

- gross customer collections;
- net provider settlement;
- Saarthi fee revenue;
- supplier procurement;
- payment success rate;
- payment failure rate;
- average payment time;
- confirmation-to-delivery time;
- final-payment delay;
- refund rate;
- dispute rate;
- settlement latency;
- reconciliation mismatch rate;
- offline-payment incidents.

AI can summarize trends, but AI must never directly modify financial state.

---

# 61. Gemini / AI Payment Intelligence

Gemini may answer operational questions such as:

> "Which payments need attention today?"

> "Which providers have unresolved payment issues?"

> "Show orders where final payment is overdue."

> "Why did payment failures increase this week?"

> "Which settlements are delayed?"

AI must use authorized APIs/services and must not directly access or mutate the database.

AI must never:

- mark payments successful;
- issue refunds;
- change fees;
- alter ledger entries;
- release settlement;
- change reserve balances

without an explicit, authorized deterministic workflow.

---

# 62. AI Payment Alerts

Possible intelligent alerts:

```text
"3 final payments are overdue."

"Provider settlement delays increased 18% today."

"Two orders have payment/ledger mismatches."

"Supplier payout failure rate is higher than normal."
```

Keep alerts actionable and explain why they were generated.

---

# 63. Cashfree Production Approval Checklist

Before production, obtain written confirmation from Cashfree on:

1. Two staged customer payments belonging to one Saarthi business order.
2. 30% confirmation + 70% final payment workflow.
3. 70% payment being created/unlocked only after Saarthi delivery verification.
4. 0.5% provider-side commission on aggregate successfully collected order value.
5. No separate Saarthi fee charged to customer.
6. Fleet Owner → Supplier procurement payouts for Saarthi's exact business model.
7. Refund/partial-refund behavior across the two customer payment stages.
8. Settlement timing/eligibility based on Saarthi's completion conditions.
9. Provider reserve/security mechanism.
10. Balance/adjustment/recovery behavior for unresolved provider obligations.
11. Webhook/reconciliation behavior.
12. KYC and onboarding requirements for providers/suppliers.
13. Settlement and refund reporting.
14. Limits, fees, TATs and operational constraints.
15. Exact production eligibility for Saarthi's marketplace model.

Until these are confirmed, keep the provider adapter replaceable.

---

# 64. Testing Requirements

Create automated tests for:

### Happy path

```text
30% success
Supplier success
Delivery success
70% success
Fee calculated
Settlement success
```

### Failure paths

- 30% payment failure;
- duplicate 30% webhook;
- 30% payment succeeds but webhook delayed;
- supplier payout failure;
- truck breakdown;
- cancellation before delivery;
- delivery quantity mismatch;
- 70% payment failure;
- payment debited but status pending;
- duplicate final payment attempt;
- refund;
- partial refund;
- dispute;
- settlement failure;
- reconciliation mismatch;
- provider reserve below threshold;
- reserve withdrawal blocked during active trip;
- provider fee recovery after grace period;
- duplicate reconciliation job.

---

# 65. Financial Invariants

The backend must enforce:

```text
customer_paid <= order_total
```

```text
sum(successful_customer_charges)
= customer_collected_amount
```

```text
saarthi_fee
= configured_rate × eligible_collected_amount
```

```text
provider_net
= eligible_provider_amount
- provider_fee
- valid_adjustments
```

```text
supplier_payment
is independent from customer_charge
```

```text
ledger_entries
must reconcile
```

Never rely only on frontend calculations.

---

# 66. Database Principles

Use precise monetary types.

Prefer:

```text
NUMERIC(18,2)
```

or the project's existing appropriate money representation.

Never use floating-point values for money.

Store:

- currency;
- amount;
- original amount;
- adjusted amount;
- fee amount;
- refund amount;
- timestamps;
- provider references.

Use `INR` as the default currency for the current India-first implementation while keeping currency extensible.

---

# 67. Canonical Economics Example

```text
Customer order
₹62,500

Supplier purchase
₹50,000

Gross contribution
₹12,500

Saarthi fee
₹312.50

Estimated contribution after Saarthi fee
₹12,187.50
```

This excludes:

- fuel;
- driver cost;
- tolls;
- maintenance;
- tax;
- insurance;
- other operating costs.

---

# 68. Final Architecture

```text
                    SAARTHI COMMERCE ENGINE
                              |
       +----------------------+----------------------+
       |                      |                      |
       v                      v                      v
Customer Charges      Supplier Procurement    Provider Settlement
       |                      |                      |
   +---+---+                  |                      |
   |       |                  |                      |
  30%     70%                 |                      |
   |       |                  |                      |
   +---+---+                  |                      |
       |                      |                      |
       +-----------+----------+----------------------+
                   |
                   v
              SAARTHI LEDGER
                   |
       +-----------+------------+
       |           |            |
       v           v            v
    Refunds    Reconciliation  Fees
       |           |            |
       +-----------+------------+
                   |
                   v
           PAYMENT PROVIDER
               ADAPTER
                   |
                CASHFREE
```

---

# 69. Final Product Principle

Saarthi's payment system should feel like:

> **"The financial operating layer for every Saarthi transaction."**

Not:

> "A payment gateway added to the website."

The payment system connects:

```text
Demand
 ↓
Bid
 ↓
Order
 ↓
Payment
 ↓
Supplier
 ↓
Truck
 ↓
Trip
 ↓
Delivery
 ↓
Payment
 ↓
Settlement
 ↓
Analytics
```

---

# 70. Final Implementation Checklist

## Architecture
- [ ] Inspect existing code
- [ ] Preserve provider abstraction
- [ ] Add/extend commerce module
- [ ] Add immutable ledger
- [ ] Add reconciliation
- [ ] Add audit trail

## Customer Payments
- [ ] Payment Plan
- [ ] 30% confirmation
- [ ] 70% final settlement
- [ ] Delivery-gated final payment
- [ ] Payment retries
- [ ] Payment expiry
- [ ] Double-payment protection

## Supplier
- [ ] Supplier purchase
- [ ] Supplier payment
- [ ] Supplier payout reconciliation

## Provider
- [ ] 0.5% fee
- [ ] Provider settlement
- [ ] Settlement dashboard
- [ ] Provider economics
- [ ] Provider compliance score
- [ ] Provider reserve/security mechanism after compliance approval

## Reliability
- [ ] Signed webhook verification
- [ ] Idempotency
- [ ] Reconciliation
- [ ] Monitoring
- [ ] Correlation IDs
- [ ] Failure recovery

## Disputes
- [ ] Full refund
- [ ] Partial refund
- [ ] Quantity adjustment
- [ ] Partial delivery
- [ ] Dispute workflow

## UX
- [ ] Responsive payment UI
- [ ] Mobile-first flow
- [ ] Desktop/tablet layouts
- [ ] Payment timeline
- [ ] Payment protection
- [ ] Locked final payment
- [ ] Smart reminders
- [ ] Clean receipts
- [ ] Transaction Passport
- [ ] Payment Health
- [ ] Accessible UI
- [ ] Reduced-motion support

## Intelligence
- [ ] Payment analytics
- [ ] Risk engine
- [ ] Offline anomaly detection
- [ ] Gemini payment insights
- [ ] AI attention alerts

## Production
- [ ] Cashfree approval
- [ ] KYC approval
- [ ] Settlement configuration
- [ ] Reserve mechanism approval
- [ ] Refund configuration
- [ ] Reconciliation validation
- [ ] Load testing
- [ ] Disaster recovery testing

---

# 71. Claude Code Execution Rule

After reading this specification, Claude MUST:

1. Inspect Saarthi.
2. Produce an implementation impact report.
3. Identify existing payment/order/subscription/billing functionality.
4. Reuse existing architecture.
5. Implement the commerce layer incrementally.
6. Implement provider abstraction first.
7. Implement a development/mock payment provider using the same contract as production.
8. Implement the Cashfree adapter behind that interface.
9. Implement database migrations safely.
10. Add tests before enabling production payment behavior.
11. Verify every financial state transition.
12. Verify webhook signature and idempotency.
13. Verify ledger reconciliation.
14. Verify mobile and desktop payment UX.
15. Verify accessibility.
16. Verify failure/retry/refund/dispute scenarios.
17. Never expose provider secrets.
18. Never create a second payment engine.
19. Never create an informal Saarthi wallet/escrow.
20. Never claim production Cashfree support for a specific flow until the provider has confirmed it.

---

# FINAL VERDICT

```text
Cashfree
   +
Easy Split
   +
Saarthi Commerce Engine
   +
30/70 staged customer payments
   +
Separate supplier procurement payments
   +
0.5% provider-side Saarthi fee
   +
Provider settlement
   +
Immutable financial ledger
   +
Automated reconciliation
   +
Refunds & disputes
   +
Provider compliance
   +
Compliant provider reserve/security mechanism
   +
Payment risk & intelligence
   +
Premium responsive payment UX
```

This is the payment foundation Saarthi should build on for logistics today and travel, mobility, services, subscriptions and future marketplace transactions tomorrow.

**Do not optimize only for "taking payments." Optimize for a complete, auditable, trusted transaction lifecycle.**
