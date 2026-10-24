// "It prints its next generation": the table of each of 20 generations, the parts of one generation, the names of each.
// Data: data/generations.json (tools/site-generations.js), read from programs the generation before printed.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',') + ')';
  const LET = (i) => (i ? String.fromCharCode(96 + i) : '·');
  let D = null, k = 20, timer = 0;

  function fit(cv, w, h) {
    const r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); return g;
  }
  // the chance of every next letter after each letter, as the child computes it: weights / 256, softmax
  function probs(q) {
    return q.w.map((row) => { const e = row.map((w, j) => Math.exp((w + q.b[j]) / 256)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); });
  }

  // ---- the table of a generation, and the runs of its end-of-name column ----------------------
  function draw() {
    const cv = $('gen-view'), q = D.bigram.gens[k], P = probs(q), V = P.length;
    const W = cv.parentElement.clientWidth, side = W >= 640, cell = Math.max(9, Math.floor(((side ? W * 0.55 : W) - 36) / V));
    const hx = 30, hy = 34, hw = cell * V, bx = side ? hx + hw + 70 : hx, by = side ? hy : hy + hw + 64, bw = side ? W - bx - 70 : W - bx - 70;
    const H = side ? hy + hw + 16 : by + V * cell + 16;
    const g = fit(cv, W, H), panel = rgb(css('panel')), plus = rgb(css('c-plus'));
    g.fillStyle = css('panel'); g.fillRect(0, 0, W, H);
    g.font = Math.min(12, cell) + 'px ' + css('mono'); g.textBaseline = 'middle';
    g.fillStyle = css('muted'); g.textAlign = 'left';
    g.fillText('letter before ↓   next letter →', 6, 12);
    g.fillText(side ? 'column · in the file: a run of + or −' : 'column · in the file: a run of + or − per letter', bx - 20, by - 22);
    g.textAlign = 'center';
    for (let c = 0; c < V; c++) {
      g.fillStyle = css('muted');
      g.fillText(LET(c), hx - 12, hy + c * cell + cell / 2); g.fillText(LET(c), hx + c * cell + cell / 2, hy - 9);
      for (let j = 0; j < V; j++) { g.fillStyle = mix(panel, plus, Math.sqrt(Math.min(1, P[c][j] / 0.45))); g.fillRect(hx + j * cell, hy + c * cell, cell - 1, cell - 1); }
    }
    g.strokeStyle = css('ink'); g.lineWidth = 2; g.strokeRect(hx - 1.5, hy - 1.5, cell + 2, V * cell + 2);
    for (let c = 0; c < V; c++) {                                      // the run the child holds for the end of a name after letter c
      const w = q.w[c][0], y = by + c * cell, len = (Math.abs(w) / 1100) * bw;
      g.fillStyle = css('muted'); g.textAlign = 'center'; g.fillText(LET(c), bx - 12, y + cell / 2);
      g.fillStyle = css(w >= 0 ? 'c-plus' : 'c-minus'); g.fillRect(bx, y + 2, Math.max(1, len), cell - 4);
      g.fillStyle = css('muted'); g.textAlign = 'left'; g.fillText((w >= 0 ? '+' : '−') + num(Math.abs(w)), bx + len + 6, y + cell / 2);
    }
    $('gen-name').textContent = 'gen' + k;
    $('gen-k').value = k;
    $('gen-said').textContent = (k ? `gen${k}, printed by gen${k - 1} after step ${num(q.step)}: ` : 'gen0, written by the generator, with random weights: ') +
      `${num(q.chars)} characters. Fed nothing, it prints a child of ${num(q.child)}.`;
    $('gen-names').textContent = q.names.join(' ');
  }
  function play() {
    if (timer) { clearInterval(timer); timer = 0; $('gen-play').textContent = 'Play'; return; }
    k = k >= 20 ? 0 : k; draw(); $('gen-play').textContent = 'Stop';
    timer = setInterval(() => { if (k >= 20) return play(); k++; draw(); }, 650);
  }

  // ---- the parts of gen1 and gen2 of the attention program, to scale -------------------------
  const PART = { loss: ['the loss lines, in [ ]', 'ink'], state: ['the state', 'c-plus'], walk: ['', 'muted'], data: ['the body, as data', 'c-minus'], back: ['', 'muted'], body: ['the body', 'c-in'] };
  const CMD = { '+': 'c-plus', '-': 'c-minus', '<': 'c-lt', '>': 'c-gt', '[': 'c-open', ']': 'c-close', ',': 'c-in', '.': 'c-out' };
  const esc = (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c);
  const glyphs = (s) => [...s].map((c) => (c === '\n' ? '<span class="nl">⏎</span>' : CMD[c] ? `<span style="color:var(--${CMD[c]})">${esc(c)}</span>` : esc(c))).join('');
  function parts() {
    const A = D.attn, big = Math.max(...A.parts.map((p) => p.chars)), box = $('gen-parts');
    let html = '';
    for (const p of A.parts) {
      html += `<p class="label">gen${p.k} · ${num(p.chars)} characters${p.k === 2 ? ', printed by gen1' : ''}</p><div class="gen-bar" style="width:${(100 * p.chars) / big}%">`;
      for (const [id, n] of p.parts) html += `<i style="flex:${n} 0 ${id === 'loss' || id === 'back' ? '3px' : '0px'};background:var(--${PART[id][1]})" title="${PART[id][0] || 'a walk along the tape'}: ${num(n)} characters"></i>`;
      html += '</div>';
    }
    const p = A.parts[1], n = Object.fromEntries(p.parts), t = A.parts[0].text;
    const rows = [
      ['loss', `${num(p.lines)} loss lines inside [ ]: a loop that never runs, since [ jumps past ] when its cell is 0, so the . in them prints nothing.`, p.text.loss],
      ['state', 'The weights, their momentum, the step and the last letters, as the program ended. Every number in octal: a + for each unit of a digit, and [->++++++++<]>[-<+>]< to multiply by 8.', t.state],
      ['data', `The body below, written as ${num(A.runs)} runs, each a symbol and a length. Reading these, the body can print itself.`, t.data],
      ['body', 'Reads names through , and trains. Then prints, through ., the next program: its loss lines, its new state, this data and, decoded from it, itself.', t.body],
    ];
    html += '<dl class="gen-parts">' + rows.map(([id, says, text]) => `<div><dt><span class="sw" style="background:var(--${PART[id][1]})"></span>${PART[id][0]}<span>${num(n[id])} characters</span></dt><dd>${says}</dd><dd><code>${glyphs(text)}</code></dd></div>`).join('') + '</dl>';
    box.innerHTML = html;
  }

  // ---- the names the child of each generation writes ----------------------------------------
  function names() {
    $('gen-rows').innerHTML = D.attn.gens.map((q) => `<div class="gen-row"><span>gen${q.k}</span><span>${q.names.slice(0, 10).map((s) => (s.length > 18 ? s.slice(0, 17) + '…' : s)).join(' · ')}</span><span>${q.loss ? (q.loss / 1000).toFixed(2) : 'random'}</span></div>`).join('');
  }

  fetch('data/generations.json?v=r1').then((r) => r.json()).then((d) => {
    D = d; draw(); parts(); names();
    $('gen-k').addEventListener('input', (e) => { if (timer) play(); k = +e.target.value; draw(); });
    $('gen-play').addEventListener('click', play);
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(draw, 120); });
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }).catch(() => { $('gen-said').textContent = 'The data of this figure did not load.'; });
})();
