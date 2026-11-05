// Command line entry. Exit codes (BRIEF §2.3): 0 clean, 1 findings, 2 input error, 3 RPC unavailable, 4 partial scan.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { auditReport, Declined, InputError } from './audit.mjs';
import { renderText } from './report.mjs';
import { RpcUnavailableError } from './rpc.mjs';
import { PrunedError } from './blocks.mjs';
import { createReplay } from './replay.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEMO_DIR = join(HERE, '..', 'fixtures', 'demo');

const HELP = `chainfess: your agent says X, the chain says Y.
Lists every transaction a coding agent's session log does not account for.

  chainfess demo [--json]
      Bundled fixture, recorded RPC replies, no wallet, no RPC calls.

  chainfess audit --wallet 0x… [--log file]… [--all-sessions] [--rpc url] [--chain-id n]
      [--from ISO] [--to ISO] [--from-block n] [--to-block n] [--max-hours h]
      [--yes] [--json] [--no-subagents] [--quiet] [--debug]
      Default log: the latest Claude Code session for this directory.
      --no-subagents skips subagent transcripts only; the main session's saved tool outputs are still read.
      A 32-byte value goes to the RPC only with a tx-hash label or read command beside it; the rest stays local.

  chainfess sign --burn-tx 0x… --wallet 0x… [--log file]… [--server url]
  chainfess verify <statement.json> [--pubkey file]
  chainfess hook install --wallet 0x… | uninstall | status

Exit codes: 0 no findings, 1 findings, 2 input error, 3 RPC unavailable, 4 partial scan.
`;

const AUDIT_OPTIONS = {
  wallet: { type: 'string', multiple: true },
  log: { type: 'string', multiple: true },
  'all-sessions': { type: 'boolean' },
  rpc: { type: 'string' },
  'chain-id': { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  'from-block': { type: 'string' },
  'to-block': { type: 'string' },
  'max-hours': { type: 'string' },
  yes: { type: 'boolean' },
  json: { type: 'boolean' },
  'no-subagents': { type: 'boolean' },
  quiet: { type: 'boolean' },
  debug: { type: 'boolean' },
};

function defaultIo() {
  return {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    isTTY: !!process.stdout.isTTY,
    errTTY: !!process.stderr.isTTY,
    stdinTTY: !!process.stdin.isTTY,
    env: process.env,
    cwd: process.cwd(),
  };
}

const useColor = (io) => io.isTTY && !io.env.NO_COLOR;

function confirmer(io) {
  if (!io.stdinTTY) return null;
  return (question) => new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`${question} [y/N] `, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  });
}

function auditOptsFrom(values, io) {
  return {
    wallets: values.wallet, logs: values.log, allSessions: values['all-sessions'],
    rpc: values.rpc, chainId: values['chain-id'],
    from: values.from, to: values.to, fromBlock: values['from-block'], toBlock: values['to-block'],
    maxHours: values['max-hours'], yes: values.yes, noSubagents: values['no-subagents'],
    cwd: io.cwd,
  };
}

function printDebug(io, audit) {
  const s = audit.rpcStats;
  io.err(`debug: ${s.requests} RPC requests (${Object.entries(s.byMethod).map(([m, c]) => `${m}:${c}`).join(', ')}), fallback ${s.fallbackUsed ? "yes" : "no"}, throttle signals ${s.throttles}\n`);
  io.err(`debug: candidates ${audit.candidates.hashes.length} looked up, ${audit.candidates.localOnly} local only, ${audit.candidates.notLookedUp} over limit; partial ${audit.sink.partials.size}; tool calls ${audit.sink.tools.size}\n`);
  io.err(`debug: planned ${audit.ledger.plannedBlocks} blocks, scanned ${audit.ledger.scannedBlocks}, total ${audit.seconds.toFixed(1)} s\n`);
}

