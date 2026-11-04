// Transport rules of BRIEF §3.4 and the exit codes around them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { auditReport, InputError } from '../src/audit.mjs';
import { createRpc, RpcUnavailableError } from '../src/rpc.mjs';
import { createReplay } from '../src/replay.mjs';
import { planWallet, runLedger, ScanCapError } from '../src/ledger.mjs';
import { mapRange } from '../src/blocks.mjs';
import { audit, copyFixture } from './helpers.mjs';
import { h, WALLET, OTHER } from './fixtures/build.mjs';

const noSleep = async () => {};
const ok = (body) => ({ status: 200, json: async () => body });

test('rpc: batch keeps order by id and sends User-Agent', async () => {
  let ua;
  const rpc = createRpc({ url: 'http://x', paceMs: 0, sleep: noSleep, fetchImpl: async (_u, init) => {
    ua = init.headers['user-agent'];
    const req = JSON.parse(init.body);
    return ok([...req].reverse().map((r) => ({ id: r.id, result: r.params[0] })));
  } });
  assert.deepEqual(await rpc.batch([['m', ['a']], ['m', ['b']], ['m', ['c']]]), ['a', 'b', 'c']);
  assert.equal(ua, 'chainfess/0.1');
  assert.equal(rpc.stats().requests, 1);
});

test('rpc: 429 then success retries; after 3 failures the batch shrinks', async () => {
  const sizes = [];
  let calls = 0;
  const rpc = createRpc({ url: 'http://x', paceMs: 0, sleep: noSleep, fetchImpl: async (_u, init) => {
    const req = JSON.parse(init.body);
    sizes.push(Array.isArray(req) ? req.length : 1);
    if (++calls <= 3) return { status: 429, json: async () => ({}) };
    return ok(Array.isArray(req) ? req.map((r) => ({ id: r.id, result: 1 })) : { id: req.id, result: 1 });
  } });
  const list = Array.from({ length: 100 }, () => ['m', []]);
  const out = await rpc.batch(list, { size: 100 });
  assert.equal(out.length, 100);
  assert.deepEqual(sizes.slice(0, 4), [100, 100, 100, 50]);
});

test('rpc: empty batch result and fewer results are throttle signals', async () => {
  let calls = 0;
  const rpc = createRpc({ url: 'http://x', paceMs: 0, sleep: noSleep, fetchImpl: async (_u, init) => {
    const req = JSON.parse(init.body);
    calls++;
    if (calls === 1) return ok([]);
    if (calls === 2) return ok([{ id: req[0].id, result: 1 }]);
    return ok(req.map((r) => ({ id: r.id, result: 2 })));
  } });
  assert.deepEqual(await rpc.batch([['m', []], ['m', []]]), [2, 2]);
});

test('rpc: a primary that fails moves to the fallback in single-call mode', async () => {
  const seen = [];
  const rpc = createRpc({ url: 'http://primary', fallbackUrl: 'http://fb', chainId: 4663, paceMs: 0, sleep: noSleep, fetchImpl: async (u, init) => {
    seen.push(u);
    if (u === 'http://primary') return { status: 503, json: async () => ({}) };
    const req = JSON.parse(init.body);
    assert.ok(!Array.isArray(req), 'fallback gets single calls');
    return ok({ id: req.id, result: req.method === 'eth_chainId' ? '0x1237' : 7 });
  } });
  assert.equal(await rpc.call('eth_blockNumber', [], { quick: true }), 7);
  assert.deepEqual(await rpc.batch([['m', []], ['m', []]]), [7, 7]);
  assert.equal(rpc.stats().fallbackUsed, true);
  assert.ok(seen.includes('http://fb'));
});

test('rpc: fallback on another chain is refused', async () => {
  const rpc = createRpc({ url: 'http://p', fallbackUrl: 'http://fb', chainId: 4663, paceMs: 0, sleep: noSleep, fetchImpl: async (u, init) => {
    if (u === 'http://p') return { status: 503, json: async () => ({}) };
    const req = JSON.parse(init.body);
    return ok({ id: req.id, result: '0x1' });
  } });
  await assert.rejects(() => rpc.call('m', [], { quick: true }), RpcUnavailableError);
});

test('exit 3: RPC fully down; message names the endpoint', async () => {
  const dir = copyFixture('reverted');
  let err = '';
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('down'); };
  try {
    const code = await main(['audit', '--wallet', WALLET, '--log', join(dir, 'session.jsonl')], { err: (s) => { err += s; }, out: () => {}, cwd: dir, errTTY: false, isTTY: false, stdinTTY: false });
    assert.equal(code, 3);
    assert.match(err, /robinhood-rpc\.publicnode\.com/);
    assert.match(err, /robinhood\.drpc\.org/);
    assert.match(err, /--rpc/);
  } finally { globalThis.fetch = before; }
});

