// `npm test`: runs test/*.test.mjs and test/server/*.test.mjs. Named files work the same on Node 20 and 26.
// The server needs node:sqlite (Node 22.13+); on an older Node its tests that load it are left out, and this says so.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(dir, f)) : []);
let hasSqlite = true;
try { await import('node:sqlite'); } catch { hasSqlite = false; }
const needsSqlite = (f) => /helpers\.mjs|server\/(app|db)\.mjs|node:sqlite/.test(readFileSync(f, 'utf8'));
const server = list(join(here, 'server'));
const usable = hasSqlite ? server : server.filter((f) => !needsSqlite(f));
if (usable.length !== server.length) process.stderr.write(`node:sqlite is not available on Node ${process.version}: skipping ${server.length - usable.length} server test file(s)\n`);
const r = spawnSync(process.execPath, ['--test', ...list(here), ...usable], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
