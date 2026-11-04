import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanner } from '../../server/scan.mjs';
import { startApp, goodBody, waitJob, hash, WALLET, STRANGER } from './helpers.mjs';
import { verifyStatement } from '../../server/keys.mjs';

// A tiny fake chain: WALLET sent nonces 0,1,2 at blocks 1500, 1550, 1600; STRANGER sent one tx at 1550 too.
function fakeChain() {
  const mk = (h, from, nonce, block, to = STRANGER, value = '0x0') => ({ hash: h, from, nonce: '0x' + nonce.toString(16), blockNumber: '0x' + block.toString(16), to, value });
  const txs = [mk(hash(1), WALLET, 0, 1500), mk(hash(2), WALLET, 1, 1550, STRANGER, '0x5'), mk(hash(3), WALLET, 2, 1600), mk(hash(9), STRANGER, 7, 1550, WALLET)];
  const byHash = Object.fromEntries(txs.map((t) => [t.hash, t]));
  const calls = { blockNums: [] };
  const answer = ({ method, params }) => {
    switch (method) {
      case 'eth_getTransactionCount': return params[0].toLowerCase() === WALLET ? '0x3' : '0x0';
      case 'eth_getTransactionByHash': return byHash[params[0]] ?? null;
      case 'eth_getBlockByNumber': {
        const n = Number(BigInt(params[0])); calls.blockNums.push(n);
        return { number: params[0], timestamp: '0x' + (1_800_000_000 + n).toString(16), transactions: params[1] ? txs.filter((t) => Number(BigInt(t.blockNumber)) === n) : [] };
      }
      case 'eth_getTransactionReceipt': return byHash[params[0]] ? { status: '0x1', contractAddress: null } : null;
      case 'eth_chainId': return '0x1237';
      default: return null;
    }
  };
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const items = Array.isArray(body) ? body : [body];
    const out = items.map((it) => ({ jsonrpc: '2.0', id: it.id, result: answer(it) }));
    return { status: 200, json: async () => (Array.isArray(body) ? out : out[0]) };
  };
  return { fetchImpl, calls };
}

test('integration: full /api/sign job through the real runLedger with a fake RPC (ghost gap found, scanned only inside the gap)', async () => {
  const fc = fakeChain();
  const scan = createScanner({ rpcUrl: 'http://fake', chainId: 4663, fetchImpl: fc.fetchImpl, paceMs: 0, sleep: async () => {} });
  const t = await startApp({ scan });
  try {
    const r = await t.post(goodBody({ hashes: [hash(1), hash(3)], fromBlock: 1400, toBlock: 1900 }));
    assert.equal(r.status, 202);
    const j = await waitJob(t, r.body.jobId);
    assert.equal(j.body.status, 'done', JSON.stringify(j.body));
    const st = j.body.statement;
    assert.equal(verifyStatement(st, j.body.signature, t.keys.publicPem), true);
    assert.deepEqual(st.nonceAt, { [WALLET]: 3 });
    assert.deepEqual(st.txs.map((x) => [x.nonce, x.block, x.listedByClient, x.value]), [[0, 1500, true, '0'], [1, 1550, false, '5'], [2, 1600, true, '0']]);
    assert.deepEqual(st.unscannedRanges, []);
    assert.equal(st.txs.every((x) => x.hash === x.hash.toLowerCase()), true);
    // scan is limited to the gap between nonce 0 (block 1500) and nonce 2 (block 1600), inclusive; enrich calls use header-only reads
    const scanned = fc.calls.blockNums.filter((n) => n >= 1500 && n <= 1600);
    assert.ok(Math.min(...fc.calls.blockNums) >= 1500 && Math.max(...fc.calls.blockNums) <= 1600, 'no block outside the gap was fetched');
    assert.ok(scanned.length >= 100);
    assert.doesNotMatch(JSON.stringify(st), /accounted/i);
  } finally { await t.stop(); }
});
test('integration: contiguous listing scans zero blocks and every tx is listed', async () => {
  const fc = fakeChain();
  const scan = createScanner({ rpcUrl: 'http://fake', chainId: 4663, fetchImpl: fc.fetchImpl, paceMs: 0, sleep: async () => {} });
  const t = await startApp({ scan });
  try {
    const r = await t.post(goodBody({ hashes: [hash(1), hash(2), hash(3)] }));
    const j = await waitJob(t, r.body.jobId);
    assert.deepEqual(j.body.statement.txs.map((x) => x.listedByClient), [true, true, true]);
    // only header reads for timestamps, no full-block scan
    assert.ok(fc.calls.blockNums.length <= 3);
  } finally { await t.stop(); }
});
