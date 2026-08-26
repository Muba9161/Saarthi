# Saarthi — Spec v3.0 Implementation Report

Completion report for `SAARTHI_COMPLETE_CURRENT_PRODUCT_FEATURE_SPECIFICATION_v3.0.md`,
in the form required by spec §66.

---

## 1. Reconciliation with the existing repository

The repository already implemented the large majority of the spec. Nothing was
rebuilt. The classification that drove this work:

| Spec area | Classification | Action |
|---|---|---|
| Logistics, mobility, safety, associations, travel, nearby, SOS, media, inventory, return loads, route intelligence | ALREADY IMPLEMENTED | Verified, untouched |
| Devices, telemetry, Freematics, mock device, live tracking, WebSocket realtime | ALREADY IMPLEMENTED | Extended (below) |
| Loan & EMI (§19, §27) | NEW | Built end to end |
| QR field privacy & masking (§17, §34) | PARTIALLY IMPLEMENTED | Extended |
| Service history (§20) | PARTIALLY IMPLEMENTED | Extended |
| Subscriptions by vehicle count + `+1` top-up (§41, §42) | CONFLICT | Reconciled |
| Table/card view system (§21) | NEW | Built |
| Redis as first-class infrastructure (§43) | NEW | Adapters implemented |
| AI tool registry, Gemini, provenance, daily brief (§22–§40) | PARTIALLY IMPLEMENTED | Extended |
| YC06 four-camera (§10, §52) | NEW | Built |
| FASTag & toll (§3, §29, §37, §58, §69) | NEW | Built, with a live NETC adapter |
| Vehicle resale (§4) | REQUIRES DEFERRAL | Feature-flagged off, data intact |

---

## 2. Database migrations

All additive. No column was dropped, no table renamed, no data destroyed.

| Migration | Contents |
|---|---|
| `20260826173359_vehicle_finance_loans` | `vehicle_loans`, `loan_installments`, `loan_payments`, `loan_events`, `loan_reminders`; 11 enums; 6 `NotificationType` values |
| `20260826181543_qr_privacy_policy` | `qr_privacy_policies` |
| `20260826183450_vehicle_subscription_topups` | `vehicle_subscription_topups`, `TopUpStatus` |
| `20260826185356_service_history_fields` | 22 columns on `maintenance_records`; `ServiceCategory`, `ServiceDataSource`, `ServiceVerificationStatus`; 2 indexes |
| `20260826…_user_view_preferences` | `user_view_preferences`, `ViewMode` |
| `20260826…_device_cameras_video` | `device_cameras`, `video_stream_sessions`; `CameraPosition`, `CameraStatus`, `StreamSessionStatus`; `DeviceProvider.YC06`; `DeviceType.MULTI_CAMERA` |
| `20260826203550_fastag_and_toll` | `fastag_accounts`, `toll_transactions`; `FastagStatus`, `TollDirection`, `TollDataSource`, `TollPaymentMode`; 3 `NotificationType` values |

**Backward compatibility.** Every new column is nullable or defaulted. The one
behavioural change is plan vehicle capacity (§4 below) — enforced only when
*adding* a vehicle, so no existing fleet loses access to a vehicle it runs.

---

## 3. What was built

### 3.1 Loan & EMI (§19, §27)

Saarthi records finance; it does not provide it. Nothing in this module moves
money — a payment row is a note that a payment happened elsewhere.

- **Models** — `VehicleLoan`, `LoanInstallment`, `LoanPayment`, `LoanEvent`,
  `LoanReminder`. `loanNumber` is unique *per tenant*, not globally: two fleets
  can genuinely hold the same reference from different financiers.
- **Domain** (`packages/shared/src/domain/loans.ts`) — amortisation for flat,
  reducing-balance and floating interest at four frequencies; the final
  installment absorbs rounding residue so principal columns sum exactly to the
  amount borrowed; month-end dates clamp into February rather than rolling.
- **Installment states** — `UPCOMING → DUE_SOON → DUE_TODAY → OVERDUE`, plus
  `PAID`, `PARTIALLY_PAID`, `WAIVED`, `UNKNOWN`. Terminal states are stored;
  transient ones are recomputed on read so a schedule is right the moment a date
  rolls over.
- **`UNKNOWN` is load-bearing.** An installment a lender did not disclose a
  payment state for is excluded from *both* the paid and outstanding totals and
  counted separately. Every surface that shows a total also shows the gap.
- **Reminders** — T-4, T-1, T+1, configurable per loan. Duplicate suppression is
  a unique key on (installment, reminder kind) in PostgreSQL, not timing, so a
  restarted worker cannot resend.
