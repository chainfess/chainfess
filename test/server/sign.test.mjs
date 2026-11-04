import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJSON } from '../../src/canonical.mjs';
import { runSign, runVerify, checkSignature, PRELAUNCH_LINE } from '../../src/sign.mjs';
import { PUBLIC_KEY_PEM } from '../../src/pubkey.mjs';
import { signStatement, makeKeysForTest } from './keys-shim.mjs';
import { startApp, goodBody, hash, WALLET } from './helpers.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cf-'));
const cap = () => { const lines = []; return { lines, fn: (s) => lines.push(s) }; };

test('canonicalJSON: key order never changes the output, nested objects sorted, no whitespace, arrays keep order', () => {
  const a = { b: 1, a: { z: [3, { y: 1, x: 2 }], c: null }, s: 'é"\n' };
  const b = { s: 'é"\n', a: { c: null, z: [3, { x: 2, y: 1 }] }, b: 1 };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.equal(canonicalJSON(a), '{"a":{"c":null,"z":[3,{"x":2,"y":1}]},"b":1,"s":"é\\"\\n"}');
  assert.equal(canonicalJSON({ a: undefined, b: 1 }), '{"b":1}');
  assert.throws(() => canonicalJSON({ a: 10n }));
  assert.throws(() => canonicalJSON({ a: NaN }));
});
test('canonicalJSON is stable under a parse/stringify roundtrip', () => {
  const o = { v: 1, txs: [{ nonce: 2, hash: '0xab', listedByClient: false }], nonceAt: { '0x2': 1, '0x1': 2 } };
  assert.equal(canonicalJSON(JSON.parse(JSON.stringify(o))), canonicalJSON(o));
});

async function signedDoc(t, over = {}) {
  const r = await t.post(goodBody(over));
  await t.app.whenIdle();
  const j = await t.api('/api/sign/' + r.body.jobId);
  return { statement: j.body.statement, signature: j.body.signature };
}

