#!/usr/bin/env bash
#
# Build and release Saarthi. Idempotent; safe to re-run.
#
#   bash deploy.sh            build what is already in /opt/saarthi and release
#   bash deploy.sh --pull     fetch origin/main first, then build and release
#
# The source tree is expected at /opt/saarthi with a populated .env beside the
# root package.json — config/env.ts walks up to the workspace package.json to
# find it, so the API and Vite read the same file.
set -euo pipefail

APP_DIR="/opt/saarthi"
WEB_ROOT="/var/www/saarthi/web"
DOMAIN="${SAARTHI_DOMAIN:-vorldxsaarthi.com}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!!  %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root."
cd "$APP_DIR" || fail "$APP_DIR does not exist — run provision.sh first."
[[ -f .env ]] || fail "$APP_DIR/.env is missing. Copy it across before deploying."

if [[ "${1:-}" == "--pull" ]]; then
  log "Fetching origin/main"
  git fetch --prune origin
  git reset --hard origin/main
fi
echo "HEAD: $(git log --oneline -1 2>/dev/null || echo 'not a git checkout')"

log "Installing dependencies"
# `npm ci` from the committed lockfile, across all workspaces. Left root-owned
# on purpose: the service runs as 'saarthi' and only needs to read them, so a
# compromised process cannot rewrite its own dependency tree.
npm ci --no-audit --fund=false

log "Generating the Prisma client"
npm run db:generate

log "Building shared -> api -> web"
# Vite's bundle is the memory-hungry step; the swapfile from provision.sh is
# what keeps this from being OOM-killed on a smaller instance.
NODE_OPTIONS="--max-old-space-size=3072" npm run build

[[ -f apps/api/dist/main.js ]]   || fail "API build produced no dist/main.js"
[[ -f apps/web/dist/index.html ]] || fail "Web build produced no dist/index.html"

log "Applying database migrations"
# 'migrate deploy' only ever applies committed migrations — it never generates
# one and never resets, which is why it and not 'migrate dev' belongs here.
npm run db:deploy

log "Seeding reference data (idempotent — roles, plans, entitlements)"
npm run db:seed

# Compress once here rather than on every request. nginx's gzip defaults to
# level 1, which costs roughly 15% more bytes than level 9 on this bundle and
# spends CPU re-deriving the same answer for every visitor. `gzip_static on`
# serves these files directly when the browser accepts gzip, and falls back to
# on-the-fly compression for anything without a .gz beside it.
log "Pre-compressing static assets"
find apps/web/dist -type f \
  \( -name "*.js" -o -name "*.css" -o -name "*.svg" \
     -o -name "*.json" -o -name "*.html" -o -name "*.webmanifest" \) \
  -size +1k -exec gzip -9 -k -f {} +

log "Publishing the SPA to ${WEB_ROOT}"
mkdir -p "$WEB_ROOT"
# --delete removes asset hashes from previous builds. index.html is written
# last by rsync's default ordering, but the immutable /assets cache header means
# a stale index would pin browsers to files that no longer exist — so the whole
# tree is replaced in one pass.
rsync -a --delete apps/web/dist/ "$WEB_ROOT/"
chown -R www-data:www-data /var/www/saarthi

log "Installing nginx site and systemd unit"
# The TLS config references certificates by path, so nginx refuses to load it
# before they exist. Until certbot has issued them, the HTTP-only bootstrap
# config is installed instead - it serves the app and, critically, keeps the
# ACME challenge path reachable so the certificate can be issued at all.
# Snippets first — both site configs include them, so nginx -t fails if they
# are not on disk before the site is enabled.
mkdir -p /etc/nginx/snippets
install -m 644 "$REPO_DIR/deploy/nginx/security-headers.conf" /etc/nginx/snippets/saarthi-security-headers.conf
[[ -f "$REPO_DIR/deploy/nginx/ssl-params.conf" ]] \
  && install -m 644 "$REPO_DIR/deploy/nginx/ssl-params.conf" /etc/nginx/snippets/saarthi-ssl.conf

if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "certificate present - installing the TLS site"
  SITE_SRC="$REPO_DIR/deploy/nginx/${DOMAIN}.conf"
else
  echo "no certificate yet - installing the HTTP-only bootstrap site"
  SITE_SRC="$REPO_DIR/deploy/nginx/bootstrap.conf"
fi
install -m 644 "$SITE_SRC" "/etc/nginx/sites-available/${DOMAIN}.conf"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
install -m 644 "$REPO_DIR/deploy/systemd/saarthi-api.service" /etc/systemd/system/saarthi-api.service
systemctl daemon-reload

# The .env holds every secret the app has. Root writes it, the service reads it.
chown root:saarthi "$APP_DIR/.env"
chmod 640 "$APP_DIR/.env"

log "Restarting the API"
systemctl enable saarthi-api >/dev/null
systemctl restart saarthi-api

log "Waiting for readiness"
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:4000/health/ready >/dev/null 2>&1; then
    echo "API ready after ${i}s"
    break
  fi
  [[ $i -eq 30 ]] && { journalctl -u saarthi-api -n 40 --no-pager; fail "API did not become ready"; }
  sleep 1
done

log "Reloading nginx"
nginx -t
systemctl reload nginx

log "Deployed"
curl -fsS http://127.0.0.1:4000/health | jq . 2>/dev/null || curl -fsS http://127.0.0.1:4000/health
