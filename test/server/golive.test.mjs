import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CA = '0x' + 'c3'.repeat(20);
const strHex = (s) => { const b = Buffer.from(s).toString('hex'); return '0x' + '20'.padStart(64, '0') + s.length.toString(16).padStart(64, '0') + b.padEnd(64, '0'); };

function fakeRpc({ decimals = 18, symbol = 'CFESS', chainId = 4663, supply = 10n ** 27n } = {}) {
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const { id, method, params } = JSON.parse(b);
      let result;
      if (method === 'eth_chainId') result = '0x' + chainId.toString(16);
      else if (method === 'eth_call') {
        const d = params[0].data;
        result = d === '0x313ce567' ? '0x' + decimals.toString(16).padStart(64, '0') : d === '0x18160ddd' ? '0x' + supply.toString(16).padStart(64, '0') : strHex(symbol);
      }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}
function runGolive(args, env) {
  return new Promise((resolve) => {
    const p = spawn('bash', ['golive.sh', ...args], { env: { ...process.env, GOLIVE_DRY: '1', ...env }, cwd: process.cwd() });
    let err = ''; p.stderr.on('data', (c) => { err += c; }); p.stdout.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out: err }));
  });
}

test('golive: reads decimals(), stores burnAmount in RAW units, keeps the other token.json fields', async () => {
  const rpc = await fakeRpc({ decimals: 6 });
  try {
    const f = join(mkdtempSync(join(tmpdir(), 'cf-')), 'token.json');
    writeFileSync(f, JSON.stringify({ symbol: 'CFESS', launched: false, launchDate: '2026-11-06', burnAmount: '0', tokenAddress: '', taxBps: null, teamWallet: '0x1351AbcA903f9E28B59708Af47c0bF0521C47FD3' }));
    const r = await runGolive([CA, '1500.5'], { RPC_URL: rpc.url, TOKEN_FILE: f });
    assert.equal(r.code, 0, r.out);
    const t = JSON.parse(readFileSync(f, 'utf8'));
    assert.deepEqual([t.launched, t.ca, t.tokenAddress, t.decimals, t.burnAmount, t.burnAmountHuman], [true, CA, CA, 6, '1500500000', '1500.5']);
    assert.match(t.launchedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(t.launchDate, '2026-11-06');
  } finally { rpc.close(); }
});
test('golive: 18 decimals', async () => {
  const rpc = await fakeRpc({ decimals: 18 });
  try {
    const f = join(mkdtempSync(join(tmpdir(), 'cf-')), 'token.json'); writeFileSync(f, '{}');
    const r = await runGolive([CA, '1000'], { RPC_URL: rpc.url, TOKEN_FILE: f });
    assert.equal(r.code, 0, r.out);
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).burnAmount, '1000000000000000000000');
  } finally { rpc.close(); }
});
test('golive refuses: wrong symbol, wrong chain, null CA, too many decimals; token file stays untouched', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'cf-')), 'token.json'); writeFileSync(f, '{"launched":false}');
  const cases = [
    [{ symbol: 'OTHER' }, [CA, '10']], [{ chainId: 1 }, [CA, '10']], [{}, ['0x' + '0'.repeat(40), '10']],
    [{}, ['0x000000000000000000000000000000000000dEaD', '10']], [{ decimals: 2 }, [CA, '1.234']], [{}, ['0x12', '10']],
  ];
  for (const [rpcOpts, args] of cases) {
    const rpc = await fakeRpc(rpcOpts);
    try {
      const r = await runGolive(args, { RPC_URL: rpc.url, TOKEN_FILE: f });
      assert.notEqual(r.code, 0, JSON.stringify(args));
    } finally { rpc.close(); }
  }
  assert.equal(readFileSync(f, 'utf8'), '{"launched":false}');
});

test('golive without an amount burns 0.01% of totalSupply (raw), keeps taxBps 200, stores no supply figure', async () => {
  const rpc = await fakeRpc({ decimals: 18, supply: 10n ** 27n });
  try {
    const f = join(mkdtempSync(join(tmpdir(), 'cf-')), 'token.json');
    writeFileSync(f, JSON.stringify({ launched: false, burnAmount: '0', taxBps: 200, burnAmountHuman: '5' }));
    const r = await runGolive([CA], { RPC_URL: rpc.url, TOKEN_FILE: f });
    assert.equal(r.code, 0, r.out);
    const t = JSON.parse(readFileSync(f, 'utf8'));
    assert.deepEqual([t.burnAmount, t.taxBps, t.burnPctOfSupply, t.burnAmountHuman], ['100000000000000000000000', 200, '0.01', undefined]);
    assert.equal(JSON.stringify(t).includes('totalSupply'), false);
    assert.doesNotMatch(r.out, /1000000000000000000000000000/);
  } finally { rpc.close(); }
});
