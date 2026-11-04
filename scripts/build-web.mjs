#!/usr/bin/env node
// Static build of chainfess.pro → web/dist. No dependencies. Flags for testing other paths without touching web/:
//   --site '{"npmLive":true,...}'  --data path.json  --token path.json  --out dir
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landing, report, docs, tokenPage, notFound, llms } from './lib/pages.mjs';
import { checkAudit } from './lib/check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const site = { npmLive: false, repoPublic: false, sampleReal: false, ...readJson(join(WEB, 'site.json')), ...(arg('--site') ? JSON.parse(arg('--site')) : {}) };
const token = readJson(arg('--token') || join(WEB, 'token.json'));
const OUT = resolve(arg('--out') || join(WEB, 'dist'));

// Which audit JSON feeds the strip and /report/sample.
const samplePath = join(WEB, 'data', 'sample.json');
const demoPath = join(WEB, 'data', 'demo.json');
let dataPath = arg('--data');
if (!dataPath) dataPath = site.sampleReal ? samplePath : (existsSync(demoPath) ? demoPath : samplePath);
const json = readJson(dataPath);
checkAudit(json, dataPath);
// A fixture is always labelled, whatever the switch says; real data is only presented as real with sampleReal.
if (site.sampleReal && json.demo) console.error('build-web: warning: sampleReal is true but the data has demo:true; it stays labelled DEMO.');
const isDemo = !site.sampleReal || !!json.demo;

const css = readFileSync(join(WEB, 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s{2,}/g, ' ');

let publicKey = null;
const pk = join(ROOT, 'src', 'pubkey.mjs');
if (existsSync(pk)) {
  const m = readFileSync(pk, 'utf8').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
  if (m) publicKey = m[0];
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(WEB, 'public'), OUT, { recursive: true });
for (const f of ['site.js', 'hero.js']) writeFileSync(join(OUT, f), readFileSync(join(WEB, 'src', f)));
// token.json is fetched no-cache at load, so a golive swap needs no rebuild.
writeFileSync(join(OUT, 'token.json'), JSON.stringify(token, null, 2) + '\n');

const page = (path, html) => { const p = join(OUT, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, html); };
page('index.html', landing({ site, token, json, isDemo, css }));
page('docs/index.html', docs({ site, css, publicKey, token }));
page('token/index.html', tokenPage({ site, token, css }));
page('report/sample/index.html', report({ site, json, isDemo, css }));
page('404.html', notFound({ site, css }));
page('llms.txt', llms({ site, token, isDemo, json }));
page('robots.txt', 'User-agent: *\nAllow: /\n');
writeFileSync(join(OUT, 'site.webmanifest'), JSON.stringify({ name: 'Chainfess', short_name: 'Chainfess', start_url: '/', display: 'standalone', background_color: '#EEF1E8', theme_color: '#EEF1E8', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }, null, 2));
console.log(`build-web: ${OUT} (site ${JSON.stringify(site)}, data ${dataPath.replace(ROOT + '/', '')}, ${isDemo ? 'DEMO' : 'real'})`);
