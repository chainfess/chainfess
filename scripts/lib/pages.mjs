// Static page templates. Public copy comes from BRIEF §1, §2, §3.6, §4, §5, §13 and the §0 motivating case only.
import { esc, shortHash, shortAddr, num, utcTime, utcDate, LABEL, nonceLine } from './util.mjs';
import { renderStrip, glyph, stripEvents } from './strip.mjs';

const RPC = 'https://robinhood-rpc.publicnode.com';
export const SITE = 'https://chainfess.pro';
const X_URL = 'https://x.com/chainfesspro';
const GH_URL = 'https://github.com/chainfess/chainfess';
const NPM_URL = 'https://www.npmjs.com/package/chainfess';
const DEMO_NOTE = 'Demo: fixture data.';

const copyBox = (cmd, cls = '') => `<div class="cmd ${cls}"><code>${esc(cmd).replace(/(--[\w-]+ [^ ]{1,14}(?= |$))/g, '<span class="nb">$1</span>')}</code><button type="button" class="cp" data-copy="${esc(cmd)}">Copy</button></div>`;

// CLI name in running text: `npx chainfess …` only once the package is public.
export const cli = (site) => (site.npmLive ? 'npx chainfess' : 'chainfess');

export function caSlot(token, { short = false } = {}) {
  const live = token.launched && /^0x[0-9a-fA-F]{40}$/.test(token.ca) && !/^0x0{40}$/.test(token.ca);
  const inner = live
    ? `<div class="cmd ca-box"><code>${esc(token.ca)}</code><button type="button" class="cp" data-copy="${esc(token.ca)}">Copy</button></div>
  <p class="ca-line"><a class="btn btn-2 buy" href="https://ponsfamily.com/token/${esc(token.ca)}" rel="noopener">Buy on Pons</a> <span>The only official CA is the one on this page and on <a href="${X_URL}" rel="noopener">@chainfesspro</a>.</span></p>`
    : `<p class="ca-pre">${short ? '' : `$${esc(token.symbol)} launches 6 Nov 2026 (UTC). `}No CA yet. The CA will be posted here and on <a href="${X_URL}" rel="noopener">@chainfesspro</a> at launch; only that one is official.</p>`;
  return `<div class="ca-slot" data-ca-slot>${inner}</div>`;
}

// One copy constant: the share of supply burned per signed report. The exact amount comes from the contract at golive.
export const BURN_PCT = '0.01';
export const CREATOR_TAX_WORD = 'creator tax';

export function burnText(token) {
  if (String(token.burnAmount) === '0') return `${token.burnPctOfSupply || BURN_PCT}% of supply (exact amount set from the contract at launch)`;
  if (token.burnAmountHuman) return `${token.burnAmountHuman} $${token.symbol}`;
  if (token.decimals != null) {
    const raw = BigInt(token.burnAmount), d = 10n ** BigInt(token.decimals);
    const frac = (raw % d).toString().padStart(Number(token.decimals), '0').replace(/0+$/, '');
    return `${(raw / d).toLocaleString('en-US')}${frac ? '.' + frac : ''} $${token.symbol}`;
  }
  return `${token.burnAmount} raw units of $${token.symbol}`;
}

