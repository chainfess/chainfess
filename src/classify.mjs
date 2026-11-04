// The ten rows of BRIEF §2.3. Pure. Only rows 6 and 7 are findings.
export const STATUS = {
  PRE: 'pre-session', POST: 'post-session', PENDING: 'pending', ACCOUNTED: 'accounted', PARTIAL: 'partial',
  UNACCOUNTED: 'unaccounted', FOREIGN: 'foreign-signer', RECENT: 'recent-other', OBSERVED: 'observed',
};

export const WINDOW_BEFORE_MS = 5000;
export const WINDOW_AFTER_MS = 60000;

/** W(id) of §2.1. An unmatched tool_use runs to the end of the session. */
export function inWindow(tool, timestampSec, tEndMs) {
  if (!tool || tool.start === null || tool.start === undefined || timestampSec === null || timestampSec === undefined) return false;
  const t = timestampSec * 1000;
  const end = tool.end !== null && tool.end !== undefined ? tool.end + WINDOW_AFTER_MS : tEndMs;
  return t >= tool.start - WINDOW_BEFORE_MS && t <= end;
}

/** Earliest structured occurrence; a tool_result occurrence is what can tie a tx to a tool call. */
function toolOccurrence(occ) {
  if (occ && occ.first && occ.first.toolId && (occ.first.kind === 'tool_result' || occ.first.kind === 'tool-results')) return occ.first;
  return null;
}

/**
 * A sending pattern explains the call's own send, not everything its output prints.
 * `cast send … && cast block latest` must not turn a block dump into findings, so a call is left out of
 * row 7 when its output prints a tx of a registered wallet (that is the send) or txs of more than two senders.
 */
export function dumpCalls(items, ctx) {
  const senders = new Map();
  const own = new Set();
  for (const t of items) {
    const occ = toolOccurrence(ctx.occurrence(t.hash));
    if (!occ) continue;
    const tool = ctx.tool(occ.toolId);
    if (!tool || !inWindow(tool, t.timestamp, ctx.tEnd)) continue;
    if (ctx.wallets.has(t.from)) { own.add(occ.toolId); continue; }
    if (!senders.has(occ.toolId)) senders.set(occ.toolId, new Set());
    senders.get(occ.toolId).add(t.from);
  }
  const out = new Set(own);
  for (const [id, set] of senders) if (set.size > 2) out.add(id);
  return out;
}

export function classify(tx, ctx) {
  const mine = ctx.wallets.has(tx.from);
  const occ = ctx.occurrence(tx.hash);
  const row = (status, extra = {}) => ({ status, finding: status === STATUS.UNACCOUNTED || status === STATUS.FOREIGN, source: null, pattern: null, ...extra });

  if (mine && tx.block !== null && tx.block < ctx.startBlock) return row(STATUS.PRE, sourceOf(occ, ctx));
  if (tx.block !== null && tx.block > ctx.endBlock) return row(STATUS.POST, sourceOf(occ, ctx));
  if (tx.block === null) return row(STATUS.PENDING, sourceOf(occ, ctx));

  if (mine) {
    if (occ && (occ.first || occ.other || occ.broadcast || occ.bare)) return row(STATUS.ACCOUNTED, sourceOf(occ, ctx));
    const part = ctx.partial(tx.hash);
    if (part) return row(STATUS.PARTIAL, { source: { kind: displayKind(part), line: part.line }, pattern: null });
    return row(STATUS.UNACCOUNTED);
  }

  const toolOcc = toolOccurrence(occ);
  const src = sourceOf(occ, ctx);
  if (toolOcc) {
    const tool = ctx.tool(toolOcc.toolId);
    if (inWindow(tool, tx.timestamp, ctx.tEnd)) {
      const isDump = ctx.dumps && ctx.dumps.has(toolOcc.toolId);
      if (tool.pattern && !isDump) return row(STATUS.FOREIGN, { ...src, pattern: tool.pattern });
      return row(STATUS.RECENT, src);
    }
  }
  return row(STATUS.OBSERVED, src);
}

function displayKind(o) {
  if (o.origin === 'subagent') return 'subagent';
  if (o.kind === 'other') return 'text';
  return o.kind;
}

function sourceOf(occ, ctx) {
  if (!occ) return { source: null, pattern: null };
  const o = occ.first || occ.other || occ.bare || occ.broadcast;
  if (!o) return { source: null, pattern: null };
  const tool = o.toolId ? ctx.tool(o.toolId) : null;
  return { source: { kind: displayKind(o), line: o.line }, pattern: tool && tool.pattern ? tool.pattern : null };
}

/** mentioned-in-text flag of §2.4. Display only, never a status. */
export function mentionFlag(hash, ctx) {
  const matches = (set) => {
    for (const key of set) {
      const [p, s] = key.split('|');
      if (hash.startsWith('0x' + p) && (!s || hash.endsWith(s))) return true;
    }
    return false;
  };
  for (const f of ctx.finals) if (f && (f.full.has(hash) || matches(f.partials))) return 'final';
  if (ctx.textFull.has(hash) || matches(ctx.textPartials)) return 'text';
  return 'none';
}

/** Prefix and suffix, or an 8+ hex prefix when the log gave no suffix. */
export function partialMatch(hash, partials) {
  for (const [key, occ] of partials) {
    const [p, s] = key.split('|');
    if (!hash.startsWith('0x' + p)) continue;
    if (s ? hash.endsWith(s) : p.length >= 8) return occ;
  }
  return null;
}
