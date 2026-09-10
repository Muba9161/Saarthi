# SAARTHI — SALESMAN, SALES, REFERRAL & ONBOARDING IMPLEMENTATION REPORT

Implementation of `SAARTHI_SALESMAN_SALES_REFERRAL_ONBOARDING_SPECIFICATION.md`.

Read §2 first if you read nothing else: it lists the three decisions that need
a business answer before this goes live.

---

## 1. Pre-implementation analysis (specification §32)

### ALREADY IMPLEMENTED — reused, not rebuilt

| Capability | Where it already lived |
|---|---|
| Auth, sessions, RBAC catalogue, guards | `apps/api/src/auth/`, `packages/shared/src/domain/permissions.ts`, `apps/api/src/server/guards.ts` |
| Customer registration → organization → subscription | `apps/api/src/auth/auth.service.ts` (`register`) |
| Signup order provisioning + payment | `apps/api/src/modules/subscriptions/signup-order.service.ts` |
| Subscriptions, plans, capacity, **tracker purchase** | `apps/api/src/modules/subscriptions/`, `VehicleTracker` |
| Payments abstraction | `apps/api/src/providers/payments/` |
| Tracker/terminal, Driver App, vehicle QR pairing, OBD, telemetry | `modules/devices/`, `modules/terminal/`, `modules/telemetry/` |
| Audit trail | `apps/api/src/modules/audit/audit.service.ts` |
| QR rendering | `apps/api/src/modules/qr/qr-render.service.ts` |
| Demo/simulation gate | `DEMO_MODE`, `requireDemoMode()`, `modules/simulation/` |
| Public-URL resolution for links and codes | `apps/api/src/lib/public-url.ts` |

### PARTIALLY IMPLEMENTED — extended, not replaced

- **Demo Mode.** Existed as a GPS simulator for real tenants. Now has a
  salesman-facing script (`modules/sales/demo.service.ts`) that drives the
  *existing* screens and the *existing* simulator. No demo data generator, no
  demo tenant, no duplicated screens.
- **Tracker inventory.** `VehicleTracker` was a purchase record with a serial
  and no custody states. `TrackerHandover` adds the custody chain and points at
  that same row. No second device registry.
- **First-vehicle completion.** Every fact was already queryable. `onboarding.service.ts`
  is a read-only aggregator over `VehicleTracker`, `DeviceAssignment`,
  `HardwareDevice`, `TelemetryReading`, `TerminalSession` and `Truck`.

### NEW REQUIRED — built

`SALESMAN` role · 13 `sales.*` / `leads.*` / `referrals.*` / `commission.*` /
`tracker_handover.*` / `demo.*` permissions · `SalesmanProfile` · `SalesLead` +
`SalesLeadEvent` · `ReferralAttribution` · `CommissionRule` + `Commission` ·
`TrackerHandover` · read-only GODWeb provider · `/api/v1/sales/*` +
`/api/v1/referrals/public/*` · Sales navigation section and 9 pages · referral
capture on `registerSchema`.

### DUPLICATE — REUSE EXISTING (nothing new created)

Tracker registry → `VehicleTracker` / `HardwareDevice` · customer onboarding →
`auth.register` · payments → `Payment` / `paymentProvider` · Driver App, OBD,
vehicle pairing, telemetry → untouched · audit → `recordAudit` · QR image →
`renderPayloadDataUri`.

### CONFLICT — REQUIRED A DECISION

See §2. Three, all resolved conservatively and all still needing your sign-off.

---

## 2. Decisions that need a business answer

### 2.1 GODWeb has no validation API yet — dependency documented, not invented

There is no GODWeb integration anywhere in this repository (the only match for
"godweb" was a database username in `.env.backup`). Specification §3 says to
document the dependency rather than invent a GODWeb-side system, so:

- `apps/api/src/providers/godweb/` defines the contract, an HTTP adapter and a
  factory that returns `null` when unconfigured. **No local stub, no
  development fallback that answers "yes"** — for the same reason the identity
  and RC providers have none: a "verified" salesman profile authorises money.
- The endpoint path is configuration (`GODWEB_VALIDATE_PATH`) and the response
  mapper accepts several plausible field spellings, so switching Saarthi onto
  the real endpoint is an `.env` change rather than a code change.
- **What GODWeb must expose:** one authenticated read — `GET <path>/{godId}` —
  returning at least a display name and whether the person may still sell, and
  `404` (or `{found:false}`) for an unrecognised GODID. Nothing else.

**Until it exists**, a profile stays `PENDING_VERIFICATION`: it issues no
referral link and accrues no commission. To keep the feature operable, a
**platform administrator may verify a GODID by hand** — their user id and their
stated evidence are written onto the profile and into a distinct audit action
(`salesman.verified_manually`), and the path is **refused whenever GODWeb is
reachable**. That is the one deliberate deviation from "never trust a GODID
without verification": the trust is a named person's, recorded, revocable, and
impossible once the authority can be asked.

→ **Confirm** whether the manual path is acceptable for launch, and get the
GODWeb endpoint scheduled.

