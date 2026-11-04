#!/usr/bin/env bash
# Usage: deploy/staging-token.sh <tokenAddress> <burnAmountRawUnits>
# Turns staging to launched:true with a test ERC-20. Staging only; production token.json is untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=$(tr -d '[:space:]' < .deploy-host 2>/dev/null || echo us1)
TOKEN=${1:-}; RAW=${2:-}
[[ "$TOKEN" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "usage: $0 <0x tokenAddress> <burnAmount raw units>"; exit 2; }
[[ "$RAW" =~ ^[1-9][0-9]*$ ]] || { echo "burnAmount must be a positive integer in raw units"; exit 2; }
ssh "$HOST" "cat > /opt/chainfess/state-staging/token.json" <<JSON
{ "symbol": "CFESS", "ca": "$TOKEN", "launched": true, "launchDate": "2026-11-06", "launchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "burnAmount": "$RAW", "tokenAddress": "$TOKEN", "testToken": true }
JSON
ssh "$HOST" 'chown chainfess:chainfess /opt/chainfess/state-staging/token.json; chmod 640 /opt/chainfess/state-staging/token.json'
echo "staging token.json written; the staging server re-reads it within 30 s"
