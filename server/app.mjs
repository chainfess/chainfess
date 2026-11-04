import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verifyBurn, isTxHash, isAddress } from './verify-burn.mjs';
import { signStatement } from './keys.mjs';
import { buildStatement } from './statement.mjs';
import { signingEnabled } from './token.mjs';

const BODY_LIMIT = 128 * 1024;
const BLOCK_TTL_MS = 10_000;

/**
 * Dependencies are injected so tests need no network:
 *  db, chain {blockNumber,getTx,getReceipt}, tokenStore {get()}, privateKey, publicPem,
 *  scan({wallets,fromBlock,toBlock,knownHashes,maxScanBlocks}) -> ledger result, chainId, maxScanBlocks
 */
export function createApp(deps) {
  const { db, chain, tokenStore, privateKey, publicPem, scan, chainId = 4663, maxScanBlocks = 210000,
    now = () => Date.now(), log = () => {} } = deps;
  const startedAt = now();
  let blockCache = null; // {block, at, fetched}
  let lastRpcOk = null;

  // ---- queue: one job at a time
  const queue = [];
  let running = false;
  let idle = Promise.resolve();
  function enqueue(jobId, request) {
    queue.push({ jobId, request });
    if (!running) idle = pump();
  }
  async function pump() {
    running = true;
    while (queue.length) {
      const { jobId, request } = queue.shift();
      try {
        db.setStatus(jobId, 'scanning');
        const ledger = await scan({
          wallets: request.wallets, fromBlock: request.fromBlock, toBlock: request.toBlock,
          knownHashes: new Set(request.hashes), maxScanBlocks,
        });
        const statement = buildStatement({
          ledger, request, chainId, burnTx: request.burnTx,
          signedAt: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), serverPublicKey: publicPem,
        });
        db.setDone(jobId, statement, signStatement(statement, privateKey));
      } catch (e) {
        log('job failed', jobId, e && e.message);
        db.setFailed(jobId, 'scan_failed');
      }
    }
    running = false;
  }
  for (const id of db.openJobs()) { // resume after restart
    const j = db.getJob(id);
    try { enqueue(id, JSON.parse(j.request)); } catch { db.setFailed(id, 'restart_lost_request'); }
  }

  async function latestBlock() {
    const t = now();
    if (blockCache && t - blockCache.fetched < BLOCK_TTL_MS) return blockCache;
    try {
      const block = await chain.blockNumber();
      blockCache = { block, at: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'), fetched: t };
      lastRpcOk = true;
    } catch (e) {
      lastRpcOk = false;
      if (blockCache && t - blockCache.fetched < 60_000) return blockCache; // short grace on stale data
      throw e;
    }
    return blockCache;
  }

  // ---- helpers
  function send(res, status, body, extra = {}) {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', ...extra });
    res.end(s);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > BODY_LIMIT) { if (size - c.length <= BODY_LIMIT) reject(Object.assign(new Error('too_large'), { code: 'too_large' })); chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /** BRIEF §5.1 rule 7 input validation. Returns {ok, value} or {ok:false, error} */
  function validateBody(b, latest) {
    const bad = (error) => ({ ok: false, error });
    if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('invalid_body');
    if (!isTxHash(b.burnTx)) return bad('invalid_burnTx');
    if (!Array.isArray(b.wallets) || b.wallets.length < 1 || b.wallets.length > 3 || !b.wallets.every(isAddress)) return bad('invalid_wallets');
    const wallets = [...new Set(b.wallets.map((w) => w.toLowerCase()))];
    if (!Array.isArray(b.hashes) || b.hashes.length > 500 || !b.hashes.every((h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h))) return bad('invalid_hashes');
    const hashes = [...new Set(b.hashes.map((h) => h.toLowerCase()))];
    const { fromBlock, toBlock } = b;
    if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || fromBlock < 0 || toBlock < fromBlock) return bad('invalid_block_range');
    if (toBlock - fromBlock > maxScanBlocks) return bad('range_over_cap');
    if (latest != null && toBlock > latest) return bad('to_block_in_future');
    if (typeof b.logSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.logSha256)) return bad('invalid_logSha256');
    return { ok: true, value: { burnTx: b.burnTx, wallets, hashes, fromBlock, toBlock, logSha256: b.logSha256.toLowerCase() } };
  }

  async function handleSign(req, res) {
    const token = tokenStore.get();
    if (!signingEnabled(token)) return send(res, 403, { enabled: false }); // rule 1
    let body;
    try {
      const raw = await readBody(req);
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid_json' }); }
    } catch (e) {
      if (e.code === 'too_large') { res.once('finish', () => req.destroy()); return send(res, 413, { error: 'body_too_large' }, { connection: 'close' }); }
      return send(res, 400, { error: 'bad_request' });
    }
    // cheap shape checks first (no RPC); block-height-dependent checks after
    const shape = validateBody(body, null);
    if (!shape.ok) return send(res, 400, { error: shape.error });
    const r = shape.value;
    let latest, tx, receipt;
    try {
      latest = (await latestBlock()).block;
      const heightCheck = validateBody(body, latest);
      if (!heightCheck.ok) return send(res, 400, { error: heightCheck.error });
      [tx, receipt] = await Promise.all([chain.getTx(r.burnTx), chain.getReceipt(r.burnTx)]);
    } catch {
      return send(res, 503, { error: 'rpc_unavailable' });
    }
    // rules 2-5 use a fresh latest from the cache above; confirmations measured against it
    const v = verifyBurn({ tx, receipt, latest, tokenAddress: token.tokenAddress, burnAmount: String(token.burnAmount), wallets: r.wallets });
    if (!v.ok) return send(res, v.status, { error: v.error });
    // rule 6: replay
    const jobId = randomUUID();
    const claim = db.claimBurn(r.burnTx, jobId);
    if (!claim.ok) {
      const existing = db.getJob(claim.jobId);
      if (existing && existing.status === 'failed') { // scan failed earlier: same burn may rerun, still one statement ever
        db.requeue(existing.id, r);
        enqueue(existing.id, r);
        return send(res, 202, { jobId: existing.id });
      }
      return send(res, 409, { error: 'already_used', jobId: claim.jobId });
    }
    db.addJob(jobId, r.burnTx, r);
    enqueue(jobId, r);
    return send(res, 202, { jobId });
  }

  function jobView(j) {
    const out = { status: j.status };
    if (j.status === 'done') { out.statement = JSON.parse(j.statement); out.signature = j.signature; }
    if (j.status === 'failed') out.error = j.error;
    return out;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;
    if (m === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' }); return res.end(); }

    if (p === '/api/block' && m === 'GET') {
      try { const b = await latestBlock(); return send(res, 200, { block: b.block, at: b.at }, { 'cache-control': 'public, max-age=5' }); }
      catch { return send(res, 503, { error: 'rpc_unavailable' }); }
    }
    if (p === '/api/health' && m === 'GET') {
      try { await latestBlock(); } catch { /* reflected in rpcOk */ }
      return send(res, 200, { ok: true, rpcOk: lastRpcOk === true, queue: queue.length + (running ? 1 : 0), uptimeSec: Math.floor((now() - startedAt) / 1000) });
    }
    if (p === '/api/sign/status' && m === 'GET') {
      const t = tokenStore.get();
      if (!signingEnabled(t)) return send(res, 200, { enabled: false, publicKey: publicPem });
      return send(res, 200, { enabled: true, burnAmount: String(t.burnAmount), tokenAddress: t.tokenAddress, publicKey: publicPem, maxScanBlocks });
    }
    if (p === '/api/sign' && m === 'POST') return handleSign(req, res);
    let mm;
    if ((mm = p.match(/^\/api\/sign\/([0-9a-f-]{36})$/)) && m === 'GET') {
      const j = db.getJob(mm[1]);
      return j ? send(res, 200, jobView(j)) : send(res, 404, { error: 'not_found' });
    }
    if ((mm = p.match(/^\/api\/report\/(0x[0-9a-fA-F]{64})$/)) && m === 'GET') {
      const j = db.jobByBurn(mm[1].toLowerCase());
      if (!j) return send(res, 404, { error: 'not_found' });
      return send(res, j.status === 'done' ? 200 : 202, jobView(j));
    }
    if (p.startsWith('/api/')) return send(res, m === 'GET' || m === 'POST' ? 404 : 405, { error: 'not_found' });
    return send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => { log('handler error', e && e.message); if (!res.headersSent) send(res, 500, { error: 'internal' }); else res.end(); });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return { server, whenIdle: () => idle, queueLength: () => queue.length };
}
