// The bar, the menu and the footer of every page of the site, in one file.
(function () {
  'use strict';
  var me = document.currentScript;
  var root = new URL('.', me.src).href;                        // this file lives in the site root

  var SECTIONS = [
    { key: 'chat', name: 'Chatbot', glyph: ',', c: '--c-in', path: '', folders: [''],
      does: 'Ask a question. A brainfuck program answers it.' },
    { key: 'learn', name: 'Learn', glyph: '+', c: '--c-plus', path: 'brainfuck/', folders: ['brainfuck', 'learn', 'reference', 'challenges/basics'],
      does: 'Start from the eight commands, one small lesson at a time.',
      pages: [['Start here', 'brainfuck/'], ['Brainfuck basics', 'challenges/basics/'], ['Build toward a chatbot', 'learn/'], ['Reference', 'reference/']] },
    { key: 'insights', name: 'Program insights', glyph: '[]', c: '--c-open', path: 'how/', folders: ['how', 'inside', 'deltanet', 'about'],
      does: 'Read how a question becomes an answer, part by part.',
      pages: [['How it works', 'how/'], ['Inside the program', 'inside/'], ['Compare the models', 'compare/'], ['About the project', 'about/']] },
    { key: 'map', name: 'Program map', glyph: '<>', c: '--c-gt', path: 'map/', folders: ['map'],
      does: 'See every character of the program, and zoom in.' },
    { key: 'play', name: 'Play', glyph: '.', c: '--c-out', path: 'playground/', folders: ['playground', 'challenges', 'patterns'],
      does: 'Write your own brainfuck and run it.',
      pages: [['Playground', 'playground/'], ['Challenges', 'challenges/'], ['Code patterns', 'patterns/']] },
  ];

  // ---- where are we? the longest folder that the address starts with wins ----
  function clean(href) { return href.split('#')[0].split('?')[0].replace(/index\.html$/, ''); }
  var here = clean(location.href), rel = here.indexOf(root) === 0 ? here.slice(root.length) : '';
  var none = me.getAttribute('data-page') === 'none';                // the 404 page: no entry is current
  var section = null, best = -1;
  if (!none) SECTIONS.forEach(function (s) {
    if (me.getAttribute('data-section') === s.key) { section = s; best = 1e9; }
    s.folders.forEach(function (f) { if ((rel === f || rel.indexOf(f + '/') === 0) && f.length > best) { section = s; best = f.length; } });
  });
  if (section) document.documentElement.style.setProperty('--sec', 'var(' + section.c + ')');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function href(path) { return root + path; }
  function mark() { var m = el('span', 'mark'); m.setAttribute('aria-hidden', 'true'); m.append(el('i', '', '['), '+', el('i', '', ']')); return m; }

  // ---- the bar ----
  var bar = el('header', 'top'), inner = el('div', 'in');
  var brand = el('a', 'brand'); brand.href = href(''); brand.append(mark(), 'brnfck.chat');
  var nav = el('nav', 'main'); nav.id = 'site-nav'; nav.setAttribute('aria-label', 'Site');
  var ul = el('ul');
  SECTIONS.forEach(function (s) {
    var li = el('li'), a = el('a'), g = el('i', '', s.glyph);
    a.href = href(s.path); a.style.setProperty('--c', 'var(' + s.c + ')');
    g.setAttribute('aria-hidden', 'true');
    a.append(g, el('b', '', s.name), el('span', '', s.does));
    if (s === section) a.setAttribute('aria-current', clean(a.href) === here ? 'page' : 'true');
    li.append(a); ul.append(li);
  });
  nav.append(ul);
  var theme = el('button', 'theme'); theme.type = 'button'; theme.append(el('b'));
  var menu = el('button', 'menu', 'Menu'); menu.type = 'button'; menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-controls', 'site-nav');
  inner.append(brand, nav, theme, menu); bar.append(inner);

  if (section && section.pages) {
    var row = el('div', 'sub'), rin = el('div', 'in'), sub = el('nav'), sul = el('ul');
    sub.setAttribute('aria-label', section.name);
    section.pages.forEach(function (p) {
      var li = el('li'), a = el('a', '', p[0]); a.href = /^https:/.test(p[1]) ? p[1] : href(p[1]);
      if (clean(a.href) === here || (p[1] !== section.path && rel.indexOf(p[1]) === 0)) a.setAttribute('aria-current', clean(a.href) === here ? 'page' : 'true');
      li.append(a); sul.append(li);
    });
    sub.append(sul); rin.append(el('span', 'lab', section.name), sub); row.append(rin); bar.append(row);
  }
  me.parentNode.insertBefore(bar, me);
  function measure() { document.documentElement.style.setProperty('--top-h', bar.offsetHeight + 'px'); }
  measure(); window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(bar);

  var skip = el('a', 'skip', 'Skip to the content'); skip.href = '#main';
  skip.addEventListener('click', function (e) {
    var m = document.querySelector('main'); if (!m) return;
    e.preventDefault(); if (!m.id) m.id = 'main'; skip.href = '#' + m.id;
    if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
    m.focus();
  });
  me.parentNode.insertBefore(skip, bar);

  // ---- the menu (a phone) and the theme ----
  function setOpen(open) { bar.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); menu.textContent = open ? 'Close' : 'Menu'; }
  menu.addEventListener('click', function () { setOpen(!bar.classList.contains('open')); });
  bar.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bar.classList.contains('open')) { setOpen(false); menu.focus(); } });
  function showTheme() {
    var dark = document.documentElement.dataset.theme === 'dark';
    theme.firstChild.textContent = dark ? 'Light' : 'Dark';
    theme.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  }
  theme.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('brnfck.theme', next); } catch (e) { }
    showTheme();
  });
  showTheme();

  // ---- the footer: the same five sections, with their pages ----
  var SOURCE = 'https://github.com/rutgerklamer/brnfck-chat';      // the code of the site and the compiler, MIT
  function foot() {
    var f = el('footer', 'foot'), box = el('div', 'in');
    box.append(el('p', '', 'Four chat models, each running as one brainfuck program: SmolLM2-135M-Instruct by Hugging Face, Qwen2.5-0.5B-Instruct and Qwen2.5-1.5B-Instruct by Alibaba Cloud, and Qwen3.5-0.8B by the Qwen team of Alibaba Cloud, all four under the Apache 2.0 licence. Brainfuck only runs them. Their answers can be wrong.'));
    SECTIONS.concat([{ name: 'About', glyph: '', c: '--muted', pages: [['Run it yourself', 'how/#run'], ['Credits', 'how/#credits'], ['Every page', 'sitemap/'], ['Source code (MIT)', SOURCE]] }]).forEach(function (s) {
      var d = el('div'), h = el('h2'), l = el('ul');
      if (s.glyph) { var g = el('i', '', s.glyph); g.style.setProperty('--c', 'var(' + s.c + ')'); g.setAttribute('aria-hidden', 'true'); h.append(g); }
      h.append(s.name);
      (s.pages || [[s.name, s.path]]).forEach(function (p) { var li = el('li'), a = el('a', '', p[0]); a.href = /^https:/.test(p[1]) ? p[1] : href(p[1]); li.append(a); l.append(li); });
      d.append(h, l); box.append(d);
    });
    f.append(box); document.body.append(f);
  }
  // ---- the page strip: on a long page, its parts as one bar under the menu, each as long as it is on
  // the page. What you have read is filled in; a part is a link to its start. ----
  // the words of a heading, without what is only decoration (aria-hidden) and without a leading #
  function words(h) {
    var c = h.cloneNode(true);
    [].forEach.call(c.querySelectorAll('[aria-hidden="true"]'), function (n) { n.remove(); });
    return c.textContent.replace(/^#\s*/, '').replace(/\s+/g, ' ').trim();
  }
  function strip() {
    var main = document.querySelector('main'); if (!main) return;
    var heads = [].slice.call(main.querySelectorAll('h2')).filter(function (h) { return !h.closest('figure, details, [hidden], .sr-only') && !h.classList.contains('sr-only') && h.textContent.trim(); });
    if (heads.length < 2) return;
    heads.forEach(function (h) {                                // a part without a name gets one from its words, so it can be linked to
      if (h.id) return;
      var base = words(h).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'part', id = base, n = 2;
      while (document.getElementById(id)) id = base + '-' + n++;
      h.id = id;
    });
    var title = main.querySelector('h1'), parts = [];
    if (title) parts.push({ el: main, name: words(title) });
    heads.forEach(function (h) { parts.push({ el: h, name: words(h), id: h.id }); });
    var box = el('nav', 'pagebar'), inn = el('div', 'in'), now = el('p', 'now'), list = el('ol');
    box.setAttribute('aria-label', 'Parts of this page');
    now.setAttribute('aria-hidden', 'true');
    parts.forEach(function (p, i) {
      var li = el('li'), a = el('a'), name = el('span', 'sr-only', p.name);
      a.href = p.id ? '#' + p.id : '#'; a.title = p.name; a.append(name);
      if (!p.id) a.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      li.append(a); list.append(li); p.li = li; p.a = a; p.n = i + 1;
    });
    inn.append(now, list); box.append(inn); bar.append(box);
    var spans = [];
    function layout() {
      var y = window.scrollY, end = main.getBoundingClientRect().bottom + y;
      spans = parts.map(function (p, i) { return p.id ? p.el.getBoundingClientRect().top + y : 0; });
      spans.push(end);
      parts.forEach(function (p, i) { p.li.style.flexGrow = Math.max(1, Math.round(spans[i + 1] - spans[i])); });
      box.hidden = end < window.innerHeight * 1.3;        // a page that hardly scrolls needs no strip
      measure(); show();
    }
    function show() {
      if (box.hidden) return;
      var at = window.scrollY + (bar.offsetHeight || 0) + window.innerHeight * 0.3, cur = 0;
      parts.forEach(function (p, i) {
        var f = Math.max(0, Math.min(1, (at - spans[i]) / Math.max(1, spans[i + 1] - spans[i])));
        p.li.style.setProperty('--f', f);
        if (at >= spans[i]) cur = i;
      });
      parts.forEach(function (p, i) { if (i === cur) p.a.setAttribute('aria-current', 'location'); else p.a.removeAttribute('aria-current'); });
      now.textContent = '';
      now.append(el('b', '', parts[cur].n + '/' + parts.length), ' ' + parts[cur].name);
    }
    var queued = false;
    window.addEventListener('scroll', function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; show(); }); }, { passive: true });
    window.addEventListener('resize', layout);
    if (window.ResizeObserver) new ResizeObserver(layout).observe(main);
    layout();
  }
  function ready() { foot(); strip(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
