# Production migration

Saarthi is built so that going to production replaces **infrastructure**, not business logic. This
document lists exactly what changes.

## Replacement matrix

| Local (today) | Production | How to switch |
|---|---|---|
| Local PostgreSQL | Managed PostgreSQL | `DATABASE_URL` |
| Local filesystem storage | Object storage | `STORAGE_PROVIDER=object` + implement `ObjectStorageProvider` against the existing `StorageProvider` interface |
| Mock GPS simulator | GPS hardware / provider webhook | Post to `POST /api/v1/tracking/locations` with `source: DEVICE`. Nothing downstream changes. |
| In-process pub/sub | Redis pub/sub | `PUBSUB_DRIVER=redis` + implement the adapter behind `PubSubDriver` |
| In-process cache | Redis | `CACHE_DRIVER=redis` behind `CacheDriver` |
| In-process job scheduler | BullMQ | `QUEUE_DRIVER=redis` behind `QueueDriver`; job handlers are unchanged |
| Local notification outbox | Email / SMS / push providers | `NOTIFICATION_PROVIDER=production` behind `NotificationProvider` |
| Mock payments | Payment gateway | `PAYMENT_PROVIDER=production` behind `PaymentProvider` |
| Local AI analyst | Hosted model | `AI_PROVIDER=anthropic` + `AI_API_KEY` — the adapter already exists |
| OSM raster tiles | Vector map provider | `VITE_MAP_STYLE_URL` + `VITE_MAP_API_KEY`; unlocks true 3D |

Each interface lives beside its local implementation, so a production provider is a new class in the
same folder — no service, route or component changes.

## Pre-flight checklist

### Configuration
- [ ] `NODE_ENV=production`
- [ ] `DEMO_MODE=false` — the API **refuses to boot** otherwise, so simulator endpoints cannot leak
- [ ] Fresh 48-byte secrets for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`
- [ ] `COOKIE_SECURE=true` and `COOKIE_DOMAIN` set
- [ ] `CORS_ORIGINS` limited to the real frontend origin
- [ ] `BCRYPT_ROUNDS` ≥ 12

### Database
- [ ] `npm run db:deploy` (never `migrate dev`)
- [ ] `npm run db:seed` — reference data only, and idempotent
- [ ] Automated backups configured and a restore rehearsed
- [ ] Review indexes on `truck_locations` for your write volume; consider partitioning by month

### Security
- [ ] `npm audit` clean
- [ ] Secret scan over the repository history
- [ ] Re-run the tenant-isolation tests against staging
- [ ] Rate limits reviewed for real traffic (tracking ingest is intentionally high)
- [ ] HTTPS terminated, HSTS on
- [ ] Confirm document downloads stay `private, no-store`

### Data protection
- [ ] Retention policies agreed for tracking history, audit logs, documents and AI conversations
- [ ] Confirm the minimum identity data actually needed is stored — the document catalogue is
      configurable, so remove types you do not require
- [ ] Any production KYC integration reviewed against Indian privacy and data-protection law before
      it is enabled

### Observability
- [ ] Ship structured logs (already redacted for passwords, tokens and secrets)
- [ ] Error tracking wired
- [ ] Probes pointed at `/health/live` and `/health/ready`
- [ ] Alert on tracking-ingest failures, queue backlog and AI spend

### Smoke test
Register → verify → add truck → add driver → upload documents → create order → accept quote →
start trip → live tracking → complete delivery → check analytics → confirm plan gating.

## Things deliberately left for production

These are **not** oversights — they need real infrastructure or a commercial decision:

1. Redis adapters for cache, queue and pub/sub (interfaces done, implementations throw loudly).
2. Object storage provider.
3. Payment checkout flow (`PaymentProvider` interface defined, no gateway chosen).
4. Real GPS device/provider ingestion (endpoint and contract already final).
5. Email/SMS/push delivery (local provider writes to a visible outbox instead).
