// Real Claude Code log shapes from SPIKE.md, on top of the 19 fixtures.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { audit, byStatus, copyFixture } from './helpers.mjs';
import { auditReport, InputError, lookupCandidates } from '../src/audit.mjs';
import { createSink, findProjectDir, handleLine, newestLog, sendingPattern, slugOf } from '../src/parse.mjs';
import { createReplay } from '../src/replay.mjs';
import { h, OTHER, WALLET } from './fixtures/build.mjs';

const status = (r, hash) => (r.txs.find((t) => t.hash === hash) || {}).status;

test('real-log content-array: tool_result content as an array of blocks is searched', async () => {
  const { report } = await audit('content-array');
  assert.equal(status(report, h('arr')), 'accounted');
  assert.equal(report.txs[0].source.kind, 'tool_result');
});

test('real-log tool-use-result-carrier: top-level toolUseResult counts as tool_result', async () => {
  const { report } = await audit('tool-use-result-carrier');
  assert.equal(status(report, h('tur')), 'accounted');
  assert.equal(report.txs[0].source.kind, 'tool_result');
  assert.equal(report.txs[0].source.line, 3);
});

test('real-log persisted-marker: hash only in the file a <persisted-output> marker names; referencing line kept', async () => {
  const { report } = await audit('persisted-marker');
  const t = report.txs.find((x) => x.hash === h('pm'));
  assert.equal(t.status, 'accounted');
  assert.equal(t.source.kind, 'tool-results');
  assert.equal(t.source.line, 3);
  assert.equal(t.pattern, 'cast-send');
  assert.equal(report.logs.toolResults, 1);
  assert.equal(report.logs.missingToolResults, 0);
  assert.equal(report.logs.note, null);
});

test('real-log persisted-path: toolUseResult.persistedOutputPath outside the session dir is opened', async () => {
  const { report } = await audit('persisted-path');
  assert.equal(status(report, h('pp')), 'accounted');
});

test('real-log persisted-glob: tool-results/* text and JSON are searched, images skipped', async () => {
  const { report } = await audit('persisted-glob');
  assert.equal(status(report, h('pg')), 'accounted');
  assert.equal(report.txs[0].source.kind, 'tool-results');
  assert.equal(report.summary.unresolvedHashes, 0); // the hash inside shot.png was not read
});

test('real-log persisted-foreign: a persisted output ties to its tool call for row 7', async () => {
  const { report } = await audit('persisted-foreign');
  const t = report.txs.find((x) => x.hash === h('pf'));
  assert.equal(t.status, 'foreign-signer');
  assert.equal(t.pattern, 'cast-send');
});

test('real-log persisted-missing: referenced file gone counts, and footer and JSON say so plainly', async () => {
  const { report, text } = await audit('persisted-missing');
  assert.equal(report.logs.missingToolResults, 1);
  assert.match(report.logs.note, /1 saved tool output missing from disk/);
  assert.match(report.logs.note, /"not in this log" lines may be explained by those unreadable outputs/);
  assert.match(text, /"not in this log" lines may be explained by those unreadable outputs/);
  assert.equal(status(report, h('pmiss')), 'unaccounted');
});

test('real-log persisted-over-cap: a file over the cap counts as skipped, and the footer names it', async () => {
  const { report, text } = await audit('persisted-over-cap', { maxToolResultBytes: 1024 });
  assert.equal(report.logs.skippedToolResults, 1);
  assert.match(text, /1 saved tool output over the 512 MB read limit/);
  assert.match(report.logs.note, /may be explained/);
  assert.equal(status(report, h('pover')), 'unaccounted');
  const under = await audit('persisted-over-cap');
  assert.equal(status(under.report, h('pover')), 'accounted');
});

test('real-log persisted-large: a file bigger than memory chunks is read through, hash on a chunk seam found', async () => {
  const dir = copyFixture('persisted-glob');
  // 1 MiB chunks: put hashes across the first seam and past 3 MiB.
  const a = h('seam');
  const b = h('deep');
  const seam = 1024 * 1024 - 30;
  writeFileSync(join(dir, 'session/tool-results/big.txt'), `${' '.repeat(seam)}${a}${' '.repeat(3 * 1024 * 1024)}${b}`);
  const world = {
    chainId: 4663, latest: 100000000, latestTs: Date.parse('2026-11-05T00:00:00Z') / 1000, blockTime: 0.104, nonces: { [WALLET]: 0 }, code: {},
    txs: [{ hash: a, from: OTHER, to: null, nonce: 1, block: 90000000 }, { hash: b, from: OTHER, to: null, nonce: 2, block: 90000001 }],
  };
  const { report } = await auditReport({
    wallets: [WALLET], logs: [join(dir, 'session.jsonl')], cwd: dir, fetchImpl: createReplay(world).fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false,
  });
  assert.equal(status(report, a), 'observed');
  assert.equal(status(report, b), 'observed');
});

