# SAARTHI — VERIFICATION PROVIDER, PRICING, CASHFREE PAYMENT & WIZARD IMPLEMENTATION SPECIFICATION

## Purpose

This specification defines the current Saarthi verification system that must be audited and implemented in the **existing Saarthi project**.

It covers:

- Verification requirements by account/role
- Per-verification customer charging
- Existing Saarthi Cashfree Payment Gateway for collecting verification fees
- Way2API verification services
- Cashfree verification APIs where applicable
- Provider abstraction and routing
- Provider cost vs customer price
- Existing verification wizard redesign/cleanup
- Animated verification-success confetti
- Verification state, retry and idempotency
- Bank account verification / penny validation
- Existing identity/document verification architecture
- Security, ledger and reconciliation

> **First inspect the existing project. Reuse existing systems. Do not rebuild working authentication, payments, verification, identity, wizard, database, or UI systems without proving that they cannot support this specification.**

---

# 1. Most Important Payment Rule

## Customer pays Saarthi first

For every billable verification:

```text
Customer
   ↓
Saarthi Verification Wizard
   ↓
Shows final verification price
   ↓
Customer clicks "Pay & Verify"
   ↓
EXISTING SAARTHI CASHFREE PAYMENT GATEWAY
   ↓
Payment succeeds
   ↓
Saarthi backend confirms payment
   ↓
Saarthi calls verification provider
   ↓
Way2API / Cashfree Verification API
   ↓
Verification result
   ↓
Saarthi persists result
   ↓
VERIFIED / FAILED
   ↓
🎉 Success animation when VERIFIED
```

### Non-negotiable

The customer must **NOT pay the verification provider directly**.

Do NOT implement:

```text
Customer
→ Way2API
→ Payment
```

Do NOT introduce a separate payment gateway for verification.

Use the **existing Saarthi Cashfree Payment Gateway integration** already used by the project.

---

# 2. Existing Cashfree Payment Setup Must Be Reused

The existing Saarthi Cashfree integration is the payment rail for customer verification fees.

Claude must first inspect:

- Existing Cashfree client
- Payment/order creation service
- Checkout integration
- Payment callback/return flow
- Webhook handling
- Signature verification
- Idempotency
- Existing payment tables/models
- Existing ledger
- Existing refunds
- Existing payment status state machine

Then extend the existing system.

Do NOT create:

- A second Cashfree client
- A second generic payment service
- A second webhook processor
- A separate verification payment table if the current payment model can represent it
- A separate checkout system

The verification payment should have a clear transaction type/reference, for example:

```text
VERIFICATION_FEE
```

Use the project's existing naming conventions if another equivalent type already exists.

---

# 3. Payment and Verification Are Two Separate Operations

They are connected, but they are not the same operation.

```text
PAYMENT
    ↓
Confirms customer paid Saarthi

VERIFICATION
    ↓
Confirms external identity/document data
```

Expected sequence:

```text
1. Create verification-payment request
2. Customer completes payment through existing Cashfree
3. Backend confirms successful payment
4. Only then perform billable external verification
5. Persist provider result
```

Do not mark a verification as successful merely because payment succeeded.

Do not call the provider before successful payment unless an existing provider-specific technical requirement makes a non-billable pre-check necessary.

---

# 4. Customer-Facing Verification Pricing

The business model is:

```text
External Provider Cost
        +
Saarthi margin
        =
Customer Verification Price
```

Example:

```text
Provider Cost      ₹5
Customer Price    ₹10
```

The customer sees:

> **Verification fee: ₹10**

The customer should NOT see:

```text
Provider cost ₹5
Markup ₹5
```

unless a separate internal/admin financial screen needs it.

---

# 5. Verification Price Is Final Customer Price

Normal verification UI must show a single clear final payable amount.

Example:

```text
PAN Verification
₹10
[ Pay & Verify ]
```

Do not create a confusing display such as:

```text
₹5 provider cost
₹5 margin
₹10 subtotal
18% GST
₹11.80 total
```

unless the actual tax/accounting design explicitly requires that breakdown.

The normal wizard should stay simple.

If tax/accounting disclosure is required on the payment receipt/invoice, that should remain in the financial/invoice layer.

