# Changelog

## 0.1.1

- README and `--help` say "no RPC calls" for `demo` instead of "no network": `demo` calls no RPC, but `npx` downloads the package on first run.
- README says `cast tx` reproduces each line and `cast nonce` prints the live count, which only rises after the audit.
- `package.json` has a `repository` field.
- `--version`, the report's `toolVersion` and the hook's `npx` command name 0.1.1.

## 0.1.0

First release.

- `chainfess demo`: bundled fixture, recorded RPC replies, no wallet, no RPC calls.
- `chainfess audit`: Claude Code session logs (`.jsonl`), subagent transcripts, saved tool outputs and Foundry `broadcast/` files, compared with the wallet's nonce and blocks on Robinhood Chain.
- Four outcomes, deterministic, no LLM: Accounted, Partial, Unaccounted, Foreign signer.
- `chainfess sign` and `chainfess verify` for signed reports.
