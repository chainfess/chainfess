// `npm test`: runs test/*.test.mjs and test/server/*.test.mjs. Named files work the same on Node 20 and 26.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(dir, f)) : []);
const files = [...list(here), ...list(join(here, 'server'))];
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