---

# 6. Configurable Verification Pricing

Do not hardcode verification prices inside frontend components.

The verification pricing model should conceptually support:

```text
Verification Type
Provider
Provider Cost
Customer Price
Currency
Tax Treatment
Pricing Version
Status
```

Example:

```text
PAN
Provider: WAY2API
Provider Cost: configured
Customer Price: configured
Pricing Version: PAN_V1
```

This allows Saarthi to change:

- Provider
- Provider cost
- Customer price
- Pricing rule

without rewriting the wizard.

---

# 7. Internal Provider Economics

Maintain provider cost separately from customer price.

Example:

```text
Customer Price       ₹10
Provider Cost         ₹5
-------------------------
Gross Spread          ₹5
```

Do not automatically call this final "profit".

Better internal terminology:

- Customer Price
- Provider Cost
- Gross Spread

Other costs may exist, such as payment processing, taxes, infrastructure, support, refunds, retries, and operations.

---

# 8. Way2API — Current Account Evidence

The user-provided Way2API dashboard screenshots show these relevant services as **Approved / Active**:

| Service | Way2API price shown |
|---|---:|
| Bank Account Validation | **$0.0158/call** |
| PAN Verification | **$0.0341/call** |
| Voter ID Verification | **$0.0215/call** |
| Driving License Verify | **$0.0215/call** |
| GST Verification | **$0.0089/call** |
| Vehicle RC Verification | **$0.0215/call** |
| Vehicle RC Text and PDF | **$0.023/call** |
| Aadhaar PAN Link Check | **$0.0215/call** |

These prices are based on the user-provided account screenshots and should be treated as current account evidence, not universal Way2API pricing.

---

# 9. Aadhaar-PAN Link Check Is Not Aadhaar Identity Verification

This is critical.

The Way2API screenshot contains:

```text
Aadhaar PAN Link Check
```

Do NOT treat that as:

```text
Aadhaar Identity Verification
```

The existing Saarthi Personal and Driver verification requirements need actual Aadhaar identity verification.

Claude must verify whether a real Aadhaar identity-verification API is available through the user's enabled Way2API account or another approved provider.

If the required Aadhaar API is not available, report the gap.

Do not silently substitute an Aadhaar-PAN link check for Aadhaar verification.

---

# 10. Cashfree Verification APIs

Cashfree also provides verification APIs.

The user checked their Cashfree dashboard and could not find per-verification pricing.

Therefore:

- Do not invent Cashfree verification prices.
- Do not claim Cashfree is cheaper.
- Do not hardcode an assumed Cashfree cost.
- Treat Cashfree verification cost as **UNKNOWN / NOT CONFIGURED** until exact account-specific pricing is available.
- Cashfree can still be used for verification where the required API is enabled and commercially suitable.

Cashfree Payment Gateway and Cashfree Verification APIs must remain conceptually separate:

```text
Cashfree Payment Gateway
→ collects money from Saarthi customer

Cashfree Verification API
→ may perform a verification lookup
```

The same Cashfree merchant account/integration may support both, but they are different capabilities.

---

# 11. Provider Abstraction

Use a provider abstraction.

Conceptual architecture:

```text
Saarthi Verification Service
            │
      Provider Router
       ┌────┴─────┐
       ↓          ↓
    Way2API    Cashfree
```

The application should call a generic operation such as:

```text
verify(verificationType, subject, payload)
```

rather than directly coupling frontend/business logic to:

```text
Way2API PAN endpoint
```

or:

```text
Cashfree Aadhaar endpoint
```

Provider adapters should handle:

- Authentication
- API calls
- Request mapping
- Response mapping
- Provider reference
- Provider error mapping
- Timeout handling
- Retry behavior
- Provider billing metadata
- Provider-specific status

---

# 12. Provider Routing

Provider selection should be configurable.

Conceptually:

```text
Verification Type
       ↓
Eligible Providers
       ↓
Enabled?
       ↓
Capability available?
       ↓
Cost known?
       ↓
Reliability/operational data
       ↓
Selected Provider
```

Do not permanently hardcode:

```text
Everything → Way2API
```

or:

```text
Everything → Cashfree
```

