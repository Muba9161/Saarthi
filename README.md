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
| Nearby services + nearby Saarthi trucks (privacy-aware) | Working |
| SOS network with expanding-radius responder matching | Working |
| Driver scoring (explainable) + achievements | Working |
| Maintenance, fuel, rule-based maintenance risk | Working |
| Fleet analytics + digital truck passport | Working, computed from records |
| AI Copilot, recommendations, insights | Working (local analyst provider) |
| Audit logging | Working |

**110 automated tests pass** (67 API integration, 43 domain unit). Type checking and the production
build both pass.

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

# 4. Run
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
- [`docs/DEVELOPMENT_PROGRESS.md`](docs/DEVELOPMENT_PROGRESS.md) — what is done, what is next
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — the production migration path

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