test('sign + verify roundtrip with a non-production key: refused without --pubkey, accepted with it and clearly labelled', async () => {
  const t = await startApp();
  try {
    const doc = await signedDoc(t);
    const dir = tmp();
    const file = join(dir, 's.json'); writeFileSync(file, JSON.stringify(doc));
    const pem = join(dir, 'k.pem'); writeFileSync(pem, t.keys.publicPem);
    const e = cap(); const o = cap();
    assert.equal(await runVerify(file, { out: o.fn, err: e.fn }), 1);
    assert.match(e.lines.join('\n'), /REFUSED.*not the chainfess production key/);
    const o2 = cap();
    assert.equal(await runVerify(file, { pubkey: pem, out: o2.fn, err: () => {} }), 0);
    const text = o2.lines.join('\n');
    assert.match(text, /NON-PRODUCTION key/);
    assert.match(text, /1 listed by the client, 1 not listed/);
  } finally { await t.stop(); }
});
test('verify refuses a statement whose embedded key is not the supplied key, and one that is not a statement file', async () => {
  const t = await startApp();
  try {
    const doc = await signedDoc(t);
    const dir = tmp(); const file = join(dir, 's.json'); writeFileSync(file, JSON.stringify(doc));
    const prod = join(dir, 'prod.pem'); writeFileSync(prod, PUBLIC_KEY_PEM);
    assert.equal(await runVerify(file, { pubkey: prod, out: () => {}, err: () => {} }), 1);
    const junk = join(dir, 'j.json'); writeFileSync(junk, '{"a":1}');
    assert.equal(await runVerify(junk, { out: () => {}, err: () => {} }), 2);
    assert.equal(await runVerify(join(dir, 'missing.json'), { out: () => {}, err: () => {} }), 2);
    assert.equal(await runVerify(undefined, { out: () => {}, err: () => {} }), 2);
  } finally { await t.stop(); }
});
test('tamper detection: any change to the statement or the signature fails verification', async () => {
  const t = await startApp();
  try {
    const doc = await signedDoc(t);
    assert.equal(checkSignature(doc, t.keys.publicPem).ok, true);
    const mutations = [
      (d) => { d.statement.nonceAt[WALLET] += 1; },
      (d) => { d.statement.txs[0].listedByClient = !d.statement.txs[0].listedByClient; },
      (d) => { d.statement.txs.pop(); },
      (d) => { d.statement.toBlock += 1; },
      (d) => { d.statement.burnTx = hash(1); },
      (d) => { d.statement.logSha256 = '00'.repeat(32); },
      (d) => { d.statement.extra = 1; },
      (d) => { d.signature = d.signature.slice(0, -4) + 'AAAA'; },
      (d) => { d.signature = ''; },
    ];
    const dir = tmp(); const pem = join(dir, 'k.pem'); writeFileSync(pem, t.keys.publicPem);
    for (const m of mutations) {
      const d = JSON.parse(JSON.stringify(doc)); m(d);
      assert.equal(checkSignature(d, t.keys.publicPem).ok, false);
      const f = join(dir, 'x.json'); writeFileSync(f, JSON.stringify(d));
      assert.equal(await runVerify(f, { pubkey: pem, out: () => {}, err: () => {} }), 1);
    }
    // a statement re-signed by someone else with their own key but claiming ours fails too
    const other = makeKeysForTest();
    const forged = JSON.parse(JSON.stringify(doc)); forged.signature = signStatement(forged.statement, other.privateKey);
    assert.equal(checkSignature(forged, t.keys.publicPem).ok, false);
  } finally { await t.stop(); }
});
test('client-listing: a client that lists every hash gets all-listed, and the word "accounted" never appears in the statement', async () => {
  const t = await startApp({ scan: async ({ wallets, knownHashes }) => ({
    nonceAt: { [wallets[0]]: 2 },
    txs: [1, 2].map((n) => ({ hash: hash(n), from: wallets[0], to: wallets[0], nonce: n - 1, block: 1500 + n, valueWei: '0' })),
    unscannedRanges: [],
  }) });
  try {
    const doc = await signedDoc(t, { hashes: [hash(1), hash(2)] });
    assert.deepEqual(doc.statement.txs.map((x) => x.listedByClient), [true, true]);
    assert.doesNotMatch(JSON.stringify(doc), /accounted/i);
    const other = await t.post(goodBody({ burnTx: hash(0xb0) })); // replay, not a new statement
    assert.equal(other.status, 409);
    // verify output uses listed / not listed only
    const dir = tmp(); const f = join(dir, 's.json'); writeFileSync(f, JSON.stringify(doc));
    const p = join(dir, 'k.pem'); writeFileSync(p, t.keys.publicPem);
    const o = cap(); await runVerify(f, { pubkey: p, out: o.fn, err: () => {} });
    const out = o.lines.join('\n');
    assert.doesNotMatch(out, /accounted/i);
    assert.match(out, /2 listed by the client, 0 not listed/);
  } finally { await t.stop(); }
});
test('client-listing: a tx the client did not list is "not listed"', async () => {
  const t = await startApp();
  try {
    const doc = await signedDoc(t, { hashes: [] });
    assert.deepEqual(doc.statement.txs.map((x) => x.listedByClient), [false, false]);
    assert.doesNotMatch(JSON.stringify(doc), /accounted/i);
  } finally { await t.stop(); }
});
test('runSign pre-launch: prints the /token line and exits 0 without running the audit', async () => {
  const t = await startApp({ token: { launched: false } });
  try {
    const o = cap(); let audited = false;
    const code = await runSign({ burnTx: hash(0xb0), server: t.base, out: o.fn, err: () => {}, prepareAudit: async () => { audited = true; } });
    assert.equal(code, 0); assert.equal(audited, false);
    assert.equal(o.lines[0], PRELAUNCH_LINE);
    assert.match(PRELAUNCH_LINE, /chainfess\.pro\/token/);
    assert.doesNotMatch(PRELAUNCH_LINE, /soon|coming|hour/i);
  } finally { await t.stop(); }
});
test('runSign end to end against the app: statement saved, replay still returns the same statement', async () => {
  const t = await startApp();
  try {
    const dir = tmp(); const outFile = join(dir, 'st.json');
    const prepareAudit = async () => ({ wallets: [WALLET], fromBlock: 1400, toBlock: 1900, hashes: [hash(1)], logSha256: 'ab'.repeat(32) });
    const o = cap();
    const run = (extra = {}) => runSign({ burnTx: hash(0xb0), server: t.base + '/', out: o.fn, err: (s) => o.lines.push('ERR ' + s), prepareAudit, outFile, pollMs: 10, ...extra });
    assert.equal(await run(), 0);
    const first = readFileSync(outFile, 'utf8');
    assert.match(o.lines.join('\n'), /not the production key.*--pubkey/s);
    const pemFile = outFile.replace(/\.json$/, '') + '.pubkey.pem';
    assert.equal(await runVerify(outFile, { pubkey: pemFile, out: () => {}, err: () => {} }), 0);
    assert.equal(await run(), 0);
    assert.equal(readFileSync(outFile, 'utf8'), first);
    assert.match(o.lines.join('\n'), /already used/);
  } finally { await t.stop(); }
});
test('runSign maps server refusals to a non-zero exit', async () => {
  const t = await startApp({ burns: {} });
  try {
    const e = cap();
    const code = await runSign({ burnTx: hash(0xb0), server: t.base, out: () => {}, err: e.fn, outFile: join(tmp(), 'x.json'),
      prepareAudit: async () => ({ wallets: [WALLET], fromBlock: 1400, toBlock: 1900, hashes: [], logSha256: 'ab'.repeat(32) }) });
    assert.equal(code, 1);
    assert.match(e.lines.join(''), /404/);
    assert.equal(await runSign({ burnTx: 'nope', out: () => {}, err: () => {} }), 2);
    assert.equal(await runSign({ burnTx: hash(1), server: 'http://127.0.0.1:1', out: () => {}, err: () => {} }), 3);
  } finally { await t.stop(); }
});
