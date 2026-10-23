// "Trained in brainfuck": a training run in the browser, the loss, the weights on the tape, the
// program to scale, where the attention looks, and the names. Data: data/<model>.json (tools/site-train.js).
(function () {
  'use strict';
  const T = self.Train, KEYS = ['bigram', 'mlp', 'attn'];
  const COLOR = { bigram: 'd3', mlp: 'd1', attn: 'd2' };
  const TITLE = { bigram: 'One letter back', mlp: 'Three letters back', attn: 'With attention' };
  const $ = (id) => document.getElementById(id);
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  const DATA = {};
  const load = (key) => DATA[key] || (DATA[key] = fetch('data/' + key + '.json?v=r4').then((r) => r.json()));
  const milli = (x) => Math.floor(x / 1000) + '.' + String(x % 1000).padStart(3, '0');
  const secs = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) : num(ms / 1000)) + ' s';

  // a canvas as wide as its box, h css pixels high, drawn in device pixels
  function fit(cv, w, h) {
    const r = window.devicePixelRatio || 1;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    return g;
  }
  const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',') + ')';
  function pressSeg(seg, attr, v) { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === v))); }
  const b64 = (s) => { const bin = atob(s), out = new Int8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) << 24 >> 24; return out; };

  // ---- 1. the training run ------------------------------------------------------------------

  const run = { key: 'attn', worker: null, live: null, n: 0, same: 0, t0: 0, tape: null, tapeStep: 0, built: null };
  const lossCv = $('loss-view'), tapeCv = $('tape-view');

  function drawLoss() {
    const box = lossCv.parentElement.clientWidth, W = box, H = Math.min(340, Math.max(220, Math.round(W * 0.62)));
    const g = fit(lossCv, W, H), padL = 40, padB = 26, padT = 10, padR = 10;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB, lo = 1.2, hi = 3.6, maxStep = 6018;
    const X = (s) => x0 + (s / maxStep) * (x1 - x0), Y = (l) => y1 - ((l - lo) / (hi - lo)) * (y1 - y0);
    g.fillStyle = css('panel'); g.fillRect(0, 0, W, H);
    g.font = '11px ' + css('mono'); g.fillStyle = css('muted'); g.strokeStyle = css('line'); g.lineWidth = 1;
    for (let l = 1.5; l <= 3.5; l += 0.5) { g.beginPath(); g.moveTo(x0, Y(l) + 0.5); g.lineTo(x1, Y(l) + 0.5); g.stroke(); g.fillText(l.toFixed(1), 6, Y(l) + 4); }
    for (const s of [0, 2000, 4000, 6000]) g.fillText(num(s), Math.min(X(s) - 4, x1 - 30), H - 8);
    const d = DATA[run.key + ':v'];
    if (d) {                                                      // the recorded steps of this program
      g.fillStyle = css('muted'); g.globalAlpha = 0.28;
      d.loss.forEach((l, i) => g.fillRect(X(i + 1) - 0.75, Y(l / 1000) - 0.75, 1.5, 1.5));
      g.globalAlpha = 1;
    }
    for (const k of KEYS) {                                       // the average of 100 steps, for each program
      const dk = DATA[k + ':v'];
      if (!dk) continue;
      g.strokeStyle = css(COLOR[k]); g.lineWidth = k === run.key ? 2.5 : 1.25; g.beginPath();
      let sum = 0;
      dk.loss.forEach((l, i) => {
        sum += l; if (i >= 100) sum -= dk.loss[i - 100];
        if (i >= 49) { const y = Y(sum / Math.min(i + 1, 100) / 1000); if (i === 49) g.moveTo(X(i - 49), y); else g.lineTo(X(i - 49), y); }
      });
      g.stroke();
    }
    if (run.live) {                                               // this run
      g.fillStyle = css(COLOR[run.key]);
      run.live.forEach((l, i) => g.fillRect(X(i + 1) - 1.25, Y(l / 1000) - 1.25, 2.5, 2.5));
      g.fillStyle = css('ink'); g.fillRect(X(run.live.length), y0, 1, y1 - y0);
    }
    g.fillStyle = css('muted'); g.fillText('step', x1 - 26, y1 - 6);
  }

  function lossKey() {
    $('loss-key').innerHTML = KEYS.map((k) => `<span><i class="sw" style="background:var(--${COLOR[k]})"></i>${TITLE[k]}</span>`).join('') +
      '<span><i class="sw" style="background:var(--muted);opacity:.4"></i>one step, recorded</span>';
  }

  // the slots of the tape: a name for each, for the figure's words
  function slotName(key, reg, row, col, d) {
    const R = d.regions[reg], f = row - 1, V = 27, letter = (c) => (c ? String.fromCharCode(96 + c) : 'end');
    const back = (k, n) => ['three', 'two', 'one'][3 - n + k] + ' letter' + (n - k === 1 ? '' : 's') + ' back';
    if (row * R.slots + col >= R.regionSlots) return null;
    if (key !== 'bigram' && reg === d.regions.length - 1 && f === R.units + 1) return { what: 'output bias for “' + letter(col) + '”' };
    if (f < 0 || f >= R.units) return { what: f < 0 ? 'the frame before the first: room for the walks to start' : 'the landing frame: where the walks end' };
    if (col === 0) return { what: 'the frame marker' };
    if (key === 'bigram') return { unit: 'next letter “' + letter(f) + '”', what: col <= V ? 'after “' + letter(col - 1) + '”' : 'bias' };
    if (key === 'attn' && reg === 0) {
      const unit = 'query and key dimension ' + (f + 1);
      if (col <= V) return { unit, what: 'query for the newest letter “' + letter(col - 1) + '”' };
      if (col === V + 1) return { unit, what: 'query bias' };
      if (col <= 2 * V + 1) return { unit, what: 'key for the letter “' + letter(col - V - 2) + '”' };
      return { unit, what: 'key for position ' + (col - 2 * V - 1) + ' of 8' };
    }
    const unit = 'hidden unit ' + (f + 1), K = 3;
    if (col <= K * V) { const k = Math.floor((col - 1) / V); return { unit, what: 'for “' + letter((col - 1) % V) + '”, ' + back(k, K) }; }
    if (col === K * V + 1) return { unit, what: 'bias' };
    if (col <= K * V + 1 + V) return { unit, what: 'to the next letter “' + letter(col - K * V - 2) + '”' };
    if (col <= K * V + 1 + 2 * V) return { unit, what: 'value of the letter “' + letter(col - K * V - 2 - V) + '”' };
    return { unit, what: 'value of position ' + (col - K * V - 1 - 2 * V) + ' of 8' };
  }

  let tapeGeom = null;
  function drawTape() {
    const d = DATA[run.key + ':v'];
    if (!d) return;
    const live = run.worker && run.tape, idx = +$('tape-step').value;
    const w = live ? run.tape : b64(d.snapshots[Math.min(idx, d.snapshots.length - 1)].w);
    const maxCols = Math.max(...d.regions.map((R) => R.slots));
    const box = tapeCv.parentElement.clientWidth, s = Math.max(1, Math.min(8, Math.floor(box / maxCols)));
    const labH = 16, gap = 8, rows = d.regions.map((R) => Math.ceil(R.regionSlots / R.slots));
    const H = rows.reduce((a, r) => a + labH + r * s + gap, 0), W = box;
    const g = fit(tapeCv, W, H);
    g.fillStyle = css('panel'); g.fillRect(0, 0, W, H);
    const bg = rgb(css('panel')), plus = rgb(css('c-plus')), minus = rgb(css('c-minus'));
    const shades = [];
    for (let q = 0; q <= 127; q++) shades.push([mix(bg, plus, Math.min(1, q / 48)), mix(bg, minus, Math.min(1, q / 48))]);
    let y = 0, k = 0;
    tapeGeom = { s, regions: [] };
    g.font = '11px ' + css('mono');
    d.regions.forEach((R, ri) => {
      g.fillStyle = css('muted');
      const label = run.key === 'bigram' ? 'one row per next letter, one column per letter before it'
        : ri === 0 && d.regions.length > 1 ? 'queries and keys: one row per dimension' : 'hidden units: one row each, then the output biases';
      g.fillText(label, 0, y + 11);
      y += labH;
      tapeGeom.regions.push({ y, rows: rows[ri], cols: R.slots, first: k });
      for (let r = 0; r < R.regionSlots; r++, k++) {
        const q = w[k];
        g.fillStyle = q >= 0 ? shades[q][0] : shades[-q][1];
        g.fillRect((r % R.slots) * s, y + Math.floor(r / R.slots) * s, s, s);
      }
      y += rows[ri] * s + gap;
    });
    const step = live ? run.tapeStep : d.snapshots[Math.min(idx, d.snapshots.length - 1)].step;
    $('tape-step-out').textContent = live ? 'live ' + num(step) : num(step);
    $('tape-label').textContent = live ? 'Weights on the tape of the running program' : 'Weights on the tape';
  }

  function tapeHover(ev) {
    const d = DATA[run.key + ':v'];
    if (!d || !tapeGeom) return;
    const r = tapeCv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, s = tapeGeom.s;
    for (let ri = 0; ri < tapeGeom.regions.length; ri++) {
      const G = tapeGeom.regions[ri], row = Math.floor((y - G.y) / s), col = Math.floor(x / s);
      if (row < 0 || row >= G.rows || col < 0 || col >= G.cols) continue;
      const nm = slotName(run.key, ri, row, col, d);
      if (!nm) break;
      const live = run.worker && run.tape, idx = +$('tape-step').value;
      const w = live ? run.tape : b64(d.snapshots[Math.min(idx, d.snapshots.length - 1)].w);
      const v = w[G.first + row * G.cols + col] / 64;
      $('tape-said').textContent = (nm.unit ? nm.unit + ', ' : '') + nm.what + (nm.unit ? ': about ' + v.toFixed(2) : '') + '.';
      return;
    }
  }

  function stat(id, text, cls) { const e = $(id); e.textContent = text; e.className = cls || ''; }

  async function pick(key) {
    if (run.worker) return;
    run.key = key; run.live = null; run.tape = null;
    pressSeg($('train-model'), 'k', key);
    const d = await load(key);
    DATA[key + ':v'] = d;
    const slider = $('tape-step');
    slider.max = d.snapshots.length - 1; slider.value = d.snapshots.length - 1;
    stat('st-chars', num(d.program.chars)); stat('st-step', '0 of ' + num(d.steps)); stat('st-loss', '–'); stat('st-time', '–'); stat('st-same', '–');
    $('train-said').textContent = d.name + ': ' + num(d.parameters) + ' weights, trained by ' + d.trainer + ', ' + num(d.program.chars) + ' characters of brainfuck. It reads the names ' +
      (d.epochs === 1 ? 'once' : d.epochs + ' times') + ', ' + num(d.examples) + ' letters, ' + num(d.steps) + ' steps.';
    $('train-names').hidden = true;
    drawLoss(); drawTape();
  }

  function stop(msg) {
    if (run.worker) run.worker.terminate();
    run.worker = null;
    if (window.LeaveGuard) LeaveGuard.set('train', false);
    $('train-go').textContent = 'Train';
    $('train-model').querySelectorAll('button').forEach((b) => { b.disabled = false; });
    if (msg) $('train-said').textContent = msg;
    drawTape();
  }

  function start() {
    const d = DATA[run.key + ':v'];
    if (!d) return;
    run.live = []; run.n = 0; run.same = 0; run.t0 = performance.now(); run.tape = null;
    $('train-names').hidden = true;
    $('train-go').textContent = 'Stop';
    $('train-model').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    $('train-said').textContent = 'Building the training program…';
    const wk = run.worker = new Worker('worker.js?v=r5');
    if (window.LeaveGuard) LeaveGuard.set('train', true);
    let pending = false;
    const redraw = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; drawLoss(); drawTape(); }); };
    wk.onmessage = (ev) => {
      const m = ev.data;
      if (wk !== run.worker) return;
      if (m.type === 'built') $('train-said').textContent = 'Built in ' + num(m.ms) + ' ms: ' + num(m.chars) + ' characters. Compiling it to WebAssembly…';
      else if (m.type === 'compiled') $('train-said').textContent = 'Compiled in ' + num(m.ms) + ' ms. Training: the program reads the names and prints a line after every step.';
      else if (m.type === 'tape') { run.tape = m.w; run.tapeStep = m.step; redraw(); }
      else if (m.type === 'lines') {
        for (const line of m.lines) {
          const n = ++run.n, want = 'step ' + n + ' loss ' + milli(d.loss[n - 1]);
          if (line === want) run.same++;
          const l = line.match(/loss (\d+)\.(\d{3})$/);
          run.live.push(l ? +l[1] * 1000 + +l[2] : NaN);
        }
        const last = m.lines[m.lines.length - 1], el = performance.now() - run.t0;
        stat('st-step', num(run.n) + ' of ' + num(d.steps));
        stat('st-loss', last.replace(/^.* loss /, ''));
        stat('st-time', secs(el));
        stat('st-same', num(run.same) + ' of ' + num(run.n), run.same === run.n ? 'ok' : 'no');
        redraw();
      } else if (m.type === 'trained') {
        const ok = m.sha256 === d.child.sha256;
        $('train-said').textContent = 'Trained: ' + num(d.steps) + ' steps in ' + secs(m.ms) + ', ' + (m.ms / d.steps).toFixed(2) + ' ms per step. Then it printed its child program, ' + num(m.child) + ' characters, ' +
          (ok ? 'equal to the reference’s to the last character' : 'which differs from the reference’s') + '. Running the child…';
      } else if (m.type === 'names') {
        const ok = m.names === d.names;
        $('train-names-list').textContent = m.names.trim().split('\n').join('  ');
        $('train-names').hidden = false;
        stop($('train-said').textContent.replace(' Running the child…', '') + ' The child printed 30 names' + (ok ? ', the same as the reference’s child.' : ', not the same as the reference’s child.'));
      } else if (m.type === 'error') stop('Stopped: ' + m.message);
    };
    wk.onerror = (e) => stop('Stopped: ' + (e.message || 'the worker failed'));
    wk.postMessage({ type: 'train', key: run.key });
  }

  $('train-go').addEventListener('click', () => { if (run.worker) stop('Stopped after ' + num(run.n) + ' steps.'); else start(); });
  $('train-model').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) pick(b.dataset.k); });
  $('tape-step').addEventListener('input', drawTape);
  tapeCv.addEventListener('mousemove', tapeHover);

  // ---- 2. the program to scale --------------------------------------------------------------

  const PART = {
    start: ['Writes the markers and the seed', 'c-lt'], init: ['Draws the random start weights', 'c-lt'],
    read: ['Reads a letter, moves the context on', 'c-in'],
    'key-forward': ['Queries, keys and scores', 'd1'], attention: ['Softmax of the attention', 'd4'],
    forward: ['Hidden units and logits', 'd1'], head: ['Softmax, loss and its gradient', 'd5'],
    backward: ['Back through the hidden units', 'd2'], 'attention-backward': ['Back through the attention', 'd4'],
    'key-backward': ['Back into the queries and keys', 'd2'], momentum: ['Moves every weight', 'd3'],
    'print-step': ['Prints the step and the loss', 'c-out'], 'child-weights': ['Prints the child’s weights', 'c-out'],
    engine: ['Prints the child’s engine', 'rule'],
  };
  const CMD = { '+': 't-plus', '-': 't-minus', '<': 't-mv', '>': 't-mv', '[': 't-br', ']': 't-br', ',': 't-in', '.': 't-out' };
  const map = { key: 'attn', k: 0, start: 0, text: {}, cols: 0, rows: 0, deep: false, whole: true };
  const mapCv = $('map-view');

  function partAt(parts, a) { let i = 0; while (i + 1 < parts.length - 1 && parts[i + 1][1] <= a) i++; return i; }

  function mapGeom(deep = map.k <= 1) {
    const W = mapCv.parentElement.clientWidth, H = Math.min(360, Math.max(220, Math.round(W * 0.45)));
    const cw = deep ? 11 : 4, ch = deep ? 16 : 4;
    return { W, H, cw, ch, cols: Math.floor(W / cw), rows: Math.floor(H / ch), deep };
  }
  function topK(d) { const G = mapGeom(false); return Math.ceil(d.program.chars / (G.cols * G.rows)); }

  function drawMap() {
    const d = DATA[map.key + ':v'];
    if (!d) return;
    if (map.whole) { map.k = topK(d); map.start = 0; }
    const G = mapGeom(), g = fit(mapCv, G.W, G.H), parts = d.program.parts, N = d.program.chars;
    map.cols = G.cols; map.rows = G.rows; map.deep = G.deep;
    mapCv.classList.toggle('deep', G.deep);
    g.fillStyle = css('panel'); g.fillRect(0, 0, G.W, G.H);
    const text = map.text[map.key];
    g.font = '600 12px ' + css('mono'); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < G.cols * G.rows; i++) {
      const a = map.start + i * map.k;
      if (a >= N) break;
      const x = (i % G.cols) * G.cw, y = Math.floor(i / G.cols) * G.ch, col = css(PART[parts[partAt(parts, a)][0]][1]);
      if (G.deep && text) {
        g.globalAlpha = 0.22; g.fillStyle = col; g.fillRect(x, y, G.cw, G.ch); g.globalAlpha = 1;
        g.fillStyle = css(CMD[text[a]] || 'ink'); g.fillText(text[a], x + G.cw / 2, y + G.ch / 2 + 1);
      } else { g.fillStyle = col; g.fillRect(x, y, G.cw, G.ch); }
    }
    $('map-out').disabled = $('map-all').disabled = map.k >= topK(d);
    const shown = Math.min(N, map.start + G.cols * G.rows * map.k) - map.start;
    $('map-said').textContent = map.k >= topK(d)
      ? 'The whole program, ' + num(N) + ' characters; each square is ' + num(map.k) + ' characters.'
      : 'Characters ' + num(map.start + 1) + ' to ' + num(map.start + shown) + ' of ' + num(N) + (G.deep ? ', one per square.' : '; each square is ' + num(map.k) + ' characters.');
  }

  function partsList() {
    const d = DATA[map.key + ':v'], parts = d.program.parts, N = d.program.chars;
    $('map-parts').innerHTML = parts.slice(0, -1).map(([name, a], i) => {
      const n = parts[i + 1][1] - a;
      return `<li data-a="${a}"><button type="button" data-a="${a}"><i class="sw" style="background:var(--${PART[name][1]})"></i><span>${PART[name][0]}</span><span class="n">${num(n)} · ${(100 * n / N).toFixed(1)}%</span></button></li>`;
    }).join('');
  }

  async function ensureText(key) {
    if (map.text[key]) return;
    const m = T.spec.MODELS[key], engine = new T.gen.Gen(m, { child: true }).childEngine();
    map.text[key] = new T.gen.Gen(m).trainer(engine).src;
  }

  async function zoomTo(a, k) {
    const d = DATA[map.key + ':v'];
    if (k <= 1) { $('map-said').textContent = 'Building the program to show its characters…'; await new Promise((r) => setTimeout(r, 30)); await ensureText(map.key); }
    map.k = Math.max(1, k); map.whole = map.k >= topK(d);
    const G = mapGeom(), row = G.cols * map.k;
    map.start = Math.max(0, Math.min(Math.floor((a - (G.cols * G.rows * map.k) / 2) / row) * row, Math.floor(d.program.chars / row) * row));
    drawMap();
  }

  async function mapPick(key) {
    map.key = key;
    pressSeg($('map-model'), 'k', key);
    DATA[key + ':v'] = await load(key);
    map.whole = true;
    partsList(); drawMap();
  }

  mapCv.addEventListener('click', (e) => {
    if (map.deep) return;
    const r = mapCv.getBoundingClientRect(), G = mapGeom();
    const i = Math.floor((e.clientY - r.top) / G.ch) * G.cols + Math.floor((e.clientX - r.left) / G.cw);
    const k = map.k / 16 < 2 ? 1 : Math.ceil(map.k / 16);
    zoomTo(map.start + i * map.k, k);
  });
  mapCv.addEventListener('mousemove', (e) => {
    const d = DATA[map.key + ':v'];
    if (!d) return;
    const r = mapCv.getBoundingClientRect(), G = mapGeom();
    const i = Math.floor((e.clientY - r.top) / G.ch) * G.cols + Math.floor((e.clientX - r.left) / G.cw), a = map.start + i * map.k;
    if (a >= d.program.chars) return;
    const parts = d.program.parts, p = partAt(parts, a), n = parts[p + 1][1] - parts[p][1];
    const text = map.text[map.key];
    $('map-said').textContent = (G.deep && text ? 'Character ' + num(a + 1) + ', “' + text[a] + '”, in: ' : 'Character ' + num(a + 1) + ', in: ') +
      PART[parts[p][0]][0].toLowerCase() + ' (' + num(n) + ' characters, ' + (100 * n / d.program.chars).toFixed(1) + '% of the program).';
    document.querySelectorAll('#map-parts li').forEach((li, j) => li.classList.toggle('on', j === p));
  });
  $('map-out').addEventListener('click', () => { const d = DATA[map.key + ':v'], G = mapGeom(); zoomTo(map.start + (G.cols * G.rows * map.k) / 2, Math.min(topK(d), map.k === 1 ? 16 : map.k * 16)); });
  $('map-all').addEventListener('click', () => { map.whole = true; drawMap(); });
  $('map-model').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) mapPick(b.dataset.k); });
  $('map-parts').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = DATA[map.key + ':v'], parts = d.program.parts, a = +b.dataset.a, i = parts.findIndex((p) => p[1] === a), n = parts[i + 1][1] - a, G = mapGeom();
    let k = topK(d);
    while (k > 1 && n / (k / 16) < G.cols * G.rows * 0.9) k = Math.ceil(k / 16);
    zoomTo(a + Math.min(n, G.cols * G.rows * k) / 2, k);
  });

  // ---- 3. where the attention looks -------------------------------------------------------

  let attP = null;
  async function attention() {
    const d = await load('attn');
    if (!attP) {
      const wrap = (x) => (Array.isArray(x) ? x.map(wrap) : { w: x, v: 0 });
      attP = {};
      for (const k of Object.keys(d.childParams)) attP[k] = wrap(d.childParams[k]);
    }
    const m = T.spec.MODELS.attn, word = $('att-word').value.toLowerCase().replace(/[^a-z]/g, '');
    const toks = [...word].map((c) => c.charCodeAt(0) - 96).slice(-m.T);
    const ctx = Array(m.T - toks.length).fill(0).concat(toks);
    const f = T.reference.forward(m, attP, ctx, T.spec.SC), sm = T.reference.softmax(f.u);
    $('att-row').innerHTML = ctx.map((c, i) => {
      const pc = Math.round((f.att[i] * 100) / 256);
      return `<div class="att-cell"><div class="bar"><i style="height:${(f.att[i] / 256) * 100}%"></i></div><b class="${c ? '' : 'pad'}${i === m.T - 1 ? ' last' : ''}">${c ? String.fromCharCode(96 + c) : '.'}</b><span>${pc}%</span></div>`;
    }).join('');
    const p = sm.e.map((e, j) => [j, e / sm.S]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('att-next').innerHTML = p.map(([j, q]) => `<div><b>${j ? String.fromCharCode(96 + j) : '↵'}</b><span class="m"><i style="width:${(q / p[0][1]) * 100}%"></i></span><span>${(q * 100).toFixed(q < 0.1 ? 1 : 0)}%</span></div>`).join('');
    const top = f.att.indexOf(Math.max(...f.att));
    $('att-said').textContent = word
      ? 'After “' + word + '” it takes in most from ' + (ctx[top] ? '“' + String.fromCharCode(96 + ctx[top]) + '”, position ' + (top + 1) + ' of 8' : 'a place before the name') + ' (' + Math.round((f.att[top] * 100) / 256) +
        '%), and its first guess is ' + (p[0][0] ? '“' + String.fromCharCode(96 + p[0][0]) + '”' : 'the end of the name') + ' (' + Math.round(p[0][1] * 100) + '%).'
      : 'With no letters yet, it guesses the first letter of a name.';
    pressSeg($('att-pick'), 'w', word);
  }
  $('att-word').addEventListener('input', attention);
  $('att-pick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { $('att-word').value = b.dataset.w; attention(); } });

  // ---- 4. the names -----------------------------------------------------------------------

  async function names() {
    const known = new Set(T.data.names());
    const html = [];
    for (const k of KEYS) {
      const d = await load(k), list = d.names.trim().split('\n'), old = list.filter((n) => known.has(n)).length;
      html.push(`<div style="--c:var(--${COLOR[k]})"><h3>${d.name}</h3><ol>${list.map((n) => `<li${known.has(n) ? ' class="known"' : ''}>${n || '(empty)'}</li>`).join('')}</ol><p>${list.length - old} new, ${old} from the list (✓)</p></div>`);
    }
    $('kids').innerHTML = html.join('');
  }

  // ---- start ----------------------------------------------------------------------------------

  lossKey();
  Promise.all(KEYS.map(async (k) => { DATA[k + ':v'] = await load(k); })).then(() => { drawLoss(); });
  const asked = new URLSearchParams(location.search).get('m'), first = KEYS.includes(asked) ? asked : 'attn';
  pick(first);
  mapPick(first);
  attention();
  names();
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { drawLoss(); drawTape(); drawMap(); }, 120); });
  new MutationObserver(() => { drawLoss(); drawTape(); drawMap(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
