# Saarthi

**The operating system for a trucking business** — fleet management, live tracking, a logistics
marketplace, driver safety and AI intelligence in one platform.

Saarthi runs completely on a local machine today, and is architected so moving to production is an
infrastructure change rather than a rewrite.

---

## What works right now

| Capability | State |
|---|---|
| Authentication, sessions, password reset | Working |
| RBAC across 8 roles + multi-tenant isolation | Working, enforced server-side |
| Subscription plans, entitlements, plan limits | Working, enforced server-side |
| Verification workflow (driver / truck / business) | Working |
| Document management: upload, version, verify, expiry engine | Working |
| Truck & driver management, assignments, history | Working |
| Supplier catalogue & customer marketplace | Working |
| Orders: post → quote → accept → trip | Working |
| Trips: full lifecycle with state-machine validation | Working |
| Tracking pipeline (ingest → persist → derive → broadcast) | Working |
| Mock GPS simulator (start/pause/resume/stop/reset/speed/deviation/delay) | Working |
| Realtime over WebSockets, per-channel authorisation | Working |
| 3D maps (terrain, extruded buildings, time-of-day lighting) | Working, no API key needed |
| Turn-by-turn navigation (truck routing, ETA, auto-reroute) | Working, needs a free OpenRouteService key |
| Nearby services + nearby Saarthi trucks (privacy-aware) | Working |
| Vehicle RC lookup + certificate PDF (Way2API) | Working, needs a Way2API key |
| Petrol / CNG station layer with published fuel prices (SSR) | Working, no key required |
| SOS network with expanding-radius responder matching | Working |
| Driver scoring (explainable) + achievements | Working |
| Maintenance, fuel, rule-based maintenance risk | Working |
| Service history: invoices, parts, warranty, repeat-component detection | Working |
| Vehicle loans & EMI: schedules, reminders, repayment ledger | Working |
| FASTag: tag status, balance tracking, low-balance and blacklist warnings | Working, live NETC lookup needs a key |
| Toll: crossings, spend by plaza, statement import, trip toll variance | Working |
| QR identity with per-field privacy policy and masking | Working, enforced server-side |
| Vehicle capacity by plan + `+1 vehicle` top-ups | Working, enforced server-side |
| Table / card view toggle, remembered per person per screen | Working |
| Multi-camera devices (YC06): four channels, live-view access log | Working, needs a video gateway |
| Fleet analytics + digital truck passport | Working, computed from records |
| AI Copilot with an authorised tool registry and provenance | Working (local analyst provider) |
| Daily fleet brief | Working, rule-based — not generated |
| Redis cache, pub/sub, locks and rate limiting | Working, off by default (memory drivers) |
| Audit logging | Working |

**556 automated tests pass** (352 API integration, 204 domain unit). Type checking and the
production build both pass.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure — copy the example and generate real secrets
cp .env.example .env
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64url'))"

# 3. Database (uses your local PostgreSQL, or `docker compose up -d`)
createdb saarthi            # or: psql -U postgres -c "CREATE DATABASE saarthi"
npm run db:migrate
npm run db:seed

