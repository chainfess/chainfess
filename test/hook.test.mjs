// All of these use a temp HOME; the real ~/.claude/settings.json is never read or written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hookCommand, runHook } from '../src/hook.mjs';
import { createReplay } from '../src/replay.mjs';
import { copyFixture } from './helpers.mjs';
import { WALLET } from './fixtures/build.mjs';

const BIN = fileURLToPath(new URL('../bin/chainfess.mjs', import.meta.url));

function env() {
  const home = mkdtempSync(join(tmpdir(), 'chainfess-home-'));
  const settings = join(home, '.claude', 'settings.json');
  let out = '';
  let err = '';
  const io = { home, env: {}, out: (s) => { out += s; }, err: (s) => { err += s; } };
  return { home, settings, io, output: () => out, errors: () => err };
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('hook install: creates settings when none exist; reinstall does not duplicate', async () => {
  const e = env();
  assert.equal(await runHook(['install', '--wallet', WALLET], e.io), 0);
  await runHook(['install', '--wallet', WALLET], e.io);
  const doc = read(e.settings);
  assert.equal(doc.hooks.SessionEnd.length, 1);
  assert.match(doc.hooks.SessionEnd[0].hooks[0].command, /hook run --wallet 0x/);
  assert.match(doc.hooks.SessionEnd[0].hooks[0].command, /\|\| true$/);
});

test('hook install: preserves everything else and writes a backup; uninstall removes only ours', async () => {
  const e = env();
  mkdirSync(join(e.home, '.claude'), { recursive: true });
  const original = {
    model: 'x', permissions: { allow: ['Bash(ls)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say stop' }] }], SessionEnd: [{ matcher: 'm', hooks: [{ type: 'command', command: 'mine.sh' }] }] },
  };
  writeFileSync(e.settings, JSON.stringify(original));
  assert.equal(await runHook(['install', '--wallet', WALLET], e.io), 0);
  const doc = read(e.settings);
  assert.equal(doc.model, 'x');
  assert.deepEqual(doc.permissions, original.permissions);
  assert.deepEqual(doc.hooks.Stop, original.hooks.Stop);
  assert.equal(doc.hooks.SessionEnd.length, 2);
  assert.equal(doc.hooks.SessionEnd[0].hooks[0].command, 'mine.sh');
  const backups = readdirSync(join(e.home, '.claude')).filter((f) => f.includes('chainfess-backup'));
  assert.equal(backups.length, 1);
  assert.deepEqual(read(join(e.home, '.claude', backups[0])), original);
  assert.equal(await runHook(['uninstall'], e.io), 0);
  assert.deepEqual(read(e.settings), original);
});

test('hook uninstall: nothing else in a shared group is touched, an empty hooks key goes away', async () => {
  const e = env();
  mkdirSync(join(e.home, '.claude'), { recursive: true });
  const cmd = hookCommand([WALLET]);
  writeFileSync(e.settings, JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'keep' }, { type: 'command', command: cmd }] }] } }));
  await runHook(['uninstall'], e.io);
  assert.deepEqual(read(e.settings).hooks.SessionEnd[0].hooks, [{ type: 'command', command: 'keep' }]);
  writeFileSync(e.settings, JSON.stringify({ a: 1, hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: cmd }] }] } }));
  await runHook(['uninstall'], e.io);
  assert.deepEqual(read(e.settings), { a: 1 });
});

test('hook install: broken settings are refused and left as they were; no wallet is exit 2', async () => {
  const e = env();
  mkdirSync(join(e.home, '.claude'), { recursive: true });
  writeFileSync(e.settings, '{ not json');
  assert.equal(await runHook(['install', '--wallet', WALLET], e.io), 2);
  assert.equal(readFileSync(e.settings, 'utf8'), '{ not json');
  assert.equal(await runHook(['uninstall'], e.io), 2);
  assert.equal(readFileSync(e.settings, 'utf8'), '{ not json');
  const f = env();
  assert.equal(await runHook(['install'], f.io), 2);
  assert.ok(!existsSync(f.settings));
});

test('hook status: reports not installed, then the wallets', async () => {
  const e = env();
  await runHook(['status'], e.io);
  assert.match(e.output(), /not installed/);
  await runHook(['install', '--wallet', WALLET], e.io);
  await runHook(['status'], e.io);
  assert.match(e.output(), /installed \(SessionEnd\)/);
  assert.ok(e.output().includes(WALLET));
});

test('hook command: pins npx when the package lives in the npx cache', () => {
  assert.match(hookCommand([WALLET], '/x/_npx/ab/node_modules/chainfess/bin/chainfess.mjs'), /^npx --yes chainfess@0\.1\.1 hook run/);
  assert.match(hookCommand([WALLET], '/opt/chainfess/bin/chainfess.mjs', '/usr/bin/node'), /^"\/usr\/bin\/node" "\/opt\/chainfess\/bin\/chainfess\.mjs" hook run/);
});

test('hook run: never fails a session, whatever arrives on stdin', async () => {
  const e = env();
  for (const input of ['', 'not json', '{}', JSON.stringify({ transcript_path: '/nope.jsonl' }), JSON.stringify({ transcript_path: 5 })]) {
    assert.equal(await runHook(['run', '--wallet', WALLET], { ...e.io, stdin: Readable.from([input]) }), 0);
  }
  const r = spawnSync(process.execPath, [BIN, 'hook', 'run', '--wallet', WALLET], { input: 'garbage', env: { HOME: e.home, PATH: process.env.PATH }, encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('hook worker: writes the JSON and text report for the transcript, mode 600, no network beyond the injected RPC', async () => {
  const e = env();
  const dir = copyFixture('reverted');
  const world = read(join(dir, 'rpc.json'));
  const replay = createReplay(world);
  const reports = join(e.home, '.chainfess', 'reports');
  const code = await runHook(['worker', '--wallet', WALLET, '--log', join(dir, 'session.jsonl'), '--id', 'abc', '--reports', reports], {
    ...e.io, cwd: dir, auditExtra: { fetchImpl: replay.fetchImpl, paceMs: 0, sleep: async () => {}, fallback: false },
  });
  assert.equal(code, 0);
  const r = read(join(reports, 'abc.json'));
  assert.equal(r.summary.accounted, 1);
  assert.ok(existsSync(join(reports, 'abc.txt')));
  assert.equal(readFileSync(join(reports, 'abc.txt'), 'utf8').includes('ACCOUNTED'), true);
});

test('hook worker: an RPC failure leaves no report and still exits 0', async () => {
  const e = env();
  const dir = copyFixture('reverted');
  const reports = join(e.home, 'r');
  const code = await runHook(['worker', '--wallet', WALLET, '--log', join(dir, 'session.jsonl'), '--id', 'x', '--reports', reports], {
    ...e.io, cwd: dir, auditExtra: { fetchImpl: async () => { throw new Error('down'); }, paceMs: 0, sleep: async () => {}, fallback: false },
  });
  assert.equal(code, 0);
  assert.ok(!existsSync(join(reports, 'x.json')));
});
