import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, goodBody, waitJob, hash, WALLET, WALLET2, STRANGER, TOKEN, burnFixture, transferLog } from './helpers.mjs';
import { verifyStatement } from '../../server/keys.mjs';

test('rule 1: launched:false -> 403 {enabled:false} on POST /api/sign, status says enabled:false with the public key only', async () => {
  const t = await startApp({ token: { launched: false, tokenAddress: '', burnAmount: '0' } });
  try {
    const r = await t.post(goodBody());
    assert.deepEqual([r.status, r.body], [403, { enabled: false }]);
    const s = await t.api('/api/sign/status');
    assert.equal(s.body.enabled, false);
    assert.equal(s.body.publicKey, t.keys.publicPem);
    assert.equal('burnAmount' in s.body, false);
  } finally { await t.stop(); }
});
test('status when enabled lists burnAmount (raw units), tokenAddress, publicKey, maxScanBlocks', async () => {
  const t = await startApp();
  try {
    const s = (await t.api('/api/sign/status')).body;
    assert.deepEqual([s.enabled, s.burnAmount, s.tokenAddress, s.maxScanBlocks], [true, '1000', TOKEN, 210000]);
  } finally { await t.stop(); }
});
test('launched:true with an empty tokenAddress is still disabled', async () => {
  const t = await startApp({ token: { launched: true, tokenAddress: '', burnAmount: '1000' } });
  try { assert.equal((await t.post(goodBody())).status, 403); } finally { await t.stop(); }
});
test('rule 7: input validation returns 400 with a reason', async () => {
  const t = await startApp({ maxScanBlocks: 1000 });
  try {
    const cases = [
      [goodBody({ burnTx: '0x12' }), 'invalid_burnTx'],
      [goodBody({ burnTx: hash(0xb0).toUpperCase().replace('0X', '0x') }), 'invalid_burnTx'],
      [goodBody({ wallets: [] }), 'invalid_wallets'],
      [goodBody({ wallets: [WALLET, WALLET2, STRANGER, '0x' + '33'.repeat(20)] }), 'invalid_wallets'],
      [goodBody({ wallets: ['nope'] }), 'invalid_wallets'],
      [goodBody({ hashes: Array.from({ length: 501 }, (_, i) => hash(i + 10)) }), 'invalid_hashes'],
      [goodBody({ hashes: ['0x12'] }), 'invalid_hashes'],
      [goodBody({ fromBlock: 1900, toBlock: 1400 }), 'invalid_block_range'],
      [goodBody({ fromBlock: 1.5 }), 'invalid_block_range'],
      [goodBody({ fromBlock: 100, toBlock: 1200 }), 'range_over_cap'],
      [goodBody({ fromBlock: 1900, toBlock: 2100 }), 'to_block_in_future'],
      [goodBody({ logSha256: 'xyz' }), 'invalid_logSha256'],
      [[1, 2], 'invalid_body'],
    ];
    for (const [body, err] of cases) {
      const r = await t.post(body);
      assert.deepEqual([r.status, r.body.error], [400, err], err);
    }
    assert.equal((await t.post(null, '{not json')).body.error, 'invalid_json');
    // exactly 500 hashes and 3 wallets are fine at the shape level
    const ok = await t.post(goodBody({ hashes: Array.from({ length: 500 }, (_, i) => hash(i + 10)), wallets: [WALLET, WALLET2, STRANGER] }));
    assert.equal(ok.status, 202);
  } finally { await t.stop(); }
});
test('rule 7: body over the size limit -> 413', async () => {
  const t = await startApp();
  try {
    const r = await t.post(null, JSON.stringify({ pad: 'x'.repeat(200 * 1024) }));
    assert.equal(r.status, 413);
  } finally { await t.stop(); }
});
test('rule 2: too_recent -> 409', async () => {
  const t = await startApp({ latest: 1020 });
  try {
    const r = await t.post(goodBody({ fromBlock: 1000, toBlock: 1010 }));
    assert.deepEqual([r.status, r.body.error], [409, 'too_recent']);
    assert.equal(t.state.scanCalls, 0);
  } finally { await t.stop(); }
});
test('amount below burnAmount -> 400 and the burn is NOT consumed', async () => {
  const t = await startApp({ burns: { [hash(0xb0)]: burnFixture({ logs: [transferLog({ value: 10n })] }) } });
  try {
    const r = await t.post(goodBody());
    assert.deepEqual([r.status, r.body.error], [400, 'amount_below_required']);
    assert.equal(t.db.jobByBurn(hash(0xb0)), undefined);
  } finally { await t.stop(); }
});
test('burn from a non-audited wallet -> 403', async () => {
  const t = await startApp({ burns: { [hash(0xb0)]: burnFixture({ from: STRANGER }) } });
  try {
    const r = await t.post(goodBody());
    assert.deepEqual([r.status, r.body.error], [403, 'burn_wallet_not_audited']);
  } finally { await t.stop(); }
});
test('unknown burn tx -> 404; rpc down -> 503', async () => {
  const t = await startApp();
  try {
    assert.equal((await t.post(goodBody({ burnTx: hash(0xdead) }))).status, 404);
    t.state.rpcDown = true; t.clock.t += 100000;
    assert.equal((await t.post(goodBody())).status, 503);
  } finally { await t.stop(); }
});
test('happy path: 202 -> job done -> signature verifies; report route returns the same statement', async () => {
  const t = await startApp();
  try {
    const r = await t.post(goodBody());
    assert.equal(r.status, 202);
    const j = await waitJob(t, r.body.jobId);
    assert.equal(j.body.status, 'done');
    assert.equal(verifyStatement(j.body.statement, j.body.signature, t.keys.publicPem), true);
    const st = j.body.statement;
    assert.deepEqual([st.v, st.chainId, st.fromBlock, st.toBlock, st.burnTx], [1, 4663, 1400, 1900, hash(0xb0)]);
    assert.deepEqual(st.nonceAt, { [WALLET]: 3 });
    assert.equal(st.txs.length, 2, 'only txs sent by the audited wallet');
    assert.deepEqual(st.txs.map((x) => x.listedByClient), [true, false]);
    assert.equal(st.serverPublicKey, t.keys.publicPem);
    const rep = await t.api('/api/report/' + hash(0xb0));
    assert.equal(rep.status, 200);
    assert.deepEqual(rep.body.statement, st);
  } finally { await t.stop(); }
});
test('replay: second submit of the same burn -> 409 already_used with the original jobId', async () => {
  const t = await startApp();
  try {
    const a = await t.post(goodBody());
    await t.app.whenIdle();
    const b = await t.post(goodBody({ wallets: [WALLET, WALLET2] }));
    assert.deepEqual([b.status, b.body.error, b.body.jobId], [409, 'already_used', a.body.jobId]);
    assert.equal(t.state.scanCalls, 1);
  } finally { await t.stop(); }
});
test('replay: concurrent duplicate submits yield exactly one job', async () => {
  const t = await startApp();
  try {
    const rs = await Promise.all([t.post(goodBody()), t.post(goodBody()), t.post(goodBody())]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409, 409]);
  } finally { await t.stop(); }
});
test('a failed scan can be retried with the same burn and still yields one statement', async () => {
  const t = await startApp();
  try {
    t.state.scanFail = true;
    const a = await t.post(goodBody());
    const failed = await waitJob(t, a.body.jobId);
    assert.deepEqual([failed.body.status, failed.body.error], ['failed', 'scan_failed']);
    t.state.scanFail = false;
    const b = await t.post(goodBody());
    assert.deepEqual([b.status, b.body.jobId], [202, a.body.jobId]);
    assert.equal((await waitJob(t, a.body.jobId)).body.status, 'done');
    assert.equal((await t.post(goodBody())).status, 409);
  } finally { await t.stop(); }
});
test('queue runs one job at a time', async () => {
  const burns = {};
  for (let i = 1; i <= 4; i++) burns[hash(0xb0 + i)] = { ...burnFixture(), tx: { ...burnFixture().tx, hash: hash(0xb0 + i) } };
  const t = await startApp({ burns });
  try {
    const rs = await Promise.all([1, 2, 3, 4].map((i) => t.post(goodBody({ burnTx: hash(0xb0 + i) }))));
    assert.ok(rs.every((r) => r.status === 202));
    await t.app.whenIdle();
    assert.equal(t.state.scanCalls, 4);
    assert.equal(t.state.scanMax, 1);
    for (const r of rs) assert.equal((await t.api('/api/sign/' + r.body.jobId)).body.status, 'done');
  } finally { await t.stop(); }
});
test('/api/block is cached for 10 s', async () => {
  const t = await startApp();
  try {
    const a = await t.api('/api/block');
    assert.equal(a.body.block, 2000);
    t.state.latest = 2500; t.clock.t += 5000;
    assert.equal((await t.api('/api/block')).body.block, 2000);
    t.clock.t += 6000;
    assert.equal((await t.api('/api/block')).body.block, 2500);
    assert.equal(t.state.blockCalls, 2);
  } finally { await t.stop(); }
});
test('/api/health reports ok, rpcOk, queue, uptimeSec; rpc outage flips rpcOk', async () => {
  const t = await startApp();
  try {
    const h = (await t.api('/api/health')).body;
    assert.deepEqual([h.ok, h.rpcOk, h.queue], [true, true, 0]);
    assert.equal(typeof h.uptimeSec, 'number');
    t.state.rpcDown = true; t.clock.t += 100000;
    assert.equal((await t.api('/api/health')).body.rpcOk, false);
  } finally { await t.stop(); }
});
test('unknown routes and bad ids are 404; GET on /api/sign is not an accepted method', async () => {
  const t = await startApp();
  try {
    assert.equal((await t.api('/api/nope')).status, 404);
    assert.equal((await t.api('/api/sign/not-a-job')).status, 404);
    assert.equal((await t.api('/api/sign/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await t.api('/api/report/' + hash(7))).status, 404);
    assert.equal((await t.api('/api/sign')).status, 404);
  } finally { await t.stop(); }
});
test('token.json store re-reads on its interval and keeps the last good copy on a bad read', async () => {
  const { createTokenStore, signingEnabled } = await import('../../server/token.mjs');
  let content = JSON.stringify({ launched: false });
  const s = createTokenStore({ file: 'x', intervalMs: 20, readFile: () => content });
  try {
    assert.equal(signingEnabled(s.get()), false);
    content = JSON.stringify({ launched: true, tokenAddress: TOKEN, burnAmount: '5' });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(signingEnabled(s.get()), true);
    content = '{broken';
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(signingEnabled(s.get()), true);
  } finally { s.stop(); }
});
