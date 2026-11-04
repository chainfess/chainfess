// Claude Code log parsing (BRIEF §2.1, SPIKE). Streaming, memory bounded.
// Command text and free text are read here and never retained: only hex tokens, numbers and pattern names leave.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

export const MAX_TOOL_RESULT_BYTES = 512 * 1024 * 1024;
export const MAX_LINE_CHARS = 16 * 1024 * 1024;
const MAX_BROADCAST_BYTES = 5 * 1024 * 1024;
const MAX_BARE = 200000;
const MAX_PARTIAL = 100000;
const OVERLAP = 512;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.ico', '.heic', '.avif']);

const FULL_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const BARE_RE = /(?<![0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const PARTIAL_RE = /0x([0-9a-fA-F]{4,20})(?:…|\.{2,3}|\\u2026)(?:([0-9a-fA-F]{4,8})(?![0-9a-fA-F.]))?/g;
// A 32-byte value next to one of these words is treated as a possible private key and never sent to any RPC.
const KEY_CONTEXT_RE = /(priv(ate)?[\s_\-]?key|privkey|secret|mnemonic|seed|signing[\s_\-]?key|_key\b|\bkey\b|--key|\bpk\b|wallet\s*\(|signer\s*\(|account\s*\()[^0-9a-fA-F]{0,32}(\(\d+\)\s*)?["'`]?$/i;

const PATTERNS = [
  ['cast-send', (c) => /\bcast\s+send\b/.test(c)],
  ['cast-publish', (c) => /\bcast\s+publish\b/.test(c) || /\bcast\s+mktx\b/.test(c)],
  ['forge-broadcast', (c) => /\bforge\s+script\b[\s\S]*--broadcast/.test(c)],
  ['forge-create', (c) => /\bforge\s+create\b/.test(c)],
  ['raw-rpc', (c) => /eth_sendRawTransaction|eth_sendTransaction/.test(c)],
  ['script-with-key', (c) => /(^|[^\w-])(node|npx|bun|deno|python3?|ts-node|tsx)\b/.test(c) && /--private-key|PRIVATE_KEY|MNEMONIC/.test(c)],
];

/** Pure. Returns a pattern name or null; the input is not retained. */
export function sendingPattern(toolName, input) {
  if (toolName !== 'Bash' && toolName !== 'bash') return null;
  let cmd = '';
  if (input && typeof input.command === 'string') cmd = input.command;
  else if (input !== undefined) cmd = JSON.stringify(input);
  for (const [name, test] of PATTERNS) if (test(cmd)) return name;
  return null;
}

export function slugOf(path) {
  return path.replace(/[^A-Za-z0-9-]/g, '-');
}

export function claudeProjectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(base, 'projects');
}

function readHead(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally { closeSync(fd); }
}
function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(size, bytes));
    const n = readSync(fd, buf, 0, buf.length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally { closeSync(fd); }
}

const listLogs = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  } catch { return []; }
};

/** Project dir of a cwd: slug of the real path, then a scan of logs whose `cwd` field matches. */
export function findProjectDir(cwd, projects = claudeProjectsDir()) {
  let real = cwd;
  try { real = realpathSync(cwd); } catch { /* keep as given */ }
  const candidates = [join(projects, slugOf(real)), join(projects, slugOf(cwd))];
  for (const c of candidates) if (listLogs(c).length) return { dir: c, lookedIn: candidates[0] };
  let names = [];
  try { names = readdirSync(projects); } catch { /* no projects dir */ }
  const needles = [JSON.stringify(real), JSON.stringify(cwd)].map((s) => `"cwd":${s}`);
  for (const name of names) {
    const dir = join(projects, name);
    for (const log of listLogs(dir).slice(0, 50)) {
      try {
        const head = readHead(log, 128 * 1024);
        if (needles.some((n) => head.includes(n))) return { dir, lookedIn: candidates[0] };
      } catch { /* unreadable, next */ }
    }
  }
  return { dir: null, lookedIn: candidates[0] };
}

export function newestLog(dir) {
  let best = null;
  let bestT = -1;
  for (const log of listLogs(dir)) {
    const t = statSync(log).mtimeMs;
    if (t > bestT) { bestT = t; best = log; }
  }
  return best;
}

/** Same-project session files whose first..last timestamps overlap the range. Reads only head and tail. */
export function overlappingLogs(mainPaths, tStartMs, tEndMs) {
  const mains = new Set(mainPaths.map((p) => join(dirname(p), basename(p))));
  const dirs = new Set(mainPaths.map((p) => dirname(p)));
  const out = [];
  const tsRe = /"timestamp":"([^"]+)"/g;
  for (const dir of dirs) {
    for (const log of listLogs(dir)) {
      if (mains.has(log)) continue;
      try {
        if (statSync(log).mtimeMs < tStartMs) continue;
        const first = [...readHead(log, 256 * 1024).matchAll(tsRe)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
        const last = [...readTail(log, 256 * 1024).matchAll(tsRe)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
        if (!first.length || !last.length) continue;
        const a = Math.min(...first);
        const b = Math.max(...last);
        if (a <= tEndMs && b >= tStartMs) out.push(log);
      } catch { /* unreadable: not counted */ }
    }
  }
  return out;
}

export function createSink() {
  return {
    hashes: new Map(),        // lower hash -> { first, other }
    bare: new Map(),          // 64 hex with no 0x -> occurrence; matched locally, never sent anywhere
    partials: new Map(),      // "prefix|suffix" -> occurrence
    keyLike: new Set(),       // full candidates seen next to a key word
    tools: new Map(),         // tool id -> { start, end, pattern }
    textFull: new Set(),      // mentioned in assistant text
    textPartials: new Set(),
    finals: new Map(),        // sessionId -> { full:Set, partials:Set }
    referenced: new Map(),    // persisted file path -> occurrence meta
    tStart: null, tEnd: null,
    validEntries: 0, timestamped: 0, unreadableLines: 0, seenLines: 0,
  };
}

function earlier(a, b) {
  if (!b) return true;
  if (a.ts === null) return false;
  if (b.ts === null) return true;
  return a.ts < b.ts;
}

function addFull(sink, key, occ) {
  let rec = sink.hashes.get(key);
  if (!rec) { rec = { first: null, other: null }; sink.hashes.set(key, rec); }
  if (occ.kind === 'other') { if (earlier(occ, rec.other)) rec.other = occ; } else if (earlier(occ, rec.first)) rec.first = occ;
}

/** Finds hex tokens in a piece of text. `locate(token)` returns the occurrence to record. */
function harvest(sink, text, locate, accept = () => true) {
  if (text.indexOf('0x') !== -1) {
    FULL_RE.lastIndex = 0;
    for (let m; (m = FULL_RE.exec(text));) {
      if (!accept(m.index + m[0].length)) continue;
      const key = m[0].toLowerCase();
      if (KEY_CONTEXT_RE.test(text.slice(Math.max(0, m.index - 64), m.index))) sink.keyLike.add(key);
      addFull(sink, key, locate(m[0]));
    }
    PARTIAL_RE.lastIndex = 0;
    for (let m; (m = PARTIAL_RE.exec(text));) {
      const prefix = m[1].toLowerCase();
      const suffix = m[2] ? m[2].toLowerCase() : '';
      if (suffix ? prefix.length > 12 : prefix.length < 8) continue;
      const key = `${prefix}|${suffix}`;
      if (!sink.partials.has(key) && sink.partials.size < MAX_PARTIAL) sink.partials.set(key, locate('0x' + m[1]));
    }
  }
  if (text.length >= 64) {
    BARE_RE.lastIndex = 0;
    for (let m; (m = BARE_RE.exec(text));) {
      if (!accept(m.index + m[0].length)) continue;
      const key = m[0].toLowerCase();
      if (!sink.bare.has(key) && sink.bare.size < MAX_BARE) sink.bare.set(key, locate(m[0]));
    }
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b.text === 'string' ? b.text : typeof b === 'string' ? b : '')).join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function notePersisted(sink, path, meta) {
  if (!path || typeof path !== 'string' || !isAbsolute(path) || !path.includes('/tool-results/')) return;
  if (!sink.referenced.has(path)) sink.referenced.set(path, meta);
}

const SAVED_RES = [/Full output saved to: (\/[^\n"\\]+)/g, /Output has been saved to (\/[^\n"\\]+?\.(?:txt|json|html|md|log))/g];

function findPersistedPaths(sink, text, meta) {
  if (text.indexOf('saved to') === -1) return;
  for (const re of SAVED_RES) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) notePersisted(sink, m[1].trim(), meta);
  }
}