test('real-log oversized-line: a line over the parse limit is scanned in pieces and counted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainfess-long-'));
  const log = join(dir, 's.jsonl');
  const start = JSON.stringify({ type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { content: 'x' } });
  const end = JSON.stringify({ type: 'assistant', timestamp: '2026-11-01T10:10:00Z', message: { content: [{ type: 'text', text: 'd' }] } });
  writeFileSync(log, `${start}\n{"type":"user","blob":"${'y'.repeat(2500000)} ${h('long')} ${'y'.repeat(2500000)}"}\n${end}\n`);
  const world = {
    chainId: 4663, latest: 100000000, latestTs: Date.parse('2026-11-05T00:00:00Z') / 1000, blockTime: 0.104, nonces: { [WALLET]: 1 }, code: {},
    txs: [{ hash: h('long'), from: WALLET, to: null, nonce: 0, block: 99999000 - 3000000 }],
  };
  const { report } = await auditReport({
    wallets: [WALLET], logs: [log], cwd: dir, fetchImpl: createReplay(world).fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false, maxLineChars: 1024 * 1024,
  });
  assert.equal(report.logs.unreadableLines, 1);
  assert.ok(report.txs.find((t) => t.hash === h('long')));
});

test('real-log unknown-types: unknown entry types do not fail or set the span; a hash in them is still in the log', async () => {
  const { report } = await audit('unknown-types');
  assert.equal(report.session.tStart, '2026-11-01T10:00:00Z'); // the 2020 snapshot did not set it
  assert.equal(status(report, h('queued')), 'accounted');
});

test('real-log no-timestamp: an entry with no timestamp takes the previous one for lookups, not for the span', () => {
  const sink = createSink();
  const ctx = { origin: 'main', lastTs: null, evidenceOnly: false };
  handleLine(sink, JSON.stringify({ type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { content: 'a' } }), 1, ctx);
  handleLine(sink, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'cast send' } }] } }), 2, ctx);
  assert.equal(sink.tools.get('t').start, Date.parse('2026-11-01T10:00:00Z'));
  assert.equal(sink.tStart, sink.tEnd);
  assert.equal(sink.timestamped, 1);
});

test('real-log bare-hash: a full hash printed with no 0x is in the log and is never sent to an RPC', async () => {
  const { report, replay } = await audit('bare-hash');
  assert.equal(status(report, h('bare')), 'accounted');
  assert.equal(report.summary.findings, 0);
  assert.equal(replay.log.hashes.length, 0);
});

test('real-log same-block-nonces: a gap nonce sharing a block with its neighbours is found', async () => {
  const { report } = await audit('same-block-nonces');
  assert.equal(status(report, h('sb1')), 'unaccounted');
  assert.equal(report.summary.findings, 1);
});

test('real-log two-wallets: tx between registered wallets is one row, under its sender', async () => {
  const { report } = await audit('two-wallets');
  assert.equal(report.txs.length, 1);
  assert.equal(report.wallets[1].neverSent, true);
});

test('real-log nothing-to-reconcile: wallet with no tx in range prints the §7 line, exit 0', async () => {
  const { report, text } = await audit('nothing-to-reconcile');
  assert.equal(report.exitCode, 0);
  assert.match(text, /0 transactions from 0x.* between blocks .* Nothing to reconcile\./);
  assert.match(text, /whole session span was scanned/);
});

test('real-log slug: every non-alphanumeric char becomes one dash', () => {
  assert.equal(slugOf('/Users/a/Documents/222. Chainfess 05-11-2026'), '-Users-a-Documents-222--Chainfess-05-11-2026');
  assert.equal(slugOf('/x/run_@x.y z~(1)&'), '-x-run--x-y-z--1--');
});

