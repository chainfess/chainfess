// `chainfess hook install|uninstall|status` and the SessionEnd command itself (BRIEF claim 16, SPIKE).
// The hook must never block or fail a session: `hook run` hands off to a detached process and exits 0.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const BIN = fileURLToPath(new URL('../bin/chainfess.mjs', import.meta.url));
const MARKER = 'chainfess-session-end-hook';
const VERSION = '0.1.0';
const STDIN_WAIT_MS = 2000;

function paths(io) {
  const env = io.env || process.env;
  const home = io.home || env.HOME || homedir();
  const base = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return { settings: join(base, 'settings.json'), reports: join(home, '.chainfess', 'reports') };
}

/** Under npx the package lives in a cache that can be pruned, so the hook names a pinned npx command instead. */
function runner(binPath = BIN, nodePath = process.execPath) {
  if (binPath.includes('/_npx/')) return `npx --yes chainfess@${VERSION}`;
  return `"${nodePath}" "${binPath}"`;
}

export function hookCommand(wallets, binPath, nodePath) {
  const flags = wallets.map((w) => `--wallet ${w}`).join(' ');
  return `${runner(binPath, nodePath)} hook run ${flags} --tag ${MARKER} || true`;
}

const isOurs = (h) => h && typeof h.command === 'string' && h.command.includes(MARKER);

function readSettings(file) {
  if (!existsSync(file)) return {};
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('not a JSON object');
  return doc;
}

function writeSettings(file, doc, hadFile) {
  mkdirSync(dirname(file), { recursive: true });
  let backup = null;
  if (hadFile) {
    backup = `${file}.chainfess-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, backup);
  }
  const tmp = `${file}.chainfess-tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, file);
  return backup;
}

/** Pure: settings without our hook. Other hooks, even in the same group, stay. */
export function withoutOurs(doc) {
  const next = { ...doc };
  const list = next.hooks && next.hooks.SessionEnd;
  if (!Array.isArray(list)) return next;
  const groups = [];
  for (const g of list) {
    if (!g || !Array.isArray(g.hooks)) { groups.push(g); continue; }
    const kept = g.hooks.filter((h) => !isOurs(h));
    if (kept.length) groups.push(kept.length === g.hooks.length ? g : { ...g, hooks: kept });
  }
  const hooks = { ...next.hooks };
  if (groups.length) hooks.SessionEnd = groups; else delete hooks.SessionEnd;
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  return next;
}

export function withOurs(doc, command) {
  const next = withoutOurs(doc);
  if (next.hooks !== undefined && (typeof next.hooks !== 'object' || Array.isArray(next.hooks))) throw new Error('"hooks" is not an object');
  const hooks = { ...(next.hooks || {}) };
  if (hooks.SessionEnd !== undefined && !Array.isArray(hooks.SessionEnd)) throw new Error('"hooks.SessionEnd" is not a list');
  hooks.SessionEnd = [...(hooks.SessionEnd || []), { hooks: [{ type: 'command', command }] }];
  return { ...next, hooks };
}

function install(argv, io) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { wallet: { type: 'string', multiple: true } }, allowPositionals: false }));
  } catch (e) { io.err(`${e.message}\n`); return 2; }
  const wallets = values.wallet || [];
  if (!wallets.length) { io.err('usage: chainfess hook install --wallet 0x… [--wallet 0x…]\n'); return 2; }
  for (const w of wallets) if (!/^0x[0-9a-fA-F]{40}$/.test(w)) { io.err('not a wallet address\n'); return 2; }
  const { settings, reports } = paths(io);
  const had = existsSync(settings);
  let doc;
  try { doc = readSettings(settings); } catch (e) { io.err(`${settings} could not be read (${e.message}); not touching it.\n`); return 2; }
  let next;
  try { next = withOurs(doc, hookCommand(wallets, io.binPath, io.nodePath)); } catch (e) { io.err(`${settings}: ${e.message}; not touching it.\n`); return 2; }
  const backup = writeSettings(settings, next, had);
  io.out(`SessionEnd hook installed in ${settings}\n`);
  if (backup) io.out(`backup: ${backup}\n`);
  io.out(`each session end audits ${wallets.join(', ')} in the background; reports go to ${reports}\n`);
  return 0;
}

