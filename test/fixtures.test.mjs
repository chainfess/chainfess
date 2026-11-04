// BRIEF §2.6 fixtures 1-18. Fixture 19 client-listing lives in test/server/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { audit, byStatus, BANNED } from './helpers.mjs';
import { auditReport, InputError } from '../src/audit.mjs';
import { FAKE_API, FAKE_KEY, blockAt, h, T_START, T_END, WALLET } from './fixtures/build.mjs';

const hasStatus = (r, hash, status) => {
  const t = r.txs.find((x) => x.hash === hash);
  assert.ok(t, `tx ${hash} listed`);
  assert.equal(t.status, status);
  return t;
};

test('fixture 1 read-not-send: cast tx of an old third-party tx is Observed, 0 findings', async () => {
  const { report, text } = await audit('read-not-send');
  hasStatus(report, h('old'), 'observed');
  assert.equal(report.summary.findings, 0);
  assert.equal(report.exitCode, 0);
  assert.equal(report.wallets[0].neverSent, true);
  assert.match(text, /never sent a transaction/);
});

test('fixture 2 foreign-send-window: unknown command, no key flag, is Recent other wallet, 0 findings', async () => {
  const { report } = await audit('foreign-send-window');
  hasStatus(report, h('pay'), 'recent-other');
  assert.equal(report.summary.findings, 0);
  assert.equal(report.exitCode, 0);
});

test('fixture 2 foreign-send-window: same command with --private-key is Foreign signer (script-with-key)', async () => {
  const { report } = await audit('foreign-send-window-key');
  const t = hasStatus(report, h('pay'), 'foreign-signer');
  assert.equal(t.pattern, 'script-with-key');
  assert.equal(report.summary.findings, 1);
  assert.equal(report.exitCode, 1);
});

test('fixture 3 foreign-send-pattern: cast send output, other from, in window is Foreign signer; the key never appears', async () => {
  const { report, text, json, replay } = await audit('foreign-send-pattern');
  const t = hasStatus(report, h('fs'), 'foreign-signer');
  assert.equal(t.pattern, 'cast-send');
  assert.ok(!text.includes(FAKE_KEY) && !json.includes(FAKE_KEY));
  assert.ok(!json.includes('--private-key') && !text.includes('--private-key'));
  assert.ok(!replay.log.bodies.join('').includes(FAKE_KEY), 'key not sent to the RPC');
  assert.ok(report.summary.localOnlyHashes >= 1);
});

test('fixture 4 forge-broadcast: hash only in run-latest.json is Accounted, source broadcast', async () => {
  const { report } = await audit('forge-broadcast');
  const t = hasStatus(report, h('fb'), 'accounted');
  assert.equal(t.source.kind, 'broadcast');
  assert.equal(report.logs.broadcast, 1);
  assert.equal(report.summary.findings, 0);
});

test('fixture 5 truncated-hash: 0x1234…abcd only is Partial, 0 findings', async () => {
  const { report } = await audit('truncated-hash');
  const t = report.txs[0];
  assert.equal(t.status, 'partial');
  assert.equal(t.finding, false);
  assert.equal(report.summary.findings, 0);
  assert.equal(t.mentioned, 'text');
});

test('fixture 6 not-a-tx: salts, block hashes, testnet hash are an Unresolved footer count only', async () => {
  const { report, text } = await audit('not-a-tx');
  assert.equal(report.summary.unresolvedHashes, 1); // labelled transactionHash: looked up, not a tx
  assert.equal(report.summary.localOnlyHashes, 2); // salt and blockHash: not looked up
  assert.equal(report.txs.length, 0);
  assert.equal(report.summary.findings, 0);
  assert.match(text, /Looked up, not a tx: 1 hash in the log is not a transaction on chain 4663/);
  assert.match(text, /Not looked up, stays local: 2 32-byte values/);
  assert.ok(!text.includes(h('salt')));
  assert.ok(!('unresolved' in report.summary));
});

test('fixture 7 pre-session: hash of a tx mined 2 h before the session is Pre-session', async () => {
  const { report } = await audit('pre-session');
  hasStatus(report, h('pre'), 'pre-session');
  assert.equal(report.summary.findings, 0);
  assert.equal(report.scan.plannedBlocks, 0);
});

test('fixture 8 pending: blockNumber null is Pending', async () => {
  const { report, text } = await audit('pending');
  hasStatus(report, h('pend'), 'pending');
  assert.equal(report.summary.findings, 0);
  assert.match(text, /re-run after inclusion/);
});

