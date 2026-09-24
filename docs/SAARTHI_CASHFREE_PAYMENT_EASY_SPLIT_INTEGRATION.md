# SAARTHI — CASHFREE PAYMENT & EASY SPLIT INTEGRATION

## Objective
Integrate Cashfree into the existing Saarthi system for:
- Customer payment collection
- 30% order-confirmation payment
- 70% post-delivery payment
- Easy Split marketplace settlements
- Fleet Owner / Mobility Provider vendor onboarding
- Saarthi 0.5% platform fee
- Refunds, adjustments and reconciliation
- Webhooks and immutable financial records

**Current status:** VorldX Industries Pvt Ltd. has created the Cashfree merchant account. Easy Split activation is under Cashfree review. Build and test in Sandbox/Test first. Do not assume Easy Split production access until Cashfree confirms activation.

## Legal/Product Structure
- Legal entity: **VorldX Industries Pvt Ltd.**
- Product/brand: **VorldX Saarthi**
- Website: **https://vorldxsaarthi.com/**
- Cashfree merchant account: VorldX Industries Pvt Ltd.

Do not create a separate Saarthi legal/payment entity.

## 1. Inspect Before Coding
Read:
- `CLAUDE.md`
- all relevant MD/spec files
- existing payment modules
- order lifecycle
- provider/fleet/mobility models
- subscriptions
- PostgreSQL schema
- Redis
- webhook infrastructure
- authentication/RBAC
- existing ledger/financial models
- existing Razorpay integration/provider abstraction
- existing frontend checkout

Classify relevant work as: implemented / partial / new / duplicate / conflict / refactor.

**Do not rebuild existing systems or create duplicate payment, order, vendor, ledger, webhook or settlement systems.**

## 2. Payment Architecture
Use a provider abstraction:

```text
PaymentProvider
├── CashfreePaymentProvider
└── Existing/Future RazorpayProvider
```

Business code must call `PaymentService`, not Cashfree APIs directly.

Keep Cashfree-specific logic inside its adapter.

Conceptual capabilities:

```ts
createOrder()
getPaymentStatus()
createRefund()
verifyWebhook()
```

Marketplace capabilities should be separate:

```ts
createVendor()
getVendor()
createSplit()
getSettlementStatus()
createAdjustment()
```

Adapt this to the existing project structure rather than blindly creating these exact files.

## 3. Environment
Use backend-only environment variables:

```env
CASHFREE_ENV=sandbox
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_API_VERSION=
CASHFREE_WEBHOOK_SECRET=
CASHFREE_RETURN_URL=
CASHFREE_WEBHOOK_URL=
```

Use separate production credentials.

Never expose Cashfree secret keys to React, Android, browser code, APIs or logs. Never commit them.

## 4. Customer Payment Flow

```text
Customer
→ Saarthi Backend
→ Create Cashfree Order
→ Receive payment session
→ Saarthi frontend opens Cashfree Checkout
→ Customer pays
→ Cashfree webhook
→ Verify webhook
→ Update Saarthi payment/order
```

Cashfree's current Web Checkout flow uses backend order creation and a returned payment session for checkout. Payment status must be verified server-side.

**Never mark an order paid solely from a frontend success callback.**

## 5. Webhooks
Every Cashfree webhook must be signature-verified before processing.

Flow:

```text
Webhook received
→ verify signature
→ validate event
→ identify Saarthi payment/order
→ idempotency check
→ valid state transition
→ persist event/result
→ acknowledge
```

Handle duplicate, delayed, retried and out-of-order webhooks.

Use the existing webhook infrastructure if present.

## 6. Idempotency
Protect:
- order creation
- payment processing
- refunds
- split creation
- webhook processing

Track relevant Saarthi IDs plus Cashfree order/payment/vendor identifiers.

Never create duplicate financial records because a webhook or request is repeated.

## 7. Saarthi 30/70 Rule

```text
Order Total = 100%

30% = ORDER_CONFIRMATION
70% = FINAL_SETTLEMENT
```

Example:

```text
25 tons × ₹2,500 = ₹62,500

30% = ₹18,750
70% = ₹43,750
```

Prefer two payment transactions for the same Saarthi order:

```text
Payment #1 → ORDER_CONFIRMATION → 30%
Payment #2 → FINAL_SETTLEMENT → 70%
```

The 70% payment becomes available only after the existing Saarthi delivery/unloading verification rules allow it.

Do not mutate a 30% transaction into a 100% transaction.

