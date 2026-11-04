import { generateKeyPairSync } from 'node:crypto';
import { createApp } from '../../server/app.mjs';
import { openDb } from '../../server/db.mjs';
import { publicPemOf } from '../../server/keys.mjs';
import { TRANSFER_TOPIC0 } from '../../server/verify-burn.mjs';

export const TOKEN = '0x' + 'a1'.repeat(20);
export const WALLET = '0x' + '11'.repeat(20);
export const WALLET2 = '0x' + '22'.repeat(20);
export const STRANGER = '0x' + '99'.repeat(20);
export const DEAD = '0x000000000000000000000000000000000000dEaD';
export const hash = (n) => '0x' + n.toString(16).padStart(64, '0');
const pad = (a) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();

export function transferLog({ token = TOKEN, from = WALLET, to = DEAD, value = 1000n } = {}) {
  return { address: token, topics: [TRANSFER_TOPIC0, pad(from), pad(to)], data: '0x' + value.toString(16).padStart(64, '0') };
}
export function burnFixture({ from = WALLET, block = 1000, logs = [transferLog({ from })], status = '0x1' } = {}) {
  return {
    tx: { hash: hash(0xb0), from, blockNumber: '0x' + block.toString(16) },
    receipt: { status, logs, blockNumber: '0x' + block.toString(16) },
  };
}

export function makeKeys() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicPemOf(privateKey) };
}

/** Starts an app on an ephemeral port with fakes. */
export async function startApp(o = {}) {
  const keys = o.keys || makeKeys();
  const db = openDb(':memory:');
  const burns = o.burns || { [hash(0xb0)]: burnFixture() };
  const state = { latest: o.latest ?? 2000, blockCalls: 0, scanCalls: 0, scanActive: 0, scanMax: 0 };
  const chain = {
    blockNumber: async () => { state.blockCalls++; if (state.rpcDown) throw new Error('down'); return state.latest; },
    getTx: async (h) => burns[h]?.tx ?? null,
    getReceipt: async (h) => burns[h]?.receipt ?? null,
  };
  let token = o.token || { launched: true, tokenAddress: TOKEN, burnAmount: '1000' };
  const tokenStore = { get: () => token, set: (t) => { token = t; } };
  const clock = { t: 1_800_000_000_000 };
  const scan = o.scan || (async ({ wallets, knownHashes }) => {
    state.scanCalls++; state.scanActive++; state.scanMax = Math.max(state.scanMax, state.scanActive);
    await new Promise((r) => setTimeout(r, 15));
    state.scanActive--;
    if (state.scanFail) throw new Error('boom');
    return {
      nonceAt: { [wallets[0]]: 3 },
      txs: [
        { hash: hash(1), from: wallets[0], to: STRANGER, nonce: 1, block: 1500, valueWei: '0' },
        { hash: hash(2), from: wallets[0], to: STRANGER, nonce: 2, block: 1600, valueWei: '5' },
        { hash: hash(3), from: STRANGER, to: wallets[0], nonce: 0, block: 1601, valueWei: '1' },
      ],
      unscannedRanges: [],
    };
  });
  const app = createApp({ db, chain, tokenStore, privateKey: keys.privateKey, publicPem: keys.publicPem, scan,
    maxScanBlocks: o.maxScanBlocks ?? 210000, now: () => clock.t });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (path, init) => {
    const res = await fetch(base + path, init);
    let body = null; try { body = await res.json(); } catch { /* */ }
    return { status: res.status, body };
  };
  const post = (body, raw) => api('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  const stop = () => new Promise((r) => { app.server.close(r); app.server.closeAllConnections?.(); });
  return { app, db, state, base, api, post, stop, keys, clock, tokenStore, setBurns: (b) => Object.assign(burns, b) };
}

export function goodBody(over = {}) {
  return { burnTx: hash(0xb0), wallets: [WALLET], fromBlock: 1400, toBlock: 1900, hashes: [hash(1)], logSha256: 'ab'.repeat(32), ...over };
}

export async function waitJob(t, jobId) {
  await t.app.whenIdle();
  return t.api('/api/sign/' + jobId);
}