- **Providers** — `LoanProvider` with `InternalLoanProvider` (refuses retrieval
  and explains why — "Saarthi is not connected to that lender" is a different
  statement from "the lender has no record of this loan") and `MockLoanProvider`
  (deliberately disagrees slightly, so reconciliation and conflict paths run
  locally). Provider figures land as `PROVIDER_REPORTED`, never `VERIFIED`.
- **Disclosure** — owner sees everything; support sees masked loan numbers and
  no mandate reference at all; a fleet manager sees nothing.
- **Surfaces** — `/fleet/loans` list with fleet totals, loan detail with full
  schedule and payment ledger, and a Loan & Finance tab on the Vehicle Passport
  with a live EMI preview when recording a loan.

### 3.2 QR field privacy (§17, §34)

The existing scope system decided *categories*; this decides how much of each
field inside a granted category is disclosed.

- **Profiles** — `PUBLIC`, `BASIC_VERIFIED`, `OPERATIONAL`, `OWNER`, `ADMIN`,
  mapped from the scanner's established relationship.
- **28 catalogued fields** with a default minimum profile, a masking threshold
  and a mask strategy. Masks match the spec: `9876543210 → 98******10`,
  `DL-123456789012 → DL-1234****9012`, `LOAN-123456789 → LOAN-*****6789`.
- **A policy can only narrow.** The effective answer is the narrowest of the
  code's scopes, the relationship ceiling and the policy. An owner marking a
  driver's phone public does not expose it to someone the relationship never
  granted `CONTACT` to. Verified by test.
- **Never disclosed by any policy** — driver home address, chassis and engine
  numbers, loan numbers, EMI amounts, outstanding balances, FASTag references
  and balances. They appear in the settings screen marked *Fixed*, so an owner
  can see that Saarthi does not share them.
- **Tenant kill switch** — `allowPublicScans: false` closes anonymous scanning
  across every already-printed sticker without reissuing any of them.
- **Added to the scan payload** — a rule-based service verdict and a
  finance-status flag (financed yes/no, never amounts), matching the spec's
  example scan.

### 3.3 Subscriptions: capacity and top-ups (§41, §42)

This was the one genuine conflict with the existing implementation, which sold
feature tiers rather than fleet sizes.

- Plan capacity is now **1 / 5 / 20 / 50 vehicles** across the four existing
  tiers, so no tier was deleted and no tenant lost their feature set.
- **`VehicleSubscriptionTopUp`** — one row per `+1 vehicle`, each with its own
  billing window and payment reference, so three bought at different times can
  be cancelled independently.
- **Effective capacity is resolved centrally.** `limits.maxTrucks` is base +
  active top-ups, folded in by the entitlement service, so every existing
  capacity check honours a top-up without being changed and no future check can
  forget to.
- **Over-capacity never removes anything.** A lapsed top-up or a downgrade
  leaves vehicles working; only *adding another* is refused. Verified by test.
- Purchases are serialised per tenant with a distributed lock, and a declined
  payment is recorded rather than discarded.

### 3.4 Service history (§20)

- 22 columns added to the existing `MaintenanceRecord` rather than a parallel
  model, per §57: engine hours, category, workshop, mechanic, labour/parts/tax
  split, invoice number, parts line items, replaced components, diagnostic
  codes, warranty, source, verification status, provider, conflict note.
- **Normalised component keys** (31 of them) alongside free-text part names, so
  "have these brake pads been replaced twice?" is answerable. Consumables are
  excluded from repeat detection — flagging oil changes would bury the signal.
- **Deterministic analysis** — service health, spend, cost-per-km, cost trend
  and repeated components are computed by rules before the AI layer sees them.
- **Conflicts surface, they do not resolve.** An external record that
  contradicts one already held marks the record `CONFLICT` and keeps both.
- **`VERIFIED` has exactly one path**: a person. Not an import, not a provider
  sync, and explicitly not AI extraction.
- **Coverage is stated.** No network sees every roadside workshop, and the
  timeline says so rather than implying completeness.

### 3.5 Table / card view system (§21)

- `UserViewPreference` — per user, per surface: layout, hidden columns, page
  size, sort. Stored server-side so the choice follows the person between
  devices; `localStorage` holds a copy only to avoid a wrong-layout flash.
- `DataView` wraps the existing `DataTable` and adds a card layout, a column
  picker and the toggle. A screen may supply its own card renderer; without one
  the columns render as label/value pairs, so **adopting it is a one-line
  change** and no list is left without a mobile layout.
