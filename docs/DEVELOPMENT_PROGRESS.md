# Saarthi — Development Progress

**Updated:** 2026-08-16
**Build:** type check ✅ · production build ✅ · 110 tests ✅ (67 API integration, 43 domain unit)

---

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Project foundation | ✅ Complete |
| 1 | Database foundation | ✅ Complete — 50 tables, 5 migrations |
| 2 | Authentication | ✅ Complete — 20 tests |
| 3 | RBAC + tenant isolation | ✅ Complete — proven by tests |
| 4 | Verification workflow | ✅ Complete |
| 5 | Document management | ✅ Complete |
| 6 | Truck management | ✅ Complete |
| 7 | Driver management | ✅ Complete |
| 8 | Supplier + materials | ✅ Complete |
| 9 | Customers | ✅ Complete |
| 10 | Orders | ✅ Complete |
| 11 | Trips | ✅ Complete |
| 12 | Map foundation | ✅ Complete — MapLibre, no API key needed |
| 13 | Mock GPS simulator | ✅ Complete |
| 14 | Realtime tracking | ✅ Complete |
| 15 | Trip replay | ✅ API complete; UI player not yet built |
| 16 | Nearby services | ✅ Complete — 416 seeded POIs |
| 17 | Nearby Saarthi trucks | ✅ Complete — privacy-aware |
| 18 | SOS | ✅ Complete |
| 19 | Driver scoring | ✅ Complete — explainable |
| 20 | Achievements | ✅ Complete |
| 21 | Maintenance | ✅ Complete |
| 22 | Fleet analytics | ✅ Complete |
| 23 | Subscriptions | ✅ Backend enforced; self-serve plan change not built |
| 24 | AI foundation | ✅ Complete |
| 25 | AI Fleet Copilot | ✅ Complete |
| 26 | AI recommendations | ✅ Complete |
| 27 | AI business intelligence | ✅ Complete |
| 28 | Production readiness | ◻ Not started |

---

## Backend — complete

- **50 tables** across 5 reproducible migrations. No manual SQL required at any point.
- **~120 endpoints** under `/api/v1`, every one validated, authenticated, authorised and audited.
- **Tenant isolation** returns `404` rather than `403` on cross-tenant access, so ids cannot be
  enumerated. Proven by tests.
- **Tracking pipeline** — one ingestion path shared by the simulator, the driver app and (later) GPS
  hardware. Derives distance, progress, ETA and delay; raises speed, harsh-braking, harsh-
  acceleration and route-deviation events; broadcasts to authorised channels only.
- **Provider abstractions** in place for storage, notifications, AI, cache, queue and pub/sub.
  `STORAGE_PROVIDER`, `AI_PROVIDER`, `CACHE_DRIVER`, `QUEUE_DRIVER`, `PUBSUB_DRIVER` select the
  implementation; no business code is aware of the choice.
- **Background jobs** — document expiry sweep, maintenance reminders, session cleanup, tracking
  retention. Handlers are plain async functions, so BullMQ is a driver swap.

### Bugs found and fixed by the test suite

1. A fleet that quoted an order got `404` reading it back, because quoting did not confer access.
2. Trip progress collapsed to 0% on two-point routes — projection matched the nearest *vertex*
   instead of the nearest *segment*.
3. Harsh-acceleration fired on the first location of a trip by comparing against a stale zero speed;
   now requires two fixes within 60 seconds.
4. An SOS responder could not mark themselves as arrived without a separate "help assigned" step.
5. Latitude/longitude on query-string endpoints rejected valid input (not coerced from strings).

---

## Frontend — core complete, some screens lean

Fully built out: **command centre, live map, trucks + digital truck passport, drivers + explainable
score breakdown, trips + live trip view, orders + order detail with quote comparison, new
requirement with transport matching, documents panel, maintenance, fuel, GPS simulator, AI copilot,
analytics, nearby services, SOS incident detail, driver home, driver SOS, notifications, settings,
subscription, admin overview, auth screens.**

Lean but real (list + live data + proper loading/empty/error states) — these are the next candidates
for the richer treatment: **SOS incident list, marketplace requirement list, material browse,
supplier catalogue, driver trip history, admin users / organizations / audit.**

Every screen handles loading, empty, error, unauthorised and plan-locked states. No route in the
router is missing a module, and no navigation link points at a page that does not exist.

---

## Design system

The UI was rebuilt on a shared visual language rather than page-by-page styling:

