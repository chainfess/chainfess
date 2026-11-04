#!/usr/bin/env node
// §6.3: validate web/data/sample.json (real `chainfess audit --json` output) and render /report/sample and the landing strip.
//   node scripts/sample.mjs            validate, then rebuild web/dist with the current site.json
//   node scripts/sample.mjs --check    validate only
// It flips nothing: set "sampleReal": true in web/site.json yourself once the real run is in place.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAudit } from './lib/check.mjs';
import { nonceLine } from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = join(ROOT, 'web', 'data', 'sample.json');
const j = JSON.parse(readFileSync(p, 'utf8'));
checkAudit(j, 'web/data/sample.json');
const site = JSON.parse(readFileSync(join(ROOT, 'web', 'site.json'), 'utf8'));
console.log(`sample.json OK: demo=${j.demo}, ${j.txs.length} txs, ${j.summary?.findings ?? 0} findings. ${nonceLine(j.wallets[0])}`);
if (j.demo) console.log('It is fixture data; pages stay labelled "DEMO — fixture data".');
else if (!site.sampleReal) console.log('Real data, but web/site.json has sampleReal:false; pages still use the fixture.');
if (process.argv.includes('--check')) process.exit(0);
const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-web.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