test('exit 2: wrong chain is refused unless --chain-id matches', async () => {
  await assert.rejects(() => audit('reverted', { world: { chainId: 1 } }), (e) => e instanceof InputError && /chain 1, expected 4663/.test(e.message));
  const okRun = await audit('reverted', { world: { chainId: 1 }, rpc: 'http://mine', chainId: 1 });
  assert.equal(okRun.report.chainId, 1);
  assert.equal(okRun.report.verify.rpc, null);
  assert.match(okRun.text, /--rpc-url \$RPC_URL/);
  await assert.rejects(() => audit('reverted', { chainId: 1 }), InputError);
});

test('exit 2: bad flags and bad wallets', async () => {
  const io = { err: () => {}, out: () => {}, errTTY: false, isTTY: false, stdinTTY: false };
  assert.equal(await main(['audit', '--wallet', 'nope'], io), 2);
  assert.equal(await main(['audit'], io), 2);
  assert.equal(await main(['audit', '--bogus'], io), 2);
  assert.equal(await main(['nothing'], io), 2);
  assert.equal(await main(['audit', '--wallet', WALLET, '--log', '/nope.jsonl'], io), 2);
});

test('exit 4: blocks that keep failing become unscanned ranges, findings still listed', async () => {
  const dir = copyFixture('ghost-gap');
  const world = JSON.parse(readFileSync(join(dir, 'rpc.json'), 'utf8'));
  const replay = createReplay(world);
  const bad = world.txs.find((t) => t.nonce === 4).block + 250; // after nonce 5 is found the scan stops early; use tail below
  const flaky = async (u, init) => {
    const req = JSON.parse(init.body);
    const list = Array.isArray(req) ? req : [req];
    if (list.some((r) => r.method === 'eth_getBlockByNumber' && r.params[1] === true && Number(r.params[0]) <= bad)) {
      return { status: 503, json: async () => ({}) };
    }
    return replay.fetchImpl(u, init);
  };
  const { report } = await auditReport({ wallets: [WALLET], logs: [join(dir, 'session.jsonl')], cwd: dir, fetchImpl: flaky, paceMs: 0, sleep: noSleep, fallback: false });
  assert.equal(report.exitCode, 4);
  assert.ok(report.scan.unscanned.length >= 1);
  assert.equal(report.summary.unaccounted, 0); // nonce 5 was in the failing range: not claimed either way
});

test('exit 4 rather than a false clean: a null block in range is never treated as scanned', async () => {
  const dir = copyFixture('ghost-gap');
  const world = JSON.parse(readFileSync(join(dir, 'rpc.json'), 'utf8'));
  const replay = createReplay(world);
  const blanks = async (u, init) => {
    const res = await replay.fetchImpl(u, init);
    const body = await res.json();
    const blank = (x) => (x.result && Array.isArray(x.result.transactions) && x.result.transactions.length && typeof x.result.transactions[0] === 'object' ? { ...x, result: null } : x);
    return { status: 200, json: async () => (Array.isArray(body) ? body.map(blank) : blank(body)) };
  };
  const { report } = await auditReport({ wallets: [WALLET], logs: [join(dir, 'session.jsonl')], cwd: dir, fetchImpl: blanks, paceMs: 0, sleep: noSleep, fallback: false });
  assert.equal(report.exitCode, 4);
});

test('cap: a plan over 210,000 blocks is refused with the numbers and override lines', async () => {
  await assert.rejects(() => audit('foreign-send-window', { world: { nonces: { [WALLET]: 1 } }, maxHours: 0.01 }), (e) => {
    assert.ok(e instanceof InputError);
    assert.match(e.message, /over the cap of 350/);
    assert.match(e.message, /--max-hours/);
    assert.match(e.message, /--from-block/);
    return true;
  });
});

test('confirm: an estimate over 10 minutes asks, and non-interactive with no --yes refuses', async () => {
  const args = { fromBlock: 99000000, toBlock: 99150000, world: { nonces: { [WALLET]: 1 } }, maxHours: 10 };
  await assert.rejects(() => audit('foreign-send-window', args), /pass --yes/);
  const yes = await audit('foreign-send-window', { ...args, yes: true });
  assert.equal(yes.report.scan.scannedBlocks, 150001);
});

test('plan: gaps, head, tail, clipping per §2.2 step 4, ends inclusive', () => {
  const known = new Map([[3, 100], [4, 110], [7, 200]]);
  const { segments } = planWallet({ wallet: 'w', nonce: 9, knownNonces: known, fromBlock: 50, toBlock: 300 });
  assert.deepEqual(segments.map((s) => [s.from, s.to]), [[50, 100], [110, 200], [200, 300]]);
  const clip = planWallet({ wallet: 'w', nonce: 8, knownNonces: known, fromBlock: 150, toBlock: 180 });
  assert.deepEqual(clip.segments.map((s) => [s.from, s.to]), [[150, 180]]);
  assert.deepEqual(planWallet({ wallet: 'w', nonce: 0, knownNonces: new Map(), fromBlock: 1, toBlock: 2 }).segments, []);
  assert.deepEqual(planWallet({ wallet: 'w', nonce: 2, knownNonces: new Map(), fromBlock: 1, toBlock: 2 }).segments.map((s) => s.nonceHi), [1]);
});