The same wizard must continue to work if the provider changes later.

---

# 13. Cost Comparison

Currently:

```text
Way2API
→ several concrete prices visible

Cashfree Verification
→ exact account-specific prices not available to the user
```

Therefore the system must not pretend that a verified "cheapest provider" exists when Cashfree pricing is unknown.

Once Cashfree gives exact pricing, Saarthi can compare:

```text
Verification Type
→ Way2API cost
→ Cashfree cost
→ Availability
→ Success rate
→ Response time
→ Selected provider
```

Provider selection may then be optimized.

---

# 14. Verification Requirements

Verification requirements must depend on **Account Type / Verification Subject**, not simply Plan.

## Customer

Current business rule:

- No identity-document verification required.
- Customer verified/trusted status comes from the existing requirement/order behavior.

Do not add document verification to Customer unless separately required.

## Driver

Current required identity checks:

```text
Aadhaar
Voter ID
PAN
```

## Personal

Current required checks:

```text
Aadhaar
Personal PAN
```

Keep Personal/User Aadhaar separate from Driver Aadhaar.

## Business

Current required checks:

```text
Owner Aadhaar
Company PAN
GST
```

## Supplier

Current required checks:

```text
Owner Aadhaar
Company PAN
GST
Material-related government/license document
```

Use the existing project definitions where exact document names/subjects already exist.

---

# 15. Plan and Account Type Must Remain Separate

Do not use:

```text
plan === BUSINESS
```

as the verification workflow selector by itself.

Correct:

```text
Account Type
   ↓
Verification Requirements
   ↓
Wizard
```

Plan controls commercial subscription.

Account Type controls operational/verification workflow.

Examples:

```text
BUSINESS + FLEET_OWNER
BUSINESS + MOBILITY_PROVIDER
SUPPLIER + SUPPLIER
PERSONAL + PERSONAL_CONTEXT
FREE + CUSTOMER
FREE + DRIVER
```

These must not accidentally receive the same verification steps merely because of shared plan logic.

---

# 16. Existing Identity-Subject Separation

The current Saarthi architecture already distinguishes verification subjects such as:

```text
USER
DRIVER
```

Preserve that design.

Example:

```text
USER Aadhaar
≠
DRIVER Aadhaar
```

A driver being verified must not automatically satisfy the account holder's Personal verification.

Likewise, verifying one subject must not modify another subject's verification state.

---

# 17. Verification Wizard — UI Requirement

The current verification UI is too cluttered.

Use the **existing wizard already present in Saarthi**.

Do not introduce a second wizard framework.

The wizard must show only the steps relevant to the current verification subject/account type.

Do not display every document/form simultaneously.

---

# 18. Wizard Structure

Recommended pattern:

```text
Verification

● Identity
○ Tax / Business
○ Documents
○ Review
```

Then one focused step at a time.

Example:

```text
┌──────────────────────────────────────────────┐
│ PAN Verification                             │
│                                              │
│ Verify your PAN to complete this step.       │
│                                              │
│ Verification fee                             │
│                                              │
│                    ₹10                       │
│                                              │
│               [ Pay & Verify ]               │
└──────────────────────────────────────────────┘
```

After completion:

```text
✓ PAN Verified
```

Then move to the next required step.

---

# 19. Wizard Step States

Each step should have an explicit state:

```text
NOT_STARTED
PAYMENT_REQUIRED
PAYMENT_PROCESSING
VERIFYING
VERIFIED
FAILED
RETRY_REQUIRED
```

Overall verification may be:

```text
NOT_STARTED
IN_PROGRESS
VERIFIED
```

Do not reduce all individual checks to one boolean.

Example:

```text
Aadhaar → VERIFIED
PAN     → VERIFIED
GST     → PENDING
```

---

# 20. Verification Payment Flow

Detailed flow:

```text
User opens verification wizard
        ↓
Selects verification step
        ↓
Backend determines current configured customer price
        ↓
UI shows final price
        ↓
User clicks "Pay & Verify"
        ↓
Saarthi creates verification fee payment
        ↓
Existing Cashfree Payment Gateway checkout
        ↓
Customer pays Saarthi
        ↓
Cashfree success/webhook
        ↓
Backend verifies authoritative payment status
        ↓
Verification transaction becomes PAID
        ↓
Saarthi invokes selected verification provider
        ↓
Provider returns result
        ↓
Backend validates/maps result
        ↓
Persist verification
        ↓
VERIFIED / FAILED
```

