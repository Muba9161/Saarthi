#!/usr/bin/env bash
#
# Issue the Let's Encrypt certificate and switch nginx from the HTTP-only
# bootstrap config to the TLS one. Idempotent; safe to re-run.
#
#   CERTBOT_EMAIL='you@example.com' bash tls.sh
#
# Run this only once DNS for the domain points at this server — the ACME HTTP-01
# challenge is answered by this machine, so an A record pointing anywhere else
# fails, and repeated failures count against Let's Encrypt's rate limits.
set -euo pipefail

DOMAIN="${SAARTHI_DOMAIN:-vorldxsaarthi.com}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!!  %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root."
# No apostrophe in this message: bash treats a single quote inside ${VAR:?word}
# as an opening quote even within double quotes, and the script fails to parse.
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL must be set - Lets Encrypt sends expiry warnings there}"

log "Checking DNS before asking Let's Encrypt for anything"
# The public IP as the internet sees it, not as the interface reports it: on a
# NATed host those differ, and it is the public one the ACME server connects to.
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org)"
echo "this server : $SERVER_IP"
for host in "$DOMAIN" "www.$DOMAIN"; do
  resolved="$(getent ahostsv4 "$host" | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//')"
  echo "$host -> ${resolved:-<unresolved>}"
  [[ "$resolved" == *"$SERVER_IP"* ]] \
    || fail "$host does not resolve to $SERVER_IP yet. Wait for DNS to propagate — issuing now would burn a rate-limit slot."
done

log "Confirming the ACME challenge path is reachable"
mkdir -p /var/www/certbot/.well-known/acme-challenge
token="preflight-$(date +%s)"
echo "$token" > "/var/www/certbot/.well-known/acme-challenge/$token"
got="$(curl -fsS --max-time 10 "http://${DOMAIN}/.well-known/acme-challenge/${token}" || true)"
rm -f "/var/www/certbot/.well-known/acme-challenge/$token"
[[ "$got" == "$token" ]] || fail "The challenge path is not served over HTTP. Check that nginx is up and the bootstrap site is enabled."
echo "challenge path OK"

log "Requesting the certificate"
certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --agree-tos -m "$CERTBOT_EMAIL" --no-eff-email \
  --keep-until-expiring --non-interactive

[[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] || fail "certbot reported success but no certificate is present"

log "Switching nginx to the TLS site"
# No external TLS config is fetched here. The snippet below states the policy,
# because certbot's options-ssl-nginx.conf ships with the nginx plugin and this
# deployment issues with `certonly --webroot`.
mkdir -p /etc/nginx/snippets
install -m 644 "$REPO_DIR/deploy/nginx/ssl-params.conf" /etc/nginx/snippets/saarthi-ssl.conf
install -m 644 "$REPO_DIR/deploy/nginx/security-headers.conf" /etc/nginx/snippets/saarthi-security-headers.conf

install -m 644 "$REPO_DIR/deploy/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}.conf"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx

log "Wiring renewal to reload nginx"
# certbot's systemd timer renews, but nginx keeps serving the old certificate
# until it is told to reload. This hook is what closes that gap.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot.timer 2>/dev/null || true
certbot renew --dry-run

log "TLS live"
# %{host} is not available in older curl builds, so the name is interpolated
# by the shell instead.
curl -fsS -o /dev/null -w "https://${DOMAIN} -> HTTP %{http_code}\n" "https://${DOMAIN}/health/live" || true
echo
openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
