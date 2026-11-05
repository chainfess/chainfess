# chainfess

Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.

Try it in 10 seconds, no wallet, no RPC calls:

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

`audit` and `demo` run on your machine. The log never leaves it; `audit`'s only network calls are JSON-RPC reads with block numbers, values the log labels as tx hashes, and your wallet address. Only the optional `sign` contacts our server: it sends the wallets, block range, hashes and a hash of the log, never the log.

A private key has the same shape as a tx hash, so a 32-byte hex value goes to the RPC only when its context says it is a tx hash: the value of a `transactionHash`, `txHash` or `hash` field or label, the bare output of a plain `cast send` or `forge` call, an explorer `/tx/` URL, or the argument of `cast tx`, `cast receipt`, `cast run` or `eth_getTransactionByHash`. A value with `key`, `secret`, `mnemonic`, `seed`, `password`, `token` or `private` on its line or in its JSON object, in a shell assignment, or that is the private key of a wallet you passed, never leaves your machine. Neither does anything else. Those local values are still matched against the wallet's txs found by the block scan, so your own tx stays Accounted; the scan may just be longer. The footer counts both: "looked up, not a tx" and "not looked up, stays local".

Reports show hashes, addresses, values, the command pattern name, the source kind and a line reference. Never command text, never secrets.

## Verify

Verify the rules yourself: `cast tx <hash>` reproduces each line. `cast nonce <wallet>` prints the live count, which only rises after the audit. The report footer prints both lines.

## Scope

Works with Claude Code session logs (`.jsonl`), including subagent transcripts and Foundry `broadcast/` files. EOA wallets only. Robinhood Chain by default; any EVM RPC with `--rpc` (then limits apply, unmeasured).

## Limits

Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.

A script that signs with another wallet without a recognised key flag or command pattern shows only as "other wallet's tx mined during this tool call", not as a finding. Another wallet's hash printed with no hash label stays local, so it is not listed at all. So does a sending command that also printed a tx of your own wallet, or txs of more than two other wallets, because that output is a dump, not a send.

No balance deltas: the free RPC refuses historical balances. A planned scan over 210,000 blocks (about 6 h of chain, about 58 minutes to scan at 60 blocks/s, measured on 5 Nov 2026 over 30,000 blocks on the public RPC) is refused unless you pass `--max-hours` or a block range. The plan is the worst case: a scan stops a gap once its nonces are found, and a hash with no label can make the plan larger. Over 512 MB, a saved tool output is not read; the footer says so, because "not in this log" lines may then be explained by that output.

## Signed report

burn 0.01% of supply in $CFESS (exact amount set from the contract at launch) from the audited wallet, run `npx chainfess sign --burn-tx 0x…`, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours. `npx chainfess verify <statement.json>` checks it offline.

$CFESS launches 6 Nov 2026 (UTC date). No CA exists yet; any $CFESS you see before it is posted on chainfess.pro and on @chainfesspro is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.

## Options

```
chainfess audit --wallet 0x… [--log f]… [--all-sessions] [--rpc url] [--chain-id n]
  [--from ISO] [--to ISO] [--from-block n] [--to-block n] [--max-hours h]
  [--yes] [--json] [--no-subagents] [--quiet] [--debug]
```

`--no-subagents` skips subagent transcripts only; the main session's saved tool outputs are still read.

MIT.