- Adopted on: vehicles, drivers, trips, orders, maintenance, devices,
  incidents, loans.

### 3.6 Redis (§43)

Every driver interface already existed and threw when set to `redis`. All four
are now implemented.

- **`RedisCache`** — degrades to a miss on any failure (a cache is an
  optimisation; PostgreSQL is the truth), every key carries a TTL, and
  prefix invalidation uses `SCAN`/`UNLINK` rather than `KEYS`.
- **`RedisPubSub`** — separate subscriber connection, environment-namespaced
  channels, local fan-out so one subscription serves many handlers.
- **`RedisLock`** — `SET NX PX` with a token and a Lua compare-and-delete, so a
  worker whose lease expired cannot release its successor's lock.
- **`DistributedQueue`** — every instance keeps its timers, but only the one
  that takes the lock runs each tick. Explicitly *not* a durable queue; the
  comment says where BullMQ belongs when work needs delivery guarantees.
- **Rate limiting** moves to Redis with `CACHE_DRIVER=redis` — an in-memory
  limiter counts per instance, which silently triples a limit across three.
- **Live vehicle state** (§43.2) — positions cached per vehicle with a
  heartbeat TTL; the live-map payload is cached briefly and overlaid with
  fresher positions, so a map poll no longer joins three tables.
- **Cache keys** follow §43.5 exactly: `saarthi:{env}:…`, always tenant-scoped.

### 3.7 AI: tool registry, Gemini, provenance, daily brief (§22–§40)

- **Authorised tool registry** — 25 tools across fleet, vehicle, service,
  finance, driver, cost and subscription. Three checks stand between a model and
  the data: the tool must exist, the *caller's* permissions and plan must allow
  it, and the arguments must pass the tool's own Zod schema.
- **Unusable tools are never offered.** A model told about
  `get_vehicle_loan_summary` will offer to check EMIs; a dispatcher who cannot
  see finance would then be refused after being promised an answer.
- **Cache keys include the authorisation scope** — tenant, user and permission
  set — so one tenant can never receive another's cached answer. Verified by
  test.
- **Every result carries a basis** (`SOURCE_DATA` / `RULE_RESULT` /
  `PROVIDER_REPORTED`), a record count, references and **caveats**, which are
  surfaced to the user rather than summarised away.
- **`get_toll_summary` exists to say toll is not tracked**, rather than leaving
  a model free to invent a figure.
- **Gemini provider** — REST, no SDK dependency, with function calling. Falls
  back to the local analyst when unconfigured.
- **The development provider now supports tools**, so permission filtering,
  argument validation, execution, provenance and the iteration limit all run on
  every local question rather than only in production.
- **Provenance** — `POST /ai/ask` returns the full record of which tools ran,
  over how many records, cached or not, and a sentence in the spec's shape:
  *"Based on 42 trips, 18 fuel transactions, 6 service records."*
- **Daily brief** (§37) — deterministic, not generated. Ordered by what is
  already costing money or safety. Sent only to fleets with something
  outstanding: a daily "all clear" is how people learn to swipe the brief away
  without reading it.

### 3.8 YC06 four-camera (§10, §52)

- `DeviceCamera` (one row per physical channel) and `VideoStreamSession`.
- **Cameras belong to the device, not the vehicle.** A recorder moved between
  trucks takes its channels with it, and last month's footage still resolves to
  the vehicle it was fitted to then. Verified by test.
- **The recorder is not a position source** even with a GPS receiver: a vehicle
  has one designated telemetry device, because two devices reporting slightly
  different positions is unresolvable in support. A vehicle carries a Freematics
  and a YC06 simultaneously in the test suite.
- **Video never passes through the API.** Saarthi issues a short-lived,
  camera-scoped ticket; frames go device → gateway → browser. Only the hash of
  the ticket is stored.
- **Every live view is recorded — including refused ones.** A camera pointed at
  a driver is a surveillance capability, and an access log is what keeps it
  accountable. The UI states this at the moment of use, not in a settings page.

### 3.9 FASTag & toll (§3, §29, §37, §58, §69)

Built against a **real NETC integration**, not a stub. The two documented
Masters India endpoints are implemented in full:

| Endpoint | Serves |
|---|---|
| `POST /api/v2/sbt/FASTAG/02` | Tag details: tag id, registration, NETC vehicle class, `TAGSTATUS`, `EXCCODE`, `BANKID`, issue date |
| `POST /api/v2/sbt/FASTAG/` | Recent toll crossings: plaza name, geocode, lane direction, reader time |

