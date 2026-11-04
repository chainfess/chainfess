// Static page templates. Public copy comes from BRIEF §1, §2, §3.6, §4, §5 only.
import { esc, shortHash, shortAddr, num, utcTime, utcDate, LABEL, nonceLine } from './util.mjs';
import { renderRecorder, glyph } from './strip.mjs';

const RPC = 'https://robinhood-rpc.publicnode.com';
export const SITE = 'https://chainfess.pro';
const X_URL = 'https://x.com/chainfesspro';
const GH_URL = 'https://github.com/chainfess/chainfess';
const NPM_URL = 'https://www.npmjs.com/package/chainfess';

const copyBox = (cmd, label = 'Copy') => `<div class="cmd"><code>${esc(cmd).replace(/(--[\w-]+ \S+)/g, '<span class="nb">$1</span>')}</code><button type="button" class="cp" data-copy="${esc(cmd)}">${label}</button></div>`;

// CLI name in running text: `npx chainfess …` only once the package is public.
export const cli = (site) => (site.npmLive ? 'npx chainfess' : 'chainfess');

export function caSlot(token, { compact = false, short = false } = {}) {
  const inner = token.launched && /^0x[0-9a-fA-F]{40}$/.test(token.ca) && !/^0x0{40}$/.test(token.ca)
    ? caLive(token)
    : `<p class="ca-pre">${short ? '' : `$${esc(token.symbol)} launches 6 Nov 2026 (UTC). `}No CA yet. The CA will be posted here and on <a href="${X_URL}" rel="noopener">@chainfesspro</a> at launch; only that one is official.</p>`;
  return `<div class="ca-slot${compact ? ' ca-compact' : ''}" data-ca-slot>${inner}</div>`;
}
function caLive(token) {
  return `<div class="cmd ca-box"><code>${esc(token.ca)}</code><button type="button" class="cp" data-copy="${esc(token.ca)}">Copy</button></div>
  <p class="ca-line"><a class="buy" href="https://ponsfamily.com/token/${esc(token.ca)}" rel="noopener">Buy on Pons</a> <span>The only official CA is the one on this page and on <a href="${X_URL}" rel="noopener">@chainfesspro</a>.</span></p>`;
}

// One copy constant: the share of supply burned per signed report. Exact amount comes from the contract at golive.
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

const nav = (active) => `<header class="top"><a class="mark" href="/" aria-label="Chainfess home"><svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true"><path d="M0 15H7L9 16L12 2L15 18L17 13L19 15H26" fill="none" stroke="#141616" stroke-width="1.8" stroke-linejoin="round"/></svg>Chainfess</a>
  <nav aria-label="Main">${[['/docs', 'Docs'], ['/token', 'Token'], ['/report/sample', 'Sample report']].map(([h, t]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav></header>`;

const footer = (site) => `<footer class="foot"><div class="foot-rule" aria-hidden="true"></div><div class="foot-in">
  <nav aria-label="Footer"><a href="/docs">Docs</a><a href="/token">Token</a><a href="/report/sample">Sample report</a>${site.npmLive ? `<a href="${NPM_URL}" rel="noopener">npm</a>` : ''}${site.repoPublic ? `<a href="${GH_URL}" rel="noopener">GitHub</a>` : ''}<a href="${X_URL}" rel="noopener">X</a></nav>
  <p>Not audited. Nothing is prevented. No promise of returns.</p></div></footer>`;

