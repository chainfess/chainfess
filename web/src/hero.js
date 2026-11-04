// The instrument writes once on load: the paper feeds left, both pens follow their trace at a fixed tip,
// then the mismatch is circled. Scroll only flattens the tilt. Nothing is pinned. Only transforms and opacity change.
(function () {
  var d = document.documentElement, inst = document.querySelector('.hero .inst');
  if (!inst || !window.gsap || !window.ScrollTrigger) { d.classList.remove('m'); return; }
  if (window.__recReady) window.__recReady();
  gsap.registerPlugin(ScrollTrigger);

  var D = JSON.parse(inst.querySelector('.inst-data').textContent);
  var sheet = inst.querySelector('.sheet'), plane = inst.querySelector('.inst-plane'), shadow = inst.querySelector('.inst-shadow');
  var feeds = [].slice.call(inst.querySelectorAll('.feed'));
  var arms = { log: inst.querySelector('.arm-log'), chain: inst.querySelector('.arm-chain') };
  var marks = inst.querySelector('.marks');
  var loops = [].slice.call(inst.querySelectorAll('.gp'));
  var missT = inst.querySelector('.miss');

  var W, H, tip, L;
  function measure() {
    W = sheet.offsetWidth; H = sheet.offsetHeight;
    L = arms.log.offsetWidth;
    tip = arms.log.offsetLeft;
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
  function draw(dx) {
    var tr = 'translate3d(' + dx.toFixed(2) + 'px,0,0)';
    for (var i = 0; i < feeds.length; i++) feeds[i].style.transform = tr;
    // Paper x under the tip, in viewBox units (1000 = left edge of the sheet).
    var vx = 1000 + ((tip - dx) / W) * 1000;
    ['log', 'chain'].forEach(function (p) {
      var dy = ((yAt(D.pts[p], vx) - D.fy[p] * 1000) / 1000) * H;
      dy = Math.max(-L * 0.9, Math.min(L * 0.9, dy));
      var phi = Math.asin(-dy / L);
      var deg = (phi * 180) / Math.PI + settle.v * (p === 'log' ? 4 : 3);
      arms[p].style.transform = 'translate3d(' + (-L * (1 - Math.cos(phi))).toFixed(2) + 'px,0,0) rotate(' + deg.toFixed(3) + 'deg)';
    });
  }

  measure();
  var state = { k: 0 };
  function start() { return Math.max(0, tip - D.f0 * W + 6); }
  function frame() { draw(start() * (1 - state.k)); }
  gsap.set(loops, { strokeDasharray: 1, strokeDashoffset: 1 });
  if (missT) gsap.set(missT, { opacity: 0, y: 6 });
  gsap.set(marks, { opacity: 1 });
  frame();
  d.classList.add('m-ready');

  gsap.timeline({ delay: 0.15 })
    .to(settle, { v: 0, duration: 0.3, ease: 'back.out(2)', onUpdate: frame })
    .to(state, { k: 1, duration: 2.1, ease: 'power1.inOut', onUpdate: frame }, 0.1)
    .to(loops, { strokeDashoffset: 0, duration: 0.35, ease: 'power1.inOut', stagger: 0.12 }, '+=0.05')
    .to(missT || {}, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, '-=0.1');

  // Semi-3D: the sheet lies tilted, and flattens as it comes up the page.
  var tilt = { a: 9 };
  function setTilt() {
    plane.style.transform = 'rotateX(' + tilt.a.toFixed(2) + 'deg)';
    shadow.style.transform = 'rotateX(' + tilt.a.toFixed(2) + 'deg) translateY(' + (6 + tilt.a).toFixed(1) + 'px)';
  }
  setTilt();
  gsap.to(tilt, { a: 2, ease: 'none', onUpdate: setTilt, scrollTrigger: { trigger: inst, start: 'top 75%', end: 'top 15%', scrub: 0.6 } });

  var rt;
  addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (innerWidth < 768) { location.reload(); return; }
      measure(); frame(); ScrollTrigger.refresh();
    }, 180);
  });
})();
