# Requirements & bidding

**Status:** implemented
**Migration:** `20260903140000_requirements_and_bidding`

---

## The problem this solves

A Saarthi customer could post exactly one thing: a freight load. Everything else was a catalogue to
browse.

| What the customer needed | How they got it before |
|---|---|
| Material | Browse `/browse`, pick a supplier's listing, order it |
| Freight transport | Post an `Order`, fleets quote, accept one |
| A cab | Browse `/travel`, hope a published package matched |
| A tour | Browse `/travel`, hope a published package matched |

Two consequences followed from that asymmetry.

**Customers had no single front door.** Somebody who needed cement delivered *and* a car for the
site visit used two unrelated screens with two unrelated mental models — one where they state a need
and receive offers, one where they shop.

**Providers could not see demand.** A tour operator could publish packages and wait. It had no way
to learn that a customer three streets away wanted a car to Ayodhya next Tuesday, because that want
was never written down anywhere. The freight side had a marketplace; the passenger side had a
shop window.

---

## The shape of the answer

A **requirement** is the customer's statement of need, in one of four kinds. The businesses whose
*organization type* qualifies them see it, bid on it, and the customer awards.

```
Customer → "What do you need?"
   ├─ Material supply        ─┐
   ├─ Freight transport      ─┤→  Requirement (OPEN)
   ├─ Cab / taxi hire        ─┤       ↓ qualifying businesses bid
   └─ Tour / travel package  ─┘   RequirementBid[]   (sealed)
                                      ↓ customer awards
                    ┌─────────────────┴─────────────────┐
                 Order                            TravelBooking
           (existing pipeline)                (existing pipeline)
                    └─────────────────┬─────────────────┘
                                    Trip
```

The award is the seam. Everything before it is new; everything after it is the platform as it
already was — trips, live tracking, delivery, payment, review. **No fulfilment code was
reimplemented.** A freight award creates the `Order` and an `OrderQuote`, then calls the existing
`acceptQuote`, which is what creates the trip, reserves the vehicle, moves the driver to `ON_TRIP`
and reserves the stock.

---

## Who may bid on what

Two gates, and both must hold. A permission answers *may this person act*; the organization type
answers *is this business in that market at all*.

| Requirement kind | Scopes it attracts | Who may offer them |
|---|---|---|
| `MATERIAL_SUPPLY` | `TRANSPORT` (a delivered bid naming a seller listing) | Fleet owners, enterprises |
| `FREIGHT_TRANSPORT` | `TRANSPORT` | Fleet owners, enterprises |
| `CAB_HIRE` | `TRAVEL` | Mobility providers |
| `TOUR_PACKAGE` | `TRAVEL` | Mobility providers |

The rules live in `packages/shared/src/domain/requirements.ts` so the API and the UI cannot disagree
about them. The board never trusts a client filter: `kind=` narrows what the caller already
qualifies for, so it cannot be used to look into another market.

### A material requirement is answered by a fleet owner

Customer ↔ Fleet Owner ↔ Seller: the customer never deals with the seller directly (see
`SAARTHI_SMART_COMMERCE_IMPLEMENTATION.md`). A fleet owner answers a material requirement with a
delivered bid — it names the seller listing it will source from (`sourceMaterialId`), the server
works out the procurement reference from that listing, and one award settles the requirement.

The `MATERIAL` scope and the `PARTIALLY_AWARDED` path remain in the schema for requirements posted
before this change; no organization may place a `MATERIAL` bid now, and a legacy one cannot be
awarded.

---

## What a sealed auction means here

Three deliberate omissions from the read model (`requirement.view.ts`):

- **A bidder sees its own offer and no other.** Showing rivals' prices would turn the auction into a
  race to undercut by one rupee.
- **The budget is hidden unless the customer publishes it.** A visible budget tends to become the
  price everybody quotes.
- **Contact details are released only to the winner,** and only if the winner is a party the
  customer may deal with directly — a fleet owner or mobility provider, never a seller. Otherwise
  the board is a phone list.

---

## Lifecycle

```
OPEN ──first bid──▶ BIDDING ──award──▶ AWARDED ──order/booking ends──▶ FULFILLED
  │                    │                   │
  │                    ├─partial award─▶ PARTIALLY_AWARDED ──award──▶ AWARDED
  │                    │
  └────────────────────┴──▶ CANCELLED (customer withdrew) / EXPIRED (window closed)
```

Both machines are declared in `packages/shared/src/domain/state-machines.ts` and every transition is
validated against them before a write.

`requirements:expiry-sweep` runs every 15 minutes. A requirement left `OPEN` past its deadline keeps
the customer waiting for offers that will not come and fills every provider's board with dates that
have already gone by.

---

## Files

| Layer | File | What it holds |
|---|---|---|
| Domain | `packages/shared/src/domain/requirements.ts` | Who sees what, which scope suits which kind |
| Domain | `packages/shared/src/domain/state-machines.ts` | Requirement and bid transitions |
| Contracts | `packages/shared/src/validation/requirements.ts` | One envelope, four detail blocks |
| API | `modules/requirements/requirement.service.ts` | Posting, the board, bidding, shortlisting |
| API | `modules/requirements/award.service.ts` | The seam — award → order or booking |
| API | `modules/requirements/requirement.view.ts` | Read models, and what each caller may see |
| API | `modules/requirements/fulfilment.service.ts` | Closing a requirement out when its work ends |
| API | `modules/requirements/expiry.service.ts` | Closing bidding windows |
| Web | `pages/requirements/new-requirement.tsx` | The wizard, branching on the first answer |
| Web | `pages/requirements/requirement-detail.tsx` | Comparing offers, and awarding |
| Web | `pages/requirements/board.tsx` | The provider board |
| Web | `features/requirements/bid-dialog.tsx` | Placing and revising an offer |

---

## Two design notes worth keeping

**The bespoke travel package.** `TravelBooking.packageId` is required, and a bespoke journey has no
catalogue entry. Rather than make the column nullable — a null check at roughly thirty call sites in
a file that works today — an award mints a package owned by the winning operator, marked with
`sourceRequirementId` and left in `DRAFT`. It never appears in customer search or the operator's own
catalogue, and the entire travel pipeline runs unchanged behind it.

**The award pre-flight.** Accepting a bid and building the order are two steps, and the world moves
between them: the quoted lorry gets sent elsewhere, its driver is stood down, the operator pauses
its profile. `assertStillDeliverable` checks all of that *before* anything is written, so the award
fails cleanly rather than committing the acceptance and then throwing — which would leave a
requirement that has rejected every losing bid and produced nothing.

---

## No seeded data

`npm run db:seed` loads reference data only: roles, subscription plans, feature entitlements. The
demo dataset was removed along with this work.

A marketplace seeded with fabricated demand tells a fleet there is work to bid on that does not
exist, and a bidding board is worth exactly what its contents are true. To exercise the flow,
register a customer and a provider and use them against each other.