function uninstall(io) {
  const { settings } = paths(io);
  if (!existsSync(settings)) { io.out('no settings file; nothing to remove.\n'); return 0; }
  let doc;
  try { doc = readSettings(settings); } catch (e) { io.err(`${settings} could not be read (${e.message}); not touching it.\n`); return 2; }
  const before = JSON.stringify(doc);
  const next = withoutOurs(doc);
  if (JSON.stringify(next) === before) { io.out('hook was not installed.\n'); return 0; }
  const backup = writeSettings(settings, next, true);
  io.out(`hook removed from ${settings}\nbackup: ${backup}\n`);
  return 0;
}

function status(io) {
  const { settings, reports } = paths(io);
  let doc = {};
  try { doc = readSettings(settings); } catch (e) { io.err(`${settings} could not be read (${e.message}).\n`); return 2; }
  const ours = [];
  for (const g of (doc.hooks && Array.isArray(doc.hooks.SessionEnd) ? doc.hooks.SessionEnd : [])) {
    for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) if (isOurs(h)) ours.push(h.command);
  }
  if (!ours.length) { io.out('hook: not installed\n'); return 0; }
  const wallets = [...new Set(ours.flatMap((c) => c.match(/0x[0-9a-fA-F]{40}/g) || []))];
  io.out(`hook: installed (SessionEnd) in ${settings}\nwallets: ${wallets.join(', ')}\n`);
  let files = [];
  try { files = readdirSync(reports).filter((f) => f.endsWith('.json')); } catch { /* none yet */ }
  io.out(`reports: ${files.length} in ${reports}\n`);
  if (files.length) {
    const newest = files.map((f) => join(reports, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    try {
      const r = JSON.parse(readFileSync(newest, 'utf8'));
      io.out(`latest: ${newest}: ${r.summary.findings} finding(s), ${r.summary.accounted} accounted\n`);
    } catch { io.out(`latest: ${newest}\n`); }
  }
  return 0;
}

function readStdin(stream, waitMs) {
  return new Promise((resolve) => {
    let buf = '';
    const done = () => { stream.removeAllListeners(); if (stream.pause) stream.pause(); clearTimeout(timer); resolve(buf); };
    const timer = setTimeout(done, waitMs);
    stream.setEncoding('utf8');
    stream.on('data', (d) => { buf += d; if (buf.length > 1048576) done(); });
    stream.on('end', done);
    stream.on('error', done);
  });
}

/** The hook command. Always returns 0. */
async function run(argv, io) {
  try {
    const { values } = parseArgs({ args: argv, options: { wallet: { type: 'string', multiple: true }, tag: { type: 'string' } }, allowPositionals: false });
    const payload = JSON.parse(await readStdin(io.stdin || process.stdin, STDIN_WAIT_MS));
    const log = payload.transcript_path;
    if (typeof log !== 'string' || !log.endsWith('.jsonl') || !existsSync(log)) return 0;
    const id = String(payload.session_id || 'session').replace(/[^A-Za-z0-9-]/g, '-');
    const cwd = typeof payload.cwd === 'string' && existsSync(payload.cwd) ? payload.cwd : (io.home || homedir());
    const { reports } = paths(io);
    const args = [BIN, 'hook', 'worker', '--log', log, '--id', id, '--reports', reports];
    for (const w of values.wallet || []) args.push('--wallet', w);
    const child = spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore', env: io.env || process.env });
    child.on('error', () => {});
    child.unref();
  } catch { /* a hook never fails a session */ }
  return 0;
}

/** Runs the audit, detached from the session. Failures only ever mean no report file. */
async function worker(argv, io) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { wallet: { type: 'string', multiple: true }, log: { type: 'string' }, id: { type: 'string' }, reports: { type: 'string' } },
      allowPositionals: false,
    });
    const { auditReport } = await import('./audit.mjs');
    const { renderText } = await import('./report.mjs');
    const { report } = await auditReport({
      wallets: values.wallet, logs: [values.log], cwd: io.cwd || process.cwd(), yes: true, ...(io.auditExtra || {}),
    });
    mkdirSync(values.reports, { recursive: true, mode: 0o700 });
    writeFileSync(join(values.reports, `${values.id}.json`), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(values.reports, `${values.id}.txt`), renderText(report, {}), { mode: 0o600 });
  } catch { /* nothing to write */ }
  return 0;
}

export async function runHook(argv, io = {}) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'install': return install(rest, io);
    case 'uninstall': return uninstall(io);
    case 'status': return status(io);
    case 'run': return run(rest, io);
    case 'worker': return worker(rest, io);
    default:
      io.err('usage: chainfess hook install --wallet 0x… | uninstall | status\n');
      return 2;
  }
}
