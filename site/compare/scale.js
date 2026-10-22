// "Every program at one scale" (compare/index.html, #eight) and "How they grew" (#grew): every program of
// the site from the registry (../registry.json, tools/registry.js), the programs that run a chat model,
// the ones that train a network and their children; their current versions on a scale where every line is
// a factor of ten, and every version, when it came, as a chart and day by day.
(function () {
  'use strict';
  const fig = document.getElementById('fig-eight'), grew = document.getElementById('fig-grew');
  if (!fig) return;
  const WHAT = {
    weights: { label: 'Weights', unit: 'weights', say: 'the numbers of the model' },
    chars: { label: 'Characters', unit: 'characters', say: 'the length of the program' },
    tape: { label: 'Memory', unit: 'cells', say: 'the cells of the tape it uses, 4 bytes each' },
  };
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const word = (n) => WORDS[n] || String(n), Word = (n) => word(n).replace(/^./, (c) => c.toUpperCase());
  const num = (n) => n.toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  const COL = { chat: 'c-in', train: 'd2', child: 'd1' };
  const rows = fig.querySelector('.sc-rows'), said = fig.querySelector('.tell'), seg = fig.querySelector('.seg');
  let R = null, P = [], key = 'weights';

  const cur = (e) => e.versions.find((v) => v.n === e.current) || {};
  const link = (e) => { const pg = e.pages.find(([t]) => !/Compare/.test(t)); return pg ? '../' + pg[1] : null; };
  const group = (id) => R.groups.find((g) => g.id === id);

  // ---- every program at one scale ------------------------------------------------------------

  function draw() {
    const list = P.filter((p) => p[key] > 0), vals = list.map((p) => p[key]), lo = 2, hi = Math.ceil(Math.log10(Math.max(...vals)));
    const at = (v) => ((Math.log10(v) - lo) / (hi - lo)) * 100;
    let html = '';
    for (let e = lo; e <= hi; e++) html += `<i class="sc-tick" style="left:${((e - lo) / (hi - lo)) * 100}%"><span>${e >= 9 ? 10 ** (e - 9) + ' billion' : e >= 6 ? 10 ** (e - 6) + ' million' : num(10 ** e)}</span></i>`;
    rows.innerHTML = `<div class="sc-axis">${html}</div>` + list.map((p, i) => {
      const first = i === 0 || list[i - 1].group !== p.group;
      const name = p.href ? `<a href="${esc(p.href)}">${esc(p.name)}</a>` : esc(p.name);
      return `${first ? `<p class="sc-group">${esc(group(p.group).title)}</p>` : ''}
        <div class="sc-row ${p.group}"><span class="sc-name"><b>${name}</b><small>${esc(p.does)}${p.note ? ' · ' + esc(p.note) : ''}</small></span>
        <span class="sc-track"><i style="width:${Math.max(0.5, at(p[key]))}%"></i></span><span class="sc-val">${p.about && key === 'weights' ? 'about ' : ''}${num(p[key])}</span></div>`;
    }).join('');
    const big = Math.max(...vals), small = Math.min(...vals);
    said.textContent = WHAT[key].label + ', ' + WHAT[key].say + ': from ' + num(small) + ' to ' + num(big) + ' ' + WHAT[key].unit + ', a factor of ' + num(Math.round(big / small)) + '.';
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === key)));
  }
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { key = b.dataset.k; draw(); } });

  // ---- how they grew: every version, when it came ----------------------------------------------

  const day = (d) => d.slice(0, 10), t = (d) => Date.parse(d.length > 10 ? d.replace(' ', 'T') : d + 'T12:00');
  const DAY = 864e5;
  let pts = [], cv = null, geom = null;
  function drawGrew() {
    if (!grew || !R) return;
    cv = grew.querySelector('canvas');
    const W = cv.parentElement.clientWidth, H = Math.min(360, Math.max(260, Math.round(W * 0.42)));
    const r = window.devicePixelRatio || 1;
    cv.width = Math.round(W * r); cv.height = Math.round(H * r); cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    const all = R.programs.flatMap((e) => e.versions.map((v) => ({ e, v, x: t(v.date) }))).filter((p) => p.v.chars);
    const t0 = Math.floor(Math.min(...all.map((p) => p.x)) / DAY) * DAY - DAY / 2, t1 = Math.max(Date.now(), ...all.map((p) => p.x)) + DAY / 2;
    const padL = 64, padR = 16, padT = 14, padB = 30, x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB, lo = 5, hi = 11;
    const X = (x) => x0 + ((x - t0) / (t1 - t0)) * (x1 - x0), Y = (c) => y1 - ((Math.log10(c) - lo) / (hi - lo)) * (y1 - y0);
    geom = { X, Y };
    g.fillStyle = css('panel'); g.fillRect(0, 0, W, H);
    g.font = '11px ' + css('mono'); g.lineWidth = 1;
    for (let e = lo; e <= hi; e++) {
      g.strokeStyle = css('line'); g.beginPath(); g.moveTo(x0, Math.round(Y(10 ** e)) + 0.5); g.lineTo(x1, Math.round(Y(10 ** e)) + 0.5); g.stroke();
      g.fillStyle = css('muted'); g.fillText(e === hi ? 'characters' : e >= 9 ? 10 ** (e - 9) + ' billion' : e >= 6 ? 10 ** (e - 6) + ' million' : num(10 ** e), 4, Y(10 ** e) + 4);
    }
    const days = Math.round((t1 - t0) / DAY), every = Math.max(1, Math.ceil(days / Math.max(1, Math.floor((x1 - x0) / 70))));
    g.textAlign = 'center';
    for (let k = 0; k <= days; k += every) {
      const d = new Date(t0 + DAY / 2 + k * DAY), x = X(d.getTime());
      g.fillStyle = css('muted'); g.fillText(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), x, H - 10);
      g.fillRect(Math.round(x), y1, 1, 4);
    }
    g.textAlign = 'left';
    // each program: its versions joined, the current one larger
    pts = [];
    for (const e of R.programs) {
      const vs = e.versions.filter((v) => v.chars).map((v) => ({ e, v, x: X(t(v.date)), y: Y(v.chars) }));
      if (!vs.length) continue;
      g.strokeStyle = g.fillStyle = css(COL[e.group]);
      if (vs.length > 1) { g.lineWidth = 1.5; g.beginPath(); vs.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
      for (const p of vs) { g.beginPath(); g.arc(p.x, p.y, p.v.n === e.current ? 5 : 3, 0, 2 * Math.PI); g.fill(); pts.push(p); }
    }
  }

  function hover(ev) {
    if (!geom) return;
    const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = 144;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    grew.querySelector('.tell').textContent = best ? versionSays(best.e, best.v) : 'Point at a dot: a version of a program.';
  }

  function versionSays(e, v) {
    return e.id + (e.versions.length > 1 ? ', version ' + v.n + ' of ' + e.versions.length : '') + (v.pass ? ' (pass ' + v.pass + ')' : '') + ', ' + day(v.date) + ': ' + num(v.chars) + ' characters' +
      (v.held ? ', ' + v.held.toFixed(3) + ' on text it never saw' : v.loss ? ', loss ' + v.loss.toFixed(3) : '') + (v.n === e.current && e.versions.length > 1 ? ' (the current version)' : '') + '.';
  }

  // the versions day by day, the newest first
  function diary() {
    const list = grew.querySelector('.gr-days'), items = R.programs.flatMap((e) => e.versions.map((v) => ({ e, v })));
    const byDay = new Map();
    for (const it of items.sort((a, b) => t(b.v.date) - t(a.v.date))) { const d = day(it.v.date); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(it); }
    list.innerHTML = [...byDay].map(([d, its]) => `<li><p class="gr-day">${esc(new Date(d + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p><ul>` +
      its.map(({ e, v }) => {
        const prev = e.versions.find((x) => x.n === v.n - 1), href = link(e);
        const what = v.n === 1 ? (e.group === 'child' && v.pass ? 'first pass' : 'new') : v.pass ? 'pass ' + v.pass : 'version ' + v.n;
        const change = prev && v.held && prev.held ? ` <span class="${v.held < prev.held ? 'up' : 'down'}">${v.held < prev.held ? '−' : '+'}${Math.abs(v.held - prev.held).toFixed(3)}</span>` : prev && v.chars && prev.chars && v.chars !== prev.chars ? ` <span>${v.chars > prev.chars ? '+' : '−'}${num(Math.abs(v.chars - prev.chars))} characters</span>` : '';
        return `<li class="${e.group}"><i class="sw" aria-hidden="true"></i><span><b>${href ? `<a href="${esc(href)}">${esc(e.id)}</a>` : esc(e.id)}</b> <em>${esc(what)}</em>${v.n === e.current && e.versions.length > 1 ? ' <em class="cur">current</em>' : ''}<small>${esc(e.does)}: ${v.chars ? num(v.chars) + ' characters' : ''}${v.held ? ', ' + v.held.toFixed(3) + ' on text it never saw' : v.loss ? ', loss ' + v.loss.toFixed(3) : ''}${change}</small></span></li>`;
      }).join('') + '</ul></li>').join('');
  }

  // ---- start ---------------------------------------------------------------------------------------

  fetch('../registry.json', { cache: 'no-cache' }).then((r) => r.json()).then((reg) => {
    R = reg;
    P = R.programs.map((e) => { const v = cur(e); return { name: e.id, group: e.group, does: e.does, about: e.about, weights: e.weights, chars: v.chars, tape: v.tape, href: link(e), note: v.pass ? 'pass ' + v.pass + ', its best' : '' }; });
    const n = R.programs.length, count = (g) => R.programs.filter((e) => e.group === g).length;
    document.querySelectorAll('[data-reg="count"]').forEach((el) => { el.textContent = word(n); });
    document.querySelectorAll('[data-reg="Count"]').forEach((el) => { el.textContent = Word(n); });
    document.querySelectorAll('[data-reg="chat"]').forEach((el) => { el.textContent = word(count('chat')); });
    document.querySelectorAll('[data-reg="train"]').forEach((el) => { el.textContent = word(count('train')); });
    document.querySelectorAll('[data-reg="child"]').forEach((el) => { el.textContent = word(count('child')); });
    document.querySelectorAll('[data-reg="versions"]').forEach((el) => { el.textContent = num(R.programs.reduce((a, e) => a + e.versions.length, 0)); });
    draw();
    if (grew) { drawGrew(); diary(); cv.addEventListener('mousemove', hover); }
  }).catch(() => { said.textContent = 'The list of programs (registry.json) is not on this server.'; });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawGrew, 120); });
  new MutationObserver(drawGrew).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