const LOGO = '<svg width="24" height="20" viewBox="0 0 26 20" aria-hidden="true"><path d="M0 15H7L9 16L12 2L15 18L17 13L19 15H26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const nav = (active) => `<header class="top"><div class="wrap top-in"><a class="mark" href="/" aria-label="Chainfess home">${LOGO}Chainfess</a>
  <nav aria-label="Main">${[['/docs', 'Docs'], ['/token', 'Token'], ['/report/sample', 'Sample<span class="sm-hide"> report</span>']].map(([h, t]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav></div></header>`;

const footer = (site) => `<footer class="foot"><div class="wrap foot-in">
  <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/token">Token</a><a href="/report/sample">Sample report</a>${site.npmLive ? `<a href="${NPM_URL}" rel="noopener">npm</a>` : ''}${site.repoPublic ? `<a href="${GH_URL}" rel="noopener">GitHub</a>` : ''}<a href="${X_URL}" rel="noopener">X</a></nav>
  <p class="foot-block">Robinhood Chain block, live: <span data-block class="blk">—</span></p>
  <p class="foot-note">Not audited. Nothing is prevented. No promise of returns.</p></div></footer>`;

export function shell({ title, desc, path, body, css, head = '', site, active, bodyClass = '' }) {
  const fontPreload = ['instrument-sans', 'azeret-mono'].map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@chainfesspro">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#EEF1E8">
${fontPreload}${head}<style>${css}</style></head>
<body class="${bodyClass}">${nav(active)}${body}${footer(site)}<script src="/site.js" defer></script></body></html>`;
}

// Plain-word line per transaction, for the excerpt and the report.
function plainSource(t) {
  if (t.status === 'unaccounted') return 'Not in this log';
  if (t.status === 'foreign-signer') return 'Signed by a wallet not registered here';
  if (t.status === 'observed') return "Another wallet's transaction, read by the agent";
  if (t.status === 'recent-other') return "Another wallet's transaction, mined during a tool call";
  if (t.status === 'partial') return `Shortened hash only${t.source?.line ? `, line ${t.source.line}` : ''}`;
  if (t.status === 'post-session') return 'Sent after this session';
  if (t.status === 'pre-session') return 'Sent before this session';
  if (t.status === 'pending') return 'Pending at audit time';
  const where = t.source?.kind === 'broadcast' ? 'in a broadcast file' : t.source?.kind === 'subagent' ? 'in a subagent log' : 'in the log';
  return `Found ${where}${t.source?.line ? `, line ${t.source.line}` : ''}`;
}
const toneOf = (t) => (t.finding ? 'bad' : ['partial', 'pending', 'post-session', 'pre-session'].includes(t.status) ? 'warn' : ['observed', 'recent-other'].includes(t.status) ? 'mute' : 'ok');
const STATUS_WORD = { accounted: 'Accounted', partial: 'Partial', unaccounted: 'Unaccounted', 'foreign-signer': 'Foreign signer', 'pre-session': 'Before session', 'post-session': 'After session', pending: 'Pending', 'recent-other': 'Other wallet', observed: 'Other wallet' };

function plainSummary(w) {
  if (!w) return '';
  if (w.neverSent) return 'This wallet has never sent a transaction.';
  const s = [`This wallet has sent ${w.nonce} transaction${w.nonce === 1 ? '' : 's'}.`, `${w.inLog} ${w.inLog === 1 ? 'appears' : 'appear'} in this log.`];
  if (w.uIn) s.push(`${w.uIn} inside this session ${w.uIn === 1 ? 'does' : 'do'} not.`);
  const before = w.uBefore ?? 0, after = w.uAfter ?? (w.uBefore == null ? w.uOut : 0);
  if (before) s.push(`${before} ${before === 1 ? 'was' : 'were'} sent before it.`);
  if (after) s.push(`${after} ${after === 1 ? 'was' : 'were'} sent after it.`);
  return s.join(' ');
}

export function landing({ site, token, json, isDemo, css }) {
  const w = json.wallets?.[0];
  const c = cli(site);

  const cta = site.npmLive
    ? `${copyBox('npx chainfess demo', 'cmd-hero')}<a class="btn btn-2" href="/report/sample">See a sample report</a>`
    : `<a class="btn btn-1" href="/report/sample">See a sample report</a><a class="btn btn-2" href="/docs">Read the docs</a>`;
  const demoCap = isDemo ? `<figcaption class="cap">${DEMO_NOTE}</figcaption>` : `<figcaption class="cap">From the <a href="/report/sample">sample report</a>: a real session run by the Chainfess team on mainnet.</figcaption>`;

  const hero = `<section class="hero">
    <div class="wrap hero-t">
      <h1><span class="h-log">Your agent says X.</span><br>The chain says Y.</h1>
      <p class="sub">Chainfess lists every transaction your agent's wallet made that its session log does not account for.</p>
      <div class="cta">${cta}</div>
      <div class="hero-ca">${caSlot(token)}</div>
    </div>
    <figure class="wrap hero-v">${renderStrip(json)}${demoCap}</figure>
  </section>`;

  const problem = `<section class="sec s-white" id="problem"><div class="wrap two">
    <div><h2>The log is your agent's record. The chain is independent.</h2></div>
    <div class="prose">
      <p>OpenAI disclosed an internal agent that spent from a wallet it did not own, omitted it from its report, and was found about 3 months later. Testnet funds, no mainnet loss reported (CoinDesk, 16 Oct 2026).</p>
      <p>Chainfess reads independent chain data after the fact. The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.</p>
    </div>
  </div></section>`;

  const steps = [
    ['Point it at a wallet', site.npmLive
      ? `<p>Audit a past session. Default log = latest Claude Code session for the current directory.</p><code class="code-b">${esc(c)} audit --wallet 0x…</code>`
      : `<p>Audit a past session by giving the CLI your agent's wallet address. Default log = latest Claude Code session for the current directory. The commands are listed in the <a href="/docs#audit">docs</a>.</p>`],
    ['It compares log and chain', `<p><code>audit</code> runs on your machine and reads the chain with JSON-RPC calls. Deterministic, no LLM. The log never leaves your machine.</p>`],
    ['You get a plain list', `<p>Every transaction the log does not account for, as one line each. <code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>`],
  ];
  const how = `<section class="sec s-paper" id="how"><div class="wrap">
    <h2>How it works</h2>
    <ol class="steps">${steps.map(([t, b], i) => `<li><span class="st-n" aria-hidden="true">${i + 1}</span><h3>${esc(t)}</h3>${b}</li>`).join('')}</ol>
  </div></section>`;

  const evs = (json.txs || []).filter((t) => t.status !== 'recent-other');
  const rankTx = (t) => (t.status === 'unaccounted' ? 0 : t.finding ? 1 : t.status === 'accounted' ? 2 : 3);
  const ordered = [...evs].sort((a, b) => rankTx(a) - rankTx(b) || (a.block ?? 0) - (b.block ?? 0)).slice(0, 5);
  const report = `<section class="sec s-sage" id="report"><div class="wrap">
    <h2>What a report looks like</h2>
    <div class="sheet-card">
      <p class="rp-sum">${esc(plainSummary(w))}</p>
      ${isDemo ? `<p class="demo-note">${DEMO_NOTE}</p>` : ''}
      <ul class="tx-list">${ordered.map((t) => `<li class="tx ${toneOf(t)}"><span class="tx-s">${esc(STATUS_WORD[t.status] || t.status)}</span><span class="tx-w">${esc(plainSource(t))}</span><code class="tx-h">${esc(shortHash(t.hash))}</code><span class="tx-t">${esc(utcTime(t.time))}</span></li>`).join('')}</ul>
      <p class="sheet-foot"><a class="btn btn-2" href="/report/sample">Open the full report</a></p>
    </div>
    <p class="after-card">Reports show hashes, addresses, values, the tool pattern name, the source kind and a line reference. Never command text, never secrets.</p>
  </div></section>`;

  const outcomes = [
    ['Accounted', 'accounted', 'Its full hash appears in a supplied log or a broadcast file.', ''],
    ['Partial', 'partial', 'Only a shortened form of the hash is in the log. Flagged, not a finding.', 'warn'],
    ['Unaccounted', 'unaccounted', 'The wallet sent it inside the session, and the log has no match. This line reads "not in this log".', 'bad'],
    ['Foreign signer', 'foreign', 'A sending command printed the hash, it was mined during that command, and another wallet signed it. This line reads "signed by a wallet not registered here".', 'bad'],
  ];
  const rules = `<section class="sec s-white" id="rules"><div class="wrap">
    <h2>Four outcomes, deterministic, no LLM</h2>
    <ul class="outc">${outcomes.map(([n, g, r, tone]) => `<li class="${tone}">${glyph(g)}<div><h3>${n}</h3><p>${r}</p></div></li>`).join('')}</ul>
    <p class="more"><a href="/docs#rules">The rules are on this page: every row, in order →</a></p>
    <div class="limits">
      <div><h3>What it does not say</h3><p>Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.</p></div>
      <div><h3>Limits</h3><p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p></div>
    </div>
  </div></section>`;

  const tokenSec = `<section class="sec s-ink" id="token"><div class="wrap two">
    <div><h2>$${esc(token.symbol)}</h2></div>
    <div class="prose">
      ${caSlot(token)}
      <p>The free CLI never needs the coin. The coin pays for one thing: an ed25519-signed report. <a href="/token">How the signed report works →</a></p>
    </div>
  </div></section>`;

  const qa = [
    ['Does my log leave my machine?', `<p><code>audit</code> and <code>demo</code> run on your machine. The log never leaves it. <code>audit</code>'s only network calls are JSON-RPC reads with block numbers, values the log labels as tx hashes, and your wallet address. A 32-byte value with no such label, or with a key word beside it, is never sent. Only the optional <code>sign</code> contacts our server: it sends the wallets, the block range, a hash of the log, and only hashes of transactions confirmed on chain from a registered wallet; never the log.</p>`],
    ['Does it say who sent an unaccounted transaction?', '<p>No. Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line.</p>'],
    ['Can it stop a transaction?', '<p>No. Nothing is prevented. Chainfess compares after the fact.</p>'],
    ['Can an agent fool it?', '<p>An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>'],
    ['What does it work with?', '<p>Claude Code session logs (<code>.jsonl</code>), including subagent transcripts and Foundry <code>broadcast/</code> files. EOA wallets only. Robinhood Chain by default; any EVM RPC with <code>--rpc</code> (then limits apply, unmeasured).</p>'],
    ['Do I need the coin?', `<p>No. The free CLI never needs the coin. It only pays for a signed report: burn ${esc(burnText(token))} from the audited wallet, and our server re-checks the chain facts and signs them.</p>`],
    ['How do I check the numbers?', '<p><code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>'],
    ['Has it been audited?', '<p>No. Not audited.</p>'],
  ];
  const faq = `<section class="sec s-paper" id="faq"><div class="wrap two">
    <div><h2>Questions</h2></div>
    <div class="faq">${qa.map(([q, a], i) => `<details${i ? '' : ' open'}><summary>${esc(q)}</summary>${a}</details>`).join('')}</div>
  </div></section>`;

  const finalCta = `<section class="sec s-blue" id="start"><div class="wrap final">
    <h2>Chainfess lists every transaction the log does not account for.</h2>
    <div class="cta">${site.npmLive ? `${copyBox('npx chainfess demo', 'cmd-hero')}<a class="btn btn-on" href="/report/sample">See a sample report</a>` : `<a class="btn btn-inv" href="/report/sample">See a sample report</a><a class="btn btn-on" href="/docs">Read the docs</a>`}</div>
  </div></section>`;

  const motionBoot = `<script>(function(){var d=document.documentElement;d.classList.add('js');if(innerWidth<768||matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('m');var t=setTimeout(function(){d.classList.remove('m')},4000);window.__recReady=function(){clearTimeout(t)};['/vendor/gsap.min.js','/vendor/ScrollTrigger.min.js','/hero.js'].forEach(function(u){var e=document.createElement('script');e.src=u;e.async=false;e.onerror=function(){clearTimeout(t);d.classList.remove('m')};document.head.appendChild(e)})})()</script>`;

  return shell({
    title: 'Chainfess: your agent says X, the chain says Y',
    desc: 'Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.',
    path: '/', css, site, head: motionBoot, bodyClass: 'home',
    body: `<main>${hero}${problem}${how}${report}${rules}${tokenSec}${faq}${finalCta}</main>`,
  });
}

export function report({ site, json, isDemo, css }) {
  const w = json.wallets?.[0];
  const s = json.session || {};
  const rows = json.txs || [];
  const txRow = (t) => `<article class="rp-r ${toneOf(t)}">
      <h3><span class="tx-s">${esc(STATUS_WORD[t.status] || t.status)}</span> ${esc(plainSource(t))}</h3>
      <p class="rp-meta">${esc(utcTime(t.time))} · nonce ${t.nonce ?? '—'} · block ${num(t.block)} · ${esc(t.valueEth)} ETH${t.reverted ? ' · reverted' : ''}${t.contractCreation ? ` · contract creation ${esc(shortAddr(t.createdAddress))}` : ''}</p>
      <dl class="rp-d">
        <div><dt>Hash</dt><dd><code>${esc(t.hash)}</code></dd></div>
        <div><dt>From</dt><dd><code>${esc(t.from)}</code></dd></div>
        <div><dt>To</dt><dd><code>${esc(t.to ?? 'contract creation')}</code>${t.toLabel ? ` (${esc(t.toLabel)})` : ''}</dd></div>
        ${t.pattern ? `<div><dt>Tool</dt><dd><code>${esc(t.pattern)}</code></dd></div>` : ''}
        <div><dt>Agent's own words</dt><dd>${t.mentioned === 'final' ? 'Mentioned in its final message' : t.mentioned === 'text' ? 'Mentioned in its text' : 'Not mentioned'}</dd></div>
      </dl>
      ${isDemo ? '' : copyBox(`cast tx ${t.hash} --rpc-url ${RPC}`)}</article>`;
  const group = (name, list, intro = '') => (list.length ? `<section class="rp-g"><h2>${esc(name)}</h2>${intro ? `<p>${intro}</p>` : ''}${list.map(txRow).join('')}</section>` : '');
  const logName = (json.logs?.main?.[0] || '').split(/[\\/]/).pop().replace(/[^\w.\-]/g, '');
  const extras = [json.logs?.subagents ? `+${json.logs.subagents} subagents` : '', json.logs?.broadcast ? `${json.logs.broadcast} broadcast file` : ''].filter(Boolean).join(', ');
  const realNote = `Real session run by the Chainfess team on Robinhood Chain, ${utcDate(s.tStart)}. Wallet ${shortAddr(w?.address)} is the team wallet. An agent sent two 0-ETH self-transfers. A third 0-ETH self-transfer was sent from a second terminal, outside the agent session, while the session was open: that is the line marked "not in this log". It was done on purpose to show what a finding looks like. The "${w?.uBefore ?? 0} before" are the wallet's first two transactions, nonces 0 and 1: an earlier agent session sent them about ten minutes before this one, and they are in that session's log, not in this one.`;
  const gapCount = json.scan?.gaps?.length ?? 0;
  const body = `<main class="doc rp"><div class="wrap-n">
    <header class="doc-h"><h1>Sample report</h1>
      <p class="rp-big">${esc(plainSummary(w))}</p>
      ${isDemo ? `<p class="demo-note">${DEMO_NOTE} These hashes are not on chain.</p>` : `<p class="lead">${esc(realNote)}</p>`}
    </header>
    <figure class="rp-fig">${renderStrip(json)}</figure>
    ${group('Findings', rows.filter((t) => t.finding), 'Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.')}
    ${group('Accounted', rows.filter((t) => t.status === 'accounted'))}
    ${group('Partial', rows.filter((t) => t.status === 'partial'))}
    ${group('Before or after the session, pending', rows.filter((t) => ['pre-session', 'post-session', 'pending'].includes(t.status)))}
    ${group('Other wallets referenced', rows.filter((t) => ['observed', 'recent-other'].includes(t.status)), 'Reads are not sends. These are never findings.')}
    <section class="rp-g"><h2>Technical details</h2>
      <dl class="kv">
        <div><dt>Wallet</dt><dd><code>${esc(w?.address)}</code></dd></div>
        <div><dt>Log</dt><dd><code>${esc(logName)}</code>${extras ? ` ${esc(extras)}` : ''}</dd></div>
        <div><dt>Session</dt><dd>${utcDate(s.tStart)} ${utcTime(s.tStart)} to ${utcTime(s.tEnd)}</dd></div>
        <div><dt>Blocks</dt><dd>${num(s.startBlock)} to ${num(s.endBlock)} (${num(s.blocks)} blocks)</dd></div>
        <div><dt>Scanned</dt><dd>${num(json.scan?.scannedBlocks)} blocks in ${gapCount} gap${gapCount === 1 ? '' : 's'}</dd></div>
        <div><dt>Nonce line</dt><dd>${esc(nonceLine(w))}</dd></div>
      </dl>
    </section>
    <footer class="rp-f">
      ${json.summary?.unresolvedHashes ? `<p>Looked up, not a tx: ${num(json.summary.unresolvedHashes)} ${json.summary.unresolvedHashes === 1 ? 'hash' : 'hashes'} in the log ${json.summary.unresolvedHashes === 1 ? 'is' : 'are'} not a transaction on chain ${json.chainId}.</p>` : ''}
      ${json.summary?.localOnlyHashes ? `<p>Not looked up, stays local: ${num(json.summary.localOnlyHashes)} 32-byte ${json.summary.localOnlyHashes === 1 ? 'value' : 'values'} with nothing saying ${json.summary.localOnlyHashes === 1 ? 'it is' : 'they are'} a tx hash. Never sent to the RPC; matched on this machine against the wallet's transactions found by the scan.</p>` : ''}
      ${json.logs?.otherOverlapping ? `<p>${json.logs.otherOverlapping} other session logs overlap this range; add them with <code>--log</code> or <code>--all-sessions</code> before drawing conclusions.</p>` : ''}
      <p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>
      ${isDemo ? '' : `<p>Verify the rules yourself: <code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>${copyBox(`cast nonce ${w?.address} --rpc-url ${RPC}`)}`}
    </footer>
  </div></main>`;
  return shell({
    title: isDemo ? 'Sample report (demo) · Chainfess' : 'Sample report · Chainfess',
    desc: isDemo ? 'Sample report layout. Demo: fixture data.' : 'Sample report: a real session run by the Chainfess team on mainnet.',
    path: '/report/sample', css, site, active: '/report/sample', body,
  });
}

export function docs({ site, css, publicKey, token }) {
  const c = cli(site);
  const rules = [
    ['1', 'Pre-session', 'tx <code>from ∈ wallets</code>, <code>blockNumber &lt; startBlock</code> (only reachable via a hash in the log)', '"sent before this session (referenced in log)". Informational, not a finding'],
    ['2', 'Post-session', '<code>blockNumber &gt; endBlock</code>', '"sent after this session". Informational'],
    ['3', 'Pending', 'hash resolved with <code>blockNumber: null</code>', '"pending at audit time; re-run later". Informational'],
    ['4', 'Accounted', 'tx <code>from ∈ wallets</code>, in range, and its full hash appears in any supplied log (<code>tool_result</code>, <code>tool_use</code>, assistant <code>text</code>, subagent, <code>tool-results/</code>) or in a broadcast file', '"accounted (source: tool_result line 1234 / broadcast)"'],
    ['5', 'Partial', 'in range, full hash absent, but a partial candidate matches its prefix <b>and</b> suffix (or a ≥ 8-hex prefix when no suffix)', '"partial match only (<code>0x1234…abcd</code> at line n)". Not a finding, flagged'],
    ['6', 'Unaccounted', 'tx <code>from ∈ wallets</code>, in range, no full or partial match', '"<b>not in this log</b>". The only finding type about our wallet'],
    ['7', 'Foreign signer', 'resolved tx with <code>from ∉ wallets</code> whose hash first appears in a <code>tool_result</code> of tool-call <code>id</code>, and <code>sendingPattern(id) ≠ null</code> <b>and</b> <code>blockTimestamp(tx) ∈ W(id)</code>', '"<b>signed by a wallet not registered here</b>". Finding; shows <code>from</code>, the pattern name, line'],
    ['8', 'Recent other wallet', 'resolved tx, <code>from ∉ wallets</code>, <code>blockTimestamp(tx) ∈ W(id)</code>, no sending pattern', '"other wallet\'s tx mined during this tool call; cannot tell a read from a send". Informational, count + expandable list, never a finding'],
    ['9', 'Observed', 'resolved tx, <code>from ∉ wallets</code>, none of rows 7 to 8', '"other wallet\'s tx referenced (read)". Informational'],
    ['10', 'Unresolved', 'hash candidate with no tx on this chain (<code>null</code>): block hash, bytes32 salt, testnet tx, other chain', 'counted once in the footer ("Looked up, not a tx: n hashes in the log are not a transaction on chain 4663"), never listed as a finding. A 32-byte value with no hash label stays local and is counted separately ("Not looked up, stays local")'],
  ];
  const toc = [['audit', 'Audit'], ['rules', 'Rules'], ['nonce', 'Nonce ledger'], ['scope', 'Scope'], ['limits', 'Limits'], ['privacy', 'Privacy'], ['hook', 'Hook'], ['verify', 'Verify yourself'], ['signed', 'Signed report']];
  const flags = [
    ['--wallet 0x…', 'Repeatable, required. Lower-cased; checksummed in output.'],
    ['--log f', 'Repeatable. Default = newest <code>~/.claude/projects/&lt;slug(cwd)&gt;/*.jsonl</code>.'],
    ['--all-sessions', 'Include other session logs of the project that overlap the range.'],
    ['--no-subagents', 'Skip subagent transcripts only (<code>S/subagents/</code>). The main session\'s saved tool outputs (<code>S/tool-results/</code>) are still read.'],
    ['--rpc url, --chain-id n', 'Any EVM RPC (then limits apply, unmeasured).'],
    ['--from ISO, --to ISO', 'Override the session span, UTC.'],
    ['--from-block n, --to-block n', 'Override the block range.'],
    ['--max-hours h', 'Raise the scan cap.'],
    ['--yes', 'Skip the prompt shown when the estimated scan is over 10 min.'],
    ['--json', 'Same whitelisted fields as the text report.'],
    ['--quiet', 'Less output.'],
  ];
  const body = `<main class="doc docs"><div class="wrap">
    <header class="doc-h"><h1>Docs</h1><p class="lead">Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.</p></header>
    <div class="doc-grid">
    <nav class="toc" aria-label="On this page">${toc.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    <div class="doc-body">
    <section id="audit"><h2>Audit</h2>
      ${site.npmLive ? `<p>The CLI is published to npm as <code>chainfess</code>; commands below apply once installed. Try it in 10 seconds, no wallet, no network: <code>npx chainfess demo</code>.</p>${copyBox('npx chainfess demo')}` : '<p>The npm package is not published yet. These are the commands it provides.</p>'}
      <p>Audit a past session: <code>${c} audit --wallet 0x…</code>. Default log = latest Claude Code session for the current directory.</p>
      ${site.npmLive ? copyBox('npx chainfess audit --wallet 0x…') : ''}
      <table class="tbl flags"><caption class="vh">Audit flags</caption><thead><tr><th scope="col">Flag</th><th scope="col">Meaning</th></tr></thead><tbody>${flags.map(([f, m]) => `<tr><td><code>${f}</code></td><td>${m}</td></tr>`).join('')}</tbody></table>
      <p>Exit codes: 0 zero findings, 1 one or more findings, 2 input error, 3 RPC unavailable, 4 partial scan (unscanned ranges remain; findings may still be listed). <code>demo</code> always exits 0.</p>
    </section>
    <section id="rules"><h2>Rules</h2>
      <p>Four outcomes, deterministic, no LLM: Accounted · Partial · <b>Unaccounted</b> · <b>Foreign signer</b>. The rules are on this page. Applied per on-chain tx from a registered wallet in range and per resolved hash from the log whose <code>from</code> is not registered. Precedence top to bottom; the first matching row wins.</p>
      <ol class="rule-list">
      ${rules.map(([n, s, r, l]) => `<li class="${n === '6' || n === '7' ? 'bad' : ''}"><h3>${s}</h3><p><span class="rl-k">Rule</span> ${r}</p><p><span class="rl-k">Label</span> ${l}</p></li>`).join('')}
      </ol>
      <p><b>Finding count</b> = rows 6 + 7 only.</p>
      <p>Flags added to any row (not statuses): <code>reverted</code> (receipt <code>status = 0x0</code>), <code>contract-creation</code> (<code>to = null</code>, show created address from receipt), <code>value</code> in ETH, <code>to</code> label (EOA / contract / token), <code>mentioned-in-text</code>.</p>
      <h3>Sending patterns</h3>
      <p>Matched against the tool call's command in memory only; output carries the pattern name, never the text: <code>cast-send</code>, <code>cast-publish</code>, <code>forge-broadcast</code>, <code>forge-create</code>, <code>raw-rpc</code>, <code>script-with-key</code>. Anything else: none. Tools other than <code>Bash</code>: none (the time-window rule still applies). Tool-call window <code>W(id)</code> = tool call − 5 s to its result + 60 s.</p>
      <h3>The agent's own words</h3>
      <p>The log as a whole is the agent's record; a hash in tool output is accounted. One informational flag per tx: <code>mentioned-in-text</code> ∈ {<code>final</code>, <code>text</code>, <code>none</code>}. <code>text</code> = the full hash or a partial form with the same prefix appears in any assistant <code>text</code> block. <code>final</code> = it appears in the final assistant message: the last entry with <code>type = assistant</code> and <code>isSidechain = false</code> that contains a <code>text</code> block and is not followed by any <code>tool_use</code> in the same <code>sessionId</code> (subagent finals do not count). Shown as a column, summarised as "the agent's own words mention m of n transactions"; never a finding, never coloured red.</p>
      <h3>Reads are not sends</h3>
      <p>A hex string is a transaction only when <code>eth_getTransactionByHash</code> returns one on this chain. Rows 8 to 9 exist so <code>cast tx</code>, <code>cast receipt</code>, <code>cast block</code>, explorer pastes, and txs copied from docs are never findings. Timing alone is never a finding, because any block dump prints fresh third-party hashes inside the call window.</p>
      <p>Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.</p>
    </section>
    <section id="nonce"><h2>Nonce ledger</h2>
      <p>The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.</p>
      <ol class="num">
        <li>Read the wallet's current nonce <code>N</code>. <code>N = 0</code> means the wallet has never sent a transaction, and nothing else is scanned for it.</li>
        <li>Resolve every full hash found in the log once. Only results that are transactions on this chain count.</li>
        <li>Known nonces are the ones those transactions used. Every other number from <code>0</code> to <code>N−1</code> is unknown.</li>
        <li>Scan only the blocks where an unknown nonce can sit: between two known nonces, after the last one, or before the first one, clipped to the session. A run between two consecutive known nonces is provably empty and is not scanned.</li>
      </ol>
      <p>The header line comes from this alone, before any scan: the nonce, how many appear in the log, how many do not, and how many of those fall inside this session's blocks.</p>
    </section>
    <section id="scope"><h2>Scope</h2>
      <p>Works with Claude Code session logs (<code>.jsonl</code>), including subagent transcripts and Foundry <code>broadcast/</code> files. EOA wallets only. Robinhood Chain by default; any EVM RPC with <code>--rpc</code> (then limits apply, unmeasured).</p>
      <p>Default scan cap: 210,000 blocks. Over the cap the CLI refuses with the exact number and the <code>--max-hours</code> / <code>--from-block</code> lines to override. On throttling the CLI backs off, then uses smaller batches, then the fallback RPC. Ranges it still cannot read are listed as unscanned and the exit code is 4.</p>
      <p>Scan speed: about 60 blocks/s, measured on 5 Nov 2026 over 30,000 blocks on the public RPC. At that rate 210,000 blocks (about 6 hours of chain) take about 58 minutes. The plan is the worst case: a scan stops a gap once its nonces are found.</p>
    </section>
    <section id="limits"><h2>Limits</h2>
      <p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>
      <ul>
        <li>EOA only (4337/7702 move no EOA nonce).</li>
        <li>Claude Code logs only.</li>
        <li>A script that signs with another wallet without a recognised key flag or command pattern shows only as "Recent other wallet", not as a finding.</li>
        <li>No balance deltas: the free RPC serves no historic balance.</li>
        <li>Another wallet's hash with no hash label stays local and is not looked up, so it is not listed. That means fewer Foreign signer lines. A value the log labels as a hash is looked up even if it turns out to be something else.</li>
        <li>The default scan cap may refuse a session that has few labelled hashes, because fewer known nonces mean a larger scan. Override it with <code>--max-hours h</code> or a block range (<code>--from-block n --to-block n</code>).</li>
      </ul>
    </section>
    <section id="privacy"><h2>Privacy</h2>
      <p><code>audit</code> and <code>demo</code> run on your machine. The log never leaves it. <code>audit</code>'s only network calls are JSON-RPC reads with block numbers, values the log labels as tx hashes, and your wallet address. A 32-byte value with no such label, or with a key word beside it, is never sent. Only the optional <code>sign</code> contacts our server: it sends the wallets, the block range, a hash of the log, and only hashes of transactions confirmed on chain from a registered wallet; never the log.</p>
      <p>The footer of a report counts both kinds of 32-byte value: "looked up, not a tx" (labelled as a hash, but not a transaction on this chain) and "not looked up, stays local" (no label, or a key word beside it). Local values are still matched against the wallet's transactions found by the scan, so your own transaction stays Accounted; the scan may just be longer.</p>
      <p>Reports show hashes, addresses, values, the tool pattern name, the source kind and a line reference. Never command text, never secrets.</p>
    </section>
    <section id="hook"><h2>Hook</h2>
      <p>Optional: <code>${c} hook install --wallet 0x…</code> adds a SessionEnd hook that audits automatically. <code>hook uninstall</code> removes it and <code>hook status</code> shows it.</p>
    </section>
    <section id="verify"><h2>Verify yourself</h2>
      <p>Verify the rules yourself: <code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>
      ${copyBox(`cast tx <hash> --rpc-url ${RPC}`)}${copyBox(`cast nonce <wallet> --rpc-url ${RPC}`)}
    </section>
    <section id="signed"><h2>Signed report</h2>
      <p>Signed report: burn <span data-burn>${esc(burnText(token))}</span> from the audited wallet, run <code>${c} sign --burn-tx 0x…</code>, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours.</p>
      <p>The signed-report service switches on with the CA. The free CLI never needs the coin.</p>
      <h3>What the server checks</h3>
      <ol class="num">
        <li>The burn tx is mined, at least 50 blocks old, and its receipt status is success.</li>
        <li>Its receipt has a <code>Transfer</code> from the token, from the sender to <code>0x…dEaD</code> or the zero address, for at least the burn amount.</li>
        <li>The sender is one of the audited wallets, which binds the burn to the subject.</li>
        <li>Each burn works once. A second request gets <code>409 already_used</code> with the existing job.</li>
        <li>Range ≤ 210,000 blocks, up to 3 wallets, up to 500 hashes.</li>
      </ol>
      <h3>What the signature means</h3>
      <p>The server vouches for chain facts and for the fact that the client listed those hashes. It never sees the log, so the hashes and the log hash are client claims: a client can list every hash and receive an all-listed statement. Status words are <code>listed</code> / <code>not listed</code>. The statement is not proof that an agent behaved.</p>
      <p>Whoever first submits a burn hash consumes it. Since the burn must come from the audited wallet and the statement is retrievable by burn hash, a stranger gains nothing but could waste the burn of a wallet they watch. That is a limit of this version.</p>
      <p><code>${c} verify &lt;statement.json&gt;</code> checks a statement offline against the public key inside the package.</p>
      ${publicKey ? `<h3>Public key (ed25519)</h3><pre class="pem">${esc(publicKey)}</pre>` : ''}
    </section>
    ${site.repoPublic ? `<p><a href="${GH_URL}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a></p>` : ''}
    </div></div>
  </div></main>`;
  return shell({ title: 'Docs · Chainfess', desc: 'Commands, the deterministic rules, the nonce ledger, scope, limits, privacy, how to verify every number, and the signed report.', path: '/docs', css, site, active: '/docs', body });
}

export function tokenPage({ site, token, css }) {
  const c = cli(site);
  const tax = token.taxBps != null ? `<div><dt>Tax</dt><dd>${(Number(token.taxBps) / 100).toString()}% ${CREATOR_TAX_WORD}</dd></div>` : '';
  const pre = !token.launched;
  const body = `<main class="doc tok"><div class="wrap-n">
    <header class="doc-h"><h1>$${esc(token.symbol)}</h1>
    <p class="lead" data-token-lead>${pre ? `$${esc(token.symbol)} launches 6 Nov 2026 (UTC date; no hour published). No CA exists yet; any $${esc(token.symbol)} you see before it is posted here and on <a href="${X_URL}" rel="noopener">@chainfesspro</a> is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.` : 'The free CLI never needs the coin.'}</p></header>
    <section class="tk-s"><h2>CA</h2>${caSlot(token, { short: true })}</section>
    <section class="tk-s"><h2>What it does</h2>
      <p>Signed report: burn <span data-burn>${esc(burnText(token))}</span> from the audited wallet, ${site.npmLive ? `run <code>${c} sign --burn-tx 0x…</code>` : 'give the CLI\'s <code>sign</code> command the burn transaction'}, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours.</p>
      <p><a href="/docs#signed">Exact rules →</a></p>
    </section>
    <section class="tk-s"><h2>Details</h2>
    <dl class="kv">
      <div><dt>Burn per signed report</dt><dd data-burn>${esc(burnText(token))}</dd></div>
      ${tax}
      <div><dt>Team wallet</dt><dd><code>${esc(token.teamWallet)}</code><p class="kv-n">The team wallet is also the sample-session wallet.</p>${copyBox(`cast balance ${token.teamWallet} --rpc-url ${RPC}`)}</dd></div>
    </dl></section>
    <p class="tok-foot">No promise of returns.</p>
  </div></main>`;
  return shell({ title: `$${token.symbol} · Chainfess`, desc: `$${token.symbol}: the rules of the signed report, and where the only official CA is posted.`, path: '/token', css, site, active: '/token', body });
}

export function notFound({ site, css }) {
  const body = `<main class="doc nf"><div class="wrap-n"><h1>Not on the chart.</h1><p class="lead"><a href="/">Back to the home page →</a></p></div></main>`;
  return shell({ title: 'Not on the chart · Chainfess', desc: 'Not on the chart.', path: '/404', css, site, body });
}

export function llms({ site, token, isDemo }) {
  const c = cli(site);
  return [
    '# Chainfess', '',
    '> Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.', '',
    '## Commands',
    site.npmLive ? '- The CLI is published to npm as `chainfess`; commands below apply once installed.' : '- The npm package is not published yet. These are the commands it provides.',
    ...(site.npmLive ? ['- Try it in 10 seconds, no wallet, no network: `npx chainfess demo`.'] : []),
    `- Audit a past session: \`${c} audit --wallet 0x…\`. Default log = latest Claude Code session for the current directory.`,
    `- \`${c} verify <statement.json>\`: offline check of a signed statement.`, '',
    '## Rules',
    '- Four outcomes, deterministic, no LLM: Accounted · Partial · Unaccounted · Foreign signer.',
    '- Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.',
    "- The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.",
    '- Reports show hashes, addresses, values, the tool pattern name, the source kind and a line reference. Never command text, never secrets.',
    `- Full table: ${SITE}/docs#rules`, '',
    '## Privacy',
    "- `audit` and `demo` run on your machine. The log never leaves it. `audit`'s only network calls are JSON-RPC reads with block numbers, values the log labels as tx hashes, and your wallet address. A 32-byte value with no such label, or with a key word beside it, is never sent. Only the optional `sign` contacts our server: it sends the wallets, the block range, a hash of the log, and only hashes of transactions confirmed on chain from a registered wallet; never the log.", '',
    '## Limits',
    '- Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.',
    "- Another wallet's hash with no hash label stays local and is not looked up, so it is not listed; that means fewer Foreign signer lines. A value the log labels as a hash is looked up even if it is something else.",
    '- The default scan cap may refuse a session with few labelled hashes, because fewer known nonces mean a larger scan. Override with --max-hours or a block range. Scan speed: about 60 blocks/s, measured on 5 Nov 2026 over 30,000 blocks on the public RPC.',
    '- Works with Claude Code session logs (.jsonl), including subagent transcripts and Foundry broadcast/ files. EOA wallets only. Robinhood Chain by default; any EVM RPC with --rpc (then limits apply, unmeasured).', '',
    '## Token',
    token.launched
      ? `- CA: ${token.ca}. The only official CA is the one on ${SITE}/token and on @chainfesspro.`
      : `- $${token.symbol} launches 6 Nov 2026 (UTC). No CA exists yet; any $${token.symbol} you see before it is posted on ${SITE}/token and on @chainfesspro is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.`,
    '- No promise of returns.', '',
    '## Links',
    `- Docs: ${SITE}/docs`,
    `- Sample report${isDemo ? ' (demo: fixture data)' : ''}: ${SITE}/report/sample`,
    `- Token: ${SITE}/token`,
    '- X: https://x.com/chainfesspro',
    ...(site.npmLive ? [`- npm: ${NPM_URL}`] : []),
    ...(site.repoPublic ? [`- GitHub: ${GH_URL}`] : []), '',
  ].join('\n');
}
