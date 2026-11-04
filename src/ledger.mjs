// Nonce ledger and gap scan (BRIEF §2.2, §3.4). Knows nothing about logs: it takes a set of known hashes.
export const DEFAULT_MAX_SCAN_BLOCKS = 210000;
export const SCAN_BATCH = 100;
export const LOOKUP_BATCH = 50;

export class ScanCapError extends Error {
  constructor(planned, cap) {
    super(`planned scan of ${planned} blocks is over the cap of ${cap}`);
    this.name = 'ScanCapError';
    this.planned = planned;
    this.cap = cap;
  }
}

const hex = (n) => '0x' + n.toString(16);
const num = (x) => (x === null || x === undefined ? null : Number(x));

export function normalizeTx(raw) {
  return {
    hash: String(raw.hash).toLowerCase(),
    from: String(raw.from).toLowerCase(),
    to: raw.to ? String(raw.to).toLowerCase() : null,
    nonce: Number(raw.nonce),
    block: num(raw.blockNumber),
    valueWei: BigInt(raw.value ?? 0).toString(),
  };
}

/** Pure: the block ranges that can hold the nonces this wallet's known txs do not explain. */
export function planWallet({ wallet, nonce, knownNonces, fromBlock, toBlock }) {
  // knownNonces: Map nonce -> block. Range ends are inclusive: on a 0.1 s chain two nonces can share a block.
  const segments = [];
  const K = [...knownNonces.keys()].filter((k) => k < nonce).sort((a, b) => a - b);
  const push = (lo, hi, nonceLo, nonceHi) => {
    const clo = Math.max(lo, fromBlock);
    const chi = Math.min(hi, toBlock);
    if (clo > chi) return;
    segments.push({ wallet, from: clo, to: chi, nonceLo, nonceHi });
  };
  if (nonce <= 0) return { segments, unknown: 0 };
  if (K.length === 0) {
    push(fromBlock, toBlock, 0, nonce - 1);
    return { segments, unknown: nonce };
  }
  if (K[0] > 0) push(fromBlock, knownNonces.get(K[0]), 0, K[0] - 1);
  for (let i = 0; i + 1 < K.length; i++) {
    if (K[i + 1] - K[i] > 1) push(knownNonces.get(K[i]), knownNonces.get(K[i + 1]), K[i] + 1, K[i + 1] - 1);
  }
  const top = K[K.length - 1];
  if (top < nonce - 1) push(knownNonces.get(top), toBlock, top + 1, nonce - 1);
  return { segments, unknown: nonce - K.length };
}

export function mergeRanges(ranges) {
  const sorted = ranges.map((r) => [r.from, r.to]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last.to + 1) last.to = Math.max(last.to, b);
    else out.push({ from: a, to: b });
  }
  return out;
}

export const rangeBlocks = (ranges) => ranges.reduce((s, r) => s + (r.to - r.from + 1), 0);

/** Adds time, reverted, createdAddress to txs. headers: Map block -> unix seconds. */
export async function enrichTxs(rpc, txs, headers = new Map()) {
  const need = [...new Set(txs.filter((t) => t.block !== null && !headers.has(t.block)).map((t) => t.block))];
  if (need.length) {
    const got = await rpc.batch(need.map((b) => ['eth_getBlockByNumber', [hex(b), false]]), { size: LOOKUP_BATCH, nonNull: true });
    need.forEach((b, i) => headers.set(b, Number(got[i].timestamp)));
  }
  const noReceipt = txs.filter((t) => t.block !== null && t.reverted === undefined);
  if (noReceipt.length) {
    const got = await rpc.batch(noReceipt.map((t) => ['eth_getTransactionReceipt', [t.hash]]), { size: LOOKUP_BATCH });
    noReceipt.forEach((t, i) => {
      const r = got[i];
      t.reverted = r ? Number(r.status) === 0 : null;
      t.createdAddress = r && r.contractAddress ? String(r.contractAddress).toLowerCase() : null;
    });
  }
  for (const t of txs) {
    if (t.block === null) continue;
    t.timestamp = headers.get(t.block);
    t.time = new Date(t.timestamp * 1000).toISOString().replace('.000Z', 'Z');
    t.contractCreation = t.to === null;
  }
  return txs;
}

