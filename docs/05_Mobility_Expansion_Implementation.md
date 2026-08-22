# Saarthi — Mobility Expansion Implementation

**Implements:** [04_New_Features_Integration_Specification.md](04_New_Features_Integration_Specification.md)
**Date:** 2026-08-23
**Verification:** typecheck ✅ (shared/api/web, 0 errors) · API tests ✅ 167 · shared tests ✅ 153 · production build ✅ · seed ✅

---

## 1. What was decided, and why

### The vehicle table was *not* renamed

Spec §10 asks for a generalized `Vehicle`. The obvious reading is "rename `trucks`
to `vehicles`", and that was rejected.

`trucks` is referenced by 11 other tables, ~120 endpoints and the entire fleet
frontend. Renaming it is precisely the destructive migration §56 says to avoid,
and §54 puts existing working functionality above this specification in the
conflict order.

Instead the row gained a discriminator:

```
trucks.vehicleType   TRUCK | TAXI | CAR | BUS | VAN | SUV | TEMPO
                     AUTO_RICKSHAW | PICKUP | OTHER      (default TRUCK)
trucks.passengerCapacity, colour, airConditioned         (new, nullable)
trucks.truckType     now defaults to OTHER               (was required)
trucks.capacityTons  now defaults to 0                   (was required)
```

Every pre-existing row is a `TRUCK` and behaves exactly as before. `/trucks`
remains the goods-vehicle view; `/fleet/vehicles` is the new type-aware surface
over the *same rows*. A truck created through either appears in both — there is
an integration test asserting exactly that, because a "generalization" where the
two lists disagree would be a lie.

### Business logic asks about capabilities, not types

`packages/shared/src/domain/vehicles.ts` maps each type to what it *can do*:

```ts
vehicleSupports(VehicleType.TAXI, VehicleCapability.FREIGHT)   // false
vehicleSupports(VehicleType.VAN,  VehicleCapability.FREIGHT)   // true
```

Adding a vehicle type is a change to that one table rather than a sweep for
`if (type === ...)`. It is also why capacity is reported honestly: a taxi returns
`capacityTons: null`, not `0`, so the UI shows "—" instead of implying the taxi
carries nothing.

### Associations read through a projection, not a filter

Spec §9 and §32 restrict what an association may see. Rather than filtering a
query over `sos_incidents`, routing **copies** the permitted fields onto
`association_alerts`.

That choice matters: with a filtered query, privacy depends on every future query
remembering to filter, and on nobody adding a revealing column to the incident.
With a projection, the association's view is a closed set — widening it requires
deliberately editing
[association-alert.service.ts](../apps/api/src/modules/associations/association-alert.service.ts).

Driver name and phone are withheld until a named user acknowledges the alert, and
reading them writes an `association.sensitive_access` audit entry.

### Travel does not share the freight lifecycle

Freight: quoted by carriers → awarded → delivered → invoiced.
Travel: paid up front → provider accepts or declines → trip → rated.

Forcing both through one state machine would put an "unless it is travel" clause
on every rule. They share *infrastructure* — organizations, vehicles, drivers,
trips, tracking, notifications, payments — which is why a customer sees freight
and travel as two tabs of one account rather than two products.

### The mock device is not a shortcut

Spec §26 requires the simulator to use the same pipeline as real hardware. It
does, literally:

```
mock device → same gateway → same adapter registry → same rule engine
            → same storage → same dashboard
```

`mock-device.service.ts` does not write to `telemetry_readings` and bypasses no
check. Its payloads are validated, bounds-checked, replay-protected and
rule-evaluated like any other. When a physical Freematics unit is fitted, only
the adapter changes. Every reading it produces is flagged `simulated: true`, so
simulated data can never be mistaken for a vehicle's real history.

---

## 2. Database

Migration `20260822173245_mobility_associations_travel_hardware_telemetry`
— **22 tables, 75 statements, zero drops, zero NOT NULL additions.** Plus
`20260822182657_vehicle_type_pickup` and `20260822183..._notification_types_sync`
(both additive enum values).

| Area | Tables |
|---|---|
| Associations | `association_profiles`, `association_coverage_areas`, `association_alerts`, `association_alert_events`, `association_responders` |
| Providers & travel | `service_provider_profiles`, `provider_service_areas`, `travel_packages`, `travel_itinerary_days`, `travel_bookings`, `travel_booking_events`, `travel_reviews` |
| Payments | `payments` |
| Hardware | `hardware_devices`, `device_assignments`, `device_events`, `mock_device_runs` |
| Telemetry | `telemetry_readings`, `telemetry_diagnostic_codes`, `telemetry_alerts`, `telemetry_alert_rules`, `geofences` |