test('real-log project-dir: found by slug, then by a matching cwd field; otherwise exit 2 names the directory', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chainfess-proj-')));
  const projects = join(root, 'projects');
  const cwd = join(root, 'work.dir');
  mkdirSync(cwd);
  mkdirSync(projects);
  const bySlug = join(projects, slugOf(cwd));
  assert.equal(findProjectDir(cwd, projects).dir, null);
  assert.equal(findProjectDir(cwd, projects).lookedIn, bySlug);
  const odd = join(projects, 'renamed-dir');
  mkdirSync(odd);
  writeFileSync(join(odd, 'a.jsonl'), JSON.stringify({ type: 'user', cwd, timestamp: '2026-11-01T10:00:00Z' }) + '\n');
  assert.equal(findProjectDir(cwd, projects).dir, odd);
  mkdirSync(bySlug);
  writeFileSync(join(bySlug, 'old.jsonl'), '{}\n');
  writeFileSync(join(bySlug, 'new.jsonl'), '{}\n');
  utimesSync(join(bySlug, 'old.jsonl'), new Date(1000), new Date(1000));
  assert.equal(findProjectDir(cwd, projects).dir, bySlug);
  assert.equal(newestLog(bySlug), join(bySlug, 'new.jsonl'));
  const empty = join(root, 'empty');
  mkdirSync(empty);
  await assert.rejects(
    () => auditReport({ wallets: [WALLET], cwd: empty, projectsDir: projects, fetchImpl: () => { throw new Error('no network'); } }),
    (e) => e instanceof InputError && e.message.includes(slugOf(empty)),
  );
});

test('real-log sending-pattern: pattern names per §2.3, Bash only', () => {
  assert.equal(sendingPattern('Bash', { command: 'cast send 0x1 --rpc-url x' }), 'cast-send');
  assert.equal(sendingPattern('Bash', { command: 'cast publish 0xaa' }), 'cast-publish');
  assert.equal(sendingPattern('Bash', { command: 'cast mktx 0x1' }), 'cast-publish');
  assert.equal(sendingPattern('Bash', { command: 'forge script S --rpc-url x\n --broadcast' }), 'forge-broadcast');
  assert.equal(sendingPattern('Bash', { command: 'forge script S --rpc-url x' }), null);
  assert.equal(sendingPattern('Bash', { command: 'forge create C' }), 'forge-create');
  assert.equal(sendingPattern('Bash', { command: 'curl -d eth_sendRawTransaction x' }), 'raw-rpc');
  assert.equal(sendingPattern('Bash', { command: 'python3 pay.py --private-key k' }), 'script-with-key');
  assert.equal(sendingPattern('Bash', { command: 'tsx pay.ts' }), null);
  assert.equal(sendingPattern('Bash', { command: 'cat .env | grep PRIVATE_KEY' }), null);
  assert.equal(sendingPattern('Read', { command: 'cast send' }), null);
});

test('real-log key-guard: a value next to a key word, or the wallet\'s own key, is never looked up', () => {
  const anvil0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const addr0 = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
  const sink = createSink();
  const ctx = { origin: 'main', lastTs: null, evidenceOnly: false };
  const contexts = ['PRIVATE_KEY=', '--private-key ', '"privateKey": "', 'Private key: ', 'mnemonic seed ', 'new Wallet("', 'privateKeyToAccount(\'', 'Private Keys\\n=====\\n(0) '];
  contexts.forEach((c, i) => {
    handleLine(sink, JSON.stringify({ type: 'other', note: c.includes('\\n') ? 'x' : undefined }), i, ctx);
  });
  const keys = contexts.map((_, i) => h(`k${i}`));
  contexts.forEach((c, i) => {
    handleLine(sink, `{"type":"attachment","x":"${c.replaceAll('"', '\\"')}${keys[i]}"}`, 100 + i, ctx);
  });
  handleLine(sink, JSON.stringify({ type: 'attachment', x: `printed ${anvil0}` }), 200, ctx);
  handleLine(sink, JSON.stringify({ type: 'attachment', x: `tx hash ${h('plain')}` }), 201, ctx);
  const { hashes, withheld } = lookupCandidates(sink, [addr0]);
  assert.deepEqual(hashes, [h('plain')]);
  assert.equal(withheld, keys.length + 1);
});

test('real-log withheld-but-own: a tx hash wrongly next to a key word still matches locally after the scan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chainfess-withheld-'));
  const log = join(dir, 's.jsonl');
  const H = h('wh');
  const lines = [
    { type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { content: `secret: ${H}` } },
    { type: 'assistant', timestamp: '2026-11-01T10:10:00Z', message: { content: [{ type: 'text', text: 'ok' }] } },
  ];
  writeFileSync(log, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const latest = 100000000;
  const latestTs = Date.parse('2026-11-05T00:00:00Z') / 1000;
  const block = latest - Math.floor((latestTs - Date.parse('2026-11-01T10:05:00Z') / 1000) / 0.104);
  const world = { chainId: 4663, latest, latestTs, blockTime: 0.104, nonces: { [WALLET]: 1 }, code: {}, txs: [{ hash: H, from: WALLET, to: null, nonce: 0, block }] };
  const replay = createReplay(world);
  const { report } = await auditReport({ wallets: [WALLET], logs: [log], cwd: dir, fetchImpl: replay.fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false });
  assert.equal(status(report, H), 'accounted');
  assert.equal(report.summary.findings, 0);
  assert.equal(replay.log.hashes.length, 0);
});