Adapter details that matter: a `200` is inspected before it is trusted
(`errCode: 740` means *no tag on record*, and arrives as a healthy 200); tag
details come back as `{name, value}` pairs and are indexed before use; reader
times are anchored to IST rather than read as UTC, which would place every
crossing five and a half hours early; an unrecognised `TAGSTATUS` maps to
UNKNOWN with the raw letter preserved rather than being guessed at.

**Three honest limits, encoded as provider capability flags** rather than
discovered by a user pressing a button that fails:

- **`supportsBalance: false`.** No third-party NETC endpoint returns the rupee
  balance — it belongs to the issuing bank. Saarthi shows the balance an
  operator recorded, stamped with when it was true, and treats a reading older
  than a week as *unknown* rather than current, because the tag has been paying
  tolls in the meantime. A tag nobody has reported is `null`, never `₹0`.
- **`supportsRecharge: false`.** Topping up is the issuer's payment rail. The
  app records a top-up made elsewhere, links out to the issuer, and the response
  says in words that it did not move money.
- **The crossing feed reports the passage, not the fare.** A crossing arrives
  without an amount, so it is stored unpriced and flagged for review, and every
  total says how many rows it could not price — a floor, not a figure.

Also built: low-balance and blacklist sweeps with notifications, statement
import that is idempotent on the NETC reference and raises a *conflict* rather
than overwriting a receipt when two sources disagree on a fare, spend by plaza
and by payment mode (cash at a booth is surfaced separately — it costs more than
the FASTag rate), toll variance against the **median** of comparable runs which
**refuses to answer below three samples**, trip cost with toll separated from
fuel, four AI tools, the `3 low FASTag balances` line the spec's §37 brief asks
for, and a Toll & FASTag screen plus a per-vehicle tab.

### 3.10 Resale deferral (§4)

Disabled by withholding the entitlement (`RESALE_ENABLED=false`), which closes
the API routes, the navigation and the buttons in one move. **No data was
deleted and no code removed** — `RESALE_ENABLED=true` restores the surface with
no migration. Two read routes that were permission-gated only have been brought
under the feature guard so nothing stays open behind the flag.

---

## 4. Interfaces

**New endpoints** — 38 across:
`/fleet/loans/*`, `/fleet/vehicles/:id/loans`, `/service-history/*`,
`/fleet/vehicles/:id/service-history`, `/subscriptions/*`,
`/qr/privacy-policy`, `/me/view-preferences/*`, `/devices/:id/cameras`,
`/cameras/*`, `/fleet/vehicles/:id/cameras`, `/ai/ask`, `/ai/tools`,
`/ai/daily-brief`.

**New providers** — `LoanProvider`, `ServiceHistoryProvider`, `VideoProvider`,
`FastagProvider` (with a live Masters India NETC adapter), `GeminiAiProvider`,
plus tool-calling on the existing `AiProvider`.

**New background jobs** — `loan:emi-reminder`, `loan:overdue-check`,
`subscription:topup-expiry`, `ai:daily-fleet-brief`, and stream-session expiry
folded into the device sweep. All idempotent, all lock-guarded.

**New permissions** — `loans.read`, `loans.manage`, `loans.sensitive`,
`toll.read`, `toll.manage`, `toll.fastag.sensitive`. Loans are owner-level;
toll read/manage sit in the general fleet grant because a dispatcher works with
toll daily, and only the tag identifier is owner-level.

**New entitlements** — `finance.loans` (Basic and above — a single-truck owner
with an EMI is the archetypal customer, not an enterprise upsell) and
`finance.loans.sync` (Pro and above — provider calls cost money to make).

**Configuration** — `FASTAG_PROVIDER`, `FASTAG_API_KEY`, `FASTAG_SUB_ID`,
`FASTAG_API_BASE_URL`, `FASTAG_LOW_BALANCE_THRESHOLD`, `FASTAG_CACHE_TTL`,
`LOAN_PROVIDER`, `LOAN_DUE_SOON_DAYS`,
`LOAN_REMINDER_OFFSETS`, `LOAN_REMINDER_BATCH`, `SERVICE_HISTORY_PROVIDER`,
`VIDEO_PROVIDER`, `VIDEO_TICKET_TTL`, `VIDEO_MAX_CAMERAS_PER_DEVICE`,
`RESALE_ENABLED`, `LOCK_DRIVER`, `AI_PROVIDER=gemini`. All documented in
`.env.example`.

---

## 5. Verification