Additive changes to existing tables: `trucks` (7 columns, 1 index), plus new enum
values on `RoleName`, `OrganizationType`, `NotificationType`, `ScoreEventType`.

**Coverage matching is geographic.** A highway incident has coordinates but no
reliable district label without a geocoder, so an association registers coverage
points with a radius and matching is by great-circle distance. District and state
strings are display metadata, never the authorisation boundary.

---

## 3. API

New surfaces, all following the existing conventions (authenticate → permission →
entitlement → validate → audit):

```
/fleet/vehicles          generalized vehicle CRUD + /types catalogue
/associations            register, profile, coverage, verification
/associations/alerts     queue, overview, acknowledge, responders, notes,
                         escalate, resolve
/travel/me/*             provider profile, packages, bookings received
/travel/packages         customer search + detail + /quote
/travel/bookings         create, pay, confirm, decline, start, complete,
                         cancel, rate, /tracking
/devices                 register, update, assign, unassign, rotate-secret,
                         assignments, events, overview, mock simulator
/telemetry               latest, history, capabilities, alerts, rules,
                         geofences, maintenance recommendations
/device-gateway          device-authenticated ingestion (no user session)
```

### The gateway is the security boundary

`/device-gateway` is mounted apart from the rest of the API and deliberately does
**not** register `app.authenticate` — device credentials are the only accepted
identity there. Enforced in
[gateway.service.ts](../apps/api/src/modules/telemetry/gateway.service.ts):

| Check | Why |
|---|---|
| Assignment | A device with no vehicle has nothing to attribute readings to; orphans would later surface against whatever vehicle it is next fitted to |
| Status | SUSPENDED/RETIRED rejected — what makes revoking a stolen unit meaningful |
| Replay | Sequence ≤ highest accepted is dropped, so a captured payload cannot fake a position |
| Clock | A fast device clock would let a reading claim the future and win every "latest position" query |
| Bounds | 900 km/h is not a truck; bad hardware and injection look identical here |
| Identity | The credential decides which device this is, never the body |

Failures are uniform: unknown device, wrong secret and suspended device all
return the same 401, so the endpoint cannot enumerate device identifiers.

Device secrets are bcrypt-hashed, shown exactly once, and rotatable.

### Telemetry honesty

Every reading records `metrics` — the list of values it genuinely carries. A
consumer must check it before rendering. `0 rpm` and "this vehicle does not
report rpm" mean completely different things to a mechanic, and only that column
can tell them apart. The alert engine follows the same rule: a rule whose
required metric is absent is *skipped*, never treated as satisfied, so a vehicle
that cannot report coolant temperature is not permanently "cool".

---

## 4. Frontend

| Route | Screen |
|---|---|
| `/fleet/vehicles` | Whole-fleet list, filterable by capability |
| `/fleet/vehicles/:id/telemetry` | Live / alerts / history / hardware tabs |
| `/devices`, `/devices/:id` | Device inventory, fitment, credentials, simulator |
| `/telemetry/alerts` | Alert queue + maintenance recommendations |
| `/travel` | Customer package search |
| `/travel/packages/:id` | Package detail + booking form with live quote |
| `/travel/bookings`, `/travel/bookings/:id` | Booking list, payment, tracking, rating |
| `/travel/provider/packages`, `/travel/provider/bookings` | Provider side |
| `/association`, `/association/alerts/:id` | Emergency desk + response workflow |

Navigation adapts per organization type and permission. A `TRUCK_ASSOCIATION`
organization gets `ASSOCIATION_NAVIGATION` — an emergency queue and nothing else,
because its role grants hold no fleet, order, customer, financial or telemetry
permission at all.

No new design language: the same `PageHeader`, `DataTable`, `StatCard`, glass
cards, motion primitives and states as the rest of Saarthi.

---

## 5. Realtime

New channels — `association:{orgId}`, `device:{deviceId}`, `booking:{bookingId}`
— all authorised in `channel-authorization.ts` before a socket joins.

New events: `vehicle.telemetry.updated`, `vehicle.device.online|offline`,
`telemetry.alert.created`, `association.alert.created|updated`,
`booking.created|updated`.

**Fan-out is deliberately narrow.** A device reporting every second would push
3,600 messages/hour/vehicle to every dashboard in the organization. Telemetry
therefore goes only to the vehicle and device channels, throttled to one message
per 5 s per vehicle. Device *connectivity* is fleet-wide because that is an
operational concern; the readings are not. Association alerts go only to that
association's own channel — never the fleet channel, so two audiences never see
two different views of one event on the same wire.

