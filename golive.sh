#!/usr/bin/env bash
# Usage: ./golive.sh <CA> <burnAmountHuman>     (or BURN_AMOUNT=<human> ./golive.sh <CA>)
# Reads decimals() (and symbol()) from the chain, writes web/token.json (burnAmount in RAW units),
# re-renders og, rsyncs web/token.json and web/dist. Restarts nothing: the server re-reads token.json every 30 s.
set -euo pipefail
cd "$(dirname "$0")"
HOST=$(tr -d '[:space:]' < .deploy-host 2>/dev/null || echo us1)
RPC=${RPC_URL:-https://robinhood-rpc.publicnode.com}
CA=${1:-}; HUMAN=${2:-${BURN_AMOUNT:-}}
[[ "$CA" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "usage: $0 <0x CA> <burn amount in whole tokens, e.g. 1000>"; exit 2; }
CA_LC=$(printf '%s' "$CA" | tr 'A-F' 'a-f')
if [ "$CA_LC" = "0x0000000000000000000000000000000000000000" ] || [ "$CA_LC" = "0x000000000000000000000000000000000000dead" ]; then echo "refusing a null/burn address"; exit 2; fi
[[ "$HUMAN" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "burn amount missing or not a number (whole tokens, e.g. 1000). It is a user decision; no default is assumed."; exit 2; }

export CA HUMAN RPC
node --input-type=module -e '
import { readFileSync, writeFileSync, renameSync } from "node:fs";
const { CA, HUMAN, RPC } = process.env;
async function ethCall(data) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CA, data }, "latest"] }) });
  const j = await r.json(); if (j.error || !j.result || j.result === "0x") throw new Error("eth_call failed: " + JSON.stringify(j.error || j.result));
  return j.result;
}
const chain = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).json();
if (BigInt(chain.result) !== 4663n) throw new Error("RPC is not chain 4663: " + chain.result);
const decimals = Number(BigInt(await ethCall("0x313ce567")));
if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("implausible decimals " + decimals);
let symbol = "";
try { const h = (await ethCall("0x95d89b41")).slice(2); const len = Number(BigInt("0x" + h.slice(64, 128))); symbol = Buffer.from(h.slice(128, 128 + len * 2), "hex").toString("utf8"); } catch { symbol = ""; }
console.error(`token at ${CA}: symbol="${symbol}" decimals=${decimals}`);
if (symbol.toUpperCase() !== "CFESS" && process.env.FORCE !== "1") throw new Error(`symbol is "${symbol}", not CFESS (typo in the CA?). Set FORCE=1 to override.`);
const [whole, frac = ""] = HUMAN.split(".");
if (frac.length > decimals) throw new Error("burn amount has more decimals than the token");
const raw = (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("burn amount must be > 0");
let t = {}; try { t = JSON.parse(readFileSync("web/token.json", "utf8")); } catch {}
const out = { ...t, symbol: "CFESS", ca: CA, launched: true, launchDate: t.launchDate || "2026-11-06",
  launchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), teamWallet: t.teamWallet || "0x1351AbcA903f9E28B59708Af47c0bF0521C47FD3",
  tokenAddress: CA, decimals, burnAmountHuman: HUMAN, burnAmount: raw, taxBps: t.taxBps ?? null };
writeFileSync("web/token.json.tmp", JSON.stringify(out, null, 2) + "\n"); renameSync("web/token.json.tmp", "web/token.json");
console.error(`web/token.json written: burnAmount ${raw} raw (${HUMAN} tokens)`);
'

# og + site
[ -f scripts/og.mjs ] && node scripts/og.mjs || echo "scripts/og.mjs not found: og not re-rendered"
[ -f scripts/build-web.mjs ] && node scripts/build-web.mjs || echo "scripts/build-web.mjs not found: dist not rebuilt"
mkdir -p web/dist && cp web/token.json web/dist/token.json

# push: token.json for the server first, then the site
rsync -a --no-owner --no-group web/token.json "$HOST:/opt/chainfess/web/token.json"
rsync -a --delete --no-owner --no-group --chmod=D755,F644 web/dist/ "$HOST:/opt/chainfess/web/dist/"

# wait for the server's 30 s re-read
for i in $(seq 1 18); do
  S=$(curl -s --max-time 10 https://chainfess.pro/api/sign/status || true)
  case "$S" in *'"enabled":true'*) echo "signing enabled: $S" | sed 's/"publicKey":"[^"]*"/"publicKey":"..."/'; exit 0;; esac
  sleep 5
done
echo "WARNING: /api/sign/status not enabled after 90 s"; exit 1
