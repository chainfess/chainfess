// JSON-RPC client (BRIEF §3.4). The only HTTP client in the audit path.
export const DEFAULT_RPC = 'https://robinhood-rpc.publicnode.com';
export const FALLBACK_RPC = 'https://robinhood.drpc.org';

export class RpcUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'RpcUnavailableError'; }
}

const USER_AGENT = 'chainfess/0.1';
const THROTTLE_STATUS = new Set([429, 502, 503]);
const THROTTLE_CODES = new Set([-32005, -32029, -32603]);
const SIZE_STEPS = [100, 50, 25, 10];

class Throttle extends Error {}

function isThrottleError(err) {
  if (!err || typeof err !== 'object') return false;
  return THROTTLE_CODES.has(err.code) && /rate|limit|too many/i.test(String(err.message || ''));
}

/** origin only, so a key in a custom RPC URL path or query is never printed */
export function safeUrl(url) {
  try { return new URL(url).origin; } catch { return '(invalid url)'; }
}

export function createRpc({
  url, fallbackUrl = null, chainId, fetchImpl, onRequest,
  paceMs = 300, tries = 6, timeoutMs = 20000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
}) {
  const doFetch = (...a) => (fetchImpl || globalThis.fetch)(...a);
  const state = {
    url, single: false, fallbackUsed: false, requests: 0, byMethod: {},
    failedInARow: 0, id: 0,
    maxInFlight: 2, inFlight: 0, successes: 0, spacing: paceMs, lastStart: 0, waiters: [],
  };

  async function acquire() {
    while (state.inFlight >= state.maxInFlight) await new Promise((r) => state.waiters.push(r));
    state.inFlight++;
    const gap = state.lastStart + state.spacing - Date.now();
    state.lastStart = Math.max(Date.now(), state.lastStart + state.spacing);
    if (gap > 0) await sleep(gap);
  }
  function release() {
    state.inFlight--;
    const w = state.waiters.shift();
    if (w) w();
  }
  function noteSuccess() {
    state.successes++;
    if (state.successes >= 20) {
      state.successes = 0;
      state.maxInFlight = Math.min(3, state.maxInFlight + 1);
      state.spacing = Math.max(state.single ? 170 : paceMs, Math.floor(state.spacing / 2));
    }
  }
  function noteThrottle() {
    state.successes = 0;
    if (state.maxInFlight > 1) state.maxInFlight = 1;
    else state.spacing = Math.min(8000, Math.max(state.spacing, 150) * 2);
  }

  /** One HTTP POST. Returns results aligned with items; throws on any failure. */
  async function post(items) {
    await acquire();
    try {
      const reqs = items.map(([method, params]) => ({ jsonrpc: '2.0', id: ++state.id, method, params: params ?? [] }));
      state.requests++;
      for (const r of reqs) state.byMethod[r.method] = (state.byMethod[r.method] || 0) + 1;
      if (onRequest) onRequest({ method: reqs[0].method, count: reqs.length });
      const body = JSON.stringify(reqs.length === 1 ? reqs[0] : reqs);
      const res = await doFetch(state.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (THROTTLE_STATUS.has(res.status)) throw new Throttle(`HTTP ${res.status}`);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length < reqs.length) throw new Throttle('fewer results than requested');
      const byId = new Map(arr.map((x) => [x && x.id, x]));
      const out = [];
      for (const r of reqs) {
        const x = byId.get(r.id);
        if (!x) throw new Throttle('missing result');
        if (x.error) {
          if (isThrottleError(x.error)) throw new Throttle('rpc rate limit');
          throw new Error(`rpc error ${x.error.code}`);
        }
        out.push(x.result === undefined ? null : x.result);
      }
      noteSuccess();
      return out;
    } catch (e) {
      if (e instanceof Throttle) noteThrottle();
      throw e;
    } finally {
      release();
    }
  }

  async function switchToFallback() {
    if (state.single || !fallbackUrl) return false;
    state.url = fallbackUrl;
    state.single = true;
    state.fallbackUsed = true;
    state.spacing = Math.max(state.spacing, 170); // <= 6 r/s
    state.maxInFlight = 1;
    state.failedInARow = 0;
    try {
      if (chainId != null) {
        const [got] = await post([['eth_chainId', []]]);
        if (Number(got) !== Number(chainId)) throw new Error('fallback is on another chain');
      }
    } catch {
      fallbackDead = true;
    }
    return !fallbackDead;
  }
  let fallbackDead = false;

  const backoff = (k) => sleep(Math.min(32000, 1000 * 2 ** k) + random() * 500);

  /** Runs items with retry and shrinking batches. Throws when out of tries. */
  async function attempt(items, { size, nonNull, maxTries }) {
    const results = new Array(items.length);
    let pending = items.map((_, i) => i);
    let failures = 0;
    let cur = Math.min(size, Math.max(items.length, 1));
    const limit = maxTries ?? tries;
    while (pending.length) {
      const chunkSize = state.single ? 1 : cur;
      const idx = pending.slice(0, chunkSize);
      try {
        const got = await post(idx.map((i) => items[i]));
        if (nonNull && got.some((x) => x === null)) {
          for (let j = 0; j < idx.length; j++) if (got[j] !== null) results[idx[j]] = got[j];
          pending = pending.filter((i) => results[i] === undefined || results[i] === null);
          throw new Throttle('null in a range the chain has passed');
        }
        for (let j = 0; j < idx.length; j++) results[idx[j]] = got[j];
        pending = pending.slice(idx.length);
      } catch (e) {
        failures++;
        if (e instanceof Throttle) noteThrottle();
        if (failures >= limit) throw e;
        if (failures >= 3) {
          const next = SIZE_STEPS.find((s) => s < cur);
          if (next) cur = next;
        }
        await backoff(failures - 1);
      }
    }
    return results;
  }

  async function run(items, opts) {
    if (!items.length) return [];
    for (;;) {
      if (fallbackDead) throw new RpcUnavailableError('all RPC endpoints failed');
      try {
        const out = await attempt(items, opts);
        state.failedInARow = 0;
        return out;
      } catch (e) {
        state.failedInARow++;
        const quick = opts.quick || state.failedInARow >= 3;
        if (quick && !state.single && fallbackUrl) {
          if (await switchToFallback()) continue;
        }
        throw new RpcUnavailableError(e && e.message ? e.message : 'rpc failed');
      }
    }
  }

  return {
    /** `quick`: used by preflight, gives up on the primary after 2 tries. */
    async call(method, params, { quick = false } = {}) {
      const [r] = await run([[method, params]], { size: 1, quick, maxTries: quick ? 2 : undefined });
      return r;
    },
    /** nonNull: a null result counts as a failed try (block we know exists). */
    async batch(list, { size = 50, nonNull = false, quick = false } = {}) {
      const out = [];
      for (let i = 0; i < list.length; i += size) {
        const part = list.slice(i, i + size);
        out.push(...await run(part, { size, nonNull, quick, maxTries: quick ? 2 : undefined }));
      }
      return out;
    },
    stats: () => ({ requests: state.requests, fallbackUsed: state.fallbackUsed, byMethod: { ...state.byMethod } }),
    concurrency: () => state.maxInFlight,
  };
}
