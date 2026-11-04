// The audit pipeline (BRIEF §3.2). Everything local except JSON-RPC reads through src/rpc.mjs.
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRpc, DEFAULT_RPC, FALLBACK_RPC, RpcUnavailableError, safeUrl } from './rpc.mjs';
import { runLedger, enrichTxs, ScanCapError, DEFAULT_MAX_SCAN_BLOCKS } from './ledger.mjs';
import { mapRange, MARGIN_END, MARGIN_START } from './blocks.mjs';
import { findProjectDir, newestLog, overlappingLogs, parseAll } from './parse.mjs';
import { classify, dumpCalls, mentionFlag, partialMatch, STATUS } from './classify.mjs';
import { addressOfKey } from './keccak.mjs';
import { buildReport } from './report.mjs';

export const CHAIN_ID = 4663;
export const SCAN_BLOCKS_PER_SEC = 160;
export const BLOCKS_PER_HOUR = 35000;
export const MAX_LOOKUPS = 20000;
const CONFIRM_ABOVE_SEC = 600;
const MAX_KEY_CHECKS = 5000;

export function formatDuration(sec) {
  const s = Math.ceil(sec);
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.ceil(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}
export class Declined extends Error {}

export function normalizeWallets(list) {
  const arr = (list || []).map((w) => String(w));
  if (!arr.length) throw new InputError('--wallet 0x… is required');
  for (const w of arr) if (!/^0x[0-9a-fA-F]{40}$/.test(w)) throw new InputError(`not a wallet address: ${w.slice(0, 44)}`);
  return [...new Set(arr.map((w) => w.toLowerCase()))];
}

function parseIso(s, flag) {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new InputError(`${flag} is not an ISO UTC time`);
  return t;
}
function parseBlockFlag(v, flag) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InputError(`${flag} is not a block number`);
  return n;
}

function resolveLogs(opts, cwd) {
  const given = (opts.logs || []).map((p) => resolve(cwd, p));
  for (const p of given) {
    if (!existsSync(p) || !statSync(p).isFile()) throw new InputError(`log not found: ${p}`);
  }
  if (given.length) return { logs: given, explicit: true };
  const { dir, lookedIn } = findProjectDir(cwd, opts.projectsDir);
  const newest = dir ? newestLog(dir) : null;
  if (!newest) throw new InputError(`no Claude Code session log for this directory; looked in ${lookedIn}. Pass --log <file>.`);
  return { logs: [newest], explicit: false };
}

/** Chooses which 32-byte values may be sent to an RPC. A value next to a key word, or that is the wallet's own key, is not. */
export function lookupCandidates(sink, wallets) {
  const walletSet = new Set(wallets);
  const out = [];
  let withheld = 0;
  let notLookedUp = 0;
  let checks = 0;
  for (const h of sink.hashes.keys()) {
    if (sink.keyLike.has(h)) { withheld++; continue; }
    if (checks++ < MAX_KEY_CHECKS) {
      const a = addressOfKey(h);
      if (a && walletSet.has(a)) { withheld++; continue; }
    }
    if (out.length >= MAX_LOOKUPS) { notLookedUp++; continue; }
    out.push(h);
  }
  return { hashes: out, withheld, notLookedUp };
}

function buildCtx(sink, walletSet, startBlock, endBlock) {
  return {
    wallets: walletSet, startBlock, endBlock, tEnd: sink.tEnd,
    occurrence: (hash) => {
      const rec = sink.hashes.get(hash);
      const bare = sink.bare.get(hash.slice(2));
      if (!rec && !bare) return null;
      return { ...(rec || { first: null, other: null }), bare: bare || null };
    },
    partial: (hash) => partialMatch(hash, sink.partials),
    tool: (id) => sink.tools.get(id) || null,
    finals: [...sink.finals.values()],
    textFull: sink.textFull,
    textPartials: sink.textPartials,
  };
}

/**
 * Runs everything but rendering. opts: wallets, logs, allSessions, rpc, chainId, from, to, fromBlock, toBlock, maxHours,
 * noSubagents, yes, cwd, fetchImpl, paceMs, sleep, confirm, progress, demo.
 */
