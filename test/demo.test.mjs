import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { prepareAudit } from '../src/audit.mjs';
import { audit, BANNED } from './helpers.mjs';
import { h, WALLET } from './fixtures/build.mjs';

const BIN = fileURLToPath(new URL('../bin/chainfess.mjs', import.meta.url));

async function runDemo(args = []) {
  let out = '';
  const code = await main(['demo', ...args], { out: (s) => { out += s; }, err: () => {}, isTTY: false, env: {} });
  return { code, out };
}

test('demo: no network at all, with a fetch that throws', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('demo touched the network'); };
  try {
    const { code, out } = await runDemo();
    assert.equal(code, 0);
    assert.match(out, /not in this log/);
  } finally { globalThis.fetch = before; }
});

test('demo: 1 Accounted, 1 Unaccounted, 1 Foreign signer, 1 Observed; --json has demo:true', async () => {
  const { out } = await runDemo(['--json']);
  const r = JSON.parse(out);
  assert.equal(r.demo, true);
  assert.equal(r.summary.accounted, 1);
  assert.equal(r.summary.unaccounted, 1);
  assert.equal(r.summary.foreignSigner, 1);
  assert.equal(r.summary.observed, 1);
  assert.equal(r.summary.findings, 2);
  assert.equal(r.exitCode, 0); // same as the process
});

test('demo: every header line is labelled, no secret-looking or banned word, no colour when not a TTY', async () => {
  const { out } = await runDemo();
  const header = out.split('\n\n')[0].split('\n');
  assert.ok(header.length >= 4);
  for (const line of header) assert.ok(line.includes('DEMO — fixture data'), line);
  assert.ok(!BANNED.test(out));
  assert.ok(!out.includes('\x1b['));
  assert.ok(!out.includes('OTHER_KEY'));
  assert.ok(!out.includes('Deploy the vault'));
});

test('demo: colour only when TTY and no NO_COLOR', async () => {
  let out = '';
  await main(['demo'], { out: (s) => { out += s; }, err: () => {}, isTTY: true, env: {} });
  assert.ok(out.includes('\x1b['));
  out = '';
  await main(['demo'], { out: (s) => { out += s; }, err: () => {}, isTTY: true, env: { NO_COLOR: '1' } });
  assert.ok(!out.includes('\x1b['));
});

test('demo: the real binary takes about a second and exits 0', () => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [BIN, 'demo'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t < 2000);
});

test('privacy: fetch is only in src/rpc.mjs and src/sign.mjs', () => {
  for (const f of ['cli', 'parse', 'blocks', 'ledger', 'classify', 'report', 'audit', 'keccak', 'replay', 'hook']) {
    let src = '';
    try { src = readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8'); } catch { continue; }
    assert.ok(!/\bfetch\s*\(|globalThis\.fetch|node:https?|node:net|XMLHttpRequest/.test(src), `${f}.mjs has an HTTP client`);
  }
});

test('prepareAudit: gives sign the wallets, range, log hash and only accounted hashes of our wallets', async () => {
  const { dir, world, replay } = await audit('ghost-gap');
  const a = await prepareAudit({ wallets: world.wallets, logs: [`${dir}/session.jsonl`], cwd: dir, fetchImpl: replay.fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false });
  assert.deepEqual(a.wallets, [WALLET]);
  assert.ok(a.fromBlock < a.toBlock);
  assert.match(a.logSha256, /^[0-9a-f]{64}$/);
  assert.ok(a.hashes.includes(h('gg4')) && !a.hashes.includes(h('gg5')));
});

test('dispatch: sign and verify reach src/sign.mjs and pass --pubkey through', async () => {
  let err = '';
  const io = { out: () => {}, err: (s) => { err += s; } };
  assert.equal(await main(['verify'], io), 2);
  assert.match(err, /--pubkey/);
  assert.equal(await main(['verify', '/nope.json', '--pubkey', '/nope.pem'], io), 2);
  err = '';
  assert.equal(await main(['sign', '--burn-tx', 'bad'], io), 2);
  assert.match(err, /usage: chainfess sign/);
});