export async function runLedger({
  rpc, wallets, fromBlock, toBlock, knownHashes, maxScanBlocks = DEFAULT_MAX_SCAN_BLOCKS,
  onPlan, onProgress, headers = new Map(),
}) {
  const started = Date.now();
  const list = [...new Set(wallets.map((w) => String(w).toLowerCase()))];
  const walletSet = new Set(list);

  // 1. nonces
  const nonceAt = {};
  const counts = await rpc.batch(list.map((w) => ['eth_getTransactionCount', [w, 'latest']]), { size: LOOKUP_BATCH, nonNull: true });
  list.forEach((w, i) => { nonceAt[w] = Number(counts[i]); });

  // 2. resolve every known hash once
  const hashes = [...new Set([...(knownHashes || [])].map((h) => String(h).toLowerCase()))];
  const resolved = new Map();
  const got = await rpc.batch(hashes.map((h) => ['eth_getTransactionByHash', [h]]), { size: LOOKUP_BATCH });
  hashes.forEach((h, i) => {
    const raw = got[i];
    if (!raw || String(raw.hash).toLowerCase() !== h) { resolved.set(h, { status: 'null' }); return; }
    const tx = normalizeTx(raw);
    resolved.set(h, { status: tx.block === null ? 'pending' : 'tx', tx });
  });
  const unresolvedHashes = [...resolved.values()].filter((r) => r.status === 'null').length;

  // 3. known nonces per wallet, then the plan
  const known = new Map(list.map((w) => [w, new Map()]));
  for (const r of resolved.values()) {
    if (r.status === 'tx' && walletSet.has(r.tx.from)) known.get(r.tx.from).set(r.tx.nonce, r.tx.block);
  }
  const segments = [];
  for (const w of list) {
    segments.push(...planWallet({ wallet: w, nonce: nonceAt[w], knownNonces: known.get(w), fromBlock, toBlock }).segments);
  }
  const gaps = mergeRanges(segments);
  const plannedBlocks = rangeBlocks(gaps);
  if (onPlan) await onPlan({ nonceAt, known, gaps, plannedBlocks, resolved });
  if (plannedBlocks > maxScanBlocks) throw new ScanCapError(plannedBlocks, maxScanBlocks);

  // 4. scan
  const found = new Map();
  const seenBlocks = new Set();
  const failed = [];
  const scanStarted = Date.now();
  const scanChunk = async (blocks) => {
    let res;
    try {
      res = await rpc.batch(blocks.map((b) => ['eth_getBlockByNumber', [hex(b), true]]), { size: blocks.length, nonNull: true });
    } catch {
      failed.push(...blocks);
      return;
    }
    blocks.forEach((b, i) => {
      const blk = res[i];
      if (!blk || Number(blk.number) !== b || !Array.isArray(blk.transactions) || blk.transactions.some((t) => typeof t !== 'object')) {
        failed.push(b);
        return;
      }
      seenBlocks.add(b);
      headers.set(b, Number(blk.timestamp));
      for (const raw of blk.transactions) {
        const from = String(raw.from).toLowerCase();
        if (!walletSet.has(from)) continue;
        const tx = normalizeTx(raw);
        tx.block = b;
        found.set(tx.hash, tx);
      }
    });
    if (onProgress) {
      const secs = (Date.now() - scanStarted) / 1000;
      onProgress({ scannedBlocks: seenBlocks.size, plannedBlocks, blocksPerSec: secs > 0 ? seenBlocks.size / secs : null });
    }
  };
  const remaining = (seg) => {
    const have = new Set();
    for (const t of found.values()) {
      if (t.from === seg.wallet && t.nonce >= seg.nonceLo && t.nonce <= seg.nonceHi) have.add(t.nonce);
    }
    return seg.nonceHi - seg.nonceLo + 1 - have.size;
  };
  const scanBlocks = async (blocks, seg) => {
    let i = 0;
    while (i < blocks.length) {
      if (seg && remaining(seg) <= 0) return; // every nonce of this segment is accounted for
      const width = Math.max(1, rpc.concurrency ? rpc.concurrency() : 2);
      const size = rpc.scanBatch ? rpc.scanBatch() : SCAN_BATCH;
      const round = [];
      for (let w = 0; w < width && i < blocks.length; w++, i += size) round.push(blocks.slice(i, i + size));
      await Promise.all(round.map(scanChunk));
    }
  };
  for (const seg of segments) {
    const blocks = [];
    for (let b = seg.from; b <= seg.to; b++) if (!seenBlocks.has(b)) blocks.push(b);
    await scanBlocks(blocks, seg);
  }
  // Chunks lost before the switch to the fallback get a second chance on it.
  if (failed.length && rpc.stats().fallbackUsed) {
    const again = [...new Set(failed)].filter((b) => !seenBlocks.has(b)).sort((a, b) => a - b);
    failed.length = 0;
    await scanBlocks(again, null);
  }
  const unscanned = [...new Set(failed)].filter((b) => !seenBlocks.has(b)).sort((a, b) => a - b);
  const unscannedRanges = mergeRanges(unscanned.map((b) => ({ from: b, to: b })));

  // 5. in-range txs of our wallets: from the known hashes plus the scan
  const inRange = new Map();
  for (const r of resolved.values()) {
    if (r.status === 'tx' && walletSet.has(r.tx.from) && r.tx.block >= fromBlock && r.tx.block <= toBlock) inRange.set(r.tx.hash, r.tx);
  }
  for (const t of found.values()) {
    if (t.block >= fromBlock && t.block <= toBlock && !inRange.has(t.hash)) inRange.set(t.hash, t);
  }
  const txs = [...inRange.values()].sort((a, b) => a.block - b.block || a.nonce - b.nonce);
  await enrichTxs(rpc, txs, headers);
  for (const w of list) for (const t of txs) if (t.from === w && t.nonce >= nonceAt[w]) nonceAt[w] = t.nonce + 1;

  return {
    nonceAt, resolved, txs, gaps, unscannedRanges,
    scannedBlocks: seenBlocks.size, plannedBlocks, unresolvedHashes, known,
    scanSeconds: seenBlocks.size ? (Date.now() - scanStarted) / 1000 : 0,
    scannedHashes: new Set(found.keys()), seconds: (Date.now() - started) / 1000,
  };
}