export function shell({ title, desc, path, body, css, head = '', site, active, bodyClass = '' }) {
  const fontPreload = ['azeret-mono', 'instrument-sans'].map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@chainfesspro">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#EEF1E8">
${fontPreload}${head}<style>${css}</style></head>
<body class="${bodyClass}">${bodyClass === 'home' ? '' : nav(active)}${body}${footer(site)}<script src="/site.js" defer></script></body></html>`;
}

export function landing({ site, token, json, isDemo, css }) {
  const w = json.wallets?.[0];
  const rec = renderRecorder(json, { isDemo });
  const line = nonceLine(w);
  const claim = 'Chainfess lists every transaction your agent\'s wallet made that its session log does not account for. Local. No wallet connect. No LLM.';
  const tryRow = site.npmLive
    ? `<div class="tb-r"><div class="tb-k">Try it</div><div class="tb-v">${copyBox('npx chainfess demo')}${copyBox('npx chainfess audit --wallet 0x…')}</div></div>`
    : `<div class="tb-r"><div class="tb-k">Read</div><div class="tb-v"><a class="go" href="/report/sample">${isDemo ? 'Sample report' : 'Sample report: a real session'} <span aria-hidden="true">→</span></a>${isDemo ? '<div class="tb-note">DEMO — fixture data</div>' : ''}</div></div>`;
  const nonceSplit = w ? { n: w.nonce, inLog: w.inLog, uIn: w.uIn, uOut: w.uOut } : {};
  const finding = (json.txs || []).find((t) => t.finding);
  const stops = [
    ['The log writes.', 'Blue pen: transaction hashes in the session log.'],
    ['The chain writes.', `Black pen: what the wallet sent on chain ${json.chainId}.`],
    ...(finding ? [['The gap is circled.', 'Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.']] : []),
    ['The nonce line.', `<span class="nl" data-nonce-line>${esc(line)}</span> The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.`],
  ];
  const stopsHtml = `<ol class="stops" aria-label="How to read the chart">
    <li class="progress" aria-hidden="true"><i></i></li>
    ${stops.map(([a, b], i) => `<li class="stop${i === 0 ? ' on' : ''}" data-stop="${i}"><span class="st-n">${String(i + 1).padStart(2, '0')}</span><b>${esc(a)}</b><span class="st-t">${b}</span></li>`).join('')}
  </ol>`;

  const aria = `Chart recorder strip${isDemo ? ', demo fixture data' : ''}. Blue pen, log: ${rec.layout.ev.filter((e) => e.spec.log).length} marks. Black pen, chain: ${rec.layout.ev.filter((e) => e.spec.chain).length} marks. ${line}.`;

  const hero = `<section class="hero" id="hero">
    ${nav('/')}
    <div class="lede">
      <h1><span class="h-log">Your agent says X.</span><br><span class="h-chain">The chain says Y.</span></h1>
      <p class="sub">${esc(claim)}</p>
    </div>
    <aside class="tb" aria-label="Instrument data">
      ${tryRow}
      <div class="tb-r"><div class="tb-k">Sample</div><div class="tb-v mono-v">${esc(line)}${isDemo ? '<div class="tb-note">DEMO — fixture data</div>' : ''}${site.npmLive ? '<a class="tb-link" href="/report/sample">Sample report <span aria-hidden="true">→</span></a>' : ''}</div></div>
      <div class="tb-r"><div class="tb-k">Block</div><div class="tb-v mono-v"><span data-block class="blk">—</span> <span class="tb-dim">chain 4663, live</span></div></div>
      <div class="tb-r tb-ca"><div class="tb-k">CA</div><div class="tb-v">${caSlot(token, { compact: true })}</div></div>
    </aside>
    ${stopsHtml}
    <figure class="rec" role="img" aria-label="${esc(aria)}" tabindex="0"><div class="rec-in">${rec.html}</div></figure>
  </section>`;

  const c = cli(site);
  const trySection = site.npmLive ? `<section class="sec" id="try"><div class="sec-h"><span class="fig">Fig. 2</span><h2>Run it</h2></div><div class="sec-b run">
      <div><p class="big">Try it in 10 seconds, no wallet, no network: <code>npx chainfess demo</code>.</p>${copyBox('npx chainfess demo')}</div>
      <div><p class="big">Audit a past session: <code>npx chainfess audit --wallet 0x…</code>. Default log = latest Claude Code session for the current directory.</p>${copyBox('npx chainfess audit --wallet 0x…')}</div>
    </div></section>` : '';

  const outcomes = [
    ['Accounted', 'accounted', 'accounted (source: tool_result line 1234 / broadcast)', 'Its full hash appears in a supplied log or a broadcast file.', ''],
    ['Partial', 'partial', 'partial match only (<code>0x1234…abcd</code> at line n)', 'Full hash absent. A shortened form in the log matches. Flagged, not a finding.', 'oc'],
    ['Unaccounted', 'unaccounted', '<b>not in this log</b>', 'Sent by this wallet inside the session, no full or partial match.', 'rd'],
    ['Foreign signer', 'foreign', '<b>signed by a wallet not registered here</b>', 'A sending tool call printed its hash, it was mined inside that call, and its signer is not on the list.', 'rd'],
  ];
  const fig = (n) => `Fig. ${n + (site.npmLive ? 1 : 0)}`;
  const rulesSection = `<section class="sec sec-kv" id="rules"><div class="sec-h"><span class="fig">${fig(2)}</span><h2>Four outcomes</h2></div><div class="sec-b">
    <div class="outc" role="table" aria-label="Four outcomes">
      <div class="oc-h" role="row"><span role="columnheader">Trace</span><span role="columnheader">Outcome</span><span role="columnheader">Rule</span><span role="columnheader">Report line</span></div>
      ${outcomes.map(([name, g, label, rule, tone]) => `<div class="oc-r ${tone}" role="row"><span role="cell">${glyph(g)}</span><span role="cell" class="oc-name">${name}</span><span role="cell">${rule}</span><span role="cell" class="oc-l">${label}</span></div>`).join('')}
    </div>
    <p class="note">Four outcomes, deterministic, no LLM: Accounted · Partial · <b>Unaccounted</b> · <b>Foreign signer</b>. <a href="/docs#rules">The rules are on this page</a>.</p>
  </div></section>`;

  const ledgerCells = w ? ledger(json, w) : '';
  const nonceSection = `<section class="sec" id="nonce"><div class="sec-h"><span class="fig">${fig(3)}</span><h2>Nonce ledger</h2></div><div class="sec-b">
    <p class="big">The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.</p>
    ${ledgerCells}
    <p class="nl-foot">${esc(line)}${isDemo ? ' <em>DEMO — fixture data</em>' : ''} <a href="/report/sample">Sample report →</a></p>
    ${isDemo ? '' : '<p class="note">Sample report: a real session run by the Chainfess team on mainnet.</p>'}
  </div></section>`;

  const localSection = `<section class="sec" id="local"><div class="sec-h"><span class="fig">${fig(4)}</span><h2>What leaves the machine</h2></div><div class="sec-b two">
    <p><code>audit</code> and <code>demo</code> run on your machine. The log never leaves it; <code>audit</code>'s only network calls are JSON-RPC reads with block numbers, tx hashes and your wallet address. Only the optional <code>sign</code> contacts our server: it sends the wallets, block range, hashes and a hash of the log, never the log.</p>
    <p>Reports show hashes, addresses, values, tool name and a line reference. Never command text, never secrets.</p>
  </div></section>
  <section class="sec" id="limits"><div class="sec-h"><span class="fig">${fig(5)}</span><h2>Limits</h2></div><div class="sec-b two">
    <p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>
    <p>Works with Claude Code session logs (<code>.jsonl</code>), including subagent transcripts and Foundry <code>broadcast/</code> files. EOA wallets only. Robinhood Chain by default; any EVM RPC with <code>--rpc</code> (then limits apply, unmeasured).</p>
  </div></section>`;

  const tokenSection = `<section class="sec" id="ca"><div class="sec-h"><span class="fig">${fig(6)}</span><h2>$${esc(token.symbol)}</h2></div><div class="sec-b">
    ${caSlot(token)}
    <p class="note">The free CLI never needs the coin. <a href="/token">Token page →</a></p>
  </div></section>`;

  const motionBoot = `<script>(function(){var d=document.documentElement,w=innerWidth,h=innerHeight;d.classList.add('js');if(w<768||h<620||h>w||matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('m');window.__recBoot=1;var s=['/vendor/gsap.min.js','/vendor/ScrollTrigger.min.js','/hero.js'],t=setTimeout(function(){d.classList.remove('m')},4000);window.__recReady=function(){clearTimeout(t)};s.forEach(function(u){var e=document.createElement('script');e.src=u;e.async=false;e.onerror=function(){clearTimeout(t);d.classList.remove('m')};document.head.appendChild(e)})})()</script>`;

  return shell({
    title: 'Chainfess',
    desc: 'Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.',
    path: '/', css, site, head: motionBoot, active: '/', bodyClass: 'home',
    body: `<main>${hero}${trySection}${rulesSection}${nonceSection}${localSection}${tokenSection}</main>`,
  });
}

function ledger(json, w) {
  if (!w.nonce) return '';
  const byNonce = new Map();
  for (const t of json.txs || []) if ((t.from || '').toLowerCase() === w.address.toLowerCase()) byNonce.set(t.nonce, t);
  const N = Math.min(w.nonce, 64);
  const cells = [];
  for (let i = w.nonce - N; i < w.nonce; i++) {
    const t = byNonce.get(i);
    const cls = !t ? 'nc-u' : t.status === 'unaccounted' ? 'nc-r' : t.status === 'post-session' ? 'nc-o' : t.status === 'partial' ? 'nc-p' : 'nc-a';
    const word = !t ? 'outside this session' : LABEL[t.status] || t.status;
    cells.push(`<li class="nc ${cls}"><span class="nc-n">${i}</span><span class="nc-w">${esc(word)}</span></li>`);
  }
  return `<ol class="ledger" aria-label="Nonces of the sample wallet">${cells.join('')}</ol>`;
}

export function report({ site, json, isDemo, css }) {
  const w = json.wallets?.[0];
  const rec = renderRecorder(json, { isDemo });
  const s = json.session || {};
  const rows = (json.txs || []);
  const group = (name, list, tone) => list.length ? `<section class="rp-g ${tone}"><h2>${esc(name)} <span>(${list.length})</span></h2>
    ${list.map((t) => `<article class="rp-r"><div class="rp-m"><span class="rp-st">${esc(LABEL[t.status] || t.status)}</span><span>nonce ${t.nonce ?? '—'}</span><span>block ${num(t.block)}</span><span>${utcTime(t.time)}</span><span>${esc(t.valueEth)} ETH</span>${t.reverted ? '<span>reverted</span>' : ''}${t.contractCreation ? `<span>contract creation ${esc(shortAddr(t.createdAddress))}</span>` : ''}</div>
      <div class="rp-h"><code class="hash">${esc(t.hash)}</code></div>
      <div class="rp-d"><span>from <code>${esc(t.from)}</code></span><span>to <code>${esc(t.to ?? 'contract creation')}</code>${t.toLabel ? ` (${esc(t.toLabel)})` : ''}</span>${t.source?.kind ? `<span>source ${esc(t.source.kind)}${t.source.line ? ` line ${t.source.line}` : ''}${t.pattern ? ` (${esc(t.pattern)})` : ''}</span>` : ''}<span>mentioned: ${esc(t.mentioned || 'none')}</span></div>
      ${isDemo ? '' : copyBox(`cast tx ${t.hash} --rpc-url ${RPC}`)}</article>`).join('')}</section>` : '';
  const logName = (json.logs?.main?.[0] || '').split(/[\\/]/).pop().replace(/[^\w.\-]/g, '');
  const extras = [json.logs?.subagents ? `+${json.logs.subagents} subagents` : '', json.logs?.broadcast ? `${json.logs.broadcast} broadcast file` : ''].filter(Boolean).join(', ');
  const realNote = `Real session run by the Chainfess team on Robinhood Chain, ${utcDate(s.tStart)}. Wallet ${shortAddr(w?.address)} is the team wallet. An agent sent two 0-ETH self-transfers. A third 0-ETH self-transfer was sent from a second terminal, outside the agent session, while the session was open: that is the line marked "not in this log". It was done on purpose to show what a finding looks like.`;
  const body = `<main class="doc rp">
    <div class="doc-h"><span class="fig">Report</span><h1>Sample report</h1>
    ${isDemo ? '<p class="demo-flag">DEMO — fixture data</p><p class="lead">Generated from the bundled fixture. These hashes are not on chain.</p>' : `<p class="lead">${esc(realNote)}</p>`}</div>
    <dl class="kv">
      <div><dt>Wallet</dt><dd><code>${esc(w?.address)}</code></dd></div>
      <div><dt>Log</dt><dd><code>${esc(logName)}</code>${extras ? ` ${esc(extras)}` : ''}</dd></div>
      <div><dt>Session</dt><dd>${utcDate(s.tStart)} ${utcTime(s.tStart)} to ${utcTime(s.tEnd)}</dd></div>
      <div><dt>Blocks</dt><dd>${num(s.startBlock)} to ${num(s.endBlock)} (${num(s.blocks)} blocks)</dd></div>
      <div><dt>Scan</dt><dd>${num(json.scan?.scannedBlocks)} blocks in ${json.scan?.gaps?.length ?? 0} gap${json.scan?.gaps?.length === 1 ? '' : 's'}</dd></div>
      <div class="kv-n"><dt>Nonce</dt><dd>${esc(nonceLine(w))}</dd></div>
    </dl>
    <figure class="rec rec-flat" role="img" aria-label="Chart recorder strip of this report" tabindex="0"><div class="rec-in">${rec.html.replace(/ id="gm"/, ' id="gm"')}</div></figure>
    ${group('Findings', rows.filter((t) => t.finding), 'g-find')}
    ${group('Accounted', rows.filter((t) => t.status === 'accounted'), '')}
    ${group('Partial', rows.filter((t) => t.status === 'partial'), 'g-oc')}
    ${group('Before or after the session, pending', rows.filter((t) => ['pre-session', 'post-session', 'pending'].includes(t.status)), 'g-oc')}
    ${group('Other wallets referenced', rows.filter((t) => ['observed', 'recent-other'].includes(t.status)), '')}
    <footer class="rp-f">
      <p>${json.summary?.unresolvedHashes ? `${json.summary.unresolvedHashes} hashes in the log are not transactions on chain ${json.chainId}.` : ''}${json.logs?.otherOverlapping ? ` ${json.logs.otherOverlapping} other session logs overlap this range; add them with <code>--log</code> or <code>--all-sessions</code> before drawing conclusions.` : ''}</p>
      <p>Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.</p>
      <p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>
      ${isDemo ? '' : `<p>Verify the rules yourself: <code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>${copyBox(`cast nonce ${w?.address} --rpc-url ${RPC}`)}`}
    </footer>
  </main>`;
  return shell({
    title: isDemo ? 'Sample report (demo) · Chainfess' : 'Sample report · Chainfess',
    desc: isDemo ? 'Sample report layout. DEMO — fixture data.' : 'Sample report: a real session run by the Chainfess team on mainnet.',
    path: '/report/sample', css, site, active: '/report/sample', body,
  });
}

export function docs({ site, css, publicKey, token }) {
  const c = cli(site);
  const rules = [
    ['1', 'Pre-session', 'tx <code>from ∈ wallets</code>, <code>blockNumber &lt; startBlock</code> (only reachable via a hash in the log)', '"sent before this session (referenced in log)" (informational, not a finding)'],
    ['2', 'Post-session', '<code>blockNumber &gt; endBlock</code>', '"sent after this session" (informational)'],
    ['3', 'Pending', 'hash resolved with <code>blockNumber: null</code>', '"pending at audit time; re-run later" (informational)'],
    ['4', 'Accounted', 'tx <code>from ∈ wallets</code>, in range, and its full hash appears in any supplied log (<code>tool_result</code>, <code>tool_use</code>, assistant <code>text</code>, subagent, <code>tool-results/</code>) or in a broadcast file', '"accounted (source: tool_result line 1234 / broadcast)"'],
    ['5', 'Partial', 'in range, full hash absent, but a partial candidate matches its prefix <b>and</b> suffix (or a ≥ 8-hex prefix when no suffix)', '"partial match only (<code>0x1234…abcd</code> at line n)" (not a finding, flagged)'],
    ['6', 'Unaccounted', 'tx <code>from ∈ wallets</code>, in range, no full or partial match', '"<b>not in this log</b>" (the only finding type about our wallet)'],
    ['7', 'Foreign signer', 'resolved tx with <code>from ∉ wallets</code> whose hash first appears in a <code>tool_result</code> of tool-call <code>id</code>, and <code>sendingPattern(id) ≠ null</code> <b>and</b> <code>blockTimestamp(tx) ∈ W(id)</code>', '"<b>signed by a wallet not registered here</b>" (finding; shows <code>from</code>, the pattern name, line)'],
    ['8', 'Recent other wallet', 'resolved tx, <code>from ∉ wallets</code>, <code>blockTimestamp(tx) ∈ W(id)</code>, no sending pattern', '"other wallet\'s tx mined during this tool call; cannot tell a read from a send" (informational, count + expandable list, never a finding)'],
    ['9', 'Observed', 'resolved tx, <code>from ∉ wallets</code>, none of rows 7 to 8', '"other wallet\'s tx referenced (read)" (informational)'],
    ['10', 'Unresolved', 'hash candidate with no tx on this chain (<code>null</code>): block hash, bytes32 salt, testnet tx, other chain', 'counted once in the footer ("n hashes in the log are not transactions on chain 4663"), never listed as a finding'],
  ];
  const toc = [['audit', 'Audit'], ['rules', 'Rules'], ['nonce', 'Nonce ledger'], ['scope', 'Scope'], ['limits', 'Limits'], ['privacy', 'Privacy'], ['verify', 'Verify yourself'], ['signed', 'Signed report']];
  const flags = [
    ['--wallet 0x…', 'Repeatable, required. Lower-cased; checksummed in output.'],
    ['--log f', 'Repeatable. Default = newest <code>~/.claude/projects/&lt;slug(cwd)&gt;/*.jsonl</code>.'],
    ['--all-sessions', 'Include other session logs of the project that overlap the range.'],
    ['--no-subagents', 'Skip <code>S/subagents/*.jsonl</code> and <code>S/tool-results/*</code>.'],
    ['--rpc url, --chain-id n', 'Any EVM RPC (then limits apply, unmeasured).'],
    ['--from ISO, --to ISO', 'Override the session span, UTC.'],
    ['--from-block n, --to-block n', 'Override the block range.'],
    ['--max-hours h', 'Raise the scan cap.'],
    ['--yes', 'Skip the prompt shown when the estimated scan is over 10 min.'],
    ['--json', 'Same whitelisted fields as the text report.'],
    ['--quiet', 'Less output.'],
  ];
  const body = `<main class="doc docs">
    <div class="doc-h"><span class="fig">Docs</span><h1><span class="h-log">Your agent says X.</span><br>The chain says Y.</h1><p class="lead">Chainfess lists every transaction the log does not account for.</p></div>
    <div class="doc-grid">
    <nav class="toc" aria-label="On this page">${toc.map(([id, t], i) => `<a href="#${id}"><span>${String(i + 1).padStart(2, '0')}</span>${t}</a>`).join('')}</nav>
    <div class="doc-body">
    <section id="audit"><h2>Audit</h2>
      ${site.npmLive ? `<p>Try it in 10 seconds, no wallet, no network: <code>npx chainfess demo</code>.</p>${copyBox('npx chainfess demo')}` : ''}
      <p>Audit a past session: <code>${c} audit --wallet 0x…</code>. Default log = latest Claude Code session for the current directory.</p>
      ${site.npmLive ? copyBox('npx chainfess audit --wallet 0x…') : ''}
      <table class="tbl flags"><caption class="vh">Audit flags</caption><thead><tr><th scope="col">Flag</th><th scope="col">Meaning</th></tr></thead><tbody>${flags.map(([f, m]) => `<tr><td><code>${f}</code></td><td>${m}</td></tr>`).join('')}</tbody></table>
      <p>Exit codes: 0 zero findings, 1 one or more findings, 2 input error, 3 RPC unavailable, 4 partial scan (unscanned ranges remain; findings may still be listed).</p>
    </section>
    <section id="rules"><h2>Rules</h2>
      <p>Four outcomes, deterministic, no LLM: Accounted · Partial · <b>Unaccounted</b> · <b>Foreign signer</b>. The rules are on this page. Applied per on-chain tx from a registered wallet in range and per resolved hash from the log whose <code>from</code> is not registered. Precedence top to bottom; the first matching row wins.</p>
      <div class="tbl-w" tabindex="0" role="region" aria-label="Rules table"><table class="tbl rules"><thead><tr><th scope="col">#</th><th scope="col">Status</th><th scope="col">Rule</th><th scope="col">Public label</th></tr></thead><tbody>
      ${rules.map(([n, s, r, l]) => `<tr class="${n === '6' || n === '7' ? 'row-f' : ''}"><td>${n}</td><td class="st">${s}</td><td>${r}</td><td>${l}</td></tr>`).join('')}
      </tbody></table></div>
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
      <ol class="steps">
        <li>Read the wallet's current nonce <code>N</code>. <code>N = 0</code> means the wallet has never sent a transaction, and nothing else is scanned for it.</li>
        <li>Resolve every full hash found in the log once. Only results that are transactions on this chain count.</li>
        <li>Known nonces are the ones those transactions used. Every other number from <code>0</code> to <code>N−1</code> is unknown.</li>
        <li>Scan only the blocks where an unknown nonce can sit: between two known nonces, after the last one, or before the first one, clipped to the session. A run between two consecutive known nonces is provably empty and is not scanned.</li>
      </ol>
      <p>The header line comes from this alone, before any scan: the nonce, how many appear in the log, how many do not, and how many of those fall inside this session's blocks.</p>
    </section>
    <section id="scope"><h2>Scope</h2>
      <p>Works with Claude Code session logs (<code>.jsonl</code>), including subagent transcripts and Foundry <code>broadcast/</code> files. EOA wallets only. Robinhood Chain by default; any EVM RPC with <code>--rpc</code> (then limits apply, unmeasured).</p>
      <p>Default scan cap: 210,000 blocks (≈ 6 h of chain, ≈ 1 h to scan). Over the cap the CLI refuses with the exact number and the <code>--max-hours</code> / <code>--from-block</code> lines to override. The estimate divides planned blocks by about 60 blocks/s, the sustained rate measured on the public RPC on 5 Nov 2026; it may throttle harder, and the CLI shows the measured rate during a scan. On throttling the CLI backs off, then uses smaller batches, then the fallback RPC. Ranges it still cannot read are listed as unscanned and the exit code is 4.</p>
    </section>
    <section id="limits"><h2>Limits</h2>
      <p>Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.</p>
      <ul>
        <li>EOA only (4337/7702 move no EOA nonce).</li>
        <li>Claude Code logs only.</li>
        <li>A script that signs with another wallet without a recognised key flag or command pattern shows only as "Recent other wallet", not as a finding.</li>
        <li>No balance deltas: the free RPC serves no historic balance.</li>
      </ul>
    </section>
    <section id="privacy"><h2>Privacy</h2>
      <p><code>audit</code> and <code>demo</code> run on your machine. The log never leaves it; <code>audit</code>'s only network calls are JSON-RPC reads with block numbers, tx hashes and your wallet address. Only the optional <code>sign</code> contacts our server: it sends the wallets, block range, hashes and a hash of the log, never the log.</p>
      <p>Reports show hashes, addresses, values, tool name and a line reference. Never command text, never secrets.</p>
    </section>
    <section id="verify"><h2>Verify yourself</h2>
      <p>Verify the rules yourself: <code>cast tx &lt;hash&gt;</code> and <code>cast nonce &lt;wallet&gt;</code> reproduce every number.</p>
      ${copyBox(`cast tx <hash> --rpc-url ${RPC}`)}${copyBox(`cast nonce <wallet> --rpc-url ${RPC}`)}
    </section>
    <section id="signed"><h2>Signed report</h2>
      <p>Signed report: burn <span data-burn>${esc(burnText(token))}</span> from the audited wallet, run <code>${c} sign --burn-tx 0x…</code>, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours.</p>
      <p>The signed-report service switches on with the CA. The free CLI never needs the coin.</p>
      <h3>What the server checks</h3>
      <ol class="steps">
        <li>The burn tx is mined, at least 50 blocks old, and its receipt status is success.</li>
        <li>Its receipt has exactly one <code>Transfer</code> from the token, from the sender to <code>0x…dEaD</code> or the zero address, for at least the burn amount.</li>
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
    ${site.repoPublic ? `<p class="chg"><a href="${GH_URL}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a></p>` : ''}
    </div></div>
  </main>`;
  return shell({ title: 'Docs · Chainfess', desc: 'Commands, the deterministic rules, the nonce ledger, scope, limits, privacy, how to verify every number, and the signed report.', path: '/docs', css, site, active: '/docs', body });
}

export function tokenPage({ site, token, css }) {
  const c = cli(site);
  const tax = token.taxBps != null ? `<div><dt>Tax</dt><dd>${(Number(token.taxBps) / 100).toString()}% ${CREATOR_TAX_WORD}</dd></div>` : '';
  const pre = !token.launched;
  const body = `<main class="doc tok">
    <div class="doc-h"><span class="fig">Token</span><h1>$${esc(token.symbol)}</h1>
    <p class="lead" data-token-lead>${pre ? `$${esc(token.symbol)} launches 6 Nov 2026 (UTC date; no hour published). No CA exists yet; any $${esc(token.symbol)} you see before it is posted here and on <a href="${X_URL}" rel="noopener">@chainfesspro</a> is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.` : 'The free CLI never needs the coin.'}</p></div>
    <section class="tk-ca"><h2>CA</h2>${caSlot(token, { short: true })}</section>
    <section class="tk-burn"><h2>What it does</h2>
      <p class="big">Signed report: burn <span data-burn>${esc(burnText(token))}</span> from the audited wallet, run <code>${c} sign --burn-tx 0x…</code>, get an ed25519-signed statement of chain facts that our server re-checked itself. The server never sees your log, so which hashes you listed is your claim, not ours.</p>
      <p><a href="/docs#signed">Exact rules →</a></p>
    </section>
    <dl class="kv">
      <div><dt>Burn</dt><dd data-burn>${esc(burnText(token))}</dd></div>
      ${tax}
      <div><dt>Team wallet</dt><dd><code>${esc(token.teamWallet)}</code></dd></div>
      <div class="kv-n"><dt>Check it</dt><dd>${copyBox(`cast balance ${token.teamWallet} --rpc-url ${RPC}`)}<p class="sm">The team wallet is also the sample-session wallet.</p></dd></div>
    </dl>
    <p class="tok-foot">No promise of returns.</p>
  </main>`;
  return shell({ title: `$${token.symbol} · Chainfess`, desc: `$${token.symbol}: the rules of the signed report, and where the only official CA is posted.`, path: '/token', css, site, active: '/token', body });
}

export function notFound({ site, css }) {
  const body = `<main class="doc nf"><svg class="nf-t" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 60H520" stroke="#1C3F8F" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="M680 60H1200" stroke="#141616" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><h1>Not on the chart.</h1><p><a href="/">Back to the recorder →</a></p></main>`;
  return shell({ title: 'Not on the chart · Chainfess', desc: 'Not on the chart.', path: '/404', css, site, body });
}

export function llms({ site, token, isDemo, json }) {
  const c = cli(site);
  const lines = [
    '# Chainfess',
    '',
    '> Your agent says X. The chain says Y. Chainfess lists every transaction the log does not account for.',
    '',
    '## Commands',
    ...(site.npmLive ? ['- Try it in 10 seconds, no wallet, no network: `npx chainfess demo`.'] : []),
    `- Audit a past session: \`${c} audit --wallet 0x…\`. Default log = latest Claude Code session for the current directory.`,
    `- \`${c} verify <statement.json>\`: offline check of a signed statement.`,
    '',
    '## Rules',
    '- Four outcomes, deterministic, no LLM: Accounted · Partial · Unaccounted · Foreign signer.',
    '- Unaccounted means "not in this log". A human, a cron job or another session on the same wallet produces the same line. Chainfess does not say who sent it.',
    "- The wallet's nonce says how many transactions it has ever sent. The report shows how many of them this log explains.",
    '- Reports show hashes, addresses, values, tool name and a line reference. Never command text, never secrets.',
    `- Full table: ${SITE}/docs#rules`,
    '',
    '## Privacy',
    "- `audit` and `demo` run on your machine. The log never leaves it; `audit`'s only network calls are JSON-RPC reads with block numbers, tx hashes and your wallet address. Only the optional `sign` contacts our server: it sends the wallets, block range, hashes and a hash of the log, never the log.",
    '',
    '## Limits',
    '- Not audited. Nothing is prevented. An agent with shell access can edit its own local log; chain facts stay true, log-based lines then mislead.',
    '- Works with Claude Code session logs (.jsonl), including subagent transcripts and Foundry broadcast/ files. EOA wallets only. Robinhood Chain by default; any EVM RPC with --rpc (then limits apply, unmeasured).',
    '',
    '## Token',
    token.launched
      ? `- CA: ${token.ca}. The only official CA is the one on ${SITE}/token and on @chainfesspro.`
      : `- $${token.symbol} launches 6 Nov 2026 (UTC). No CA exists yet; any $${token.symbol} you see before it is posted on ${SITE}/token and on @chainfesspro is not ours. The signed-report service switches on with the CA. The free CLI never needs the coin.`,
    '- No promise of returns.',
    '',
    '## Links',
    `- Docs: ${SITE}/docs`,
    `- Sample report${isDemo ? ' (DEMO — fixture data)' : ''}: ${SITE}/report/sample`,
    `- Token: ${SITE}/token`,
    '- X: https://x.com/chainfesspro',
    ...(site.npmLive ? [`- npm: ${NPM_URL}`] : []),
    ...(site.repoPublic ? [`- GitHub: ${GH_URL}`] : []),
    '',
  ];
  return lines.join('\n');
}