## 8. Existing Order Lifecycle
Integrate with the existing lifecycle; do not create another one.

Target conceptual flow:

```text
BID_ACCEPTED
→ ORDER_CREATED
→ PAYMENT_30_REQUIRED
→ PAYMENT_30_SUCCESS
→ SUPPLIER_PROCUREMENT
→ DRIVER_ASSIGNED
→ TRUCK_ASSIGNED
→ LOADING_VERIFICATION
→ LOADED
→ TRIP_STARTED
→ IN_TRANSIT
→ DESTINATION_REACHED
→ UNLOADING_VERIFICATION
→ DELIVERED
→ PAYMENT_70_REQUIRED
→ PAYMENT_70_SUCCESS
→ FINANCIAL_RECONCILIATION
→ SAARTHI_FEE_CALCULATED
→ PROVIDER_SETTLEMENT
→ ORDER_COMPLETED
```

Use actual repository states if they differ.

## 9. Saarthi Fee
Current rule:

```text
Saarthi fee = 0.5% of successful customer order value
```

Example:

```text
Order = ₹62,500
Saarthi fee = ₹312.50
Provider net = ₹62,187.50
```

Do not hard-code `0.5` throughout the codebase. Use the existing fee/rule system or create a configurable rule only if one does not exist.

Customer should not see a separate Saarthi fee under the current business rule.

## 10. Easy Split
When activated, use Easy Split for marketplace provider settlement.

```text
Customer
→ Cashfree Payment Gateway
→ Easy Split
   ├── Provider/Vendor share
   └── VorldX/Saarthi share
```

Cashfree currently documents Easy Split for marketplace payment splitting, vendor settlements, commissions, refunds/adjustments and reconciliation.

Do not invent Easy Split API fields. Verify the exact current API schema and enabled capabilities from Cashfree's current developer documentation/account.

## 11. Provider/Vendor Mapping
Eligible marketplace providers include:
- Fleet Owner
- Mobility Provider
- other approved providers if later added

Do not automatically create Cashfree vendors for:
- Drivers
- Free accounts
- Personal accounts
- ordinary customers

Supplier handling must follow the final approved Saarthi payment policy.

Store the external Cashfree ID on the existing provider model:

```text
Provider
└── cashfreeVendorId
```

Never use the Cashfree vendor ID as Saarthi's primary provider ID.

## 12. Vendor Onboarding

```text
Provider registers
→ Saarthi business verification
→ bank/settlement information
→ Saarthi approval
→ create Cashfree vendor
→ save cashfreeVendorId
→ provider becomes settlement eligible
```

Creation must be backend-only.

Use the existing provider/KYC system instead of duplicating it.

## 13. Split Calculation
Saarthi backend calculates the business allocation.

Example:

```text
Customer payment = ₹62,500
Saarthi fee = ₹312.50
Provider settlement = ₹62,187.50
```

Frontend must never control:
- order amount
- provider share
- platform fee
- settlement amount
- vendor identity

Persist the calculation before sending the provider-specific split instruction.

## 14. Supplier Procurement
Current business model:

```text
Customer order = ₹62,500
Supplier procurement = 25 × ₹2,000 = ₹50,000
```

Supplier procurement/payment is a separate financial leg.

Do not accidentally deduct the Saarthi 0.5% fee from supplier procurement unless the business rule explicitly changes.

## 15. Financial Ledger
Use the existing Saarthi ledger if present.

Conceptual records:

```text
Payment
PaymentAttempt
PaymentAllocation
PlatformFee
ProviderSettlement
Refund
RefundAdjustment
Dispute
Reconciliation
LedgerEntry
WebhookEvent
```

Cashfree is the payment/settlement rail; Saarthi remains the business financial source of truth.

Do not overwrite historical financial amounts. Corrections should use adjustment/reversal entries.

## 16. Refunds
Support:
- full refund
- partial refund
- refund before provider settlement
- refund after provider settlement
- provider settlement adjustment
- failed/pending refunds

Reconcile:

```text
Original payment
→ original split
→ provider settlement
→ refund
→ provider adjustment
→ final balances
```

Follow the exact Easy Split refund/adjustment API enabled for the account.

## 17. Reconciliation
Compare:

```text
Saarthi Ledger
↕
Cashfree Payments
↕
Cashfree Splits
↕
Cashfree Settlements
```

Detect:
- missing payment
- duplicate payment
- amount mismatch
- missing split
- wrong split
- settlement mismatch
- refund mismatch
- missing webhook
- duplicate webhook
- settlement failure

