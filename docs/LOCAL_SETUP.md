# Local setup

Saarthi runs entirely on your machine. Nothing here needs a paid cloud service, an API key or a
network connection to a third party.

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.11 | Developed on 22.17 |
| npm | ≥ 10 | Uses npm workspaces |
| PostgreSQL | ≥ 15 | 17 recommended |
| Docker | optional | Only if you prefer containers to a native PostgreSQL |

Redis is **not** required. The cache, queue and pub/sub layers default to in-process
implementations that satisfy the same interfaces.

## 1. Install

```bash
npm install
```

## 2. Environment

```bash
cp .env.example .env
```

Then replace the three placeholder secrets. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `COOKIE_SECRET`. The API refuses to start if any
is shorter than 32 characters, and refuses to start in production if any still contains a
placeholder.

`DATABASE_URL` defaults to `postgresql://postgres:postgres@127.0.0.1:5432/saarthi`.

## 3. Database

Using your native PostgreSQL:

```bash
psql -U postgres -c "CREATE DATABASE saarthi"
```

Or using Docker (starts PostgreSQL and Redis):

```bash
docker compose up -d
```

Then apply migrations and seed:

```bash
npm run db:migrate
npm run db:seed
```

The seed creates reference data only — roles, subscription plans and feature entitlements. It is
idempotent and safe to run in any environment, including production.

There is no demo dataset. A marketplace seeded with fabricated organizations, orders and bids shows
an operator work to bid on that does not exist, and a bidding board is worth exactly what its
contents are true. Register the accounts you need instead; the first one you create is real.

## 4. Run

```bash
npm run dev
```

- API — <http://localhost:4000> (health at `/health`)
- Web — <http://localhost:5173>

Register an account at <http://localhost:5173/register>. Pick the organization type that matches
what you are testing — a customer posts requirements, a supplier and a fleet bid on them, a mobility
provider bids on cabs and tours.

## Verifying the install

```bash
npm run typecheck     # must exit 0
npm test              # 110 tests must pass
npm run build         # must produce apps/web/dist and apps/api/dist
curl http://localhost:4000/health
```

Tests use a separate `saarthi_test` database, created and migrated automatically on first run. Your
development data is never touched.

## Troubleshooting

**`Environment variable not found: DATABASE_URL`**
Prisma reads `.env` from the repository root via `apps/api/prisma.config.ts`. Confirm `.env` exists
at the root, not inside `apps/api`.

**`Cannot find module '@saarthi/shared/dist/index.js'`**
Build the shared package once: `npm run build -w @saarthi/shared`. In development the API resolves
it from source via tsconfig paths, but a stale `node_modules` symlink can shadow that.

**Port 4000 or 5173 already in use**
Change `API_PORT` in `.env`, or stop the process holding the port.

**Map tiles do not load**
The default provider fetches OpenStreetMap raster tiles and needs internet access. Set
`VITE_MAP_STYLE_URL` to a self-hosted style for a fully offline map.

**The simulator does not move the truck**
Check that `DEMO_MODE=true`, that the trip is in an active state, and that the API log shows
`GPS simulator engine started` at boot.