function collectMentions(sink, text, final) {
  if (text.indexOf('0x') === -1) return;
  FULL_RE.lastIndex = 0;
  for (let m; (m = FULL_RE.exec(text));) {
    const key = m[0].toLowerCase();
    sink.textFull.add(key);
    if (final) final.full.add(key);
  }
  PARTIAL_RE.lastIndex = 0;
  for (let m; (m = PARTIAL_RE.exec(text));) {
    const prefix = m[1].toLowerCase();
    const suffix = m[2] ? m[2].toLowerCase() : '';
    if (suffix ? prefix.length > 12 : prefix.length < 8) continue;
    const key = `${prefix}|${suffix}`;
    sink.textPartials.add(key);
    if (final) final.partials.add(key);
  }
}

/** Handles one complete log line. Exported for tests. */
export function handleLine(sink, raw, lineNo, ctx) {
  sink.seenLines++;
  let entry = null;
  try { entry = JSON.parse(raw); } catch { /* counted below */ }
  if (!entry || typeof entry !== 'object') {
    sink.unreadableLines++;
    harvest(sink, raw, () => ({ kind: 'other', origin: ctx.origin, line: lineNo, ts: ctx.lastTs, toolId: null }));
    return;
  }
  sink.validEntries++;
  const parsedTs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  const hasTs = Number.isFinite(parsedTs);
  if (hasTs) ctx.lastTs = parsedTs;
  const ts = ctx.lastTs;
  const isMessage = entry.type === 'user' || entry.type === 'assistant';
  if (hasTs && isMessage && !ctx.evidenceOnly) {
    sink.timestamped++;
    if (sink.tStart === null || parsedTs < sink.tStart) sink.tStart = parsedTs;
    if (sink.tEnd === null || parsedTs > sink.tEnd) sink.tEnd = parsedTs;
  }

  const blocks = [];
  if (isMessage) {
    const content = entry.message && entry.message.content;
    let firstResultId = null;
    let hasToolUse = false;
    let finalText = null;
    const list = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') {
        blocks.push({ kind: 'text', toolId: null, text: b.text });
        if (entry.type === 'assistant') {
          const t = b.text.trim();
          if (t && t !== '(no content)') finalText = finalText === null ? b.text : `${finalText}\n${b.text}`;
          collectMentions(sink, b.text, null);
        }
      } else if (b.type === 'tool_use' && entry.type === 'assistant') {
        hasToolUse = true;
        const id = typeof b.id === 'string' ? b.id : null;
        if (id) {
          const pattern = sendingPattern(b.name, b.input);
          const prev = sink.tools.get(id);
          sink.tools.set(id, { start: prev && prev.start !== null ? Math.min(prev.start, ts ?? Infinity) : ts, end: prev ? prev.end : null, pattern });
        }
        blocks.push({ kind: 'tool_use', toolId: id, text: b.input === undefined ? '' : JSON.stringify(b.input) });
      } else if (b.type === 'tool_result') {
        const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : null;
        if (firstResultId === null) firstResultId = id;
        if (id) {
          const prev = sink.tools.get(id);
          if (prev) { if (prev.end === null) prev.end = ts; } else sink.tools.set(id, { start: null, end: ts, pattern: null });
        }
        const text = resultText(b.content);
        blocks.push({ kind: 'tool_result', toolId: id, text });
        findPersistedPaths(sink, text, { line: lineNo, ts, toolId: id, origin: ctx.origin });
      }
    }
    const tur = entry.toolUseResult;
    if (tur !== undefined && tur !== null) {
      const text = typeof tur === 'string' ? tur : JSON.stringify(tur);
      blocks.push({ kind: 'tool_result', toolId: firstResultId, text });
      if (typeof tur === 'object' && typeof tur.persistedOutputPath === 'string') {
        notePersisted(sink, tur.persistedOutputPath, { line: lineNo, ts, toolId: firstResultId, origin: ctx.origin });
      } else if (typeof tur === 'string') {
        findPersistedPaths(sink, tur, { line: lineNo, ts, toolId: firstResultId, origin: ctx.origin });
      }
    }
    // Final assistant message (§2.4): main log only, not a sidechain, last text with no later tool_use.
    if (ctx.origin === 'main' && entry.type === 'assistant') {
      const sid = entry.sessionId || '';
      if (hasToolUse) sink.finals.set(sid, null);
      else if (finalText !== null && !entry.isSidechain) {
        const rec = { full: new Set(), partials: new Set() };
        collectMentions(sink, finalText, rec);
        sink.finals.set(sid, rec);
      }
    }
  }

  const locate = (token) => {
    const needle = token;
    for (const b of blocks) {
      if (b.text.includes(needle)) return { kind: b.kind, origin: ctx.origin, line: lineNo, ts, toolId: b.toolId };
    }
    return { kind: 'other', origin: ctx.origin, line: lineNo, ts, toolId: null };
  };
  harvest(sink, raw, locate);
}

