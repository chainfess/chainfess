// `chainfess sign` and `chainfess verify` (BRIEF §3.1, §5). Node >= 20, no dependencies.
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalJSON } from './canonical.mjs';
import { PUBLIC_KEY_PEM } from './pubkey.mjs';

const DEFAULT_SERVER = 'https://chainfess.pro';
export const PRELAUNCH_LINE =
  'The signed-report service is not enabled yet. It switches on with the $CFESS contract address; see https://chainfess.pro/token. The free audit never needs it.';

const normPem = (s) => String(s).replace(/\s+/g, '');
const sameKey = (a, b) => normPem(a) === normPem(b);

function digestOf(statement) {
  return createHash('sha256').update(canonicalJSON(statement)).digest();
}

/** Pure check: returns {ok, reason?} for {statement, signature} against a public key PEM. */
export function checkSignature(doc, publicKeyPem) {
  try {
    if (!doc || typeof doc !== 'object' || !doc.statement || typeof doc.signature !== 'string') return { ok: false, reason: 'not a chainfess statement file' };
    const good = edVerify(null, digestOf(doc.statement), createPublicKey(publicKeyPem), Buffer.from(doc.signature, 'base64'));
    return good ? { ok: true } : { ok: false, reason: 'signature does not match the statement' };
  } catch (e) {
    return { ok: false, reason: 'could not check signature: ' + (e && e.message ? e.message : 'error') };
  }
}

function describe(st, out) {
  const listed = (st.txs || []).filter((t) => t.listedByClient).length;
  const notListed = (st.txs || []).length - listed;
  out(`Chain ${st.chainId}, blocks ${st.fromBlock} to ${st.toBlock}, signed ${st.signedAt}`);
  for (const w of st.wallets) out(`Wallet ${w}: nonce ${st.nonceAt?.[w]} at signing`);
  out(`${(st.txs || []).length} transaction(s) from these wallets in range: ${listed} listed by the client, ${notListed} not listed`);
  for (const t of st.txs || []) out(`  nonce ${t.nonce}  block ${t.block}  ${t.hash}  ${t.listedByClient ? 'listed' : 'not listed'}`);
  if ((st.unscannedRanges || []).length) out(`Unscanned ranges: ${st.unscannedRanges.map((r) => `${r.from}-${r.to}`).join(', ')}`);
  out(`Burn transaction: ${st.burnTx}`);
  out(`Client log hash (claimed by the client, never seen by the server): ${st.logSha256}`);
  out('The server vouches for the chain facts above and for the fact that the client listed those hashes. It never saw the log. This is not proof that an agent behaved.');
}

/** chainfess verify <statement.json> [--pubkey file.pem]; offline. Returns exit code. */
export async function runVerify(path, opts = {}) {
  const out = opts.out || ((s) => console.log(s));
  const err = opts.err || ((s) => console.error(s));
  if (!path) { err('usage: chainfess verify <statement.json> [--pubkey <pem file>]'); return 2; }
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { err(`cannot read ${path}: ${e.message}`); return 2; }
  if (!doc || !doc.statement || typeof doc.signature !== 'string') { err('not a chainfess statement file (expects {statement, signature})'); return 2; }
  let pubkeyFile = opts.pubkey;
  if (pubkeyFile === undefined) {
    const i = process.argv.indexOf('--pubkey');
    if (i >= 0) pubkeyFile = process.argv[i + 1];
  }
  let key = PUBLIC_KEY_PEM;
  let nonProd = false;
  if (pubkeyFile) {
    try { key = readFileSync(pubkeyFile, 'utf8'); } catch (e) { err(`cannot read public key file: ${e.message}`); return 2; }
    nonProd = !sameKey(key, PUBLIC_KEY_PEM);
  } else if (!sameKey(doc.statement.serverPublicKey || '', PUBLIC_KEY_PEM)) {
    err('REFUSED: this statement was signed with a key that is not the chainfess production key. Pass --pubkey <pem file> only if you trust that key (for example a staging key).');
    return 1;
  }
  if (pubkeyFile && !sameKey(doc.statement.serverPublicKey || '', key)) {
    err('INVALID: the key embedded in the statement is not the key you supplied.');
    return 1;
  }
  const r = checkSignature(doc, key);
  if (!r.ok) { err(`INVALID: ${r.reason}`); return 1; }
  if (nonProd) out('NOTE: verified with a NON-PRODUCTION key supplied by --pubkey. This statement is not a production statement.');
  out(nonProd ? 'Signature valid (non-production key).' : 'Signature valid (production key).');
  describe(doc.statement, out);
  return 0;
}