export async function runAudit(opts) {
  const wallets = normalizeWallets(opts.wallets);
  const walletSet = new Set(wallets);
  const cwd = opts.cwd || process.cwd();
  const started = Date.now();
  const fromBlockFlag = parseBlockFlag(opts.fromBlock, '--from-block');
  const toBlockFlag = parseBlockFlag(opts.toBlock, '--to-block');
  const fromT = opts.from ? parseIso(opts.from, '--from') : null;
  const toT = opts.to ? parseIso(opts.to, '--to') : null;
  if (opts.maxHours !== undefined && opts.maxHours !== null && !(Number(opts.maxHours) > 0)) throw new InputError('--max-hours must be a positive number');
  const maxScanBlocks = opts.maxHours ? Math.ceil(Number(opts.maxHours) * BLOCKS_PER_HOUR) : DEFAULT_MAX_SCAN_BLOCKS;
  const progress = opts.progress || (() => {});
  const { logs: mainLogs, explicit } = resolveLogs(opts, cwd);

  // Local parse first: a bad log must not cost a single request.
  let { sink, stats } = await parseAll({
    mainLogs, includeSubagents: !opts.noSubagents, cwd: opts.noBroadcast ? null : cwd,
    maxToolResultBytes: opts.maxToolResultBytes, maxLineChars: opts.maxLineChars,
    onBytes: opts.onBytes,
  });
  if (sink.validEntries === 0 && sink.unreadableLines > 0) throw new InputError(`no readable entries in the log (${sink.unreadableLines} unreadable lines)`);
  const hasExplicitRange = (fromBlockFlag !== null || fromT !== null) && (toBlockFlag !== null || toT !== null);
  if (sink.tStart === null && !hasExplicitRange) throw new InputError('log has no timestamped entries; pass --from/--to or --from-block/--to-block');

  const tStartMs = fromT ?? sink.tStart;
  const tEndMs = toT ?? sink.tEnd;

  // Other sessions of the same project that overlap this span.
  let otherLogs = [];
  if (tStartMs !== null && tEndMs !== null) otherLogs = overlappingLogs(mainLogs, tStartMs, tEndMs);
  let otherCount = otherLogs.length;
  let otherNames = otherLogs.map((p) => basename(p));
  if (opts.allSessions && otherLogs.length) {
    // Evidence only: the audited span stays the span of the logs asked for.
    ({ sink, stats } = await parseAll({
      mainLogs, evidenceLogs: otherLogs, includeSubagents: !opts.noSubagents, cwd: opts.noBroadcast ? null : cwd,
      maxToolResultBytes: opts.maxToolResultBytes, maxLineChars: opts.maxLineChars, onBytes: opts.onBytes,
    }));
    otherCount = 0;
    otherNames = [];
    stats.includedOther = otherLogs.length;
  }

  // Preflight.
  const chainId = opts.chainId !== undefined && opts.chainId !== null ? Number(opts.chainId) : CHAIN_ID;
  if (opts.chainId !== undefined && opts.chainId !== null && !Number.isInteger(chainId)) throw new InputError('--chain-id is not a number');
  if (opts.chainId !== undefined && opts.chainId !== null && !opts.rpc) throw new InputError('--chain-id needs --rpc');
  const url = opts.rpc || DEFAULT_RPC;
  const fallbackUrl = opts.rpc ? null : (opts.fallback === false ? null : FALLBACK_RPC);
  const rpc = createRpc({ url, fallbackUrl, chainId, fetchImpl: opts.fetchImpl, paceMs: opts.paceMs ?? 300, sleep: opts.sleep });
  let latest;
  let latestTs;
  try {
    const got = await rpc.call('eth_chainId', [], { quick: true });
    if (Number(got) !== chainId) {
      throw new InputError(`the RPC at ${safeUrl(rpc.url || url)} is on chain ${Number(got)}, expected ${chainId}. Use --rpc <url> --chain-id <n> to audit another chain.`);
    }
    latest = Number(await rpc.call('eth_blockNumber', [], { quick: true }));
    const head = await rpc.call('eth_getBlockByNumber', ['0x' + latest.toString(16), false], { quick: true });
    if (!head) throw new RpcUnavailableError('no latest block');
    latestTs = Number(head.timestamp);
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new RpcUnavailableError(`RPC unavailable: tried ${[url, fallbackUrl].filter(Boolean).map(safeUrl).join(' and ')}. Pass --rpc <url> to use another endpoint.`);
  }

  // Blocks.
  const headers = new Map();
  let startBlock = fromBlockFlag;
  let endBlock = toBlockFlag;
  let rangeNotes = [];
  if (startBlock === null || endBlock === null) {
    const effectiveStart = tStartMs ?? tEndMs;
    const effectiveEnd = tEndMs ?? tStartMs;
    const mapped = await mapRange({
      rpc, tStartMs: effectiveStart, tEndMs: effectiveEnd, latest, latestTs, cache: headers,
      marginStart: fromT === null ? MARGIN_START : 0, marginEnd: toT === null ? MARGIN_END : 0,
    });
    if (startBlock === null) startBlock = mapped.startBlock;
    if (endBlock === null) endBlock = mapped.endBlock;
    rangeNotes = mapped.notes;
  }
  if (endBlock > latest) endBlock = latest;
  if (startBlock > endBlock) throw new InputError(`block range is empty: ${startBlock} to ${endBlock}`);

  // Ledger.
  const candidates = lookupCandidates(sink, wallets);
  const onPlan = async ({ plannedBlocks, gaps }) => {
    const estimate = Math.ceil(plannedBlocks / SCAN_BLOCKS_PER_SEC);
    progress(`scan plan: ${plannedBlocks.toLocaleString('en-US')} blocks in ${gaps.length} gap${gaps.length === 1 ? '' : 's'}, about ${formatDuration(estimate)} at the public RPC's measured rate`);
    if (plannedBlocks > maxScanBlocks) return; // the ledger refuses with the numbers
    if (estimate > CONFIRM_ABOVE_SEC && !opts.yes) {
      const ok = opts.confirm ? await opts.confirm(`Estimated scan is over 10 minutes (about ${formatDuration(estimate)}). Continue?`) : false;
      if (!ok) throw new Declined(`scan needs confirmation (${plannedBlocks} blocks, about ${formatDuration(estimate)}); pass --yes`);
    }
  };
  let ledger;
  try {
    ledger = await runLedger({
      rpc, wallets, fromBlock: startBlock, toBlock: endBlock, knownHashes: candidates.hashes,
      maxScanBlocks, onPlan, headers,
      onProgress: ({ scannedBlocks, plannedBlocks, blocksPerSec }) => {
        const rate = blocksPerSec ? `, ${Math.round(blocksPerSec)} blocks/s measured, about ${formatDuration((plannedBlocks - scannedBlocks) / blocksPerSec)} left at most` : '';
        progress(`scanned ${scannedBlocks.toLocaleString('en-US')} / ${plannedBlocks.toLocaleString('en-US')} blocks${rate}`, true);
      },
    });
  } catch (e) {
    if (e instanceof ScanCapError) {
      const hours = Math.ceil(e.planned / BLOCKS_PER_HOUR);
      throw new InputError(`refusing: this audit would scan ${e.planned} blocks, over the cap of ${e.cap}. To allow it: --max-hours ${hours}. To scan less: --from-block <n> --to-block <n>.`);
    }
    throw e;
  }

  // Classify.
  const ctx = buildCtx(sink, walletSet, startBlock, endBlock);
  const items = new Map();
  for (const t of ledger.txs) items.set(t.hash, t);
  const others = [];
  for (const [hash, r] of ledger.resolved) {
    if (r.status === 'null' || items.has(hash)) continue;
    others.push(r.tx);
    items.set(hash, r.tx);
  }
  await enrichForeign(rpc, others, headers);
  ctx.dumps = dumpCalls([...items.values()].filter((t) => t.block !== null), ctx);

  const rows = [];
  for (const t of items.values()) {
    const res = classify(t, ctx);
    rows.push({ tx: t, ...res, mentioned: mentionFlag(t.hash, ctx) });
  }
  await labelTargets(rpc, rows, opts.tokenAddress);

  // The header numbers of §2.2.5, with what the scan learned.
  const walletRows = wallets.map((w) => summarizeWallet(w, ledger, rows, ctx, startBlock, endBlock));

  const seconds = (Date.now() - started) / 1000;
  const reqs = rpc.stats();
  return {
    wallets, chainId, rows, walletRows, ledger, stats, sink, candidates, startBlock, endBlock, tStartMs, tEndMs,
    rangeNotes, otherCount, otherNames, rpcStats: reqs, seconds, usedDefaultRpc: !opts.rpc, explicitLogs: explicit, kEmpty: walletRows.some((w) => w.inLog === 0 && w.nonce > 0),
    mainLogs,
  };
}