- **Glassmorphism in three strengths** — `.glass`, `.glass-panel`, `.glass-deep` in `globals.css`,
  each with a specular top edge and an ambient `.glass-backdrop` wash behind it so the blur has
  colour to refract. Blur alone reads as a rendering fault; the sheen is what makes it read as glass.
- **Motion primitives** — `components/motion` exports `PageTransition`, `Stagger`, `StaggerItem`,
  `RevealOnScroll`, `AnimatedNumber`, `AnimatedBar`, `LiveValue` and `HoverLift`. Every one returns a
  plain element when `useReducedMotion()` is true, so the whole system degrades in a single place.
- **Figures animate toward their value.** `StatCard` takes `numericValue` + `format` and springs to
  it, so a realtime change reads as movement rather than a silent swap. The number is still whatever
  the API computed — the component only animates the approach.
- **Responsive shell** — a collapsible desktop sidebar (persisted to `localStorage`) with a sliding
  `layoutId` active marker, and a glass bottom tab bar on mobile.

## Recent work

- **Marketing site** at `/` for signed-out visitors, with pricing driven by the real `PLAN_CATALOGUE`.
  Signed-in users are redirected to their role's home screen.
- **Moving trucks on the map.** MapLibre positions markers with a CSS transform; transitioning that
  property is what turns a sequence of discrete GPS fixes into a truck that glides along the road
  instead of teleporting. Paired with an eased camera follow.
- **Trip replay player** over `/trips/:id/replay` — scrubber, event pips, variable speed.
- **Inline verification review** in the admin queue: documents open in place, approve / reject /
  request-correction with a required reason.
- **Four demo accounts** instead of eighteen. `admin@`, `owner@`, `driver@`, `customer@` — all
  `@saarthi.local`, all password `Saarthi@2026`. The admin holds a second membership in the supplier
  organization, so the supplier experience is reached by switching organization rather than by a
  fifth login. A second fleet and second customer exist without logins so tenant isolation stays
  demonstrable.
- **Self-registration is fully functional.** A new organization gets a 14-day Pro trial. Because a
  self-served install has no platform reviewer, demo mode adds two escape hatches: self-approving
  your own submitted case, and marking a driver/truck verified directly from its detail page. Both
  sit behind `requireDemoMode()`, which the environment refuses to enable in production.
- **Fuel is derived from distance driven.** Fuel records were previously generated per truck
  independently of how far it had travelled, which produced ~10,500 L for a fleet that had covered
  ~3,600 km and a negative gross margin on the dashboard. Fills are now written against the trip
  that burned them, sized by distance ÷ efficiency. Cost per km now lands around ₹33.

## Verification status

Last full pass, all green:

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors across shared / api / web |
| `npm run lint` | 0 errors, 22 warnings (all `any` in the remaining lean list screens) |
| `npm test` | 118 passing (43 shared, 75 API integration against real PostgreSQL) |
| `npm run build` | succeeds; largest chunk is MapLibre at 803 kB, loaded only on map routes |

Smoke-tested live across all four accounts: dashboard aggregates, live positions, trip list, truck
analytics, driver session and trips, customer orders and marketplace, admin queue and organizations,
and a cross-tenant read correctly refused.

---

## Known gaps

1. **Self-serve plan changes.** Entitlements are enforced and the catalogue renders, but there is no
   checkout flow (the mock payment provider interface exists and is unused).
2. **Playwright E2E.** Configured but no specs written — the flows are covered by API integration
   tests instead.
3. **Redis drivers.** The cache/queue/pub-sub interfaces exist and `*_DRIVER=redis` is wired, but the
   Redis implementations deliberately throw rather than silently degrading.
4. **Lean list screens.** SOS incidents, marketplace requirements, material browse, supplier
   catalogue, driver trip history and the admin users / organizations / audit screens are real
   (live data, correct states) but still list-only, and they carry the remaining `any` types.
5. **Bundle size.** The map chunk is 803 kB (218 kB gzipped). It is already split and only fetched on
   routes that show a map, so this is acceptable; worth revisiting before production.

---

## Next steps, in order

1. Enrich the lean list screens (filters, detail drawers, bulk actions) and remove their `any` types.
2. Write Playwright specs for the register → verify → assign → order → trip → SOS → complete flow.
3. Implement the Redis cache/queue/pub-sub adapters behind the existing interfaces.
4. Self-serve plan checkout through the unused `PaymentProvider` interface.
5. Phase 28 — production readiness: dependency audit, secret scan, rate-limit review, HTTPS and
   cookie hardening, object storage, real GPS provider, production notification and payment
   providers, observability.
