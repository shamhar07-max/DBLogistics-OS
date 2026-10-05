/* DigitalBurj Logistics OS — motion runtime.
   Mirrors digitalburj.com: staged reveals, count-up KPIs, live cards, global "Pause motion". */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmt(n, d, sep) {
    var s = n.toFixed(d);
    if (sep !== false) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
    return s;
  }
  function countUp(el) {
    var to = parseFloat(el.dataset.count), d = parseInt(el.dataset.decimals || '0', 10);
    var pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    if (reduce || root.dataset.motion === 'paused') { el.textContent = pre + fmt(to, d) + suf; return; }
    var t0 = performance.now(), dur = 1400;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = pre + fmt(to * e, d) + suf;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function reveal(el) {
    el.classList.add('is-in');
    el.querySelectorAll('[data-count]').forEach(countUp);
    if (el.hasAttribute('data-count')) countUp(el);
  }
  window.DBL_revealAll = function () {
    document.querySelectorAll('[data-reveal]').forEach(reveal);
    document.querySelectorAll('[data-count]').forEach(countUp);
  };
  function init() {
    if (!('IntersectionObserver' in window)) return window.DBL_revealAll();
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } });
    }, { threshold: .08, rootMargin: '0px 0px -4% 0px' });
    document.querySelectorAll('[data-reveal]').forEach(function (el, i) {
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', i % 8);
      io.observe(el);
    });
    document.querySelectorAll('[data-count]:not([data-reveal] [data-count])').forEach(function (el) { io.observe(el); });
  }
  /* Pause-motion toggle: <button data-motion-toggle> */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-motion-toggle]'); if (!b) return;
    var paused = root.dataset.motion === 'paused';
    root.dataset.motion = paused ? 'running' : 'paused';
    b.setAttribute('aria-pressed', String(!paused));
    var l = b.querySelector('[data-label]'); if (l) l.textContent = paused ? 'Pause motion' : 'Resume motion';
    var u = b.querySelector('use'); if (u) u.setAttribute('href', paused ? '#i-pause' : '#i-play');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
