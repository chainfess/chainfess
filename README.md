# chainfess

Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.

Try it in 10 seconds, no wallet, no network:

```
npx chainfess demo
```

Audit a past session:

```
npx chainfess audit --wallet 0x…
```

Default log = latest Claude Code session for the current directory.

## What it does

The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.

Four outcomes, deterministic, no LLM: Accounted · Partial · **Unaccounted** · **Foreign signer**.

| Status | Rule | Label |
|---|---|---|
| Accounted | A tx of your wallet, in the session's blocks, whose full hash is in the log, a subagent transcript, a saved tool output or a broadcast file | accounted (source and line) |
| Partial | Same, but the log only has a shortened form with the same prefix and suffix | partial match only |
| **Unaccounted** | A tx of your wallet, in the session's blocks, with no full or partial match | **not in this log** |
| **Foreign signer** | A tx from a wallet you did not pass, whose hash first came out of a recognised sending command, mined during that call | **signed by a wallet not registered here** |

Not findings, shown for information: sent before the session, sent after it, pending, another wallet's tx mined during a tool call (cannot tell a read from a send), another wallet's tx referenced (read). Hex strings that are not transactions on this chain are one count in the footer.

Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.

Exit codes: 0 no findings, 1 findings, 2 input error, 3 RPC unavailable, 4 partial scan (unscanned ranges remain).

## Privacy

`audit` and `demo` run on your machine. The log never leaves it; `audit`'s only network calls are JSON-RPC reads with block numbers, tx hashes and your wallet address. Only the optional `sign` contacts our server: it sends the wallets, block range, hashes and a hash of the log, never the log.

Every 32-byte hex value in the log is a possible tx hash, so it goes to the RPC as a lookup, unless it sits next to a key word (`PRIVATE_KEY=`, `--private-key`, `Private key:` and the like) or is the private key of a wallet you passed. Those stay on your machine. A private key of another wallet, printed with nothing around it, cannot be told apart from a hash. Use `--rpc` with an endpoint you trust if your logs may hold such a thing.

Reports show hashes, addresses, values, tool name and a line reference. Never command text, never secrets.

## Verify

Verify the rules yourself: `cast tx <hash>` and `cast nonce <wallet>` reproduce every number. The report footer prints both lines.

## Scope

Works with Claude Code session logs (`.jsonl`), including subagent transcripts and Foundry `broadcast/` files. EOA wallets only. Robinhood Chain by default; any EVM RPC with `--rpc` (then limits apply, unmeasured).

## Limits

Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.

A script that signs with another wallet without a recognised key flag or command pattern shows only as "other wallet's tx mined during this tool call", not as a finding. So does a sending command that also printed a tx of your own wallet, or txs of more than two other wallets, because that output is a dump, not a send.

No balance deltas: the free RPC refuses historical balances. A planned scan over 210,000 blocks (about 6 h of chain, about 58 minutes to scan at the public RPC's measured 60 blocks/s) is refused unless you pass `--max-hours` or a block range. Over 512 MB, a saved tool output is not read; the footer says so, because "not in this log" lines may then be explained by that output.

## Signed report

Burn `BURN_AMOUNT $CFESS` from the audited wallet, run `npx chainfess sign --burn-tx 0x…`, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours. `npx chainfess verify <statement.json>` checks it offline.

$CFESS launches 6 Nov 2026 (UTC date). No CA exists yet; any $CFESS you see before it is posted on chainfess.pro and on @chainfesspro is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.

## Options

```
chainfess audit --wallet 0x… [--log f]… [--all-sessions] [--rpc url] [--chain-id n]
  [--from ISO] [--to ISO] [--from-block n] [--to-block n] [--max-hours h]
  [--yes] [--json] [--no-subagents] [--quiet] [--debug]
```

MIT.