Never silently alter historical records to hide mismatches.

## 18. Security
Mandatory:
- backend-only secrets
- HTTPS
- webhook signature verification
- idempotency
- RBAC
- server-side amounts
- server-side provider validation
- audit logs
- no payment secrets in logs
- sandbox/production separation

## 19. Frontend
Frontend should:
1. request payment creation from Saarthi backend
2. receive only the checkout session/token required by Cashfree
3. open Cashfree Checkout using the supported SDK
4. show pending/processing state
5. return to Saarthi
6. ask Saarthi backend for authoritative status

Do not put Cashfree secret credentials in React or Android.

## 20. Redis
Use existing Redis where appropriate for:
- short-lived payment state
- idempotency locks
- webhook deduplication
- status caching

PostgreSQL remains the durable financial source of truth.

## 21. Testing

### Unit
Test:
- 30/70 calculation
- 0.5% fee
- provider share
- refund calculations
- idempotency
- authorization
- state transitions

### Integration
Test:
- Cashfree order creation
- checkout session
- payment status
- webhook verification
- duplicate webhook
- delayed webhook
- failed payment
- successful payment
- refund
- vendor creation
- split
- settlement status
- reconciliation

### Required scenario

```text
Order = ₹62,500
30% = ₹18,750
70% = ₹43,750
Saarthi fee = ₹312.50
Provider net = ₹62,187.50
```

Also test:
- 30% success / 70% failure
- payment retry
- duplicate webhook
- webhook before browser redirect
- frontend says success but backend says pending
- partial refund
- full refund
- cancellation
- quantity mismatch
- settlement failure
- reconciliation mismatch

Do not use real production payments in automated tests.

## 22. Sandbox → Production

### Now
Use Cashfree Sandbox/Test.

Implement and test:
- normal payment
- webhook
- refunds
- provider abstraction
- vendor abstraction
- Easy Split adapter
- reconciliation

### After Cashfree approval
Only then:
- confirm Easy Split activation
- create a test vendor in the approved environment
- test split
- test settlement
- test refund/adjustment
- verify webhook/reconciliation
- configure production credentials
- perform controlled production test

Do not assume Easy Split is active just because it appears in the dashboard.

## 23. Cashfree Sources
Use current official documentation:
- https://www.cashfree.com/devstudio
- https://www.cashfree.com/devstudio/preview/pg/web/checkout
- https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification
- https://www.cashfree.com/payment-gateway-charges/
- https://www.cashfree.com/blog/marketplace-payment-splitting-in-india/

If current Cashfree documentation conflicts with this document, use the current Cashfree API documentation for provider-specific request/response details, while preserving Saarthi's business rules unless the user explicitly changes them.

## 24. Claude Code Rules
Before coding:
1. Read `CLAUDE.md`.
2. Read relevant MD/spec files.
3. Inspect existing payment/order/provider/ledger/webhook/RBAC systems.
4. Identify duplicates and conflicts.
5. Make a short plan.
6. Implement only the missing pieces.
7. Run relevant tests.
8. Report exact results.

Do not:
- rebuild Saarthi
- rebuild orders
- rebuild subscriptions
- rebuild vendor accounts
- create a second ledger
- create a second webhook system
- bypass RBAC
- expose secrets
- invent Cashfree APIs
- assume Easy Split activation
- use fake production data

Follow existing Git rules. Do not commit, push, pull, merge, rebase or create branches unless explicitly instructed.

## 25. Final Report
Report:

```text
Cashfree Integration
--------------------
Provider abstraction: PASS/FAIL
Sandbox credentials: PASS/FAIL
Create order: PASS/FAIL
Checkout: PASS/FAIL
Payment status: PASS/FAIL
Webhook verification: PASS/FAIL
Webhook idempotency: PASS/FAIL
30% payment: PASS/FAIL
70% payment: PASS/FAIL
Refunds: PASS/FAIL
Vendor model: PASS/FAIL
Easy Split adapter: PASS/FAIL
Split calculation: PASS/FAIL
Settlement tracking: PASS/FAIL
Reconciliation: PASS/FAIL
Ledger integration: PASS/FAIL
RBAC/security: PASS/FAIL
Automated tests: PASS/FAIL
Production readiness: YES/NO
```

Clearly separate:
- implemented
- tested
- sandbox-tested
- blocked by Cashfree activation
- requiring production verification

Never claim production Easy Split readiness while Cashfree activation is pending.