async function cmdAudit(argv, io, extra = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: AUDIT_OPTIONS, allowPositionals: false });
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }
  const v = parsed.values;
  const showProgress = io.errTTY && !v.quiet && !v.json;
  let lastLen = 0;
  const progress = showProgress
    ? (msg, transient) => {
      io.err(`\r${msg.padEnd(lastLen)}${transient ? '' : '\n'}`);
      lastLen = transient ? msg.length : 0;
    }
    : () => {};
  try {
    const { report, audit } = await auditReport({
      ...auditOptsFrom(v, io), progress, confirm: confirmer(io), ...extra,
    });
    if (lastLen) io.err('\r' + ' '.repeat(lastLen) + '\r');
    if (v.json) io.out(JSON.stringify(report, null, 2) + '\n');
    else io.out(renderText(report, { color: useColor(io), quiet: v.quiet }));
    if (v.debug) printDebug(io, audit);
    return report.exitCode;
  } catch (e) {
    return reportError(e, io);
  }
}

function reportError(e, io) {
  if (e instanceof InputError || e instanceof Declined) { io.err(`${e.message}\n`); return 2; }
  if (e instanceof RpcUnavailableError) { io.err(`${e.message}\n`); return 3; }
  if (e instanceof PrunedError) { io.err(`${e.message}\n`); return 3; }
  io.err(`unexpected error: ${e && e.message ? e.message : 'unknown'}\n`);
  return 3;
}

export async function cmdDemo(argv, io) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' } }, allowPositionals: false });
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }
  const world = JSON.parse(readFileSync(join(DEMO_DIR, 'rpc.json'), 'utf8'));
  const { fetchImpl } = createReplay(world);
  const { report } = await auditReport({
    wallets: world.demoWallets, logs: [join(DEMO_DIR, 'session.jsonl')], cwd: DEMO_DIR,
    fetchImpl, paceMs: 0, fallback: false, demo: true, noBroadcast: true, now: Date.parse(world.demoNow),
    sleep: async () => {},
  });
  if (parsed.values.json) io.out(JSON.stringify(report, null, 2) + '\n');
  else io.out(renderText(report, { color: useColor(io) }));
  return report.exitCode;
}

async function cmdSign(argv, io) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...AUDIT_OPTIONS, 'burn-tx': { type: 'string' }, server: { type: 'string' }, out: { type: 'string' } },
      allowPositionals: false,
    });
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }
  const mod = await loadSign(io);
  if (!mod) return 2;
  const v = parsed.values;
  return mod.runSign({
    ...auditOptsFrom(v, io), burnTx: v['burn-tx'], server: v.server, outFile: v.out,
    out: (s) => io.out(s + '\n'), err: (s) => io.err(s + '\n'),
  });
}

async function cmdVerify(argv, io) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { pubkey: { type: 'string' } }, allowPositionals: true });
  } catch (e) {
    io.err(`${e.message}\n`);
    return 2;
  }
  const mod = await loadSign(io);
  if (!mod) return 2;
  return mod.runVerify(parsed.positionals[0], {
    pubkey: parsed.values.pubkey ?? null, out: (s) => io.out(s + '\n'), err: (s) => io.err(s + '\n'),
  });
}

async function loadSign(io) {
  try {
    return await import('./sign.mjs');
  } catch {
    io.err('this install of chainfess has no sign module (src/sign.mjs).\n');
    return null;
  }
}

async function cmdHook(argv, io) {
  let mod;
  try {
    mod = await import('./hook.mjs');
  } catch {
    io.err('this install of chainfess has no hook module (src/hook.mjs).\n');
    return 2;
  }
  return mod.runHook(argv, io);
}

export async function main(argv, ioOverride = {}) {
  const io = { ...defaultIo(), ...ioOverride };
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'audit': return cmdAudit(rest, io);
    case 'demo': return cmdDemo(rest, io);
    case 'sign': return cmdSign(rest, io);
    case 'verify': return cmdVerify(rest, io);
    case 'hook': return cmdHook(rest, io);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      io.out(HELP);
      return cmd === undefined ? 2 : 0;
    case '--version':
    case '-v':
      io.out('0.1.1\n');
      return 0;
    default:
      io.err(`unknown command: ${String(cmd).slice(0, 40)}\n${HELP}`);
      return 2;
  }
}
