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
async function firstAtOrAfter(reader, t, latest, latestTs, { hintLo = null, hintHi = null } = {}) {
  if (latestTs < t) return null;
  let hi = latest;
  if (hintHi !== null && hintHi < latest) {
    const [ts] = await reader.read([hintHi]);
    if (ts >= t) hi = hintHi;
  }
  const span = Math.ceil(((latestTs - t) / BLOCK_TIME) * 1.3) + 2;
  let lo = Math.max(0, latest - span);
  if (hintLo !== null && hintLo > lo && hintLo < hi) lo = hintLo;
  let [tsLo] = await reader.read([lo]);
  while (tsLo >= t && lo > 0) {
    hi = lo;
    lo = Math.max(0, lo - Math.max(1000, (latest - lo)));
    [tsLo] = await reader.read([lo]);
  }
  if (tsLo >= t) return lo; // lo == 0: t is before genesis
  let round = 0;
  while (hi - lo > 1) {
    // Block time is close to constant, so aim at the interpolated spot; every other round is even, so the worst case stays log9.
    const probes = [];
    const add = (p) => {
      const q = Math.floor(p);
      if (q > lo && q < hi && !probes.includes(q)) probes.push(q);
    };
    if (round++ % 2 === 0) {
      const [tsHi] = await reader.read([hi]);
      const est = lo + ((t - tsLo) / Math.max(1, tsHi - tsLo)) * (hi - lo);
      const d = Math.max(50, (hi - lo) / 40);
      for (const f of [-1, -0.2, -0.04, -0.008, 0.008, 0.04, 0.2, 1]) add(est + f * d);
      probes.sort((x, y) => x - y);
    }
    if (!probes.length) {
      const step = (hi - lo) / 9;
      for (let i = 1; i <= 8; i++) add(lo + step * i);
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
  } else if (startBlock === 0 && a < reader.cache.get(0)) {
    notes.push('session start is before block 0; clamped');
  }
  let endBlock;
  if (latestTs <= b) {
    endBlock = latest;
    notes.push('session still running or clock ahead');
  } else {
    const est = startBlock + Math.ceil(((b - a) / BLOCK_TIME) * 1.5) + 100;
    const first = await firstAtOrAfter(reader, b + 1, latest, latestTs, { hintLo: startBlock, hintHi: est });
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
