import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const good = { symbol: 'CFESS', ca: '0x' + 'c3'.repeat(20), launched: true, launchDate: '2026-11-06', launchedAt: '2026-11-06T10:00:00Z',
  teamWallet: '0x1351AbcA903f9E28B59708Af47c0bF0521C47FD3', burnAmount: '1000', tokenAddress: '0x' + 'c3'.repeat(20) };

function run(token) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-dep-'));
  mkdirSync(join(dir, 'web'));
  copyFileSync('deploy.sh', join(dir, 'deploy.sh')); chmodSync(join(dir, 'deploy.sh'), 0o755);
  writeFileSync(join(dir, 'web', 'token.json'), JSON.stringify(token));
  writeFileSync(join(dir, '.deploy-host'), 'invalid-host-for-test.invalid');
  return spawnSync('bash', [join(dir, 'deploy.sh'), '--no-web'], { cwd: dir, encoding: 'utf8', timeout: 20000 });
}

test('deploy.sh refuses launched:true when any field is empty, before touching the network', () => {
  for (const k of ['ca', 'tokenAddress', 'burnAmount', 'launchedAt', 'symbol']) {
    const r = run({ ...good, [k]: '' });
    assert.equal(r.status, 1, k);
    assert.match(r.stderr, /REFUSED/, k);
  }
  assert.equal(run({ ...good, ca: '0x' + '0'.repeat(40) }).status, 1);
  assert.equal(run({ ...good, burnAmount: '0' }).status, 1);
  assert.equal(run({ ...good, burnAmount: '1.5' }).status, 1);
});
test('deploy.sh lets a complete launched:true file past the guard (fails later only on the fake host)', () => {
  const r = run(good);
  assert.doesNotMatch(r.stderr, /REFUSED/);
});
test('deploy.sh lets launched:false through the guard', () => {
  assert.doesNotMatch(run({ ...good, launched: false, ca: '', tokenAddress: '', burnAmount: '0' }).stderr, /REFUSED/);
});
