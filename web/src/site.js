// Runs on every page, needs no other asset: copy buttons, live block, token slot.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var text = b.getAttribute('data-copy');
    var done = function () {
      var old = b.textContent;
      b.textContent = 'Copied';
      b.classList.add('ok');
      setTimeout(function () { b.textContent = old; b.classList.remove('ok'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (_) {}
      t.remove();
    }
  });

  // Live number: "—" or the last value when the API is down, never 0.
  var blk = $$('[data-block]');
  if (blk.length) {
    var tick = function () {
      fetch('/api/block', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && Number(j.block) > 0) blk.forEach(function (el) { el.textContent = Number(j.block).toLocaleString('en-US'); });
      }).catch(function () {});
    };
    tick();
    setInterval(function () { if (!document.hidden) tick(); }, 15000);
  }

  // Token slot: a golive swap needs no rebuild.
  var slots = $$('[data-ca-slot]');
  if (slots.length) {
    fetch('/token.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      if (!t || !t.launched || !/^0x[0-9a-fA-F]{40}$/.test(t.ca) || /^0x0{40}$/.test(t.ca)) return;
      slots.forEach(function (s) {
        if (s.querySelector('.ca-box')) return;
        s.innerHTML = '<div class="cmd ca-box"><code></code><button type="button" class="cp">Copy</button></div>' +
          '<p class="ca-line"><a class="buy" rel="noopener">Buy on Pons</a> <span>The only official CA is the one on this page and on <a href="https://x.com/chainfesspro" rel="noopener">@chainfesspro</a>.</span></p>';
        $('code', s).textContent = t.ca;
        $('.cp', s).setAttribute('data-copy', t.ca);
        $('.buy', s).href = 'https://ponsfamily.com/token/' + t.ca;
      });
      var lead = $('[data-token-lead]');
      if (lead) lead.textContent = 'The free CLI never needs the coin.';
      if (String(t.burnAmount) !== '0' && t.decimals != null) {
        var raw = BigInt(t.burnAmount), d = BigInt(10) ** BigInt(t.decimals);
        var frac = (raw % d).toString().padStart(Number(t.decimals), '0').replace(/0+$/, '');
        var txt = t.burnAmountHuman ? t.burnAmountHuman + ' $' + t.symbol : (raw / d).toLocaleString('en-US') + (frac ? '.' + frac : '') + ' $' + t.symbol;
        $$('[data-burn]').forEach(function (el) { el.textContent = txt; });
      }
    }).catch(function () {});
  }

})();
