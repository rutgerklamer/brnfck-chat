// "Every program at one scale" (compare/index.html, #eight): every program in ../registry.json (tools/registry.js),
// in its current version, on a scale where every line is a factor of ten.
(function () {
  'use strict';
  const fig = document.getElementById('fig-eight');
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
    draw();
  }).catch(() => { said.textContent = 'The list of programs (registry.json) is not on this server.'; });
})();