async function jfetch(f, url, init) {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', 'user-agent': 'chainfess/0.1', ...(init && init.headers) } });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

/**
 * chainfess sign --burn-tx 0x.. --wallet 0x.. [--log f].. [--server url]
 * opts: { burnTx, wallets, server, out, err, fetch, prepareAudit, outFile, pollMs, timeoutMs, ...auditOpts }
 */
export async function runSign(opts = {}) {
  const out = opts.out || ((s) => console.log(s));
  const err = opts.err || ((s) => console.error(s));
  const f = opts.fetch || fetch;
  const server = String(opts.server || DEFAULT_SERVER).replace(/\/+$/, '');
  const burnTx = String(opts.burnTx || '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(burnTx)) { err('usage: chainfess sign --burn-tx 0x<64 hex> --wallet 0x<address> [--log file]... [--server url]'); return 2; }

  let st;
  try { st = await jfetch(f, `${server}/api/sign/status`); } catch { err(`cannot reach ${server}`); return 3; }
  if (st.status !== 200 || !st.body) { err(`unexpected answer from ${server} (HTTP ${st.status})`); return 3; }
  if (!st.body.enabled) { out(PRELAUNCH_LINE); return 0; }

  let audit;
  try {
    const prepare = opts.prepareAudit || (await import('./audit.mjs')).prepareAudit;
    audit = await prepare({ ...opts, burnTx });
  } catch (e) { err(`local audit failed: ${e && e.message ? e.message : e}`); return 2; }
  const body = { burnTx, wallets: audit.wallets, fromBlock: audit.fromBlock, toBlock: audit.toBlock, hashes: audit.hashes, logSha256: audit.logSha256 };

  let post;
  try { post = await jfetch(f, `${server}/api/sign`, { method: 'POST', body: JSON.stringify(body) }); } catch { err(`cannot reach ${server}`); return 3; }
  let jobId;
  if (post.status === 202) jobId = post.body.jobId;
  else if (post.status === 409 && post.body?.error === 'already_used') {
    out('This burn transaction was already used for a statement (one burn, one statement). Fetching it.');
    jobId = post.body.jobId;
  } else if (post.status === 403 && post.body?.enabled === false) { out(PRELAUNCH_LINE); return 0; }
  else { err(`server refused: HTTP ${post.status} ${post.body?.error || ''}`.trim()); return 1; }

  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60 * 1000);
  let job;
  for (;;) {
    try { job = await jfetch(f, `${server}/api/sign/${jobId}`); } catch { err('lost connection while waiting'); return 3; }
    if (job.status !== 200) { err(`unexpected answer while waiting: HTTP ${job.status}`); return 3; }
    if (job.body.status === 'done') break;
    if (job.body.status === 'failed') { err(`server could not finish the scan (${job.body.error}). Run the same command again to retry this burn.`); return 4; }
    if (Date.now() > deadline) { err(`still ${job.body.status}; fetch later: ${server}/api/report/${burnTx}`); return 4; }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
  }
  const doc = { statement: job.body.statement, signature: job.body.signature };
  const file = opts.outFile || `chainfess-statement-${burnTx.slice(2, 10)}.json`;
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  out(`Signed statement saved to ${file}`);
  if (!sameKey(doc.statement.serverPublicKey || '', PUBLIC_KEY_PEM)) {
    const pem = file.replace(/\.json$/, '') + '.pubkey.pem';
    writeFileSync(pem, doc.statement.serverPublicKey);
    out(`This server's key is not the production key. To check it: chainfess verify ${file} --pubkey ${pem}`);
  } else {
    out(`Check it offline: chainfess verify ${file}`);
  }
  return 0;
}