async function enrichForeign(rpc, others, headers) {
  const mined = others.filter((t) => t.block !== null);
  // A block dump can print thousands of third-party txs; timestamps are needed for the window, receipts only when few.
  const manyRecent = mined.length > 200;
  if (manyRecent) for (const t of mined) t.reverted = null;
  await enrichTxs(rpc, mined, headers);
}

async function labelTargets(rpc, rows, tokenAddress) {
  const token = tokenAddress ? String(tokenAddress).toLowerCase() : null;
  const need = [...new Set(rows
    .filter((r) => r.status !== STATUS.RECENT && r.tx.to && r.tx.to !== token)
    .map((r) => r.tx.to))];
  const codes = new Map();
  if (need.length) {
    const got = await rpc.batch(need.map((a) => ['eth_getCode', [a, 'latest']]), { size: 50 });
    need.forEach((a, i) => codes.set(a, got[i]));
  }
  for (const r of rows) {
    const to = r.tx.to;
    if (!to) r.toLabel = null;
    else if (to === token) r.toLabel = 'token';
    else if (!codes.has(to)) r.toLabel = null;
    else r.toLabel = codes.get(to) && codes.get(to) !== '0x' ? 'contract' : 'eoa';
  }
}

/** u_in, u_out and, when the nonce order settles it, how many of u_out are after the session. */
export function summarizeWallet(wallet, ledger, rows, ctx, startBlock, endBlock) {
  const nonce = ledger.nonceAt[wallet] ?? 0;
  const mine = rows.filter((r) => r.tx.from === wallet && r.tx.block !== null && r.tx.nonce < nonce);
  const inLogNonces = new Set();
  const inRangeNotInLog = new Set();
  for (const r of mine) {
    const occ = ctx.occurrence(r.tx.hash);
    if (occ) inLogNonces.add(r.tx.nonce);
    else if (r.tx.block >= startBlock && r.tx.block <= endBlock) inRangeNotInLog.add(r.tx.nonce);
  }
  const inLog = inLogNonces.size;
  const notInLog = Math.max(0, nonce - inLog);
  const uIn = inRangeNotInLog.size;
  const uOut = Math.max(0, notInLog - uIn);
  let uAfter = 0;
  let uBefore = 0;
  if (ledger.unscannedRanges.length === 0 && uOut > 0) {
    const inside = mine.filter((r) => r.tx.block >= startBlock && r.tx.block <= endBlock).map((r) => r.tx.nonce);
    const below = mine.filter((r) => r.tx.block < startBlock).map((r) => r.tx.nonce);
    const above = mine.filter((r) => r.tx.block > endBlock).map((r) => r.tx.nonce);
    const seen = new Set(mine.map((r) => r.tx.nonce));
    const loIn = inside.length ? Math.min(...inside) : null;
    const hiIn = inside.length ? Math.max(...inside) : null;
    const hiBelow = below.length ? Math.max(...below) : null;
    const loAbove = above.length ? Math.min(...above) : null;
    const countFree = (a, b) => { // nonces in [a, b] with no known tx
      let c = 0;
      for (const n of seen) if (n >= a && n <= b) c++;
      return Math.max(0, b - a + 1 - c);
    };
    if (loIn !== null) {
      uBefore = countFree(0, loIn - 1);
      uAfter = countFree(hiIn + 1, nonce - 1);
    } else {
      if (hiBelow !== null && loAbove === null) {
        uBefore = countFree(0, hiBelow);
        uAfter = countFree(hiBelow + 1, nonce - 1);
      } else if (loAbove !== null && hiBelow === null) {
        uBefore = countFree(0, loAbove - 1);
        uAfter = countFree(loAbove, nonce - 1);
      } else if (hiBelow !== null && loAbove !== null) {
        uBefore = countFree(0, hiBelow);
        uAfter = countFree(loAbove, nonce - 1);
      }
    }
  }
  return { wallet, nonce, inLog, notInLog, uIn, uOut, uAfter, uBefore, neverSent: nonce === 0 };
}

/** What `chainfess sign` posts (§3.1). Only hashes that resolved to txs of these wallets; never other candidates, never the log. */
export async function prepareAudit(opts) {
  const a = await runAudit(opts);
  const hashes = a.rows
    .filter((r) => r.status === STATUS.ACCOUNTED && a.wallets.includes(r.tx.from))
    .map((r) => r.tx.hash);
  return {
    wallets: a.wallets, fromBlock: a.startBlock, toBlock: a.endBlock, hashes, logSha256: a.stats.logSha256,
  };
}

export async function auditReport(opts) {
  const a = await runAudit(opts);
  return { report: buildReport(a, { demo: !!opts.demo, now: opts.now }), audit: a };
}
