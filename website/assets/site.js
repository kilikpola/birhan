/* Language. The page holds both languages and shows one, so a reader is not
   made to skip past a translation of every line. Amharic is the default
   because that is who the app is for; the choice is remembered. */
(function () {
  var root = document.documentElement;
  var btnAm = document.getElementById('lang-am');
  var btnEn = document.getElementById('lang-en');

  function apply(lang) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    if (btnAm) btnAm.setAttribute('aria-pressed', String(lang === 'am'));
    if (btnEn) btnEn.setAttribute('aria-pressed', String(lang === 'en'));
    try { localStorage.setItem('birhan-lang', lang); } catch (e) {}
  }

  var saved = null;
  try { saved = localStorage.getItem('birhan-lang'); } catch (e) {}
  apply(saved === 'en' || saved === 'am' ? saved : 'am');

  if (btnAm) btnAm.addEventListener('click', function () { apply('am'); });
  if (btnEn) btnEn.addEventListener('click', function () { apply('en'); });
})();


/* Version, size and hash come from the update manifest, so no page can
   drift from what is actually published. Every download button already
   works without this — each href is a real, unchanging path. */
(function () {
  var SOURCES = ['/latest.json', 'https://updates.birhan.online/birhan/latest.json'];
  var metas = [].slice.call(document.querySelectorAll('[data-dl-meta]'));
  var btns  = [].slice.call(document.querySelectorAll('[data-dl-btn]'));
  var shas  = [].slice.call(document.querySelectorAll('[data-dl-sha]'));
  if (!metas.length && !btns.length) return;

  /* Only ever repoint a button at our own HTTPS host. The manifest is ours,
     but a download button is exactly the thing you do not want following an
     arbitrary URL if that file is ever tampered with. */
  function safeApkUrl(u) {
    try {
      var url = new URL(u, window.location.href);
      if (url.protocol !== 'https:') return null;
      if (url.hostname !== 'birhan.online' && url.hostname !== 'www.birhan.online') return null;
      return url.href;
    } catch (e) { return null; }
  }

  function render(m) {
    var bits = [];
    if (m.versionName) bits.push('v' + m.versionName);
    if (m.sizeBytes) bits.push((m.sizeBytes / 1048576).toFixed(0) + ' MB');
    if (!bits.length) return false;

    var href = m.apkUrl && safeApkUrl(m.apkUrl);
    if (href) btns.forEach(function (b) { b.setAttribute('href', href); });

    metas.forEach(function (el) {
      el.innerHTML = '<span lang="am">መጠን</span><span lang="en">Size</span> <b>' +
                     bits.join('  ') + '</b>';
    });
    if (m.sha256) shas.forEach(function (el) {
      el.textContent = 'SHA-256 ' + m.sha256; el.hidden = false;
    });
    return true;
  }

  function fallback() {
    metas.forEach(function (el) {
      el.innerHTML = '<span lang="am">ስሪቱን ማወቅ አልተቻለም። ማውረዱ ግን ይሠራል።</span>' +
                     '<span lang="en">Could not check the version — the download still works.</span>';
    });
  }

  function tryNext(i) {
    if (i >= SOURCES.length) return fallback();
    fetch(SOURCES[i], { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (m) { if (!render(m)) return Promise.reject(); })
      .catch(function () { tryNext(i + 1); });
  }
  tryNext(0);
})();

/* Reveal on scroll. Anything not observed stays visible, so the page reads
   fully if this never runs or motion is turned down. */
(function () {
  var els = document.querySelectorAll('.reveal,.stagger,.slide-l,.slide-r,.chips,.vtable');
  if (!els.length) return;
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    [].forEach.call(els, function (e) { e.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  [].forEach.call(els, function (e) { io.observe(e); });

  /* Last resort. If the observer never fires — an odd viewport, a browser
     quirk, anything — the page must not be left invisible. */
  setTimeout(function () {
    [].forEach.call(els, function (e) { e.classList.add('in'); });
  }, 2500);
})();


/* Scroll-driven flourishes: a progress seam at the top and a gentle parallax
   on the hero phone. Both are pure decoration — skipped entirely when the
   reader has asked for reduced motion, and absent-safe if elements are gone. */
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var bar = document.createElement('div');
  bar.className = 'progress';
  document.body.appendChild(bar);

  var phone = document.querySelector('.device--float');
  if (phone) phone.classList.add('device--parallax');

  var ticking = false;
  function frame() {
    ticking = false;
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? h.scrollTop / max : 0;
    bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';

    if (phone) {
      // drift up to ~22px as the hero scrolls past, eased back to rest
      var y = Math.max(-22, Math.min(0, -h.scrollTop * 0.06));
      phone.style.setProperty('--pary', y.toFixed(1) + 'px');
    }
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  frame();
})();