---

# 21. Do Not Call Provider Before Payment

Under the normal billable flow:

```text
Payment successful
        ↓
Provider verification
```

Do not do:

```text
Provider verification
        ↓
Ask customer for payment
```

Otherwise Saarthi may incur provider costs without collecting the customer's fee.

If a provider supports a non-billable validation/pre-check that is technically necessary, keep that explicitly distinct from the billable verification request.

---

# 22. Provider Failure

Do not automatically promise refunds or free retries.

First determine whether the provider charged Saarthi for the failed attempt.

Track, where the provider allows it:

```text
providerBilled = true / false
```

Possible logic:

```text
Payment Successful
      ↓
Verification Failed
      ↓
Was provider billed?
   ┌────┴────┐
   YES       NO
    ↓         ↓
Attempt may  Retry/refund
be consumed  according to policy
```

The exact retry/refund business rule must be configurable and must not be invented.

---

# 23. Already Verified Data

If the correct subject is already verified:

```text
Aadhaar
✓ Already Verified
```

Do not charge the user again for the exact same successful verification unless Saarthi later defines an explicit re-verification requirement.

The system must distinguish:

```text
Existing VERIFIED result
```

from:

```text
New billable verification attempt
```

---

# 24. Verification Success + Confetti

The success animation must be triggered only after the backend has:

1. Confirmed provider result.
2. Validated/mapped the result.
3. Persisted the verification.
4. Marked the record as `VERIFIED`.

Then:

```text
Backend = VERIFIED
        ↓
Frontend receives authoritative state
        ↓
Animated success popup
        ↓
Confetti 🎉
```

Do NOT trigger confetti merely because:

- HTTP request returned 200
- Payment succeeded
- API request was sent
- Provider response exists in memory

The authoritative trigger is the persisted `VERIFIED` state.

---

# 25. Individual Verification Success Modal

Use a polished modal such as:

```text
          🎉

    Verification Successful

    Your PAN has been
    successfully verified.

          [ Continue ]
```

Use the existing Saarthi design system and animation libraries where already present.

Keep animation tasteful and short.

Do not block the application unnecessarily.

---

# 26. Final Verification Completion

After all required steps:

```text
✓ Aadhaar
✓ PAN
✓ GST
✓ Required Document
```

show:

```text
          🎉

       You're Verified

Your Saarthi verification is complete.

             ✓
```

Then update the appropriate verified badge/state.

---

# 27. Verification History

Provide a clean authenticated area, preferably within:

```text
Profile
   ↓
Verification
```

Example:

```text
Verification History

PAN
Verified
24 Sep 2026
₹10

GST
Verified
24 Sep 2026
₹10
```

Customer sees:

- Verification type
- Status
- Date
- Amount paid

Do not expose provider cost in the normal user history.

---

# 28. Internal Verification Economics

The admin/financial layer should be able to see:

```text
Verification Type
Provider
Provider Cost
Customer Price
Payment Reference
Provider Reference
Gross Spread
Status
```

Example:

```text
PAN
Provider: Way2API
Provider Cost: $0.0341
Customer Price: configured
Status: VERIFIED
```

Provider costs are internal.

---

# 29. Bank Account Verification

Bank validation is part of Saarthi's financial/marketplace workflows.

Where required:

```text
Connect Bank Account
        ↓
Penny Validation
        ↓
Verified
        ↓
Financial Use Allowed
```

The bank account verification should also use the provider abstraction.

The Way2API screenshot currently shows:

```text
Bank Account Validation
$0.0158/call
Approved / Active
```

Use the exact configured provider data rather than hardcoding the number in application logic.

---

# 30. Bank Account Security

Never expose:

- Full account number
- Provider secrets
- Sensitive bank credentials

Use masking:

```text
XXXX XXXX 4321
Verified
```

Server-side authorization must ensure only the correct account owner can manage its bank information.

---

# 31. Payment Ledger