| Suite | Result |
|---|---|
| API integration (`apps/api`) | **16 files, 352 tests passing** |
| Shared unit (`packages/shared`) | **4 files, 204 tests passing** |
| TypeScript (`shared`, `api`, `web`) | Clean |
| Web production build | Succeeds |
| API boot | Clean, all new routes registered |
| Demo seed | Runs end to end: 4 loans, 204 installments, 32 enriched service records, 4 cameras |

New test files: `loans.test.ts` (33), `qr-privacy.test.ts` (20),
`subscription-capacity.test.ts` (18), `service-history.test.ts` (21),
`view-preferences.test.ts` (8), `ai-tools.test.ts` (17), `cameras.test.ts` (15),
plus 44 finance and masking unit tests in the shared package — 176 new tests in
all, taking the API suite from 9 files to 16.

No pre-existing test was weakened. One was updated: the Basic-plan capacity test
now derives its expected limit from `PLAN_LIMITS` instead of a hard-coded 5, so
it stays true as the plan lineup moves.

---

## 5a. Defect found and fixed during review

`listLoans` composed `overdueOnly` and `dueWithinDays` as sibling keys on the
same `installments` relation, so the second silently replaced the first: asking
for "overdue **and** due within 90 days" quietly returned everything due in the
window, overdue or not. Both filters now compose through `AND`, the shared
"still owed" status list is defined once, and a regression test covers the
combination.

---

## 6. Known limitations

1. **FASTag balances are not served by any NETC lookup API**, including the one
   integrated here. That is a property of the ecosystem, not of this build: the
   balance sits with the issuing bank. Saarthi tracks what an operator records
   and ages it out rather than showing a stale figure as current. A live balance
   would need either an issuer-specific integration or BBPS agent status.
2. **Recharge is recorded, not performed**, for the same reason.
3. **The NETC adapter is implemented against the published contract but has not
   been exercised against the live API** — no credentials are configured here.
4. **Gemini is implemented but unexercised against the live API.** No key is
   configured on this environment; the local analyst covers the same tool path.
5. **The Redis adapters are implemented but not run against a live Redis** —
   none is reachable here. Every driver still defaults to `memory`, which is
   correct for single-instance local development.
6. **`DistributedQueue` is not a durable job queue.** No retry, backoff or
   dead-letter handling. Every registered job is an idempotent sweep that
   re-runs on the next tick; BullMQ is the upgrade path when work needs delivery
   guarantees.
7. **The mock video provider issues tickets against a gateway that does not
   exist.** Every ticket and clip is flagged `simulated`, and the UI shows it.
8. **Gemini Voice / Live (§38) is not implemented.** The existing voice surface
   is unchanged; wiring it to the tool registry is the next step.
9. **One pre-existing lint error remains**, both in files outside this work:
   `apps/api/src/modules/qr/sticker.renderer.ts` (unused `fit`) and
   `packages/shared/src/domain/route-intelligence.ts` (unused
   `distanceToSegment`). Left untouched because both files are in flight.

---

## 7. Production migration requirements

The codebase is configuration-driven throughout, so moving to production is
infrastructure work rather than a rewrite (§67):

| Local | Production |
|---|---|
| `CACHE_DRIVER=memory` | `redis` + `REDIS_URL` |
| `PUBSUB_DRIVER=memory` | `redis` — **required** above one instance, or realtime silently misses subscribers |
| `LOCK_DRIVER=memory` | `redis` — **required** above one instance, or duplicate EMI reminders |
| `QUEUE_DRIVER=memory` | `redis` for tick coordination; BullMQ if durable queuing is needed |
| `AI_PROVIDER=development` | `gemini` + `AI_API_KEY` |
| `LOAN_PROVIDER=internal` | An integrated financier adapter, with consent capture |
| `FASTAG_PROVIDER=internal` | `mastersindia` + credentials for live NETC tag status and crossings |
| `SERVICE_HISTORY_PROVIDER=internal` | An OEM or workshop network adapter |
| `VIDEO_PROVIDER=none` | A WebRTC gateway; `mock` is refused in production |
| `STORAGE_PROVIDER=local` | Object storage |
| `RESALE_ENABLED=false` | Unchanged until resale returns to scope |

Three provider factories refuse their mock in production by design: finance,
service history and video. Each would otherwise put simulated figures somewhere
a person makes a real decision.

---

## 8. Deferred

**Vehicle / truck resale marketplace** — implemented, disabled, data preserved,
reachable again with one environment variable. Nothing in §4's prohibition list
is reachable while `RESALE_ENABLED=false`.
