// The chart recorder, rendered from audit JSON at build time.
// Paper coordinates equal plane coordinates in the final frame (dx = 0); motion only translates layers.
import { esc, shortHash, utcTime, utcHM, utcDate, num, shortAddr } from './util.mjs';

export const G = {
  W: 1440, H: 500, paperTop: 20, paperBot: 486, gridTop: 62, gridBot: 418, rulerBot: 468,
  baseLog: 196, baseChain: 348, amp: 84,
  tipLog: 1210, tipChain: 1030, platenX: 1286, pivotX: 1405,
};
const LEN = { log: G.pivotX - G.tipLog, chain: G.pivotX - G.tipChain };
const MAX_SPIKES = 14;

// Damped pen response: a sharp stroke plus two small bounces. Same transfer function on both pens.
function spike(x, base, amp) {
  return [[-16, 0], [-7, 0.07], [-3, 0.02], [0, -1], [5, 0.22], [10, -0.11], [15, 0.05], [21, -0.015], [28, 0]]
    .map(([dx, k]) => [x + dx, +(base + k * amp).toFixed(1)]);
}

function spec(tx) {
  switch (tx.status) {
    case 'accounted': return { log: 1, chain: 'solid', tone: 'ink' };
    case 'partial': return { log: 0.5, chain: 'solid', tone: 'ochre' };
    case 'unaccounted': return { log: 0, chain: 'solid', tone: 'red', mark: true };
    case 'foreign-signer': return { log: 1, chain: 'dash', tone: 'red', mark: true };
    case 'pre-session': return { log: 1, chain: 'solid', tone: 'mute' };
    case 'post-session': return { log: 0, chain: 'solid', tone: 'mute' };
    case 'pending': return { log: 1, chain: 0, tone: 'ochre' };
    case 'observed': return { log: 0.42, chain: 0, tone: 'mute' };
    default: return null;
  }
}

export function layout(json) {
  const s = json.session || {};
  const all = (json.txs || []).filter((t) => spec(t));
  const rank = (t) => (t.finding ? 0 : t.status === 'accounted' ? 1 : 2);
  let shown = all;
  if (all.length > MAX_SPIKES) {
    shown = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SPIKES);
  }
  const byBlock = (a, b) => (a.block ?? Infinity) - (b.block ?? Infinity);
  const before = shown.filter((t) => t.block != null && t.block < s.startBlock).sort(byBlock);
  const after = shown.filter((t) => t.block == null || t.block > s.endBlock).sort(byBlock);
  const inside = shown.filter((t) => t.block != null && t.block >= s.startBlock && t.block <= s.endBlock).sort(byBlock);

  const count = shown.length;
  const I = Math.max(168, Math.min(238, 880 / (count + 0.9)));
  let pos = 0;
  const ev = [];
  for (const t of before) { ev.push({ t, x: pos }); pos += I; }
  const xS = pos - (before.length ? I * 0.45 : 0);
  pos = xS + I * 0.62;
  for (const t of inside) { ev.push({ t, x: pos }); pos += I; }
  const xE = pos - I * 0.42;
  pos = xE + I * 0.62;
  for (const t of after) { ev.push({ t, x: pos }); pos += I; }
  const last = after.length ? pos - I : xE;
  const shift = G.tipChain - 34 - last;
  ev.forEach((e) => { e.x = Math.round(e.x + shift); e.spec = spec(e.t); });
  return { ev, xS: Math.round(xS + shift), xE: Math.round(xE + shift), hidden: all.length - shown.length, I };
}

function tracePoints(ev, pen, xMin, xMax) {
  const base = pen === 'log' ? G.baseLog : G.baseChain;
  const pts = [[xMin, base]];
  for (const e of ev) {
    const k = pen === 'log' ? e.spec.log : e.spec.chain ? 1 : 0;
    if (!k) continue;
    pts.push(...spike(e.x, base, G.amp * k));
  }
  pts.push([xMax, base]);
  return pts;
}
const toD = (pts) => 'M' + pts.map((p) => `${p[0]} ${p[1]}`).join('L');