### 2.2 Commission rates — nothing seeded, nothing hard-coded

`commission_rules` ships **empty**. There is no rate constant anywhere in the
codebase. When a qualifying payment arrives and no rule matches, the commission
row is created `PENDING` with a **null** amount and a note saying so — not zero.
It cannot be approved (the API refuses, and a database CHECK refuses behind it),
it is counted separately from every total on both the salesman and admin
screens, and creating the rule prices it automatically.

→ **Needed:** the rate (or fixed amount) per sale type and plan, and the
qualification period. Enter them at `/admin/commission → Rules`.

### 2.3 Attribution window — configuration, surfaced, not silent

Specification §19 forbids silently inventing one.
`SALES_ATTRIBUTION_WINDOW_DAYS` defaults to **90**, is documented in
`.env.example` as needing a business decision, is returned on every referral
response, and is rendered on the salesman's referral screen. It is also **stored
on each attribution row at capture time**, so changing it never retroactively
takes a salesperson's credit away or hands it back.

→ **Confirm** 90 days.

### 2.4 One honest gap: commission on the subscription plan itself

Saarthi takes no payment for a plan. A plan is selected on trial
(`plan.service.selectPlan` charges nothing) and there is no recurring invoice
run. The only real payments are the signup add-ons, top-ups and trackers, and
those are wired.

Specification §20 is explicit that commission must not be payable merely because
a subscription record exists, so `CommissionTrigger.SUBSCRIPTION` is **not**
fired from anything today. `qualifySubscriptionPayment()` in
`modules/sales/qualification.ts` is the hook waiting for plan billing; when it
lands, its success path calls that and nothing else changes.

→ **Decide** whether plan-level commission is expected before recurring billing
exists. If it is, plan billing has to take a payment first.

### 2.5 Not built: courier dispatch for digital tracker fulfillment

Specification §22 draws the digital path as
`Subscription Purchase → Fulfillment → Warehouse / Dispatch → Courier → Customer`.

What exists is the purchase (`VehicleTracker`, with its payment reference and
serial) and the setup at the far end (the existing Driver App / OBD flow). What
does **not** exist anywhere in Saarthi is a warehouse, a dispatch queue or
courier tracking — and I have not built one. That is a logistics subsystem, not
part of "the sales/referral/commission layer and the necessary
handover/onboarding tracking" the specification's Core Principle scopes, and
inventing one would have meant a second inventory system of exactly the kind §11
forbids.

The physical path is complete: `TrackerHandover` records custody from stock to
salesperson to a named person at the customer. For the digital path, a
customer's paid-for tracker is recorded and the shipment is currently an
off-platform operation.

→ **Decide** whether digital dispatch tracking is in scope. If it is, the
natural shape is to widen `TrackerHandover` — its custody states already cover
allocation and receipt — rather than to add a table.

---

## 3. Architecture — what was *not* built

Specification §2 and §33 in the negative, verified:

| Not built | Evidence |
|---|---|
| Separate sales portal | `/sales/*` are routes in `apps/web/src/app/router.tsx` inside the same `AppShell` |
| Salesman website / APK | none; `SALES_NAVIGATION` is a section of the existing shell |
| Salesman auth system | `salesRoutes` uses `app.authenticate` like every other module |
| Salesman database | `SalesmanProfile.userId` → `users`; one identity system |
| Duplicate customer onboarding | referral capture calls into `auth.register`; no second signup |
| Duplicate tracker activation | `TrackerHandover` references `VehicleTracker`; no activation code |
| Duplicate Driver App / OBD / pairing / telemetry | `onboarding.service.ts` contains only `SELECT`s |
| Tracker QR workflow | no QR code is read or minted for a tracker anywhere; the only QR is the **referral** QR, rendered by the existing service |
| GODWeb modification | provider performs one `GET`; no write method exists on the interface |

---

## 4. Where the guarantees actually live

The anti-fraud rules (§27) are in the **database**, not in service code, because
read-then-write checks lose races and a lost race here pays one sale twice.

| Rule | Enforced by |
|---|---|
| First valid attribution wins | `referral_attributions_one_live_per_organization` — partial unique index on `(organizationId) WHERE status IN (CAPTURED, ATTRIBUTED, CONVERTED)` |
| One commission per qualifying payment | `commissions_trigger_paymentReference_key`, reached through `upsert` |
| No two active rules cover one sale | `commission_rules_one_default_per_trigger`, `commission_rules_one_per_trigger_plan` |
| A settled commission always has an amount | `commissions_settled_amount_present` CHECK |
| Salesman cannot approve own commission | `SALESMAN` holds `commission.read`, never `commission.manage` |
| Frontend cannot supply an amount | no schema in `validation/sales.ts` accepts one |
| Fake GODID earns nothing | `resolveVerifiedSalesman` returns null unless the profile is `ACTIVE` |

`apps/api/tests/sales.test.ts` exercises each of these against real PostgreSQL —
including writing straight to the tables to prove the constraints, not the
service, are what refuse.

---

## 5. Files