test('fixture 9 reverted: receipt status 0 is Accounted + reverted', async () => {
  const { report, text } = await audit('reverted');
  const t = hasStatus(report, h('rev'), 'accounted');
  assert.equal(t.reverted, true);
  assert.match(text, /reverted/);
});

test('fixture 10 ghost-gap: nonce 5 on chain, not in log is one Unaccounted; only block(4)..block(6) scanned', async () => {
  const { report, replay, world } = await audit('ghost-gap');
  assert.equal(report.summary.unaccounted, 1);
  assert.equal(report.summary.findings, 1);
  const t = hasStatus(report, h('gg5'), 'unaccounted');
  assert.equal(t.nonce, 5);
  const b4 = world.txs.find((x) => x.nonce === 4).block;
  const b6 = world.txs.find((x) => x.nonce === 6).block;
  assert.deepEqual(report.scan.gaps, [{ from: b4, to: b6 }]);
  assert.ok(replay.log.blocksFull.length > 0);
  for (const b of replay.log.blocksFull) assert.ok(b >= b4 && b <= b6, `the mock saw no other range: ${b}`);
  assert.equal(report.exitCode, 1);
});

test('fixture 11 ghost-tail: nonce N-1 mined after the session is Post-session, 0 findings', async () => {
  const { report, text, world } = await audit('ghost-tail');
  assert.equal(report.summary.findings, 0);
  assert.equal(report.summary.postSession, 1);
  assert.equal(report.wallets[0].uAfter, 1);
  assert.match(text, /1 after it/);
  const late = world.txs.find((x) => x.nonce === 2);
  assert.ok(!report.txs.some((t) => t.status === 'unaccounted'));
  assert.ok(late.block > report.session.endBlock);
});

test('fixture 12 contiguous-no-scan: log holds every nonce, 0 blocks scanned, 0 findings', async () => {
  const { report, replay } = await audit('contiguous-no-scan');
  assert.equal(report.scan.scannedBlocks, 0);
  assert.equal(report.scan.plannedBlocks, 0);
  assert.equal(replay.log.blocksFull.length, 0);
  assert.equal(report.summary.accounted, 3);
  assert.equal(report.summary.findings, 0);
});

test('fixture 13 subagent: hash only in subagents/agent-x.jsonl is Accounted, source subagent; --no-subagents disables', async () => {
  const { report } = await audit('subagent');
  const t = hasStatus(report, h('sub'), 'accounted');
  assert.equal(t.source.kind, 'subagent');
  assert.equal(report.logs.subagents, 1);
  const off = await audit('subagent', { noSubagents: true });
  hasStatus(off.report, h('sub'), 'unaccounted');
});

test('fixture 14 concurrent-session: without it Unaccounted + footer; with --all-sessions Accounted', async () => {
  const one = await audit('concurrent-session', { log: 'project/main.jsonl' });
  hasStatus(one.report, h('conc'), 'unaccounted');
  assert.equal(one.report.logs.otherOverlapping, 1);
  assert.match(one.text, /1 other session log overlaps this range \(other\.jsonl\)/);
  assert.match(one.text, /--all-sessions/);
  assert.match(one.text, /not in this log/);
  const all = await audit('concurrent-session', { log: 'project/main.jsonl', allSessions: true });
  hasStatus(all.report, h('conc'), 'accounted');
  assert.equal(all.report.summary.findings, 0);
  assert.equal(all.report.logs.otherOverlapping, 0);
  assert.equal(all.report.session.tStart, one.report.session.tStart);
});

test('fixture 15 empty-log: exit 2 with the --from/--to line', async () => {
  await assert.rejects(() => audit('empty-log'), (e) => {
    assert.ok(e instanceof InputError);
    assert.match(e.message, /log has no timestamped entries; pass --from\/--to or --from-block\/--to-block/);
    return true;
  });
  const ok = await audit('empty-log', { fromBlock: 99999000, toBlock: 99999010 });
  assert.equal(ok.report.exitCode, 0);
});

test('fixture 15 corrupt-log: bad lines counted, valid entries proceed; 0 valid is exit 2', async () => {
  const { report, text } = await audit('corrupt-log');
  assert.equal(report.logs.unreadableLines, 3);
  assert.match(text, /3 unreadable lines/);
  hasStatus(report, h('corruptline'), 'accounted'); // a hash in a broken line is still in the log
  await assert.rejects(() => audit('corrupt-log-all'), InputError);
});