/** Scans a whole file in chunks with overlap; lines are not assumed. */
async function scanFileText(sink, path, meta) {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  const locate = () => ({ kind: 'tool-results', origin: meta.origin, line: meta.line, ts: meta.ts, toolId: meta.toolId });
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    const text = tail + decoder.write(chunk);
    const safeEnd = text.length - 1;
    harvest(sink, text, locate, (end) => end < safeEnd);
    tail = text.slice(-OVERLAP);
  }
  harvest(sink, tail + decoder.end(), locate);
}

function resolvePersisted(path, sessionDirs) {
  try { if (lstatSync(path).isFile()) return path; } catch { /* try the session dirs */ }
  for (const dir of sessionDirs) {
    const alt = join(dir, 'tool-results', basename(path));
    try { if (lstatSync(alt).isFile()) return alt; } catch { /* next */ }
  }
  return null;
}

/** Reads one .jsonl line by line. Lines over MAX_LINE_CHARS are scanned in pieces, not parsed. */
export async function parseLogFile(sink, path, ctx, { hash = null, onBytes = null, maxLineChars = MAX_LINE_CHARS } = {}) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  let lineNo = 0;
  let oversized = false;
  let oversizeTail = '';
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
  const overLocate = () => ({ kind: 'other', origin: ctx.origin, line: lineNo + 1, ts: ctx.lastTs, toolId: null });
  for await (const chunk of stream) {
    if (hash) hash.update(chunk);
    if (onBytes) onBytes(chunk.length);
    buf += decoder.write(chunk);
    let start = 0;
    for (;;) {
      const nl = buf.indexOf('\n', start);
      if (nl === -1) break;
      const line = buf.slice(start, nl);
      start = nl + 1;
      if (oversized) {
        harvest(sink, oversizeTail + line, overLocate);
        oversized = false;
        oversizeTail = '';
        sink.unreadableLines++;
        sink.seenLines++;
        lineNo++;
        continue;
      }
      lineNo++;
      if (line.trim()) handleLine(sink, line, lineNo, ctx);
    }
    buf = start ? buf.slice(start) : buf;
    if (buf.length > maxLineChars) {
      const safeEnd = (oversizeTail + buf).length - 1;
      harvest(sink, oversizeTail + buf, overLocate, (end) => end < safeEnd);
      oversizeTail = buf.slice(-OVERLAP);
      buf = '';
      oversized = true;
    }
  }
  const rest = buf + decoder.end();
  if (oversized) {
    harvest(sink, oversizeTail + rest, overLocate);
    sink.unreadableLines++;
    sink.seenLines++;
  } else if (rest.trim()) {
    lineNo++;
    handleLine(sink, rest, lineNo, ctx);
  }
  return lineNo;
}

