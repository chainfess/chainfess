// The instrument: a paper strip with two labelled rows, drawn from audit JSON at build time.
// Plain words only. Block numbers, nonces and hashes live in the report and docs.
import { esc } from './util.mjs';

const Y = { log: 362.5, chain: 862.5 }; // baselines in a 1000-tall viewBox
const AMP = { log: 225, chain: 250 };
const SPIKE_W = 24; // half-width in a 2000-wide viewBox

// Damped pen response: a sharp stroke plus two small bounces. Same on both pens.
function spike(x, base, amp) {
  const w = SPIKE_W / 16;
  return [[-16, 0], [-7, 0.07], [-3, 0.02], [0, -1], [5, 0.22], [10, -0.11], [15, 0.05], [21, -0.015], [28, 0]]
    .map(([dx, k]) => [+(x + dx * w).toFixed(1), +(base + k * amp).toFixed(1)]);
}
const toD = (pts) => 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L');

// Only the wallet's own transactions inside the session: that is what the two rows compare.
export function stripEvents(json) {
  const ownStatus = new Set(['accounted', 'partial', 'unaccounted']);
  const ev = (json.txs || []).filter((t) => ownStatus.has(t.status) && t.block != null).sort((a, b) => a.block - b.block).slice(0, 8);
  const n = ev.length;
  return ev.map((t, i) => ({ t, f: +(0.16 + ((i + 0.5) / Math.max(n, 1)) * 0.58).toFixed(4), logged: t.status !== 'unaccounted' }));
}

function trace(evs, pen) {
  const x = (f) => 1000 + f * 1000;
  const pts = [[0, Y[pen]]];
  for (const e of evs) {
    if (pen === 'log' && !e.logged) continue;
    pts.push(...spike(x(e.f), Y[pen], AMP[pen] * (pen === 'log' && e.t.status === 'partial' ? 0.5 : 1)));
  }
  pts.push([2000, Y[pen]]);
  return pts;
}

// Hand-drawn, nearly closed loop with overshoot. Seeded by position so it differs per mark.
function pencilLoop(seed) {
  const r = (i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  const n = 34; let d = '';
  for (let i = 0; i <= n; i++) {
    const a = -2.2 + (i / 30) * Math.PI * 2;
    const w = 1 + (r(i) - 0.5) * 0.045 + (i / n) * 0.05;
    d += `${i ? 'L' : 'M'}${(40 + Math.cos(a) * 32 * w).toFixed(1)} ${(60 + Math.sin(a) * 50 * w).toFixed(1)}`;
  }
  return d;
}

export function renderStrip(json) {
  const evs = stripEvents(json);
  const miss = evs.filter((e) => !e.logged);
  const first = miss[0];
  const svg = (pen, cls) => `<svg class="tr-svg" viewBox="0 0 2000 1000" preserveAspectRatio="none" aria-hidden="true"><path class="tr ${cls}" d="${toD(trace(evs, pen))}"/></svg>`;
  const clip = (pen, cls) => `<div class="clip" aria-hidden="true"><div class="feed feed-t">${svg(pen, cls)}</div></div>`;

  const marks = miss.map((e, i) => `<svg class="loop" style="left:${(e.f * 100).toFixed(2)}%" viewBox="0 0 80 120" preserveAspectRatio="none" aria-hidden="true"><path class="gp" pathLength="1" d="${pencilLoop(e.f * 1000 + i)}"/></svg>`).join('');
  const label = first ? `<div class="miss" style="left:${(first.f * 100).toFixed(2)}%"><span class="miss-t">Not in this log</span><i class="miss-l" aria-hidden="true"></i></div>` : '';

  const data = {
    fy: { log: Y.log / 1000, chain: Y.chain / 1000 },
    pts: { log: trace(evs, 'log'), chain: trace(evs, 'chain') },
    f0: evs[0]?.f ?? 0,
  };
  const nLog = evs.filter((e) => e.logged).length;
  const aria = first
    ? `Two rows drawn from an audit. What the chain shows: ${evs.length} transactions. What the log shows: ${nLog} of them. One is circled in red: not in this log.`
    : `Two rows drawn from an audit. What the chain shows: ${evs.length} transactions. What the log shows: ${nLog} of them.`;

  return `<div class="inst" role="img" aria-label="${esc(aria)}">
    <div class="inst-shadow" aria-hidden="true"></div>
    <div class="inst-plane">
      <div class="sheet">
        <div class="feed feed-p" aria-hidden="true"></div>
        <div class="row-rule" aria-hidden="true"></div>
        ${clip('log', 'log')}${clip('chain', 'chain')}
        <span class="row-l row-log">What the log shows</span>
        <span class="row-l row-chain">What the chain shows</span>
        <div class="marks">${marks}${label}</div>
      </div>
      <div class="roller" aria-hidden="true"></div>
      <div class="body" aria-hidden="true"><i class="screw s1"></i><i class="screw s2"></i></div>
      ${['log', 'chain'].map((p) => `<div class="arm arm-${p}" data-pen="${p}" aria-hidden="true"><i class="arm-sh"></i><i class="bar"></i><i class="ink"></i><i class="nib"></i><i class="boss"></i></div>`).join('')}
      <div class="lip" aria-hidden="true"></div>
    </div>
    <script type="application/json" class="inst-data">${JSON.stringify(data)}</script>
  </div>`;
}

// Small one-off trace pair for the outcomes list. Fixed size; carries no text.
export function glyph(kind) {
  const w = 132, yL = 26, yC = 64, a = 20, x = 62;
  const line = (y, pts) => (pts ? `M0 ${y}${pts.map((p) => `L${p[0]} ${p[1]}`).join('')}L${w} ${y}` : `M0 ${y}H${w}`);
  const sp = (y, k = 1) => [[-11, 0], [-5, 0.07], [0, -1], [4, 0.22], [8, -0.11], [12, 0.05], [17, 0]].map(([d, m]) => [x + d, +(y + m * a * k).toFixed(1)]);
  let log = line(yL, sp(yL)), chain = line(yC, sp(yC)), extra = '';
  if (kind === 'partial') log = line(yL, sp(yL, 0.5));
  if (kind === 'unaccounted') { log = line(yL); extra = `<ellipse cx="${x + 1}" cy="${yC - a / 2 + 2}" rx="17" ry="21" class="g-r"/>`; }
  if (kind === 'foreign') { chain = line(yC); extra = `<path d="M${sp(yC).map((p) => p.join(' ')).join('L')}" class="g-c" stroke-dasharray="3 2.5"/><ellipse cx="${x + 1}" cy="${yC - a / 2 + 2}" rx="17" ry="21" class="g-r"/>`; }
  return `<svg class="glyph" width="${w}" height="88" viewBox="0 0 ${w} 88" aria-hidden="true"><path d="${log}" class="g-l"/><path d="${chain}" class="g-c"/>${extra}</svg>`;
}
