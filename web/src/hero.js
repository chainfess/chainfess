// Chart recorder motion. Paper only moves left; both pens stay at fixed tips and swing to whatever the trace is at their tip.
// Only transforms and opacity change per frame.
(function () {
  var d = document.documentElement, root = document.querySelector('.hero'), rec = document.querySelector('.rec');
  var el = document.getElementById('rec-data');
  if (!window.gsap || !window.ScrollTrigger || !root || !el) { d.classList.remove('m'); return; }
  if (window.__recReady) window.__recReady();
  var D = JSON.parse(el.textContent);
  gsap.registerPlugin(ScrollTrigger);

  var movers = [].slice.call(rec.querySelectorAll('.mv'));
  var plane = rec.querySelector('.plane'), shadow = rec.querySelector('.plane-shadow');
  var arms = {}, shadows = {};
  ['log', 'chain'].forEach(function (p) {
    arms[p] = rec.querySelector('.arm[data-pen="' + p + '"]');
    shadows[p] = rec.querySelector('.arm-sh[data-pen="' + p + '"]');
  });
  var ans = [].slice.call(rec.querySelectorAll('.an')).map(function (g) {
    return { g: g, x: +g.dataset.at, pen: g.dataset.pen, on: false };
  });
  var marks = [].slice.call(rec.querySelectorAll('.mk')).map(function (g) {
    var a = g.querySelector('.gp'), b = g.querySelector('.gp2');
    gsap.set(a, { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.set(b, { opacity: 0 });
    var tl = gsap.timeline({ paused: true }).to(a, { strokeDashoffset: 0, duration: 0.35, ease: 'power1.inOut' }).to(b, { opacity: 1, duration: 0.08 });
    return { x: +g.dataset.at, tl: tl, on: false };
  });
  var counters = { log: rec.querySelector('[data-count="log"]'), chain: rec.querySelector('[data-count="chain"]') };
  var stopEls = [].slice.call(document.querySelectorAll('.stop'));
  var bar = document.querySelector('.progress i');
  var nonceEl = document.querySelector('[data-nonce-line]');
  var nonceText = nonceEl ? nonceEl.textContent : '';

  function fit() {
    var top = root.querySelector('.lede').getBoundingClientRect();
    var stops = root.querySelector('.stops').getBoundingClientRect();
    var tb = root.querySelector('.tb').getBoundingClientRect();
    var used = Math.max(stops.bottom, tb.bottom) - root.getBoundingClientRect().top;
    var s = Math.max(0.66, Math.min(innerWidth / 1310, (innerHeight - used - 14) / (D.h + 26)));
    d.style.setProperty('--s', s.toFixed(4));
  }

  function yAt(pts, x) {
    var lo = 0, hi = pts.length - 1;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[hi][0]) return pts[hi][1];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (pts[m][0] <= x) lo = m; else hi = m; }
    var a = pts[lo], b = pts[hi], k = (x - a[0]) / (b[0] - a[0] || 1);
    return a[1] + (b[1] - a[1]) * k;
  }

  var settle = { v: 1 };
  function setArm(p, dx) {
    var L = D.len[p], y = yAt(D.pts[p], D.tips[p] - dx), dy = y - D.base[p];
    dy = Math.max(-L * 0.9, Math.min(L * 0.9, dy));
    var phi = Math.asin(-dy / L);
    var deg = phi * 180 / Math.PI + settle.v * (p === 'log' ? 5 : 2.6);
    var tx = -L * (1 - Math.cos(phi));
    arms[p].style.transform = 'translate3d(' + tx.toFixed(2) + 'px,0,0) rotate(' + deg.toFixed(3) + 'deg)';
    var sh = shadows[p];
    if (sh) sh.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,16px,0) rotate(' + (deg + (+sh.dataset.phi0 || 0)).toFixed(3) + 'deg)';
  }

  function countUpTo(arr, x) { var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i] <= x) n++; return n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var last = { log: -1, chain: -1 };

  function drawDx(dx) {
    var tr = 'translate3d(' + dx.toFixed(2) + 'px,0,0)';
    for (var i = 0; i < movers.length; i++) movers[i].style.transform = tr;
    setArm('log', dx); setArm('chain', dx);
    var xLog = D.tips.log - dx, xChain = D.tips.chain - dx;
    ans.forEach(function (a) {
      var on = (a.pen === 'log' ? xLog : xChain) >= a.x + 6;
      if (on !== a.on) { a.on = on; a.g.style.opacity = on ? 1 : 0; }
    });
    marks.forEach(function (m) {
      var on = xChain >= m.x + 26;
      if (on !== m.on) { m.on = on; if (on) m.tl.play(); else m.tl.reverse(); }
    });
    var cl = countUpTo(D.logXs, xLog), cc = countUpTo(D.chainXs, xChain);
    if (cl !== last.log) { last.log = cl; counters.log.textContent = pad(cl); }
    if (cc !== last.chain) { last.chain = cc; counters.chain.textContent = pad(cc); }
  }

  // Scroll keyframes: paper position with holds at each stop.
  var S = D.stops, keys = [];
  var hasGap = S.d2 != null;
  if (hasGap) keys = [[0, S.d0], [0.05, S.d0], [0.30, S.d1], [0.36, S.d1], [0.62, S.d2], [0.74, S.d2], [0.92, S.d3], [1, S.d3]];
  else keys = [[0, S.d0], [0.06, S.d0], [0.45, S.d1], [0.55, S.d1], [0.92, S.d3], [1, S.d3]];
  var stopAt = hasGap ? [0, 0.22, 0.56, 0.84] : [0, 0.38, 0.84];
  function dxAt(u) {
    for (var i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
      var a = keys[i - 1], b = keys[i], k = (u - a[0]) / (b[0] - a[0] || 1);
      return a[1] + (b[1] - a[1]) * k;
    }
    return keys[keys.length - 1][1];
  }

  var counted = false, activeStop = 0;
  function countNonce() {
    if (counted || !nonceEl) return;
    counted = true;
    var nums = nonceText.match(/\d+/g) || [], o = { k: 0 };
    gsap.to(o, { k: 1, duration: 0.8, ease: 'power2.out', onUpdate: function () {
      var i = 0;
      nonceEl.textContent = nonceText.replace(/\d+/g, function () { return Math.round(+nums[i++] * o.k); });
    }, onComplete: function () { nonceEl.textContent = nonceText; } });
  }
  function setStop(u) {
    var n = 0;
    for (var i = 0; i < stopAt.length; i++) if (u >= stopAt[i]) n = i;
    if (n !== activeStop) {
      activeStop = n;
      stopEls.forEach(function (e, i) { e.classList.toggle('on', i === n); });
      if (n === stopEls.length - 1) countNonce();
    }
  }

  var state = { u: 0 };
  function render() {
    drawDx(dxAt(state.u));
    setStop(state.u);
    if (bar) bar.style.transform = 'scaleX(' + state.u.toFixed(4) + ')';
  }

  fit();
  ans.forEach(function (a) { a.on = true; });
  gsap.set(rec.querySelector('.rec-in'), { x: 150, opacity: 0 });
  d.classList.add('m-ready');
  render();

  gsap.timeline()
    .to(rec.querySelector('.rec-in'), { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out' })
    .to(settle, { v: 0, duration: 0.3, ease: 'back.out(2.2)', onUpdate: function () { drawDx(dxAt(state.u)); } }, '-=0.05');

  gsap.to(state, {
    u: 1, ease: 'none', onUpdate: render,
    scrollTrigger: { trigger: root, start: 'top top', end: '+=240%', pin: true, scrub: 0.6, invalidateOnRefresh: true },
  });

  // Pointer parallax on the individual `translate` property, so the CSS tilt stays untouched.
  var par = { k: 0 };
  function applyPar() { plane.style.translate = (par.k * -5).toFixed(2) + 'px 0'; shadow.style.translate = (par.k * 3).toFixed(2) + 'px 0'; }
  addEventListener('pointermove', function (e) {
    gsap.to(par, { k: (e.clientX / innerWidth - 0.5) * 2, duration: 0.9, ease: 'power3.out', overwrite: true, onUpdate: applyPar });
  }, { passive: true });

  var rt;
  addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (innerWidth < 768 || innerHeight < 620) { location.reload(); return; }
      fit(); ScrollTrigger.refresh();
    }, 180);
  });
})();