test('fixture 15 huge-log: 50 MB generated at test time, streaming, RSS <= 300 MB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainfess-huge-'));
  const log = join(dir, 'huge.jsonl');
  const filler = 'x'.repeat(2000);
  const line = (i) => JSON.stringify({ type: 'user', timestamp: T_START, sessionId: 's', uuid: `u${i}`, message: { role: 'user', content: `${filler} 0x${String(i).padStart(64, '0').slice(0, 40)}` } }) + '\n';
  let written = 0;
  let i = 0;
  const parts = [];
  writeFileSync(log, '');
  while (written < 50 * 1024 * 1024) {
    const l = line(i++);
    parts.push(l);
    written += l.length;
    if (parts.length >= 2000) { appendFileSync(log, parts.join('')); parts.length = 0; }
  }
  parts.push(JSON.stringify({ type: 'assistant', timestamp: T_END, sessionId: 's', uuid: 'end', message: { role: 'assistant', content: [{ type: 'text', text: `done ${h('huge')}` }] } }) + '\n');
  appendFileSync(log, parts.join(''));
  const child = fileURLToPath(new URL('./huge-child.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [child, log, h('huge'), WALLET, String(blockAt(T_START) + 10)], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.accounted, 1);
  assert.ok(out.peakRssMb <= 300, `RSS ${out.peakRssMb} MB`);
});

test('fixture 16 secret-in-log: fake key and ANTHROPIC_API_KEY never in text or JSON, nor sent to the RPC', async () => {
  const { report, text, json, replay } = await audit('secret-in-log');
  for (const s of [FAKE_KEY, FAKE_KEY.slice(2), FAKE_API, 'ANTHROPIC_API_KEY', 'banana', 'cast send --private-key', '--private-key']) {
    assert.ok(!text.includes(s), `text has ${s}`);
    assert.ok(!json.includes(s), `json has ${s}`);
  }
  const sent = replay.log.bodies.join('');
  assert.ok(!sent.includes(FAKE_KEY.slice(2)), 'key not sent to the RPC');
  assert.ok(!sent.includes(FAKE_API));
  hasStatus(report, h('sec'), 'accounted');
});

test('fixture 17 final-text: final / text / none flags; all still Accounted; a subagent final does not count', async () => {
  const { report, text } = await audit('final-text');
  assert.equal(hasStatus(report, h('f0'), 'accounted').mentioned, 'final');
  assert.equal(hasStatus(report, h('f1'), 'accounted').mentioned, 'text');
  assert.equal(hasStatus(report, h('f2'), 'accounted').mentioned, 'text'); // sidechain text is text, never final
  assert.deepEqual(report.summary.mentioned, { final: 1, text: 2, none: 0 });
  assert.equal(report.summary.findings, 0);
  assert.match(text, /the agent's own words mention 3 of 3 transactions/);
});

test('fixture 17 final-text: hash in no text block has flag none', async () => {
  const { report } = await audit('reverted');
  assert.equal(report.txs[0].mentioned, 'none');
});

test('fixture 18 block-dump: 60 third-party hashes inside the window are Recent other wallet, 0 findings', async () => {
  const { report, text } = await audit('block-dump');
  assert.equal(report.summary.recentOther, 60);
  assert.equal(report.summary.findings, 0);
  assert.equal(report.exitCode, 0);
  assert.match(text, /cannot tell a read from a send: 60/);
});

test('fixture 18 block-dump: a dump chained after our own cast send stays 0 findings', async () => {
  const { report } = await audit('block-dump-after-send');
  hasStatus(report, h('stranger'), 'recent-other');
  hasStatus(report, h('own'), 'accounted');
  assert.equal(report.summary.findings, 0);
  const three = await audit('dump-three-senders');
  assert.equal(three.report.summary.recentOther, 3);
  assert.equal(three.report.summary.findings, 0);
});

test('wording: the banned words never appear in any fixture output', async () => {
  for (const name of ['read-not-send', 'foreign-send-window-key', 'ghost-gap', 'corrupt-log', 'block-dump', 'persisted-missing']) {
    const { text, json } = await audit(name);
    assert.ok(!BANNED.test(text), `${name} text`);
    assert.ok(!BANNED.test(json.replace(/0x[0-9a-fA-F]+/g, '')), `${name} json`);
  }
});

test('unresolved stays a count: no row, no finding, not in txs', async () => {
  const { report } = await audit('not-a-tx');
  assert.ok(report.txs.every((t) => t.status !== 'unresolved'));
});