Verification fees should be represented in the existing Saarthi financial ledger/payment architecture.

Conceptually:

```text
Customer Verification Fee
        ↓
Cashfree Payment
        ↓
Verification Transaction
        ↓
Provider Cost
        ↓
Gross Spread
        ↓
Ledger / Reconciliation
```

Do not build a separate financial universe just for verification.

Reuse the existing immutable financial architecture if available.

---

# 32. Webhook Requirements

Existing Cashfree webhook processing must be reused.

Financial webhooks must:

1. Verify authenticity/signature.
2. Be idempotent.
3. Find the correct verification payment.
4. Validate state transition.
5. Update payment state.
6. Allow verification execution only after confirmed paid state.
7. Record the event in the existing ledger.

Duplicate webhook must not cause:

- Two verification calls
- Two customer charges
- Two verification records
- Two financial ledger events

---

# 33. Security

Never trust frontend values for:

- Verification price
- Provider cost
- Payment status
- Verification status
- Provider result
- Bank verification
- Customer identity result

Frontend should display backend-authoritative values.

All external API secrets remain backend-only.

---

# 34. Full Verification Lifecycle

Expected:

```text
NOT_STARTED
      ↓
PAYMENT_REQUIRED
      ↓
PAYMENT_PROCESSING
      ↓
PAID
      ↓
VERIFYING
      ↓
VERIFIED
```

Failure path:

```text
VERIFYING
   ↓
FAILED
   ↓
RETRY_REQUIRED
```

The existing project may use different names. Reuse its established state model if equivalent.

---

# 35. Required Project Audit Before Implementation

Claude must inspect:

1. `CLAUDE.md`
2. Verification specifications
3. Identity models
4. Document models
5. Verification records
6. Existing verification service
7. Existing verification wizard
8. Registration/onboarding
9. Account Type logic
10. Plan logic
11. Existing Cashfree Payment Gateway
12. Cashfree webhooks
13. Existing Way2API client
14. Existing Cashfree verification client, if any
15. Payment tables
16. Financial ledger
17. Existing bank-account functionality
18. Existing penny validation, if any
19. RBAC
20. Existing tests

First report:

- Already implemented
- Partially implemented
- Missing
- Broken
- Duplicated
- Conflicting
- Legacy

Do not modify code during the initial audit.

---

# 36. Provider Capability Matrix

Claude should produce a table like:

| Verification | Way2API | Cashfree | Selected Provider | Cost Status |
|---|---|---|---|---|
| Aadhaar | Verify actual capability | Verify availability | | |
| PAN | Active | Verify | | |
| Voter ID | Active | Verify | | |
| Driving Licence | Active | Verify | | |
| GST | Active | Verify | | |
| Vehicle RC | Active | Verify | | |
| Bank Account | Active | Verify | | |
| Material License | Verify | Verify | | |

Do not fill unknown values with assumptions.

---

# 37. Verification Pricing Configuration

Claude should identify where current pricing is stored and ensure the architecture can support:

```text
verificationType
provider
providerCost
customerPrice
taxTreatment
currency
pricingVersion
active
```

Do not hardcode pricing in the wizard.

---

# 38. Testing Requirements

## Payment success

```text
Wizard
→ Pay & Verify
→ Existing Cashfree Payment Gateway
→ Payment Success
→ Verification Provider
→ VERIFIED
→ Confetti
```

## Payment failure

```text
Wizard
→ Cashfree
→ Payment Failed
→ Provider is NOT called
→ Verification remains unpaid/not verified
```

## Provider failure

```text
Payment Success
→ Provider Call
→ Verification Failed
→ Correct retry/refund policy
```

## Already verified

```text
Already VERIFIED
→ No unnecessary payment
→ No duplicate provider charge
```

## Duplicate webhook

```text
Webhook 1 → Process
Webhook 2 → Ignore/idempotent
```

## Subject separation

```text
USER Aadhaar
≠
DRIVER Aadhaar
```

## Dynamic wizard

Verify that each account type receives only the appropriate verification steps.

---

# 39. Security/Bypass Tests

Attempt direct API scenarios:

```text
User attempts verification without paying
→ Reject

User manipulates verification price
→ Reject / backend ignores

User marks verification as VERIFIED from frontend
→ Reject

User calls provider directly through browser
→ Provider secrets unavailable

User attempts another user's verification
→ Reject

User attempts bank use before penny verification
→ Reject
```

---

# 40. Acceptance Criteria

The implementation is complete only when:

1. Customer verification fees are collected through the **existing Saarthi Cashfree Payment Gateway**.
2. No separate customer payment system is introduced.
3. Payment success is confirmed server-side before a billable verification call.
4. Way2API and Cashfree are accessed through a provider abstraction.
5. Way2API active services are mapped correctly.
6. Cashfree verification prices are not fabricated.
7. Aadhaar-PAN Link Check is not mistaken for Aadhaar verification.
8. Verification pricing is configurable.
9. Customer sees only the final verification price.
10. Provider cost remains internal.
11. Existing verification wizard is reused.
12. The cluttered verification UI is simplified to one focused step at a time.
13. Wizard steps are account/subject-specific.
14. User and Driver verification subjects remain separate.
15. Already-verified checks are not unnecessarily recharged.
16. Payment failure prevents billable provider verification.
17. Provider result is persisted server-side.
18. Confetti appears only after persisted `VERIFIED`.
19. Bank account validation uses the approved penny-validation flow where required.
20. Verification financial records are auditable.
21. Duplicate webhooks cannot duplicate charges or verification calls.
22. Existing working verification/payment systems are preserved.
23. No duplicate verification engine is created.

---

# 41. Final Architecture

```text
                           SAARTHI
                              │
                     Verification Center
                              │
                        Account Type
                              │
                              ↓
                    Existing Verification Wizard
                              │
                     Required Verification
                              │
                              ↓
                    Final Customer Price
                              │
                              ↓
                       [ Pay & Verify ]
                              │
                              ↓
              EXISTING SAARTHI CASHFREE PAYMENT
                              │
                       Payment Success
                              │
                              ↓
                     Saarthi Backend
                              │
                     Provider Router
                              │
                  ┌───────────┴───────────┐
                  ↓                       ↓
               Way2API                Cashfree
                  │                       │
                  └───────────┬───────────┘
                              ↓
                     Provider Response
                              ↓
                      Backend Validation
                              ↓
                    Persist Verification
                              ↓
                    VERIFIED / FAILED
                         │           │
                         ↓           ↓
                    🎉 Confetti    Retry Policy
                         │
                         ↓
                      Next Step
```

---

# 42. Non-Negotiable Rules

- **Customer pays Saarthi, not Way2API/Cashfree Verification directly.**
- Use the **existing Saarthi Cashfree Payment Gateway** for customer verification fees.
- Only after server-confirmed payment success should Saarthi perform a billable external verification.
- Cashfree Payment Gateway and Cashfree Verification APIs are separate capabilities.
- Way2API and Cashfree verification providers must be abstracted.
- Do not fabricate unknown Cashfree verification pricing.
- Way2API dashboard prices supplied by the user are current account evidence for the visible services.
- Aadhaar-PAN Link Check is not Aadhaar identity verification.
- Verification cost and customer price are separate.
- Verification pricing must be configurable.
- Use the existing Saarthi wizard.
- Do not create a second verification engine.
- Keep User and Driver identity subjects separate.
- Do not recharge successful existing verification without an explicit re-verification rule.
- Persist verification before triggering success animation.
- Bank verification must use approved penny validation before restricted financial use.
- Do not create a fake verification wallet.
- Keep payment and financial records auditable.
- Do not modify GODWeb.
- Do not perform Git operations unless explicitly instructed.
- Preserve all existing working functionality.

---

# 43. Claude Code Execution Rule

Claude must:

1. Inspect first.
2. Understand the existing verification architecture.
3. Understand the existing Cashfree payment flow.
4. Map Way2API and Cashfree verification capabilities.
5. Map the existing verification wizard.
6. Map identity/document subjects.
7. Identify gaps and conflicts.
8. Produce an implementation plan.
9. Implement only the authorized changes.
10. Run relevant tests.
11. Report exact files and behavior changed.
12. Report provider/pricing assumptions that remain unresolved.

**Do not blindly rebuild the verification or payment system.**