---

## 6. Background jobs

| Job | Interval | Why |
|---|---|---|
| `associations:escalation` | 5 min | An alert arriving at an unstaffed office would otherwise sit there while the driver waits for a response that was never coming |
| `devices:offline-sweep` | 2 min | "Offline" is Saarthi's verdict formed from silence, so something has to notice it — without this a dead SIM looks like a parked truck |
| `telemetry:retention` | 24 h | A 50-vehicle fleet reporting every 5 s writes ~26 M rows/year; retention is per plan and batched to avoid long locks |

---

## 7. Testing

`apps/api/tests/mobility.test.ts` — 32 integration tests against real
PostgreSQL, weighted toward the guarantees that are expensive to get wrong:

- **Vehicles** — taxi without payload capacity; payload rejected on a passenger
  vehicle; required on a goods vehicle; capability filtering; a truck created
  through `/trucks` is visible as a vehicle.
- **Associations** — an incident routes only to associations whose coverage
  contains it (Kanpur gets nothing from a Lucknow incident); contact details
  withheld until acknowledged, then released; sensitive access audited;
  associations get 403 on fleet and orders; low-urgency SOS not routed;
  unverified associations receive nothing.
- **Travel** — pricing and booking fee; oversized party rejected; full
  pay → confirm → complete → rate path with trip creation; full refund on
  provider decline; a declined payment leaves the booking payable; cross-tenant
  booking reads 404.
- **Hardware** — secret returned once and stored hashed; unassigned device
  rejected; bad secret and unknown device indistinguishable; ingestion records
  only present metrics and moves the vehicle; replay rejected; implausible values
  rejected; a device cannot submit as another; overspeed alert with an explainable
  score deduction; assignment history retained on swap; two devices per vehicle
  refused; suspended device rejected; capabilities honest before any data.

---

## 8. Demo dataset

`npm run db:seed` adds, alongside the existing demo data:

- **3 truck associations** — Lucknow (verified, 3 coverage areas, 1 resolved
  alert with its full audit trail), Kanpur (verified, proves geographic scoping),
  Agra (pending, populates the verification queue)
- **1 travel provider** with 4 packages (3 published, 1 draft), 3 passenger
  vehicles, 1 driver
- **2 bookings** — one completed and rated 5/5, one awaiting provider confirmation
- **4 devices** — a mock unit streaming to a truck (24 readings, 1 open + 1
  resolved alert), a registered-but-unseen Freematics ONE+ Model H, a spare, and
  one on the travel SUV

New logins, password `Saarthi@2026`:

| Account | Sees |
|---|---|
| `association@saarthi.local` | District emergency desk, responders |
| `responder@saarthi.local` | Alert queue, respond only |
| `travel@saarthi.local` | Packages, bookings, provider profile |
| `taxidriver@saarthi.local` | Passenger trips |

The existing `customer@` account gains Travel; `owner@` gains Devices and
Telemetry.

---

## 9. Not built

Stated plainly rather than left to be discovered:

1. **Forms for association registration, provider profile and package
   authoring.** The APIs are complete and tested (`POST /associations/register`,
   `PUT /travel/me/profile`, `POST /travel/me/packages`); the screens currently
   read and act on that data but do not create it, so onboarding is API- or
   seed-driven. This is the largest remaining gap.
2. **Member responder assignment in the UI.** External responders can be assigned
   from the alert screen; assigning an association *member* needs a roster
   picker. The API supports both.
3. **Geofence and alert-rule editors.** Endpoints exist
   (`/telemetry/geofences`, `/telemetry/rules`); no screens yet, so rules run on
   their documented defaults.
4. **Playwright E2E specs** for the three demo scenarios (§44–46). The flows are
   covered by API integration tests instead.
5. **AI over telemetry (§31).** The AI context service was not extended, so the
   copilot cannot yet answer "which trucks have unusual telemetry?".
6. **Unified natural-language service discovery (§17).** The spec frames this as
   "eventually"; freight and travel search remain separate.
7. **Freematics payload verification (§60).** The adapter encodes the documented
   OBD-II PID and Freematics channel convention, but the exact frame format
   depends on the firmware build. It is marked clearly in
   [freematics.adapter.ts](../apps/api/src/providers/devices/freematics.adapter.ts)
   as requiring verification against physical hardware before production use —
   which is why the mock device exists and why nothing outside that file depends
   on those key names.

Also worth knowing: `npm run lint` reports one error in
`packages/shared/src/domain/route-intelligence.ts` (an unused import). That file
belongs to the concurrent vehicle-RC/route-intelligence work stream and was left
untouched.
