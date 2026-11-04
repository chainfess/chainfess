// Timestamp to block mapping (BRIEF §3.3). k-ary search with 8 probes per request.
export const BLOCK_TIME = 0.104;
export const MARGIN_START = 30;
export const MARGIN_END = 120;
const WIDEN = 200;

export class PrunedError extends Error {
  constructor(oldestSeen) {
    super(`the RPC does not serve blocks that old (oldest seen ${oldestSeen})`);
    this.name = 'PrunedError';
    this.oldestSeen = oldestSeen;
  }
}

const hex = (n) => '0x' + n.toString(16);

export function createHeaderReader(rpc, cache = new Map()) {
  let oldest = Infinity;
  const state = { nonMonotonic: false };
  async function read(ns) {
    const need = [...new Set(ns)].filter((n) => !cache.has(n));
    if (need.length) {
      const res = await rpc.batch(need.map((n) => ['eth_getBlockByNumber', [hex(n), false]]), { size: 8 });
      need.forEach((n, i) => {
        if (!res[i]) throw new PrunedError(oldest === Infinity ? 'none' : oldest);
        oldest = Math.min(oldest, n);
        cache.set(n, Number(res[i].timestamp));
      });
    }
    return ns.map((n) => cache.get(n));
  }
  return { read, state, cache };
}

/** First block with timestamp >= t, searching (lo, hi] where ts(hi) >= t. Returns null if t is past latest. */
async function firstAtOrAfter(reader, t, latest, latestTs, hintHi = null) {
  if (latestTs < t) return null;
  let hi = latest;
  if (hintHi !== null && hintHi < latest) {
    const [ts] = await reader.read([hintHi]);
    if (ts >= t) hi = hintHi;
  }
  const span = Math.ceil(((latestTs - t) / BLOCK_TIME) * 1.3) + 2;
  let lo = Math.max(0, latest - span);
  let [tsLo] = await reader.read([lo]);
  while (tsLo >= t && lo > 0) {
    hi = lo;
    lo = Math.max(0, lo - Math.max(1000, (latest - lo)));
    [tsLo] = await reader.read([lo]);
  }
  if (tsLo >= t) return lo; // lo == 0: t is before genesis
  while (hi - lo > 1) {
    const step = (hi - lo) / 9;
    const probes = [];
    for (let i = 1; i <= 8; i++) {
      const p = Math.floor(lo + step * i);
      if (p > lo && p < hi && !probes.includes(p)) probes.push(p);
    }
    if (!probes.length) break;
    const ts = await reader.read(probes);
    let seq = tsLo;
    let nextLo = lo;
    let nextHi = hi;
    let settled = false;
    for (let i = 0; i < probes.length; i++) {
      if (ts[i] < seq) reader.state.nonMonotonic = true;
      seq = ts[i];
      if (!settled) {
        if (ts[i] >= t) { nextHi = probes[i]; settled = true; } else { nextLo = probes[i]; tsLo = ts[i]; }
      }
    }
    lo = nextLo;
    hi = nextHi;
  }
  return hi;
}

/**
 * tStartMs/tEndMs: session span in ms. Returns inclusive blocks and notes.
 * margins:false means the times were given explicitly by --from/--to.
 */
export async function mapRange({ rpc, tStartMs, tEndMs, latest, latestTs, cache, margins = true }) {
  const reader = createHeaderReader(rpc, cache);
  reader.cache.set(latest, latestTs);
  const notes = [];
  const a = Math.ceil(tStartMs / 1000 - (margins ? MARGIN_START : 0));
  const b = Math.floor(tEndMs / 1000 + (margins ? MARGIN_END : 0));
  let startBlock = await firstAtOrAfter(reader, a, latest, latestTs);
  if (startBlock === null) {
    notes.push('session starts after the latest block; clock ahead');
    startBlock = latest;
  } else if (startBlock === 0 && reader.cache.get(0) >= a && a < reader.cache.get(0)) {
    notes.push('session start is before block 0; clamped');
  }
  let endBlock;
  if (latestTs <= b) {
    endBlock = latest;
    notes.push('session still running or clock ahead');
  } else {
    const est = startBlock + Math.ceil(((b - a) / BLOCK_TIME) * 1.5) + 100;
    const first = await firstAtOrAfter(reader, b + 1, latest, latestTs, est);
    endBlock = first === null ? latest : Math.max(startBlock, first - 1);
    if (first === 0) { endBlock = 0; notes.push('session end is before block 0; clamped'); }
  }
  if (reader.state.nonMonotonic) {
    startBlock = Math.max(0, startBlock - WIDEN);
    endBlock = Math.min(latest, endBlock + WIDEN);
    notes.push('block timestamps not in order near this range; range widened by 200 blocks each side');
  }
  return { startBlock, endBlock, notes };
}
