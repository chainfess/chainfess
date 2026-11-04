// Report JSON and text. Only whitelisted fields (BRIEF §3.5): command text, tool input and log excerpts never get here.
import { toChecksum } from './keccak.mjs';
import { STATUS } from './classify.mjs';
import { DEFAULT_RPC } from './rpc.mjs';

export const TOOL_VERSION = '0.1.0';
const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'));

export function weiToEth(wei) {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const STATUS_ORDER = [STATUS.UNACCOUNTED, STATUS.FOREIGN, STATUS.PARTIAL, STATUS.ACCOUNTED, STATUS.PRE, STATUS.POST, STATUS.PENDING, STATUS.OBSERVED, STATUS.RECENT];

export function buildReport(a, { demo = false, now = null } = {}) {
  const generated = now ?? Date.now();
  const rows = [...a.rows].sort((x, y) => STATUS_ORDER.indexOf(x.status) - STATUS_ORDER.indexOf(y.status) || (x.tx.block ?? Infinity) - (y.tx.block ?? Infinity) || x.tx.nonce - y.tx.nonce);
  const txs = rows.map((r) => ({
    hash: r.tx.hash,
    status: r.status,
    finding: r.finding,
    from: toChecksum(r.tx.from),
    to: r.tx.to ? toChecksum(r.tx.to) : null,
    toLabel: r.toLabel ?? null,
    nonce: r.tx.nonce,
    block: r.tx.block,
    time: r.tx.time ?? null,
    valueWei: r.tx.valueWei,
    valueEth: weiToEth(r.tx.valueWei),
    reverted: r.tx.reverted ?? null,
    contractCreation: r.tx.to === null,
    createdAddress: r.tx.createdAddress ? toChecksum(r.tx.createdAddress) : null,
    mentioned: r.mentioned,
    source: r.source ? { kind: r.source.kind, line: r.source.line } : { kind: null, line: null },
    pattern: r.pattern ?? null,
  }));
  const count = (s) => txs.filter((t) => t.status === s).length;
  const mine = rows.filter((r) => a.wallets.includes(r.tx.from));
  const mentioned = { final: 0, text: 0, none: 0 };
  for (const r of mine) mentioned[r.mentioned]++;
  const postDerived = a.walletRows.reduce((s, w) => s + w.uAfter, 0);
  const findings = txs.filter((t) => t.finding).length;
  const unscanned = a.ledger.unscannedRanges.map((r) => ({ from: r.from, to: r.to }));
  const exitCode = unscanned.length ? 4 : findings ? 1 : 0;
  const stats = a.stats;
  return {
    v: 1,
    tool: 'chainfess',
    toolVersion: TOOL_VERSION,
    demo,
    generatedAt: iso(generated),
    chainId: a.chainId,
    logs: {
      main: stats.main,
      subagents: stats.subagents,
      toolResults: stats.toolResults,
      broadcast: stats.broadcast,
      unreadableLines: a.sink.unreadableLines,
      otherOverlapping: a.otherCount,
      otherOverlappingFiles: a.otherNames,
      includedOtherSessions: stats.includedOther ?? 0,
      missingToolResults: stats.missingToolResults,
      skippedToolResults: stats.skippedToolResults,
      skippedBroadcast: stats.skippedBroadcast,
      broadcastTruncated: stats.broadcastTruncated,
      withheldCandidates: a.candidates.withheld,
      notLookedUp: a.candidates.notLookedUp,
      note: unreadableOutputsNote(stats),
    },
    session: {
      tStart: iso(a.tStartMs), tEnd: iso(a.tEndMs),
      startBlock: a.startBlock, endBlock: a.endBlock, blocks: a.endBlock - a.startBlock + 1,
      note: a.rangeNotes.length ? a.rangeNotes.join('; ') : null,
    },
    wallets: a.walletRows.map((w) => ({
      address: toChecksum(w.wallet), nonce: w.nonce, inLog: w.inLog, notInLog: w.notInLog,
      uIn: w.uIn, uOut: w.uOut, uAfter: w.uAfter, uBefore: w.uBefore, neverSent: w.neverSent,
    })),
    scan: {
      plannedBlocks: a.ledger.plannedBlocks, scannedBlocks: a.ledger.scannedBlocks,
      gaps: a.ledger.gaps.map((g) => ({ from: g.from, to: g.to })), unscanned,
      seconds: Math.round(a.ledger.seconds * 10) / 10, requests: a.rpcStats.requests,
      fallbackUsed: a.rpcStats.fallbackUsed,
    },
    summary: {
      findings,
      accounted: count(STATUS.ACCOUNTED), partial: count(STATUS.PARTIAL), unaccounted: count(STATUS.UNACCOUNTED),
      foreignSigner: count(STATUS.FOREIGN), preSession: count(STATUS.PRE), postSession: count(STATUS.POST) + postDerived,
      pending: count(STATUS.PENDING), recentOther: count(STATUS.RECENT), observed: count(STATUS.OBSERVED),
      unresolvedHashes: a.ledger.unresolvedHashes,
      mentioned,
    },
    txs,
    exitCode,
    verify: { rpc: a.usedDefaultRpc ? DEFAULT_RPC : null },
  };
}

function unreadableOutputsNote(stats) {
  const m = stats.missingToolResults;
  const s = stats.skippedToolResults;
  const b = stats.skippedBroadcast;
  if (!m && !s && !b && !stats.broadcastTruncated) return null;
  const parts = [];
  if (m) parts.push(`${m} saved tool output${m === 1 ? '' : 's'} missing from disk`);
  if (s) parts.push(`${s} saved tool output${s === 1 ? '' : 's'} over the 512 MB read limit`);
  if (b) parts.push(`${b} broadcast file${b === 1 ? '' : 's'} over 5 MB or not readable`);
  if (stats.broadcastTruncated) parts.push('broadcast search stopped at its directory limit');
  return `This log refers to outputs that could not be read: ${parts.join(', ')}. "not in this log" lines may be explained by those unreadable outputs.`;
}

// ---------- text ----------

const short = (h, a = 8, b = 6) => (h ? `${h.slice(0, a)}…${h.slice(-b)}` : '-');
const n = (x) => Number(x).toLocaleString('en-US');
const plural = (c, word) => `${c} ${word}${c === 1 ? '' : 's'}`;
const hhmmss = (isoTime) => (isoTime ? `${isoTime.slice(11, 19)} UTC` : '-');

function palette(color) {
  const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { bold: wrap('1'), dim: wrap('2'), red: wrap('1;31'), yellow: wrap('33'), green: wrap('32'), cyan: wrap('36'), inv: wrap('1;30;43') };
}

function span(report) {
  const { tStart, tEnd } = report.session;
  if (!tStart || !tEnd) return 'range set by flags';
  const d1 = tStart.slice(0, 10);
  const d2 = tEnd.slice(0, 10);
  return `${d1} ${tStart.slice(11, 16)}–${d2 === d1 ? '' : d2 + ' '}${tEnd.slice(11, 16)} UTC`;
}

function target(t) {
  if (t.contractCreation) return t.createdAddress ? `creates ${short(t.createdAddress, 6, 4)}` : 'creates a contract';
  const label = t.toLabel && t.toLabel !== 'eoa' ? ` (${t.toLabel})` : '';
  return `→ ${short(t.to, 6, 4)}${label}`;
}

function flags(t) {
  const f = [];
  if (t.reverted) f.push('reverted');
  return f.length ? `  [${f.join(', ')}]` : '';
}

function nonceLine(w, report) {
  if (w.neverSent) return `nonce 0: this wallet has never sent a transaction.`;
  const parts = [];
  if (w.uIn) parts.push(`${w.uIn} inside this session (below)`);
  const other = w.uOut - w.uAfter - w.uBefore;
  if (w.uBefore) parts.push(`${w.uBefore} before it`);
  if (w.uAfter) parts.push(`${w.uAfter} after it`);
  if (other > 0) parts.push(report.scan.unscanned.length ? `${other} not placed (unscanned ranges remain)` : `${other} outside it`);
  const tail = w.notInLog ? ` ${w.notInLog} do${w.notInLog === 1 ? 'es' : ''} not: ${parts.join(', ')}.` : ' All of them.';
  return `nonce ${w.nonce}: this wallet has sent ${w.nonce} tx. ${w.inLog} ${w.inLog === 1 ? "appears" : "appear"} in this log.${tail}`;
}

export function renderText(report, { color = false, quiet = false } = {}) {
  const c = palette(color);
  const lines = [];
  const tag = report.demo ? `${c.inv(' DEMO — fixture data ')} ` : '';
  const head = (s) => lines.push(tag + s);
  head(c.bold(`CHAINFESS AUDIT — chain ${report.chainId} — ${report.generatedAt.slice(0, 10)} ${report.generatedAt.slice(11, 16)} UTC`));
  const logBits = [];
  if (report.logs.subagents) logBits.push(plural(report.logs.subagents, 'subagent'));
  if (report.logs.toolResults) logBits.push(plural(report.logs.toolResults, 'saved output'));
  if (report.logs.broadcast) logBits.push(plural(report.logs.broadcast, 'broadcast file'));
  if (report.logs.includedOtherSessions) logBits.push(plural(report.logs.includedOtherSessions, 'other session'));
  const walletList = report.wallets.map((w) => short(w.address, 7, 4)).join(', ');
  head(`wallet ${walletList}   log ${report.logs.main.join(', ')}${logBits.length ? ` (+${logBits.join(', ')})` : ''}`);
  head(`session ${span(report)} → blocks ${n(report.session.startBlock)}–${n(report.session.endBlock)} (${n(report.session.blocks)} blocks)`);
  for (const w of report.wallets) head((report.wallets.length > 1 ? `${short(w.address, 7, 4)} ` : '') + nonceLine(w, report));
  const gaps = report.scan.gaps.length;
  head(report.scan.plannedBlocks
    ? `scanned ${n(report.scan.scannedBlocks)} blocks in ${plural(gaps, 'gap')} (${report.scan.seconds} s)`
    : 'scanned 0 blocks: the nonces in this log leave no gap inside the session');
  if (report.session.note) head(c.dim(`note: ${report.session.note}`));
  lines.push('');

  const by = (s) => report.txs.filter((t) => t.status === s);
  const findings = report.txs.filter((t) => t.finding);
  lines.push(findings.length ? c.red(`FINDINGS (${findings.length})`) : c.green('FINDINGS (0)'));
  for (const t of by(STATUS.UNACCOUNTED)) {
    lines.push(`  ${c.red('not in this log')}  ${t.hash}`);
    lines.push(c.dim(`    nonce ${t.nonce}  block ${n(t.block)}  ${hhmmss(t.time)}  ${t.valueEth} ETH ${target(t)}${flags(t)}`));
  }
  for (const t of by(STATUS.FOREIGN)) {
    lines.push(`  ${c.red('signed by a wallet not registered here')}  ${t.hash}`);
    lines.push(c.dim(`    from ${t.from}  pattern ${t.pattern}  ${t.source.kind} L${t.source.line}  block ${n(t.block)}  ${hhmmss(t.time)}${flags(t)}`));
  }
  if (!findings.length) {
    for (const w of report.wallets) {
      const anyMine = report.txs.some((t) => t.from === w.address && t.block !== null && t.block >= report.session.startBlock && t.block <= report.session.endBlock);
      if (!anyMine && !w.neverSent && !report.scan.unscanned.length) {
        lines.push(`  0 transactions from ${w.address} between blocks ${n(report.session.startBlock)}–${n(report.session.endBlock)} (${span(report)}). Nothing to reconcile.`);
      }
    }
  }

  const section = (title, list, row, paint = (s) => s) => {
    if (!list.length) return;
    lines.push(paint(`${title} (${list.length})`));
    for (const t of list) lines.push(`  ${row(t)}`);
  };
  const where = (t) => (t.source && t.source.kind ? `${t.source.kind}${t.source.line ? ` L${t.source.line}` : ''}${t.pattern ? ` (${t.pattern})` : ''}` : 'no source');
  if (!quiet) {
    section('PARTIAL MATCH ONLY', by(STATUS.PARTIAL), (t) => `${short(t.hash)}  nonce ${t.nonce}  partial form at ${where(t)}${flags(t)}`, c.yellow);
    section('ACCOUNTED', by(STATUS.ACCOUNTED), (t) => `${short(t.hash)}  nonce ${t.nonce}  ${where(t)}  mentioned: ${t.mentioned}${flags(t)}`, c.green);
    section('SENT BEFORE THIS SESSION, referenced in log', by(STATUS.PRE), (t) => `${short(t.hash)}  nonce ${t.nonce}  block ${n(t.block)}`, c.dim);
    section('SENT AFTER THIS SESSION', by(STATUS.POST), (t) => `${short(t.hash)}  nonce ${t.nonce}  block ${n(t.block)}`, c.dim);
    section('PENDING at audit time; re-run later', by(STATUS.PENDING), (t) => `${short(t.hash)}  nonce ${t.nonce}`, c.yellow);
    const observed = by(STATUS.OBSERVED);
    section('OTHER WALLETS referenced (read)', observed.slice(0, 8), (t) => `${short(t.hash)}  from ${short(t.from, 7, 4)}  ${where(t)}`, c.dim);
    if (observed.length > 8) lines.push(c.dim(`  … and ${observed.length - 8} more (--json lists them)`));
  } else if (report.summary.accounted) {
    lines.push(`accounted: ${report.summary.accounted}`);
  }
  const m = report.summary.mentioned;
  const total = m.final + m.text + m.none;
  if (!quiet && total) lines.push(c.dim(`the agent's own words mention ${m.final + m.text} of ${total} transactions`));
  const recent = by(STATUS.RECENT);
  if (recent.length) lines.push(c.dim(`other wallets' txs mined during a tool call; cannot tell a read from a send: ${recent.length} (--json lists them)`));

  lines.push('');
  for (const line of footer(report)) lines.push(c.dim(line));
  return lines.join('\n') + '\n';
}

function footer(report) {
  const out = [];
  const logs = report.logs;
  if (report.summary.unresolvedHashes) out.push(`${plural(report.summary.unresolvedHashes, 'hash').replace(/hashs/, 'hashes')} in the log ${report.summary.unresolvedHashes === 1 ? 'is' : 'are'} not a transaction on chain ${report.chainId}.`);
  if (logs.withheldCandidates) out.push(`${logs.withheldCandidates} 32-byte value${logs.withheldCandidates === 1 ? '' : 's'} next to a key word stayed on this machine, never sent to the RPC.`);
  if (logs.notLookedUp) out.push(`${logs.notLookedUp} hash candidates over the lookup limit were matched locally only.`);
  if (logs.unreadableLines) out.push(`${logs.unreadableLines} unreadable line${logs.unreadableLines === 1 ? '' : 's'} in the log; hex strings in them were still searched.`);
  if (logs.note) out.push(logs.note);
  if (report.wallets.some((w) => w.nonce > 0 && w.inLog === 0)) out.push('No hash of this wallet is in the log, so the whole session span was scanned.');
  if (report.scan.unscanned.length) out.push(`Unscanned block ranges: ${report.scan.unscanned.map((r) => `${r.from}–${r.to}`).join(', ')}. Txs in them are not listed; re-run.`);
  if (report.scan.fallbackUsed) out.push('The primary RPC failed; fallback RPC was used, about 15x slower.');
  if (report.summary.pending) out.push('Pending txs: re-run after inclusion.');
  if (logs.otherOverlapping) out.push(`${logs.otherOverlapping} other session log${logs.otherOverlapping === 1 ? '' : 's'} overlap${logs.otherOverlapping === 1 ? 's' : ''} this range (${logs.otherOverlappingFiles.slice(0, 3).join(', ')}${logs.otherOverlappingFiles.length > 3 ? ', …' : ''}); add them with --log or --all-sessions before drawing conclusions.`);
  if (report.summary.unaccounted) out.push('"not in this log" means exactly that. A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.');
  if (report.summary.foreignSigner) out.push('"signed by a wallet not registered here": the hash came out of a sending command, mined during that call, from a wallet you did not pass with --wallet.');
  out.push('Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.');
  const rpcFlag = report.verify && report.verify.rpc ? ` --rpc-url ${report.verify.rpc}` : ' --rpc-url $RPC_URL';
  const first = report.txs.find((t) => t.finding) || report.txs.find((t) => t.block !== null);
  const verify = [];
  if (first) verify.push(`cast tx ${first.hash}${rpcFlag}`);
  if (report.wallets[0]) verify.push(`cast nonce ${report.wallets[0].address}${rpcFlag}`);
  if (verify.length) out.push(`Verify: ${verify.join(' ; ')}`);
  return out;
}
