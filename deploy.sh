#!/usr/bin/env bash
# Idempotent deploy to us1. Usage: ./deploy.sh [--no-web] [--no-cert]
#   --no-web  deploy server + nginx only; never touches /opt/chainfess/web/dist (a one-line placeholder is created if none exists)
# Never overwrites server-side signing keys, DBs, or the staging token.json (state/ and state-staging/ are excluded).
set -euo pipefail
cd "$(dirname "$0")"
HOST=$(tr -d '[:space:]' < .deploy-host 2>/dev/null || echo us1); HOST=${HOST:-us1}
NO_WEB=0; NO_CERT=""
for a in "$@"; do case "$a" in --no-web) NO_WEB=1;; --no-cert) NO_CERT="--no-cert";; *) echo "unknown flag $a"; exit 2;; esac; done

# 1. token.json guard: launched:true needs every field filled
if [ -f web/token.json ]; then
  node -e '
    const t = JSON.parse(require("fs").readFileSync("web/token.json","utf8"));
    if (t.launched === true) {
      const need = ["symbol","ca","tokenAddress","burnAmount","launchDate","launchedAt","teamWallet"];
      const empty = need.filter(k => t[k] === undefined || t[k] === null || String(t[k]).trim() === "" || /^0x0{40}$/.test(String(t[k])));
      if (empty.length || !/^[1-9][0-9]*$/.test(String(t.burnAmount))) { console.error("REFUSED: token.json has launched:true but empty/invalid fields: " + (empty.join(", ") || "burnAmount")); process.exit(1); }
    }'
else
  echo "web/token.json missing: a pre-launch default will be used"
fi

# 2. build the site unless --no-web
if [ $NO_WEB = 0 ]; then
  if [ -f scripts/build-web.mjs ]; then node scripts/build-web.mjs; else echo "scripts/build-web.mjs not found: web/dist not built"; fi
fi

# 3. rsync project (CONTRACTS excludes) ; state dirs and dist are protected
DEFAULT_TOKEN=""
if [ ! -f web/token.json ]; then
  DEFAULT_TOKEN=$(mktemp -d); printf '{ "symbol": "CFESS", "ca": "0x0000000000000000000000000000000000000000", "launched": false,\n  "launchDate": "2026-11-06", "teamWallet": "0x1351AbcA903f9E28B59708Af47c0bF0521C47FD3",\n  "burnAmount": "0", "tokenAddress": "", "taxBps": null }\n' > "$DEFAULT_TOKEN/token.json"
fi
EXCLUDES=(--exclude 'wallet*' --exclude 'WALLETS*' --exclude '.env*' --exclude '.npmrc' --exclude '.git' --exclude 'BRIEF*' --exclude 'STATUS*' --exclude 'RISET*' --exclude 'CONTRACTS.md' --exclude 'SPIKE.md' --exclude 'MEDIA-STATUS*' --exclude 'marketing/'
          --exclude '/state' --exclude '/state-staging' --exclude '/web/dist' --exclude '/web/token.json' --exclude 'node_modules' --exclude '*.db*' --exclude '.DS_Store' --exclude '.deploy-host' --exclude '/test' --exclude '/web/node_modules')
ssh "$HOST" 'mkdir -p /opt/chainfess'
# whitelist of what the server box needs (CONTRACTS excludes kept as a second guard)
SRC=(); for p in server src bin deploy package.json; do [ -e "$p" ] && SRC+=("$p"); done
rsync -a --delete --no-owner --no-group "${EXCLUDES[@]}" "${SRC[@]}" "$HOST:/opt/chainfess/"
if [ -n "$DEFAULT_TOKEN" ]; then rsync -a --no-owner --no-group "$DEFAULT_TOKEN/token.json" "$HOST:/opt/chainfess/web/token.json"; rm -rf "$DEFAULT_TOKEN"
else rsync -a --no-owner --no-group web/token.json "$HOST:/opt/chainfess/web/token.json"; fi
if [ $NO_WEB = 0 ] && [ -d web/dist ]; then
  rsync -a --delete --no-owner --no-group --chmod=D755,F644 --exclude 'wallet*' --exclude 'WALLETS*' --exclude '.env*' web/dist/ "$HOST:/opt/chainfess/web/dist/"
  [ -f web/token.json ] && rsync -a --no-owner --no-group web/token.json "$HOST:/opt/chainfess/web/dist/token.json"
fi

# 4. install units + nginx, restart our two services, certbot if needed
ssh "$HOST" "bash /opt/chainfess/deploy/remote-install.sh $NO_CERT"

# 5. health
sleep 2
ssh "$HOST" 'curl -s --max-time 10 http://127.0.0.1:4905/api/health; echo; curl -s --max-time 10 http://127.0.0.1:4906/api/health; echo'
curl -s --max-time 20 https://chainfess.pro/api/health 2>/dev/null; echo