# 4. Run — the map works immediately, no key required
npm run dev                 # API on :4000, web on :5173
```

Open <http://localhost:5173> and sign in with any demo account below.

### Demo accounts

Four accounts, one per side of the product. All use the password **`Saarthi@2026`**, and the login
screen fills them in for you.

| Role | Email | What it shows |
|---|---|---|
| Fleet owner | `owner@saarthi.local` | Fleet, trips, live map, GPS simulator, AI copilot |
| Driver | `driver@saarthi.local` | Driver app, SOS, safety score, documents |
| Customer | `customer@saarthi.local` | Marketplace, orders, live tracking of a delivery |
| Platform admin | `admin@saarthi.local` | Verification queue, audit log, organizations |

The admin account also holds a membership in the supplier organization — switch organization from
the sidebar to act as a supplier and manage materials. A second fleet and a second customer exist in
the data without logins, so tenant isolation is demonstrable: their trucks and orders must never
appear for the accounts above.

### Registering your own

Registration is open at `/register`, and a new organization is fully functional — it gets a 14-day
Pro trial, so nothing is feature-locked while you explore. Because a self-served install has no
platform reviewer, demo mode lets you approve your own verification submissions (**Verification →
Verify**) and mark a driver or truck verified directly from its detail page. Both are refused unless
`DEMO_MODE` is on, which the API will not allow in production.

---

## The five-minute demo

1. Sign in as **owner@saarthi.local** — the command centre shows real aggregates and eight
   trucks on the live map.
2. Open **GPS simulator**, pick the in-flight trip, set 25× speed, press **Start**. The truck glides
   along the road on the map rather than jumping between fixes.
3. Go to **Live map** — the marker keeps moving, driven by the same ingestion pipeline production
   GPS will use.
4. Open the trip — progress, ETA and delay update over the WebSocket without a refresh. Switch to
   the **Replay** tab to scrub back through the recorded history.
5. Press **Force deviation** in the simulator — a route-deviation alert appears and the driver's
   safety score drops with a stated reason.
6. Sign in as **customer@saarthi.local** in another browser profile, post a requirement, and watch
   the fleet quote it.
7. Sign in as **driver@saarthi.local**, raise an **SOS** — a nearby Saarthi truck is matched and
   alerted in realtime.
8. Ask the **AI Copilot**: *"What needs my attention today?"* — it answers from your own records and
   cites them.

---

## Maps

Saarthi renders through **MapLibre GL JS** on entirely open data. The basemap
needs no API key, no account and no payment method:

| Layer | Source | Cost |
|---|---|---|
| Vector tiles + styles | [OpenFreeMap](https://openfreemap.org) | Free, no key, no request limit, commercial use allowed |
| 3D building footprints | OpenStreetMap via the OpenMapTiles schema | Included in the tiles above |
| Elevation / 3D terrain | AWS Open Data terrain tiles (Tilezen) | Free, no key |
| Routing + place search | [OpenRouteService](https://openrouteservice.org) | Free key, email signup, **no card** |

Clone, `npm run dev`, and the 3D map renders. Only turn-by-turn navigation and
place search need a key.

### Enabling navigation

1. Sign up at <https://account.heigit.org/signup> — email only, no payment method.
2. Copy your API key from the dashboard.
3. Put it in the repo-root `.env`:

   ```dotenv
   VITE_ORS_API_KEY=your_key_here
   ORS_API_KEY=your_key_here
   ```

4. Restart `npm run dev` — Vite only reads `.env` at startup.

The free plan allows roughly 2,000 routing requests per day. Saarthi caches and
de-duplicates every routing and geocoding call, and derives navigation progress
from the local GPS stream rather than re-routing on each fix, so one trip costs
one routing request rather than one per tick.

### What the map does

| Feature | Notes |
|---|---|
| 3D buildings | Extruded from OSM footprints, shaded by the current sun position |
| 3D terrain | Real elevation, mild exaggeration so ghat sections read correctly |
| Time-of-day lighting | `dawn` / `day` / `dusk` / `night`, or `auto` from the clock |
| 5 basemaps | Liberty, Bright, Positron, Dark, Fiord |
| Turn-by-turn navigation | Manoeuvre list, ETA, distance remaining, arrival time |
| Truck routing | `driving-hgv` profile — respects HGV weight, height and access limits |
| Route alternatives | Compare options by time and distance, then switch |
| GPS road snapping | ORS Snap pulls each recorded fix onto the nearest road |
| Automatic re-routing | Fires after three consecutive off-route fixes, rate-limited |
| Driven/remaining split | The covered part of the route dims as the truck moves |
| Chase camera | Driver's-eye view that follows heading along the route |
| Place search | Geocoding, debounced and biased to the current view |
| Geolocation, fullscreen, scale, pitch controls | Standard MapLibre controls |

**Not available on this stack, and not faked anywhere in the UI:** live traffic.
OpenRouteService has no traffic model, so ETAs are free-flow estimates and no
congestion colouring or delay badge is shown.

Road snapping uses ORS Snap, which pulls each fix onto the nearest road but does
not reconstruct the path driven between two fixes — point `matchToRoads` at an
OSRM `/match` service for full path reconstruction.

The free plan quotas, per key per day: **Directions 2,000** (40/min),
**Snap 2,000** (100/min), Matrix 500, Isochrones 500, Export 100. HeiGIT is
migrating from `api.openrouteservice.org` to `api.heigit.org`; the new host is
the default and `VITE_ORS_BASE_URL` overrides it.

Configuration lives in [`apps/web/src/features/maps/map-config.ts`](apps/web/src/features/maps/map-config.ts)
— no component hard-codes a style URL or a camera angle. Set `VITE_MAP_STYLE_URL`
to serve a self-hosted OpenFreeMap instance or your own style JSON.

---

## Repository layout

```
saarthi/
├── apps/
│   ├── api/            Fastify + Prisma + PostgreSQL + WebSockets
│   │   ├── prisma/     Schema, migrations, seed (reference + demo)
│   │   ├── src/
│   │   │   ├── auth/           Sessions, tokens, RBAC context
│   │   │   ├── modules/        One folder per domain (service + routes)
│   │   │   ├── providers/      storage, notifications, AI — swappable
│   │   │   ├── realtime/       WebSocket gateway + channel authorisation
│   │   │   ├── infra/          cache, queue, pub/sub (memory today, Redis later)
│   │   │   └── jobs/           Scheduled background work
│   │   └── tests/      Integration tests against real PostgreSQL
│   └── web/            React + Vite + Tailwind + shadcn/ui
│       └── src/
│           ├── features/       auth, maps, documents, drivers, theme
│           ├── components/     ui primitives + shared building blocks
│           └── pages/          Route modules
├── packages/
│   └── shared/         Domain enums, RBAC, entitlements, geo, scoring,
│                       state machines, validation — used by API *and* web
└── docs/
```

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run API and web together |
| `npm run build` | Type-check and build every workspace |
| `npm run typecheck` | Type-check only |
| `npm run lint` | ESLint across the monorepo |
| `npm test` | All unit + integration tests |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reference data + demo world |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |

---

## Documentation

- [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — detailed setup and troubleshooting
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together
- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/VEHICLE_AND_PETROL_INTEGRATIONS.md`](docs/VEHICLE_AND_PETROL_INTEGRATIONS.md) — vehicle RC lookup and the petrol station directory
- [`docs/DEVELOPMENT_PROGRESS.md`](docs/DEVELOPMENT_PROGRESS.md) — what is done, what is next
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — the production migration path
- [`docs/SPEC_V3_IMPLEMENTATION_REPORT.md`](docs/SPEC_V3_IMPLEMENTATION_REPORT.md) — what spec v3.0 changed, and what it deliberately did not

---

## Design principles

1. **Real, not mocked.** Every button writes to PostgreSQL. No dashboard number is hard-coded.
2. **Mock today, replace tomorrow.** GPS, storage, notifications, payments and AI sit behind
   interfaces. Production swaps the implementation, not the business logic.
3. **The server is the authority.** The UI hides what a user cannot do; the API refuses it.
4. **Explainable by default.** Every driver-score change carries a reason. Every AI answer cites the
   records it used. Facts, calculations and predictions are labelled distinctly.
5. **Safety is not a feature flag.** SOS is reachable in one tap, is never gated behind a plan, and
   never claims to replace emergency services.
