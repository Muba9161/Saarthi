#!/usr/bin/env bash
#
# One-time server provisioning for Saarthi on a fresh Ubuntu VPS.
# Idempotent: safe to re-run.
#
#   SAARTHI_DB_PASSWORD='...' bash provision.sh
#
set -euo pipefail

DOMAIN="${SAARTHI_DOMAIN:-vorldxsaarthi.com}"
APP_USER="saarthi"
APP_DIR="/opt/saarthi"
DATA_DIR="/var/lib/saarthi"
WEB_ROOT="/var/www/saarthi/web"
NODE_MAJOR="22"
PG_VERSION="17"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
: "${SAARTHI_DB_PASSWORD:?SAARTHI_DB_PASSWORD must be set}"

log "System identity"
. /etc/os-release && echo "$PRETTY_NAME  |  $(nproc) vCPU  |  $(free -h | awk '/^Mem:/{print $2}') RAM"

log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg git build-essential \
  nginx redis-server rsync \
  certbot python3-certbot-nginx ufw unzip jq

log "PostgreSQL ${PG_VERSION} (PGDG)"
# Ubuntu 24.04 ships PostgreSQL 16; the repo's docker-compose pins 17, so the
# server is built on the same major version the schema was developed against.
if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
fi
apt-get install -y -qq "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"
psql --version

log "Swap (Vite's production build is memory-hungry)"
# Under ~6 GB of RAM the web build can be OOM-killed mid-bundle. A swap file is
# cheap insurance on a 300 GB disk and costs nothing when it goes unused.
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "4G swapfile created"
else
  echo "swapfile already present"
fi

log "Node.js ${NODE_MAJOR}.x"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
echo "node $(node -v)  npm $(npm -v)"

log "Application user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR/storage/documents" "$WEB_ROOT" /var/www/certbot
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
chown -R www-data:www-data /var/www/saarthi /var/www/certbot

log "PostgreSQL"
systemctl enable --now postgresql
# Role and database, both created only if absent so re-runs never clobber data.
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='saarthi'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE ROLE saarthi LOGIN PASSWORD '${SAARTHI_DB_PASSWORD}'"
sudo -u postgres psql -qc "ALTER ROLE saarthi PASSWORD '${SAARTHI_DB_PASSWORD}'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='saarthi'" | grep -q 1 \
  || sudo -u postgres createdb -O saarthi saarthi
# Prisma migrations create extensions and types, so the role owns its schema.
sudo -u postgres psql -q -d saarthi -c "GRANT ALL ON SCHEMA public TO saarthi; ALTER SCHEMA public OWNER TO saarthi;"
echo "database 'saarthi' ready, owned by role 'saarthi'"

log "Redis"
# Loopback only, with an append-only file so cached state and rate-limit
# counters survive a restart.
sed -i 's/^# *appendonly .*/appendonly yes/; s/^appendonly no/appendonly yes/' /etc/redis/redis.conf
grep -q '^bind 127.0.0.1' /etc/redis/redis.conf || sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl restart redis-server
redis-cli ping

log "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status numbered

log "Nginx"
systemctl enable --now nginx
rm -f /etc/nginx/sites-enabled/default
echo "nginx running; site config is installed by deploy.sh"

log "Provisioning complete for ${DOMAIN}"