test('runLedger: CONTRACTS shape for the server: lower-case from, Set of hashes, unscannedRanges', async () => {
  const w = WALLET;
  const world = {
    chainId: 4663, latest: 1000, latestTs: 2000000, blockTime: 0.104, nonces: { [w]: 2 }, code: {},
    txs: [{ hash: h('l0'), from: w, to: OTHER, nonce: 0, block: 500, value: '0x5' }, { hash: h('l1'), from: w, to: null, nonce: 1, block: 600 }],
  };
  const replay = createReplay(world);
  const rpc = createRpc({ url: 'http://x', chainId: 4663, fetchImpl: replay.fetchImpl, paceMs: 0, sleep: noSleep });
  const out = await runLedger({ rpc, wallets: [w], fromBlock: 400, toBlock: 700, knownHashes: new Set([h('l0'), h('nope')]), maxScanBlocks: 1000 });
  assert.equal(out.nonceAt[w], 2);
  assert.deepEqual(out.txs.map((t) => [t.nonce, t.block, t.valueWei, t.from]), [[0, 500, '5', w], [1, 600, '0', w]]);
  assert.equal(out.unresolvedHashes, 1);
  assert.deepEqual(out.unscannedRanges, []);
  assert.ok(out.resolved instanceof Map);
  assert.ok(typeof out.txs[0].time === 'string');
  await assert.rejects(() => runLedger({ rpc, wallets: [w], fromBlock: 0, toBlock: 999, knownHashes: [], maxScanBlocks: 10 }), ScanCapError);
});

test('blocks: mapping finds exact bounds with few requests; future and past clamp with a note', async () => {
  const world = { chainId: 4663, latest: 100000000, latestTs: 2000000000, blockTime: 0.104 };
  const replay = createReplay(world);
  const rpc = createRpc({ url: 'http://x', fetchImpl: replay.fetchImpl, paceMs: 0, sleep: noSleep });
  const tsOf = (n) => Math.floor(world.latestTs - (world.latest - n) * 0.104);
  const t0 = (world.latestTs - 86400) * 1000;
  const r = await mapRange({ rpc, tStartMs: t0, tEndMs: t0 + 7200000, latest: world.latest, latestTs: world.latestTs, cache: new Map() });
  assert.ok(tsOf(r.startBlock) >= t0 / 1000 - 30 && tsOf(r.startBlock - 1) < t0 / 1000 - 30);
  assert.ok(tsOf(r.endBlock) <= t0 / 1000 + 7200 + 120 && tsOf(r.endBlock + 1) > t0 / 1000 + 7200 + 120);
  assert.ok(replay.log.requests <= 14, `requests ${replay.log.requests}`);
  const future = await mapRange({ rpc, tStartMs: t0, tEndMs: (world.latestTs + 500) * 1000, latest: world.latest, latestTs: world.latestTs, cache: new Map() });
  assert.equal(future.endBlock, world.latest);
  assert.match(future.notes.join(), /session still running or clock ahead/);
  const past = await mapRange({ rpc, tStartMs: 1000, tEndMs: 2000, latest: world.latest, latestTs: world.latestTs, cache: new Map() });
  assert.equal(past.startBlock, 0);
  assert.match(past.notes.join(), /before block 0/);
});

test('blocks: out-of-order timestamps widen the range by 200 each side', async () => {
  const world = {
    chainId: 4663, latest: 1000000, latestTs: 2000000000, blockTime: 0.104,
    timestampAt: (n) => Math.floor(2000000000 - (1000000 - n) * 0.104) + (n % 7 === 0 ? 3 : 0),
  };
  const replay = createReplay(world);
  const rpc = createRpc({ url: 'http://x', fetchImpl: replay.fetchImpl, paceMs: 0, sleep: noSleep });
  const r = await mapRange({ rpc, tStartMs: (2000000000 - 5000) * 1000, tEndMs: (2000000000 - 4000) * 1000, latest: 1000000, latestTs: 2000000000, cache: new Map() });
  assert.match(r.notes.join(), /widened/);
});

test('blocks: an RPC that pruned old blocks is exit 3 with the oldest block seen', async () => {
  const dir = copyFixture('reverted');
  const world = JSON.parse(readFileSync(join(dir, 'rpc.json'), 'utf8'));
  world.prunedBelow = 99999990;
  let err = '';
  const replay = createReplay(world);
  const before = globalThis.fetch;
  globalThis.fetch = replay.fetchImpl;
  try {
    const code = await main(['audit', '--wallet', WALLET, '--log', join(dir, 'session.jsonl')], { err: (s) => { err += s; }, out: () => {}, cwd: dir, errTTY: false, isTTY: false, stdinTTY: false });
    assert.equal(code, 3);
    assert.match(err, /oldest seen/);
  } finally { globalThis.fetch = before; }
});
