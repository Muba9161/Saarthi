# Deploying Saarthi

Target: a single Contabo VPS (`31.220.93.223`) serving `vorldxsaarthi.com`.

## Shape

Everything is served from one origin, which is what the app is written for. With
`VITE_API_URL` blank the browser calls relative `/api` and `/ws` paths, so there
is no CORS preflight, no cross-site cookie, and the same build works from a
phone or any other host.

```
                    vorldxsaarthi.com
                           │
                    ┌──────▼──────┐
                    │    nginx    │  :80 → :443, Let's Encrypt
                    └──────┬──────┘
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   /  (SPA)           /api/v1/*          /ws, /ws/device
/var/www/saarthi/web       │                  │
                    ┌──────▼──────────────────▼──────┐
                    │  saarthi-api.service (systemd) │
                    │  node apps/api/dist/main.js    │
                    │  127.0.0.1:4000, user 'saarthi'│
                    └──────┬───────────┬─────────────┘
                           │           │
                  PostgreSQL 17    Redis 7      /var/lib/saarthi/storage
                   (loopback)      (loopback)   (documents + media)
```

The API deliberately does not serve the SPA — see the comment in
`apps/api/src/server/app.ts`. nginx is the static host.

## Files

| Path | Purpose |
|---|---|
| `provision.sh` | One-time server setup: packages, Node, Postgres, Redis, nginx, ufw, swap. Idempotent. |
| `deploy.sh` | Build and release. Idempotent. `--pull` fetches `origin/main` first. |
| `nginx/vorldxsaarthi.com.conf` | TLS termination, SPA, API proxy, WebSocket upgrade. |
| `systemd/saarthi-api.service` | Service unit with a hardened sandbox. |

## First deploy

```bash
# 1. Provision (once)
SAARTHI_DB_PASSWORD='...' bash /opt/saarthi/deploy/provision.sh

# 2. Put .env at /opt/saarthi/.env  (NODE_ENV=production, DEMO_MODE=false)

# 3. Certificate — needs DNS already pointing here
certbot certonly --webroot -w /var/www/certbot \
  -d vorldxsaarthi.com -d www.vorldxsaarthi.com \
  --agree-tos -m you@example.com --no-eff-email

# 4. Build and release
bash /opt/saarthi/deploy/deploy.sh
```

## Subsequent releases

```bash
bash /opt/saarthi/deploy/deploy.sh --pull
```

## Operating

```bash
systemctl status saarthi-api
journalctl -u saarthi-api -f
curl -s https://vorldxsaarthi.com/health | jq .
```

Readiness is `/health/ready` (checks the database); liveness is `/health/live`.

## Backups

The database is the only thing that cannot be rebuilt from the repository, along
with `/var/lib/saarthi/storage`. Both need a real backup before this carries
production data — `pg_dump` on a timer plus an off-box copy at minimum.

## Known gaps in this deployment

These are properties of the application, not of the server setup:

1. **No outbound email or SMS.** `NOTIFICATION_PROVIDER=production` has no
   implementation — only `LocalNotificationProvider` exists. In-app
   notifications work; email and SMS are written to an outbox instead of being
   sent. Password reset therefore cannot complete by email, and with
   `NODE_ENV=production` the reset token is no longer returned in the API
   response either. Until a mail provider is implemented, a forgotten password
   needs an operator with database access.
2. **No payment gateway.** `PAYMENT_PROVIDER=mock`; no gateway has been chosen.
3. **No video gateway.** `VIDEO_PROVIDER=none`, so live camera view is off and
   the UI says so. MediaMTX can be added later with the repo's `video` compose
   profile plus WHIP/WHEP proxying.
4. **Demo mode is off**, as production requires. The GPS simulator, mock
   devices and self-service verification approval are unavailable; tracking must
   come from real posts to `POST /api/v1/tracking/locations`.