function listRec(dir, pred, depth = 3, out = []) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = join(dir, d.name);
    if (d.isDirectory() && depth > 0) listRec(p, pred, depth - 1, out);
    else if (d.isFile() && pred(d.name, p)) out.push(p);
  }
  return out;
}

/** Broadcast files under cwd (§2.1): depth <= 6, <= 5 MB each. */
export function scanBroadcast(sink, cwd, stats) {
  const seen = { dirs: 0 };
  const walk = (dir, depth, inside) => {
    if (seen.dirs++ > 50000) { stats.broadcastTruncated = true; return; }
    let names;
    try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (d.isSymbolicLink()) continue;
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
        if (depth < 6) walk(p, depth + 1, inside || d.name === 'broadcast');
      } else if (inside && d.isFile() && /^run-.*\.json$/.test(d.name)) {
        readBroadcast(sink, p, stats);
      }
    }
  };
  walk(cwd, 0, false);
}

function readBroadcast(sink, path, stats) {
  try {
    if (statSync(path).size > MAX_BROADCAST_BYTES) { stats.skippedBroadcast++; return; }
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const list = [
      ...(Array.isArray(doc.transactions) ? doc.transactions.map((t) => t && t.hash) : []),
      ...(Array.isArray(doc.receipts) ? doc.receipts.map((r) => r && r.transactionHash) : []),
    ];
    let any = false;
    for (const h of list) {
      if (typeof h !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(h)) continue;
      any = true;
      const key = h.toLowerCase();
      let rec = sink.hashes.get(key);
      if (!rec) { rec = { first: null, other: null, broadcast: null }; sink.hashes.set(key, rec); }
      if (!rec.broadcast) rec.broadcast = { kind: 'broadcast', origin: 'broadcast', line: null, ts: null, toolId: null };
    }
    if (any || list.length === 0) stats.broadcast++;
  } catch {
    stats.skippedBroadcast++;
  }
}