function leader(x, y, len, cls = '') {
  const lx = x + 14, ly = y - 14;
  return `<path class="ld ${cls}" d="M${x} ${y}L${lx} ${ly}H${lx + len}"/>`;
}
const T = (x, y, cls, s) => `<text x="${x}" y="${y}" class="${cls}">${esc(s)}</text>`;

// Hand-drawn closed-ish loop with overshoot, seeded by position so it differs per mark.
function pencilLoop(cx, cy, rx, ry, seed) {
  const r = (i) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  const n = 34; let d = '';
  for (let i = 0; i <= n; i++) {
    const a = -2.2 + (i / 30) * Math.PI * 2;
    const w = 1 + (r(i) - 0.5) * 0.045 + (i / n) * 0.05;
    const x = cx + Math.cos(a) * rx * w;
    const y = cy + Math.sin(a) * ry * w;
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function annotations(json, L) {
  const out = [];
  const s = json.session || {};
  const flag = (x, a, b, at) => `<g class="an" data-pen="log" data-at="${at}">
    <path class="cl" d="M${x} ${G.gridTop + 2}V${G.gridBot}"/>
    ${T(x + 8, 76, 'lb up', a)}${T(x + 8, 90, 'lb mu', b)}</g>`;
  out.push(flag(L.xS, 'Session start', `${utcHM(s.tStart)} UTC`, L.xS));
  out.push(flag(L.xE, 'Session end', `${utcHM(s.tEnd)} UTC`, L.xE));

  let prevEv = null;
  for (const e of L.ev) {
    const { t, x, spec: sp } = e;
    const logPeak = G.baseLog - G.amp * (sp.log || 0);
    // twin connector between the channels
    const hasLog = !!sp.log, hasChain = !!sp.chain;
    if (hasLog) {
      const src = t.source?.kind ? `${t.source.kind}${t.source.line ? ` L${t.source.line}` : ''}` : 'in the log';
      out.push(`<g class="an" data-pen="log" data-at="${x}">
        ${leader(x, logPeak, 106, 'bl')}
        ${T(x + 16, logPeak - 18, 'lb bl', shortHash(t.hash))}
        ${T(x + 16, logPeak - 1, 'lb mu', src)}</g>`);
    }
    if (hasChain) {
      const chainPeak = G.baseChain - G.amp;
      let group = '';
      if (hasLog) group += `<path class="tw" d="M${x} ${G.baseLog + 22}V${chainPeak - 4}"/>`;
      if (sp.mark) {
        const big = t.status === 'unaccounted' ? ['not in this log'] : ['signed by a wallet', 'not registered here'];
        const cy = G.baseChain - G.amp / 2 + 2, rx = 44, ry = 62;
        if (!hasLog) {
          group += `<path class="tw rd" d="M${x} ${G.baseLog + 7}V${cy - ry - 3}"/><circle class="ring" cx="${x}" cy="${G.baseLog}" r="6"/>`;
        }
        const lx = x + 46, ly = 394, lw = Math.max(...big.map((b) => b.length)) * 9.9 + 8;
        group += `<path class="ld rd" d="M${x + 27} ${cy + 49}L${lx} ${ly}H${lx + lw}"/>`;
        big.forEach((b, i) => { group += T(lx + 2, ly - 5 - (big.length - 1 - i) * 16, 'fd', b); });
        group += T(lx + 2, ly + 15, 'lb rt', `nonce ${t.nonce} · ${utcTime(t.time)}`);
        out.push(`<g class="an" data-pen="chain" data-at="${x}">${group}</g>`);
        out.push(`<g class="mk" data-at="${x}" data-tone="red"><path class="gp" pathLength="1" d="${pencilLoop(x + 3, cy, rx, ry, x)}"/><path class="gp2" d="${pencilLoop(x + 3, cy, rx, ry, x)}"/></g>`);
      } else {
        const toneCls = sp.tone === 'ochre' ? 'oc' : sp.tone === 'mute' ? 'mu' : 'up';
        const word = t.status === 'accounted' ? 'accounted' : t.status === 'partial' ? 'partial match' : t.status === 'post-session' ? 'after the session' : 'before the session';
        group += leader(x, chainPeak, 106, 'ik');
        group += T(x + 16, chainPeak - 18, `lb${toneCls === 'oc' ? ' oc' : ''}`, word);
        group += T(x + 16, chainPeak - 1, 'lb mu', `nonce ${t.nonce} · ${utcHM(t.time)}${L.I >= 205 ? ' UTC' : ''}`);
        out.push(`<g class="an" data-pen="chain" data-at="${x}">${group}</g>`);
      }
    } else {
      // log-only events: a read, or still pending
      const word = t.status === 'observed' ? "other wallet's tx (read)" : 'pending at audit time';
      out.push(`<g class="an" data-pen="log" data-at="${x}">
        <path class="tw" d="M${x} ${G.baseLog + 16}V${G.baseLog + 44}"/>
        ${T(x + 8, G.baseLog + 42, t.status === 'pending' ? 'lb oc' : 'lb mu', word)}</g>`);
    }
    // ruler: event tick, block number, blocks between events
    const blockTxt = t.block != null ? `${num(t.block)}` : 'pending';
    let r = `<path class="rt-tick ${sp.mark ? 'rd' : ''}" d="M${x} ${G.gridBot}V${G.gridBot + 24}"/>`;
    r += `<text x="${x}" y="${G.gridBot + 37}" text-anchor="middle" class="lb sm${sp.mark ? ' rt' : ''}">${blockTxt}</text>`;
    if (prevEv && prevEv.t.block != null && t.block != null && t.block > prevEv.t.block) {
      const mid = Math.round((prevEv.x + x) / 2);
      r += `<g class="dl"><path d="M${mid - 4} ${G.gridBot + 15}l4 -7M${mid + 1} ${G.gridBot + 15}l4 -7"/><text x="${mid}" y="${G.gridBot + 4 + 44}" text-anchor="middle" class="lb sm mu">+${num(t.block - prevEv.t.block)} blk</text></g>`;
    }
    out.push(`<g class="an" data-pen="chain" data-at="${x}">${r}</g>`);
    prevEv = e;
  }
  return out.join('');
}

function paperLayer(json, xMin, xMax, isDemo) {
  const w = json.wallets?.[0];
  const stamp = isDemo
    ? `DEMO — fixture data  ·  chain ${json.chainId}  ·  wallet ${shortAddr(w?.address)}  ·  ${utcDate(json.session?.tStart)} UTC`
    : `Sample session  ·  chain ${json.chainId}  ·  wallet ${shortAddr(w?.address)}  ·  ${utcDate(json.session?.tStart)} UTC`;
  let legends = '';
  for (let x = Math.ceil(xMin / 1000) * 1000 + 40; x < xMax; x += 1000) legends += `<text x="${x}" y="52" class="lg${isDemo ? ' demo' : ''}" xml:space="preserve">${esc(stamp)}</text>`;
  return `<path d="M${xMin} ${G.gridTop}H${xMax}M${xMin} ${G.gridBot}H${xMax}" stroke="#141616" stroke-width="1"/>
  <path d="M${xMin} ${G.baseLog}H${xMax}M${xMin} ${G.baseChain}H${xMax}" stroke="#AEB9A8" stroke-width=".9" stroke-dasharray="2 4"/>${legends}`;
}

function arm(pen) {
  const L = LEN[pen];
  const color = pen === 'log' ? '#1C3F8F' : '#141616';
  const tag = pen === 'log' ? 'PEN 1 · LOG' : 'PEN 2 · CHAIN';
  const tagW = pen === 'log' ? 92 : 112;
  const base = pen === 'log' ? G.baseLog : G.baseChain;
  // Local svg: origin at x=0 is the nib, pivot at x = L. Canvas padded for rotation.
  const pad = 30, H = 68, cy = H / 2;
  const bar = `<rect x="66" y="${cy - 7}" width="${L - 66}" height="4" fill="#C9CDD0"/><rect x="66" y="${cy - 3}" width="${L - 66}" height="4" fill="#A9AFB3"/><rect x="66" y="${cy + 1}" width="${L - 66}" height="3" fill="#8C9399"/><rect x="66" y="${cy + 4}" width="${L - 66}" height="3" fill="#6F767C"/><path d="M66 ${cy - 7.5}H${L}M66 ${cy + 7.5}H${L}" stroke="#141616"/>`;
  const nib = `<path d="M0 ${cy}L18 ${cy - 3.2}H30V${cy + 3.2}H18Z" fill="${color}"/><rect x="30" y="${cy - 11}" width="38" height="22" rx="2" fill="${color}"/><path d="M38 ${cy - 11}v22M60 ${cy - 11}v22" stroke="#EEF1E8" stroke-width=".7" opacity=".55"/><rect x="42" y="${cy - 8}" width="14" height="3" fill="#EEF1E8" opacity=".35"/>`;
  const plate = `<rect x="${L - 110 - tagW}" y="${cy - 12}" width="${tagW}" height="24" fill="${color}"/><text x="${L - 110 - tagW / 2}" y="${cy + 4}" text-anchor="middle" class="tg">${tag}</text>`;
  const pivot = `<circle cx="${L}" cy="${cy}" r="25" fill="#8C9399" stroke="#141616"/><circle cx="${L}" cy="${cy}" r="18" fill="#C9CDD0" stroke="#141616" stroke-width=".7"/><circle cx="${L}" cy="${cy}" r="11" fill="#A9AFB3" stroke="#141616" stroke-width=".7"/><circle cx="${L}" cy="${cy}" r="5" fill="#6F767C"/><path d="M${L - 4} ${cy + 3}L${L + 4} ${cy - 3}" stroke="#EEF1E8" stroke-width="1.4"/>`;
  const svg = (inner, cls) => `<svg class="${cls}" data-pen="${pen}" width="${L + pad + 24}" height="${H}" viewBox="0 0 ${L + pad + 24} ${H}" style="left:${G.tipLog - G.tipLog + (pen === 'log' ? G.tipLog : G.tipChain)}px;top:${base - cy}px;transform-origin:${L}px ${cy}px" aria-hidden="true">${inner}</svg>`;
  const shadowBody = `<path d="M2 ${cy}L30 ${cy - 10}H68V${cy - 7}H${L}V${cy + 7}H68V${cy + 10}H30Z" fill="#141616"/><circle cx="${L}" cy="${cy}" r="25" fill="#141616"/>`;
  const phi0 = (Math.asin(16 / L) * 180 / Math.PI).toFixed(2);
  const shadow = svg(shadowBody, 'arm-sh').replace('style="', `data-phi0="${phi0}" style="transform:translate(0,16px) rotate(${phi0}deg);`);
  return shadow + svg(bar + nib + plate + pivot, 'arm');
}

function housing(json) {
  const px = G.platenX, W = 46;
  const bands = [[0, 5, '#6F767C'], [5, 7, '#8C9399'], [12, 8, '#A9AFB3'], [20, 7, '#C9CDD0'], [27, 7, '#A9AFB3'], [34, 7, '#8C9399'], [41, 5, '#6F767C']];
  const platen = bands.map(([o, w, c]) => `<rect x="${px + o}" y="4" width="${w}" height="${G.H - 8}" fill="${c}"/>`).join('');
  const shadowOnPaper = `<rect x="${px - 12}" y="${G.paperTop}" width="12" height="${G.paperBot - G.paperTop}" fill="#141616" opacity=".07"/>`;
  const X = px + W;
  const body = `<rect x="${X}" y="0" width="520" height="${G.H}" fill="#D7DBD8"/><path d="M${X} 0V${G.H}" stroke="#141616"/><path d="M${X + 6} 0V${G.H}" stroke="#8C9399" stroke-width=".7"/><path d="M${X} .5H${X + 520}M${X} ${G.H - .5}H${X + 520}" stroke="#141616"/>`;
  const screw = (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="#A9AFB3" stroke="#141616" stroke-width=".7"/><path d="M${x - 3} ${y + 2}L${x + 3} ${y - 2}" stroke="#141616" stroke-width=".9"/>`;
  const plate = `<rect x="${X + 16}" y="214" width="86" height="104" fill="#EEF1E8" stroke="#141616"/>${screw(X + 22, 220)}${screw(X + 96, 220)}${screw(X + 22, 312)}${screw(X + 96, 312)}
   <text x="${X + 59}" y="240" text-anchor="middle" class="lb sm">LOG</text><text x="${X + 59}" y="282" text-anchor="middle" class="lb sm">CHAIN</text>`;
  const caps = `<rect x="${px - 3}" y="0" width="${W + 6}" height="16" fill="#8C9399" stroke="#141616"/><rect x="${px - 3}" y="${G.H - 16}" width="${W + 6}" height="16" fill="#8C9399" stroke="#141616"/>${screw(px + 23, 8)}${screw(px + 23, G.H - 8)}<path d="M${px} 16V${G.H - 16}M${px + W} 16V${G.H - 16}" stroke="#141616" stroke-width=".8"/>`;
  return `<svg class="hs" width="${G.W + 300 - px + 20}" height="${G.H}" viewBox="${px - 20} 0 ${G.W + 300 - px + 20} ${G.H}" style="left:${px - 20}px" aria-hidden="true">${shadowOnPaper}${platen}${caps}${body}${screw(X + 30, 30)}${screw(X + 30, G.H - 30)}${plate}</svg>`;
}

export function renderRecorder(json, { isDemo }) {
  const L = layout(json);
  const firstX = L.ev[0]?.x ?? 0;
  const xMin = Math.floor(Math.min(-2300, firstX - 2400) / 100) * 100;
  const xMax = 1500;
  const ptsLog = tracePoints(L.ev, 'log', xMin, xMax);
  const ptsChain = tracePoints(L.ev, 'chain', xMin, xMax);
  // solid chain trace leaves foreign spikes out: those draw dashed, because that signer is not our wallet.
  const solidEv = L.ev.filter((e) => e.spec.chain === 'solid');
  const chainSolid = tracePoints(solidEv, 'chain', xMin, xMax);
  const dashed = L.ev.filter((e) => e.spec.chain === 'dash').map((e) => `<path class="tr dash" d="${toD(spike(e.x, G.baseChain, G.amp))}"/>`).join('');
  const w = xMax - xMin;
  const svgLayer = (cls, inner) => `<svg class="ly ${cls}" width="${w}" height="${G.H}" viewBox="${xMin} 0 ${w} ${G.H}" style="left:${xMin}px" aria-hidden="true">${inner}</svg>`;
  const clip = (pen, tip, inner) => `<div class="clip" data-clip="${pen}" style="width:${tip + 4000}px;left:-4000px"><div class="clip-in" style="left:4000px">${inner}</div></div>`;

  const finding = L.ev.find((e) => e.spec.mark);
  const firstTwin = L.ev.find((e) => e.spec.log && e.spec.chain) || L.ev.find((e) => e.spec.chain) || L.ev[0];
  const firstLog = L.ev.find((e) => e.spec.log) || L.ev[0];
  const dxFor = (x, tip, off) => tip - off - x;
  const stops = {
    d0: dxFor(firstTwin?.x ?? firstLog?.x ?? 0, G.tipLog, 44),
    d1: dxFor(firstTwin?.x ?? 0, G.tipChain, 56),
    d2: finding ? dxFor(finding.x, G.tipChain, 96) : null,
    d3: 0,
  };
  // Monotonic: paper only moves one way.
  if (stops.d1 > stops.d0) stops.d1 = stops.d0;
  if (stops.d2 != null && stops.d2 > stops.d1) stops.d2 = stops.d1;
  if (stops.d3 > (stops.d2 ?? stops.d1)) stops.d3 = 0;

  const countLog = L.ev.filter((e) => e.spec.log).length;
  const countChain = L.ev.filter((e) => e.spec.chain).length;
  const data = {
    tips: { log: G.tipLog, chain: G.tipChain }, len: LEN,
    base: { log: G.baseLog, chain: G.baseChain }, stops,
    pts: { log: ptsLog.filter((p, i) => i === 0 || i === ptsLog.length - 1 || p[0] > xMin), chain: ptsChain },
    logXs: L.ev.filter((e) => e.spec.log).map((e) => e.x), chainXs: L.ev.filter((e) => e.spec.chain).map((e) => e.x),
    w: G.W, h: G.H,
  };
  const html = `<div class="plane-shadow" aria-hidden="true"></div>
  <div class="plane">
    <div class="pp mv" style="left:${xMin}px;width:${w}px"><i class="pp-g"></i><i class="pp-r"></i><i class="pp-p pp-p1"></i><i class="pp-p pp-p2"></i></div>
    ${svgLayer('paper mv', paperLayer(json, xMin, xMax, isDemo))}
    ${clip('log', G.tipLog, svgLayer('mv', `<path class="tr log" d="${toD(ptsLog)}"/>`))}
    ${clip('chain', G.tipChain, svgLayer('mv', `<path class="tr chain" d="${toD(chainSolid)}"/>${dashed}`))}
    ${svgLayer('annos mv', annotations(json, L))}
    ${housing(json)}
    <div class="ct ct-log" data-count="log" data-final="${countLog}" aria-hidden="true">${String(countLog).padStart(2, '0')}</div>
    <div class="ct ct-chain" data-count="chain" data-final="${countChain}" aria-hidden="true">${String(countChain).padStart(2, '0')}</div>
    ${arm('chain')}${arm('log')}
    <div class="face" aria-hidden="true"></div>
  </div>
  <script type="application/json" id="rec-data">${JSON.stringify(data)}</script>`;
  return { html, layout: L, hasFinding: !!finding };
}

// Flat small glyphs: one log channel and one chain channel, for the outcomes table.
export function glyph(kind) {
  const w = 170, h = 74, yL = 28, yC = 66, a = 22, x = 78;
  const line = (y, pts) => (pts ? `M0 ${y}${pts.map((p) => `L${p[0]} ${p[1]}`).join('')}L${w} ${y}` : `M0 ${y}H${w}`);
  const sp = (y, k = 1) => spike(x, y, a * k);
  let log = line(yL, sp(yL)), chain = line(yC, sp(yC)), extra = '', chainCls = 'g-c';
  if (kind === 'partial') { log = line(yL, sp(yL, 0.5)); extra = `<path d="M${x - 10} ${yL - 18}h20" class="g-o"/>`; }
  if (kind === 'unaccounted') {
    log = line(yL);
    extra = `<ellipse cx="${x + 2}" cy="${yC - a / 2 + 1}" rx="19" ry="23" class="g-r"/><circle cx="${x}" cy="${yL}" r="3.5" class="g-r1"/>`;
  }
  if (kind === 'foreign') {
    chain = line(yC); chainCls = 'g-c';
    extra = `<path d="${toD(sp(yC))}" class="g-c" stroke-dasharray="3 2.5"/><ellipse cx="${x + 2}" cy="${yC - a / 2 + 1}" rx="19" ry="23" class="g-r"/>`;
  }
  return `<svg class="glyph" width="${w}" height="${h + 6}" viewBox="0 0 ${w} ${h + 6}" aria-hidden="true"><path d="${log}" class="g-l"/><path d="${chain}" class="${chainCls}"/>${extra}</svg>`;
}
