import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditReport } from '../src/audit.mjs';
import { renderText } from '../src/report.mjs';
import { createReplay } from '../src/replay.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');

function substitute(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) substitute(p);
    else if (name.endsWith('.jsonl')) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('@DIR@', dirname(p)));
  }
}

/** Copies a fixture to a temp dir so that absolute paths in it are real. */
export function copyFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), `chainfess-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  substitute(dir);
  return dir;
}

export async function audit(name, opts = {}) {
  const dir = copyFixture(name);
  const world = JSON.parse(readFileSync(join(dir, 'rpc.json'), 'utf8'));
  Object.assign(world, opts.world || {});
  const replay = createReplay(world);
  const { world: _w, log, ...rest } = opts;
  const { report, audit: raw } = await auditReport({
    wallets: world.wallets,
    logs: [join(dir, log || 'session.jsonl')],
    cwd: dir,
    fetchImpl: replay.fetchImpl,
    paceMs: 0,
    sleep: async () => {},
    fallback: false,
    ...rest,
  });
  const text = renderText(report, {}).replace(/\n(?=\S)/g, ' '); // footer wraps at 96 columns; phrases are matched whole
  return { report, text, json: JSON.stringify(report), replay, raw, dir, world };
}

export const byStatus = (report, s) => report.txs.filter((t) => t.status === s);

export const BANNED = /unauthorized|stolen|hidden|lied/i;