### Shared (`packages/shared`)
- `domain/enums.ts` — `RoleName.SALESMAN`, 9 sales enums, 7 notification types
- `domain/permissions.ts` — 13 permissions, the `SALESMAN` grant list
- `domain/sales.ts` — GODID handling, referral URLs, commission arithmetic, onboarding steps
- `domain/state-machines.ts` — lead lifecycle + `SALES_LEAD_DERIVED_STATUSES`
- `validation/sales.ts` — every input contract
- `validation/auth.ts` — `referralCode` on `registerSchema`

### API (`apps/api`)
- `prisma/schema.prisma` + `migrations/20260910180000_sales_referrals_commissions/`
- `providers/godweb/` — contract, HTTP adapter, factory
- `modules/sales/` — `salesman`, `lead`, `referral`, `commission`, `handover`,
  `onboarding`, `dashboard`, `demo`, `qualification`, `sales.routes`
- `config/env.ts`, `infra/cache-keys.ts`, `modules/audit/audit.service.ts`,
  `server/routes.ts`, `auth/auth.service.ts`, `jobs/index.ts`
- payment hooks in `subscriptions/{tracker,topup,signup-order}.service.ts`
- `tests/sales.test.ts` — 54 tests

### Web (`apps/web`)
- `features/sales/` — types, profile hook, standing notice, referral-code memory
- `pages/sales/` — dashboard, leads, lead-detail, customers, demo, referrals,
  trackers, commission, referral-landing
- `pages/admin/salesmen.tsx`, `pages/admin/commission.tsx`
- `app/navigation.ts`, `app/router.tsx`, `layouts/app-shell.tsx`,
  `pages/auth/register.tsx`, `components/common/status-badge.tsx`

---

## 6. Acceptance criteria (specification §33)

### Salesman
- [x] Verified GODID associated with a Saarthi salesman — `SalesmanProfile.godId`, unique
- [x] Sales accessible inside existing Saarthi — `/sales/*` in the same shell
- [x] Create/manage leads — `modules/sales/lead.service.ts`
- [x] Safe Demo Mode — reuses existing screens + simulator; six prohibitions enforced by construction
- [x] See attributed customers — `dashboard.service.customers`, deliberately thin
- [x] See commission status — `/sales/commission`, read-only

### Physical sales
- [x] Customer can register and subscribe — existing flow, untouched
- [x] Salesman can record tracker handover — `TrackerHandover`
- [x] Complete one real first-vehicle demonstration — `onboarding.service`, six real checks
- [x] Existing Driver App used — no new app; checklist reads its heartbeat
- [x] Existing vehicle QR / number connection used — reads `device_assignments`
- [x] Existing OBD flow used — detected from measured engine metrics
- [x] Telemetry reaches Saarthi — read from `telemetry_readings`
- [x] Customer repeats the process — stated on the screen; no code duplicates it

### Digital sales
- [x] Referral link — `/r/:code`
- [x] Referral QR — existing QR service
- [x] Attribution server-side — `referral.service` + partial unique index
- [x] Customer can register and subscribe — existing flow
- [x] Tracker fulfillment uses existing commerce — `VehicleTracker` purchase
- [x] Existing Driver App/OBD setup after delivery — unchanged

### Commission
- [x] Calculated server-side — `computeCommission`, no client input
- [x] Tied to the correct salesman/GODID — denormalised `godId` on every row
- [x] Duplicates prevented — unique index + `upsert`
- [x] Salesman cannot edit — permission split
- [x] Status visible — `/sales/commission`
- [x] Qualification uses actual successful payment — `qualifyPayment` call sites only

### Architecture
- [x] No separate Sales portal / Salesman APK / GODWeb modification
- [x] No tracker QR workflow, no duplicate tracker activation
- [x] No duplicate Driver App / OBD / telemetry
- [x] Existing design system and architecture preserved

---

## 7. Verification performed

- `npm run typecheck` — shared, API and web clean. Two pre-existing errors in
  `tests/toll.test.ts` are untouched by this work.
- `npx eslint` on every new file — clean.
- `prisma migrate diff` — schema and migration in exact parity.
- Migration applied to `saarthi` and `saarthi_test`; `SALESMAN` role seeded;
  the three anti-fraud indexes verified present in PostgreSQL.
- `tests/sales.test.ts` — 54 passing.
- `tests/auth.test.ts` + `tests/subscription-capacity.test.ts` — 49 passing,
  confirming the registration and payment hooks broke nothing.

Not verified: the GODWeb HTTP adapter against a live GODWeb, because there is
none to reach. Its response mapping has no test coverage beyond typechecking and
should be exercised the day the endpoint appears.

---

## 8. To put a salesperson live

1. Set the commission rule at `/admin/commission → Rules`. (Without it, sales
   are recorded but carry no amount.)
2. Confirm `SALES_ATTRIBUTION_WINDOW_DAYS`.
3. `/admin/salespeople → Add a GODID`, with the person's Saarthi user id.
4. Verify the GODID — with GODWeb if configured, otherwise by hand with stated
   evidence.
5. They sign in and land on `/sales`, with their referral link ready.