/**
 * parseAll: mainLogs (session span comes from these and their subagents), evidenceLogs (extra hash evidence only).
 * Returns the sink plus file statistics.
 */
export async function parseAll({
  mainLogs, evidenceLogs = [], includeSubagents = true, cwd = null,
  maxToolResultBytes = MAX_TOOL_RESULT_BYTES, maxLineChars = MAX_LINE_CHARS, onBytes = null,
}) {
  const sink = createSink();
  const stats = {
    main: mainLogs.map((p) => basename(p)), subagents: 0, toolResults: 0, broadcast: 0,
    missingToolResults: 0, skippedToolResults: 0, skippedBroadcast: 0, broadcastTruncated: false,
  };
  const hash = createHash('sha256');
  const sessionDirs = [];

  const parseOne = async (log, evidenceOnly, isMain) => {
    const sessionDir = log.replace(/\.jsonl$/, '');
    sessionDirs.push(sessionDir);
    await parseLogFile(sink, log, { origin: 'main', lastTs: null, evidenceOnly }, { hash: isMain ? hash : null, onBytes, maxLineChars });
    if (!includeSubagents) return;
    const subs = listRec(join(sessionDir, 'subagents'), (n) => n.endsWith('.jsonl'));
    for (const sub of subs) {
      if (!evidenceOnly) stats.subagents++;
      await parseLogFile(sink, sub, { origin: 'subagent', lastTs: null, evidenceOnly }, { onBytes, maxLineChars });
    }
  };
  for (const log of mainLogs) await parseOne(log, false, true);
  for (const log of evidenceLogs) await parseOne(log, true, false);

  // Persisted outputs: every referenced file, then whatever else the session's tool-results dirs hold.
  const done = new Set();
  const scanOne = async (path, meta) => {
    if (done.has(path)) return;
    done.add(path);
    let size;
    try { size = statSync(path).size; } catch { stats.missingToolResults++; return; }
    if (size > maxToolResultBytes) { stats.skippedToolResults++; return; }
    try {
      await scanFileText(sink, path, meta);
      stats.toolResults++;
    } catch {
      stats.missingToolResults++;
    }
  };
  for (const [path, meta] of sink.referenced) {
    if (IMAGE_EXT.has(extname(path).toLowerCase())) continue;
    const real = resolvePersisted(path, sessionDirs);
    if (!real) { stats.missingToolResults++; continue; }
    await scanOne(real, meta);
  }
  for (const dir of sessionDirs) {
    const inDir = [
      ...listRec(join(dir, 'tool-results'), (n) => !IMAGE_EXT.has(extname(n).toLowerCase()), 1),
    ];
    if (includeSubagents) {
      inDir.push(...listRec(join(dir, 'subagents'), (n, p) => p.includes('/tool-results/') && !IMAGE_EXT.has(extname(n).toLowerCase())));
    }
    for (const file of inDir) {
      const stem = basename(file).replace(/\.[^.]+$/, '');
      const tool = sink.tools.get(stem);
      await scanOne(file, { line: null, ts: tool ? tool.end : null, toolId: tool ? stem : null, origin: 'main' });
    }
  }

  if (cwd) scanBroadcast(sink, cwd, stats);
  stats.logSha256 = hash.digest('hex');
  return { sink, stats };
}
