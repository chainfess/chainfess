#!/usr/bin/env bash
# Runs ON us1 as root (called by deploy.sh). Idempotent. Touches only chainfess files, units and nginx files.
set -euo pipefail
APP=/opt/chainfess
DOMAIN=chainfess.pro
IP=31.220.21.118
NO_CERT=0; [ "${1:-}" = "--no-cert" ] && NO_CERT=1

id chainfess >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin chainfess
mkdir -p "$APP/state" "$APP/state-staging" "$APP/web/dist"
chown chainfess:chainfess "$APP/state" "$APP/state-staging"; chmod 700 "$APP/state" "$APP/state-staging"
for d in state state-staging; do
  [ -f "$APP/$d/signing.key" ] || { echo "FATAL: $APP/$d/signing.key missing (keys are generated once on this box; deploy never creates or overwrites them)"; exit 1; }
  chmod 600 "$APP/$d/signing.key"; chown chainfess:chainfess "$APP/$d/signing.key"
done
# staging token.json: created once, never overwritten (the staging token address is set by deploy/staging-token.sh)
if [ ! -f "$APP/state-staging/token.json" ]; then
  printf '{ "symbol": "CFESS", "ca": "", "launched": false, "launchDate": "2026-11-06", "burnAmount": "0", "tokenAddress": "" }\n' > "$APP/state-staging/token.json"
fi
chown chainfess:chainfess "$APP/state-staging/token.json"
# production token.json must exist for the server (rsynced from web/token.json)
[ -f "$APP/web/token.json" ] || { echo "FATAL: $APP/web/token.json missing"; exit 1; }

# placeholder page only when no page exists yet
if [ ! -f "$APP/web/dist/index.html" ]; then
  printf '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Chainfess</title><p>chainfess.pro</p>\n' > "$APP/web/dist/index.html"
fi
if [ ! -f "$APP/web/dist/404.html" ]; then
  printf '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not on the chart.</p>\n' > "$APP/web/dist/404.html"
fi
chown -R root:root "$APP/web" "$APP/server" "$APP/src" "$APP/deploy" 2>/dev/null || true
chmod -R u=rwX,go=rX "$APP/web" "$APP/server" "$APP/src" "$APP/deploy" 2>/dev/null || true

# systemd units (only ours)
for u in chainfess chainfess-staging; do
  if ! cmp -s "$APP/deploy/$u.service" "/etc/systemd/system/$u.service" 2>/dev/null; then cp "$APP/deploy/$u.service" "/etc/systemd/system/$u.service"; RELOAD=1; fi
done
[ "${RELOAD:-0}" = 1 ] && systemctl daemon-reload
# ports: refuse if something that is not ours holds them
for p in 4905 4906; do
  owner=$(ss -ltnp "sport = :$p" | awk 'NR>1{print $6}')
  if [ -n "$owner" ] && ! systemctl is-active --quiet "$([ $p = 4905 ] && echo chainfess || echo chainfess-staging)"; then
    echo "FATAL: port $p is held by $owner and it is not our unit"; exit 1
  fi
done
systemctl enable chainfess chainfess-staging >/dev/null 2>&1
systemctl restart chainfess chainfess-staging

# nginx support files
install -m 644 "$APP/deploy/nginx-zones.conf" /etc/nginx/conf.d/chainfess-zones.conf
install -m 644 "$APP/deploy/nginx-headers.conf" /etc/nginx/snippets/chainfess-headers.conf

CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
SITE=/etc/nginx/sites-available/chainfess
install_site() { # $1 = source conf ; rolls back on a failed nginx -t
  local prev=""; [ -f "$SITE" ] && { prev=$(mktemp); cp "$SITE" "$prev"; }
  cp "$1" "$SITE"; ln -sf "$SITE" /etc/nginx/sites-enabled/chainfess
  if ! nginx -t 2>/tmp/cf-nginx-t.txt; then
    cat /tmp/cf-nginx-t.txt
    if [ -n "$prev" ]; then cp "$prev" "$SITE"; else rm -f /etc/nginx/sites-enabled/chainfess "$SITE"; fi
    echo "FATAL: nginx -t failed, change rolled back"; exit 1
  fi
  systemctl reload nginx
}
if [ ! -f "$CERT" ]; then
  [ "$NO_CERT" = 1 ] && { echo "no certificate and --no-cert given: stopping before certbot"; exit 0; }
  A=$(dig +short "$DOMAIN" | tr '\n' ' '); B=$(dig +short "www.$DOMAIN" | tr '\n' ' ')
  if [ "$A" != "$IP " ] || [ "$B" != "$IP " ]; then echo "FATAL: DNS not ready: $DOMAIN=[$A] www=[$B], expected $IP"; exit 1; fi
  install_site "$APP/deploy/nginx-chainfess-http.conf"
  # A box with several ACME accounts needs one named: set CERTBOT_ACCOUNT or put the id in /etc/chainfess/certbot-account.
  ACCOUNT="${CERTBOT_ACCOUNT:-}"
  [ -z "$ACCOUNT" ] && [ -r /etc/chainfess/certbot-account ] && ACCOUNT=$(tr -d '[:space:]' < /etc/chainfess/certbot-account)
  certbot certonly ${ACCOUNT:+--account "$ACCOUNT"} --webroot -w /var/www/html -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --keep-until-expiring
fi
install_site "$APP/deploy/nginx-chainfess.conf"
echo "installed"
