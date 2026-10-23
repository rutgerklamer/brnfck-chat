// The figures of the page "Inside the program".
(function () {
  'use strict';
  const I = window.Inside;
  const { $, el, fmt, pct, short, minus, words, billions, lineFit, json, get, lazy, ready, cssVar, onResize, fit, MODEL, QWEN, MODELS, FAM, KIND, CMD, LEGEND, blockSpan, clearRows, layerNo, regionTitle, regionSays, markLabel, tiles, textAt, pretty } = I;
  const swatch = (fam) => { const s = I.swatch(fam); s.classList.add('glyph', 'part'); return s; };
  const outOf = (inp) => inp.parentNode.querySelector('output');
  const readOut = (inp, text, valuetext) => { const o = outOf(inp); if (!o) return; o.textContent = text; inp.setAttribute('aria-valuetext', valuetext || text); };
  // speed 1 to 10 is the time the whole run or trip takes: 40 seconds down to 2
  const SPEEDS = (v) => 40 * Math.exp(-3 * (v - 1) / 9);
  const sayTime = (v) => { const t = SPEEDS(v); return (t < 10 ? t.toFixed(1) : String(Math.round(t))) + ' s'; };
  function makePlayer(btn, speed, noun, advance, begin) {
    let raf = 0;
    const showSpeed = () => readOut(speed, 'the ' + noun + ' takes ' + sayTime(Number(speed.value)));
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; btn.textContent = 'Play'; };
    const play = () => {
      if (begin) begin();
      btn.textContent = 'Pause'; let last = -1;
      const tick = (now) => { if (last < 0) last = now; const dt = Math.max(0, Math.min(0.064, (now - last) / 1000)); last = now; if (advance(dt, SPEEDS(Number(speed.value)))) { stop(); return; } raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    };
    btn.addEventListener('click', () => (raf ? stop() : play()));
    speed.addEventListener('input', showSpeed); showSpeed();
    return stop;
  }
  // set once the data is there (every section below runs after that)
  let SEC = null, WJ = null, EJ = null, TR = null;
  // a link that opens the map page of this program on the stretch [from, to) of the text
  const mapLink = (from, to) => '../map/?m=' + MODEL + '#show=' + (from + 1) + ',' + to;
  document.querySelectorAll('a.tomap').forEach((a) => { a.href = '../map/?m=' + MODEL; });
  ready.then(() => { SEC = I.SEC; WJ = I.W; EJ = I.E; TR = I.TR; });

  // ---- shared drawing
  function drawRanges(canvas, items, view, opts = {}) {
    const { ctx, w, h } = fit(canvas), [a, b] = view, sx = (v) => (v - a) / (b - a) * w;
    const col = {}; for (const k in FAM) col[k] = cssVar(FAM[k].v);
    for (const it of items) {
      if (it.to <= a || it.from >= b) continue;
      const x0 = Math.max(0, sx(it.from)), x1 = Math.min(w, sx(it.to));
      ctx.fillStyle = col[it.fam]; ctx.globalAlpha = it.alpha === undefined ? 1 : it.alpha;
      ctx.fillRect(x0, 0, Math.max(x1 - x0, opts.min || 0.5), h);
    }
    ctx.globalAlpha = 1;
    if (opts.sel) { const x0 = sx(opts.sel[0]), x1 = sx(opts.sel[1]); ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2; ctx.strokeRect(Math.max(1, x0), 1, Math.max(3, Math.min(w - 1, x1) - Math.max(1, x0)), h - 2); }
    if (opts.cursor !== undefined && opts.cursor !== null) { const x = Math.max(0, Math.min(w, sx(opts.cursor))); ctx.fillStyle = cssVar('--bg'); ctx.fillRect(x - 2.5, 0, 5, h); ctx.fillStyle = cssVar('--ink'); ctx.fillRect(x - 1, 0, 2, h); }
    return (clientX) => { const r = canvas.getBoundingClientRect(), v = a + (clientX - r.left) / r.width * (b - a); return items.find((it) => v >= it.from && v < it.to) || null; };
  }
  function dragAlong(canvas, at) {
    let down = false, x0 = 0, moved = false;
    const frac = (e) => { const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    canvas.addEventListener('pointerdown', (e) => { if (e.button) return; down = true; moved = false; x0 = e.clientX; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } at(frac(e)); });
    canvas.addEventListener('pointermove', (e) => { if (!down) return; if (Math.abs(e.clientX - x0) > 4) moved = true; at(frac(e)); });
    const up = () => { down = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    return () => { const m = moved; moved = false; return m; };           // true once after a drag: the click that ends it is not a press
  }
  const hbar = (box, label, frac, value, colour, extra) => {
    const l = el('span', 'lab'), tr = el('div'), i = el('div', 'bar'), v = el('span', '', value);
    if (label instanceof Node) l.append(label); else l.textContent = label;
    i.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; if (colour) i.style.background = colour;
    tr.append(i);
    if (extra) { const wrap = el('div', 'rowbtn'); wrap.append(l, tr, v); box.append(wrap); return wrap; }
    box.append(l, tr, v); return i;
  };

  // The page-wide legend.
  LEGEND.forEach(([k, name]) => { const li = el('li'); li.append(swatch(k), name); $('legend-kinds').append(li); });

  // ---- 1. the file at a glance
  lazy($('s1'), async () => {
    const W = WJ, total = W.program.chars;
    // ways to picture it
    const WAYS = [
      ['As books', () => { const pages = total / 1800, books = pages / 300; return ['Printed as paperbacks it would be <b>' + fmt(Math.ceil(books)) + ' books</b> of 300 pages: a shelf of ' + fmt(books * 0.025) + ' metres, with nothing in it but eight symbols.', 'Counted with 1,800 characters on a page and 2.5 cm per book.']; }],
      ['As one line', () => ['Typed as the one line it is, in letters 2 mm wide, it would be <b>' + fmt(total * 0.002 / 1000) + ' kilometres</b> long.', 'Counted with 2 mm per character.']],
      ['Read aloud', () => ['Read aloud at three symbols a second, without ever stopping, it would take <b>' + (total / 3 / 86400 / 365.25).toFixed(1) + ' years</b>.', 'Counted with 3 characters per second, day and night.']],
      ['As pixels', () => ['With one pixel for every character it fills <b>' + fmt(total / (3840 * 2160)) + ' screens</b> of 3,840 by 2,160 pixels. The map of this site does exactly this, and lets you move over it.', 'Counted with 8,294,400 pixels per screen.']],
      ['Typed by hand', () => ['Typed by hand at five keys a second, eight hours a day, it would take <b>' + fmt(total / 5 / 3600 / 8 / 365.25) + ' years</b>. Nobody did: a generator wrote it, ' + MODELS[MODEL].built + '.', 'Counted with 5 characters per second, 8 hours every day of the year.']],
    ];
    const show = (i) => { [...$('g-ways').children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); const [a, b] = WAYS[i][1](); $('g-fact').innerHTML = a; $('g-basis').textContent = b; };
    WAYS.forEach(([name], i) => { const b = el('button', '', name); b.type = 'button'; b.addEventListener('click', () => show(i)); $('g-ways').append(b); });
    show(0);
    // the two parts
    const pb = $('g-parts'); const a = el('i'), b = el('i');
    a.style.cssText = 'flex:' + W.program.writer + ' 0 0;background:var(--k-write)'; b.style.cssText = 'flex:' + W.program.engine + ' 0 0;background:var(--k-engine)';
    pb.append(a, b); pb.setAttribute('aria-label', 'The writing part is ' + pct(W.program.writer / total) + ' of the file, the engine ' + pct(W.program.engine / total));
    // the commands
    const order = [...W.counts.order], box = $('g-cmds'), rows = [];
    CMD.forEach(([ch, name, v]) => {
      const lab = el('span', 'lab'), sym = el('i', 'sw glyph ' + v.slice(2), ch === '-' ? '−' : ch), nm = el('span', 'nm', name), tr = el('div'), bar = el('div', 'bar'), ct = el('span', 'ct');
      sym.setAttribute('aria-hidden', 'true'); bar.style.background = 'var(' + v + ')'; tr.append(bar); lab.append(sym, nm);
      box.append(lab, tr, ct); rows.push({ k: order.indexOf(ch), bar, ct });
    });
    const part = (which) => {
      const c = order.map((_, k) => (which !== 'engine' ? W.counts.writer[k] : 0) + (which !== 'writer' ? W.counts.engine[k] : 0)), sum = c.reduce((x, y) => x + y, 0), max = Math.max(...c);
      rows.forEach((r) => { r.bar.style.width = (100 * c[r.k] / max) + '%'; r.ct.textContent = ''; r.ct.append(fmt(c[r.k]) + ' ', el('small', '', c[r.k] / sum < 0.0001 ? (c[r.k] ? 'once' : 'never') : pct(c[r.k] / sum))); });
      [...$('g-seg').children].forEach((b2) => b2.setAttribute('aria-pressed', String(b2.dataset.part === which)));
    };
    $('g-seg').addEventListener('click', (e) => { const b2 = e.target.closest('button'); if (b2) part(b2.dataset.part); });
    part('all');
    const gpos = $('g-pos'); gpos.max = W.profile.bins - 1;
    let gb = Math.floor(W.profile.bins / 2);
    const drawProfile = () => {
      const cv = $('g-profile'), { ctx, w, h } = fit(cv), P = W.profile, cols = CMD.map(([, , v]) => cssVar(v)), idx = CMD.map(([ch]) => order.indexOf(ch));
      const bins = P.bins;
      for (let x = 0; x < Math.ceil(w); x++) {
        const b0 = Math.floor(x / w * bins), b1 = Math.max(b0 + 1, Math.floor((x + 1) / w * bins));
        const s = new Float64Array(8); let t = 0;
        for (let q = b0; q < b1 && q < bins; q++) for (let k = 0; k < 8; k++) { s[k] += P.shares[q * 8 + k]; t += P.shares[q * 8 + k]; }
        let y = 0;
        // order of the stack: walking at the bottom, then digits, then brackets
        for (const k of [2, 3, 0, 1, 4, 5, 6, 7]) { const hh = t ? s[idx[k]] / t * h : 0; if (hh > 0) { ctx.fillStyle = cols[k]; ctx.fillRect(x, h - y - hh, 1.02, hh); y += hh; } }
      }
      const ex = W.program.writer / total * w;
      ctx.fillStyle = cssVar('--ink'); ctx.fillRect(ex - 0.5, 0, 1, h);
      const gx = (gb + 0.5) / bins * w; ctx.fillStyle = cssVar('--bg'); ctx.fillRect(gx - 2.5, 0, 5, h); ctx.fillStyle = cssVar('--ink'); ctx.fillRect(gx - 1, 0, 2, h); sayBin();
    };
    function sayBin() {
      const P = W.profile, a = gb * P.charsPerBin, b = Math.min(total, (gb + 1) * P.charsPerBin), sh = CMD.map(([, name], k) => [name, P.shares[gb * 8 + order.indexOf(CMD[k][0])]]), t = sh.reduce((x, y) => x + y[1], 0) || 1;
      const parts = sh.map(([n, v]) => [n, v / t]).filter((x) => x[1] >= 0.01).sort((x, y) => y[1] - x[1]).map(([n, v]) => pct(v, 0) + ' ' + n);
      gpos.value = gb; readOut(gpos, 'slice ' + fmt(gb + 1) + ' of ' + fmt(P.bins), 'slice ' + fmt(gb + 1) + ' of ' + fmt(P.bins) + ', characters ' + fmt(a + 1) + ' to ' + fmt(b) + ': ' + parts.join(', '));
      $('g-pos-said').textContent = 'Characters ' + fmt(a + 1) + ' to ' + fmt(b) + (b <= W.program.writer ? ', in the writing part' : a >= W.program.writer ? ', in the engine' : ', where the writing part ends and the engine begins') + ': ' + parts.join(', ') + '.';
    }
    drawProfile(); onResize(drawProfile);
    gpos.addEventListener('input', () => { gb = Number(gpos.value); drawProfile(); });
    dragAlong($('g-profile'), (f) => { gb = Math.max(0, Math.min(W.profile.bins - 1, Math.floor(f * W.profile.bins))); drawProfile(); });
    $('g-profile-mid').textContent = 'the engine starts at the thin line near the right end';
    const br = W.counts.writer[4] + W.counts.writer[5];
    $('g-profile-note').textContent = 'Each thin column is one 2,048th of the file (' + fmt(W.profile.charsPerBin) + ' characters). Its colours show how many of those characters are each command. In the writing part one character in ' + fmt(W.program.writer / br) + ' is a bracket; in the engine one in ' + fmt(W.program.engine / (W.counts.engine[4] + W.counts.engine[5])) + '.';
  });

  // ---- 1b. the program printed: every book on its shelf, coloured by what its characters write ----
  // A book: 300 pages of 1,800 characters, coloured by the family of the region most of its characters write (writer.json).
  const BOOK = 300 * 1800;
  lazy($('lib-card'), async () => {
    const W = WJ, E = EJ, total = W.program.chars, writer = W.program.writer, N = Math.ceil(total / BOOK);
    const books = Array.from({ length: N }, () => ({ c: {}, r: null, rn: 0 }));
    const add = (from, to, fam, r) => {
      for (let b = Math.floor(from / BOOK); b < N && b * BOOK < to; b++) {
        const n = Math.min(to, (b + 1) * BOOK) - Math.max(from, b * BOOK), B = books[b];
        if (n <= 0) continue;
        B.c[fam] = (B.c[fam] || 0) + n;
        if (r && n > B.rn) { B.r = r; B.rn = n; }
      }
    };
    let at = 0;
    for (const s of [...W.stretches].sort((a, b) => a[1] - b[1])) {
      if (s[1] > at) add(at, s[1], 'work');
      const r = W.regions[s[0]]; add(s[1], s[2], (KIND[r.kind] || KIND.work).fam, r); at = Math.max(at, s[2]);
    }
    if (at < writer) add(at, writer, 'work');
    add(writer, total, 'engine');
    for (const B of books) { let n = -1; for (const k in B.c) if (B.c[k] > n) { n = B.c[k]; B.fam = k; } }
    const bookOf = (ch) => Math.floor(ch / BOOK), comma = bookOf(E.comma), dot = bookOf(E.dot), first = bookOf(writer);
    // the key: the families that colour at least one book, in the order of the page legend
    const used = new Set(books.map((B) => B.fam));
    for (const [k, name] of LEGEND) if (used.has(k)) { const li = el('li'); li.append(swatch(k), name); $('lib-key').append(li); }
    { const li = el('li'), s = el('i', 'sw glyph part', 'E'); s.style.background = 'var(--night-ink)'; s.style.outline = '1px solid var(--rule)'; s.setAttribute('aria-hidden', 'true'); li.append(s, 'The engine'); $('lib-key').append(li); }
    { const li = el('li'), s = el('i', 'ring'); s.setAttribute('aria-hidden', 'true'); li.append(s, 'The books with the only ', el('code', '', ','), ' and the only ', el('code', '', '.')); $('lib-key').append(li); }
    $('lib-count').textContent = MODELS[MODEL].short + ': ' + fmt(N) + ' books';
    const cv = $('g-lib');
    let G = null, sel = -1;
    // the wall: spines of whole device pixels, seven times as tall as wide, as many to a shelf as fit
    function geo(w) {
      const dpr = window.devicePixelRatio || 1, target = Math.max(300, Math.min(560, w * 0.62));
      const sw = Math.max(1, Math.round(Math.max(1, Math.min(7, Math.sqrt(target * w / (7 * N)))) * dpr)) / dpr;
      const per = Math.floor((w - 12) / sw), rows = Math.ceil(N / per), bh = Math.max(6, Math.round(sw * 7)), rh = bh + 5;
      return { dpr, sw, per, rows, bh, rh, x0: Math.round((w - per * sw) / 2), y0: 6, h: rows * rh + 10 };
    }
    const spot = (i) => ({ x: G.x0 + (i % G.per) * G.sw, y: G.y0 + Math.floor(i / G.per) * G.rh });
    function draw() {
      G = geo(cv.clientWidth); cv.style.height = (G.h + 4) + "px";               // 4: the border, inside the height
      const { ctx, w } = fit(cv), col = { engine: cssVar('--night-ink') };            // the engine: light, apart from every family
      for (const k in FAM) col[k] = cssVar(FAM[k].v);
      ctx.fillStyle = cssVar('--night'); ctx.fillRect(0, 0, w, G.h);
      // the planks, then the books: next to each other, a little darker every other book where they are wide enough to tell apart
      ctx.fillStyle = cssVar('--night-line');
      for (let r = 0; r < G.rows; r++) ctx.fillRect(G.x0 - 4, G.y0 + r * G.rh + G.bh, (r < G.rows - 1 ? G.per : N - r * G.per) * G.sw + 8, 2);
      const gap = G.sw * G.dpr >= 3 ? 1 / G.dpr : 0;
      for (let i = 0; i < N; i++) {
        const { x, y } = spot(i), last = i === N - 1 ? (total - i * BOOK) / BOOK : 1;
        ctx.fillStyle = col[books[i].fam]; ctx.globalAlpha = !gap && G.sw * G.dpr >= 2 && i % 2 ? 0.8 : 1;
        ctx.fillRect(x, y + G.bh * (1 - Math.max(0.35, last)), G.sw - gap, G.bh * Math.max(0.35, last));       // the last book is only partly written
      }
      ctx.globalAlpha = 1;
      const ring = (i, c, wd) => { const { x, y } = spot(i); ctx.strokeStyle = c; ctx.lineWidth = wd; ctx.strokeRect(x - wd / 2 - 1, y - wd / 2 - 1, G.sw + wd + 2, G.bh + wd + 2); };
      ring(comma, cssVar('--go'), 2); ring(dot, cssVar('--go'), 2);
      if (sel >= 0) ring(sel, '#f4f3ee', 2);
    }
    const share = (B) => Object.entries(B.c).sort((a, b) => b[1] - a[1]).map(([k, n]) => pct(n / Object.values(B.c).reduce((x, y) => x + y, 0), 0) + ' ' + (k === 'engine' ? 'the engine' : FAM[k].name.toLowerCase().replace(/deltanet/g, 'DeltaNet')));
    function tell() {
      const s = $('lib-said');
      if (sel < 0) {
        s.innerHTML = '';
        s.append('The writing part fills books 1 to ', el('b', '', fmt(first)), ' and the start of book ', el('b', '', fmt(first + 1)), '. The engine, which reads the question, works and prints, fills the last ', el('b', '', fmt(N - first)), '. The only comma is in book ', el('b', '', fmt(comma + 1)), ', the only full stop in book ', el('b', '', fmt(dot + 1)), '.');
        return;
      }
      const B = books[sel], a = sel * BOOK + 1, z = Math.min(total, (sel + 1) * BOOK), parts = share(B);
      s.innerHTML = '';
      s.append(el('b', '', 'Book ' + fmt(sel + 1) + ' of ' + fmt(N)), ': characters ' + fmt(a) + ' to ' + fmt(z) + '. ');
      if (B.fam === 'engine' && B.c.engine === z - a + 1) s.append('All of it is the engine.');
      else if (B.r) s.append('Mostly ', el('b', '', regionTitle(B.r)), '.');
      else s.append('Mostly characters that only walk.');
      if (parts.length > 1) s.append(' In it: ' + parts.join(', ') + '.');
      if (sel === comma) s.append(' It holds the only comma of the program, character ' + fmt(E.comma + 1) + ': every letter of a question goes in through it.');
      if (sel === dot) s.append(' It holds the only full stop, character ' + fmt(E.dot + 1) + ': every letter of every answer comes out through it.');
    }
    const at2 = (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left - 2, y = e.clientY - r.top - 2;
      const row = Math.floor((y - G.y0) / G.rh), c = Math.floor((x - G.x0) / G.sw), i = row * G.per + c;
      return row >= 0 && c >= 0 && c < G.per && i < N ? i : -1;
    };
    const choose = (i) => { sel = i; draw(); tell(); };
    cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const i = at2(e); if (i !== sel && i >= 0) choose(i); } });
    cv.addEventListener('pointerdown', (e) => { const i = at2(e); if (i >= 0) choose(i); });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') choose(-1); });
    cv.addEventListener('keydown', (e) => {
      const i = sel < 0 ? first : sel, to = { ArrowLeft: i - 1, ArrowRight: i + 1, ArrowUp: i - G.per, ArrowDown: i + G.per, Home: 0, End: N - 1 }[e.key];
      if (to === undefined) return; e.preventDefault(); choose(Math.max(0, Math.min(N - 1, to)));
    });
    function sayShelf() { $('lib-shelf').textContent = fmt(G.per) + ' to a shelf, ' + fmt(G.rows) + ' shelves'; }
    draw(); sayShelf(); tell(); onResize(() => { draw(); sayShelf(); });
    $('fig1').addEventListener('toggle', () => { draw(); sayShelf(); });            // it lies in a fold: drawn again when that opens
    $('lib-note').textContent = 'A book holds ' + fmt(BOOK) + ' characters: 300 pages of 1,800. Its colour is the part of the model that most of its characters write into memory; where a book holds more than one part, pointing at it gives the shares. The last book is only partly filled, and is drawn shorter. Counted from the stretches of the writing part, character by character.';
  });

  // ---- 3. one block
  lazy($('s3'), async () => {
    const W = WJ;
    const pick = $('b-pick');
    W.samples.forEach((s) => { const o = el('option', '', s.title + ' (' + fmt(s.K) + ' cells)'); o.value = s.id; pick.append(o); });
    let B = null, phases = [], done = 0, tape = null, ptr = 0, ORG = 0;
    let part = 0, pos = 0, S = 0, stopK = [0], stopC = [0], bounds = [], snaps = [], ends = [], cum = [];
    const ROWS = 10;

    function parse(text, K) {
      const top = [];                        // top-level pieces: flat text or one loop
      for (let i = 0; i < text.length;) {
        if (text[i] === '[') { let d = 0, j = i; do { if (text[j] === '[') d++; else if (text[j] === ']') d--; j++; } while (d > 0); top.push({ loop: true, from: i, to: j }); i = j; }
        else { let j = i; while (j < text.length && text[j] !== '[') j++; top.push({ loop: false, from: i, to: j }); i = j; }
      }
      const isPlane = (p) => { if (p.loop) return false; let n = 0; for (let i = p.from; i < p.to; i++) if (text[i] === '<') n++; return n >= K; };
      const out = []; let i = 0;
      const firstPlane = top.findIndex(isPlane);
      out.push({ type: 'setup', from: 0, to: top[firstPlane].from });
      for (i = firstPlane; i < top.length; i++) {
        const p = top[i];
        if (isPlane(p)) out.push({ type: 'digits', from: p.from, to: p.to });
        else if (p.loop) out.push({ type: 'pass', from: p.from, to: p.to });
        else out[out.length - 1].to = p.to;      // the last '<' after the last loop
      }
      const nd = out.filter((p) => p.type === 'digits').length; let k = nd;
      for (const p of out) { if (p.type === 'digits') { k--; p.plane = k; } else if (p.type === 'pass') { p.plane = k; p.last = k === 0; const m = /^\[\[-<(\++)>\]/.exec(text.slice(p.from, p.to)); p.factor = m ? m[1].length : 1; } }
      return out;
    }
    // Run a piece of brainfuck on the small tape.
    function run(text) {
      const jump = new Map(), st = [], mul = new Map();
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '[') st.push(i);
        else if (text[i] === ']') {
          const j = st.pop(); jump.set(i, j); jump.set(j, i);
          const body = text.slice(j + 1, i);
          if (!/[\[\]]/.test(body)) { let off = 0; const d = new Map(); for (const c of body) { if (c === '>') off++; else if (c === '<') off--; else d.set(off, (d.get(off) || 0) + (c === '+' ? 1 : -1)); } if (off === 0 && d.get(0) === -1) { d.delete(0); mul.set(j, [...d]); } }
        }
      }
      for (let pc = 0; pc < text.length; pc++) {
        switch (text.charCodeAt(pc)) {
          case 43: tape[ptr]++; break; case 45: tape[ptr]--; break; case 62: ptr++; break; case 60: ptr--; break;
          case 91: {
            const m = mul.get(pc);
            if (m) { const v = tape[ptr]; if (v !== 0) { for (const [o, f] of m) tape[ptr + o] += Math.imul(v, f); tape[ptr] = 0; } pc = jump.get(pc); }
            else if (tape[ptr] === 0) pc = jump.get(pc);
            break;
          }
          case 93: if (tape[ptr] !== 0) pc = jump.get(pc); break;
        }
      }
    }
    // digits of the text of a plane, in the order of the text: last cell of the block first
    const digitTexts = (p, count) => { const t = B.text.slice(p.from, p.to), out = []; let i = t.indexOf('<'); if (p.plane < B.D - 1 || B.f) i = t.indexOf('<', i + 1); while (out.length < count && i >= 0) { const j = t.indexOf('<', i + 1); out.push(t.slice(i + 1, j < 0 ? t.length : j)); i = j; } return out; };
    const val = (s) => { let v = 0; for (const c of s) v += c === '+' ? 1 : c === '-' ? -1 : 0; return v; };

    const digitEnds = (p) => { const t = B.text.slice(p.from, p.to), out = []; let i = t.indexOf('<'); if (p.plane < B.D - 1 || B.f) i = t.indexOf('<', i + 1); while (out.length < B.K && i >= 0) { const j = t.indexOf('<', i + 1); out.push(j < 0 ? t.length : j); i = j; } return out; };
    const flatStops = (t) => {
      const out = []; let depth = 0;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (c === '[') depth++;
        else if (c === ']') { if (--depth === 0) out.push(i + 1); }
        else if (depth === 0 && i > 0 && c !== t[i - 1] && t[i - 1] !== ']') out.push(i);
      }
      if (out.length > 300) { const k = Math.ceil(out.length / 300); return out.filter((_, i) => i % k === k - 1); }
      return out;
    };
    function buildStops() {
      ends = []; cum = []; stopK = [0]; stopC = [0]; bounds = []; snaps = []; let c = 0;
      phases.forEach((p, k) => {
        const len = p.to - p.from; cum.push(c); c += len;
        const offs = p.type === 'digits' ? (ends[k] = digitEnds(p)) : p.type === 'setup' ? flatStops(B.text.slice(p.from, p.to)) : [];
        let last = 0;
        for (const o of offs) if (o > last && o < len) { stopK.push(k); stopC.push(o); last = o; }
        stopK.push(k); stopC.push(len); bounds.push(stopK.length - 1);
      });
      cum.push(c); S = stopK.length - 1;
    }
    const startOf = (k) => (k ? bounds[k - 1] : 0);
    function snap(k) {
      if (!snaps[0]) snaps[0] = { t: new Int32Array(B.K + B.D + 80), p: ORG };
      if (snaps[k]) return snaps[k];
      let j = k - 1; while (j > 0 && !snaps[j]) j--;
      tape = snaps[j].t.slice(); ptr = snaps[j].p;
      for (let q = j; q < k; q++) { const p = phases[q]; run(B.text.slice(p.from, p.to)); snaps[q + 1] = { t: tape.slice(), p: ptr }; }
      return snaps[k];
    }
    function goTo(i) {
      pos = Math.max(0, Math.min(S, Math.round(i)));
      const k = stopK[pos], c = stopC[pos], p = phases[k];
      if (c >= p.to - p.from) { done = k + 1; part = 0; const s = snap(done); tape = s.t; ptr = s.p; }
      else { done = k; part = c; const s = snap(k); tape = s.t.slice(); ptr = s.p; if (c) run(B.text.slice(p.from, p.from + c)); }
      draw();
    }
    function reset() { ORG = 16; snaps = []; snap(0); goTo(0); }
    const nextBound = () => { for (const b of bounds) if (b > pos) return b; return S; };
    const prevBound = () => { for (let k = bounds.length - 1; k >= 0; k--) if (bounds[k] < pos) return bounds[k]; return 0; };
    function step() { if (pos < S) goTo(nextBound()); }
    const shiftNow = () => { let passes = 0; for (let k = 0; k < done; k++) if (phases[k].type === 'pass') passes++; return B.D - passes; };

    function draw() {
      // the parts
      const box = $('b-phases'); box.textContent = '';
      phases.forEach((p, k) => {
        const b = el('button'); b.type = 'button';
        b.append(blockSpan((k < done ? '✓ ' : '') + (p.type === 'setup' ? 'Set up' : p.type === 'digits' ? 'Digits' : p.last ? 'Last loop' : 'Loop ×' + p.factor)), el('small', '', fmt(p.to - p.from) + ' chars'));
        b.setAttribute('aria-pressed', String(k === done));
        if (k === done) b.setAttribute('aria-current', 'step');
        b.addEventListener('click', () => { stopPlay(); goTo(bounds[k]); });
        box.append(b);
      });
      // the text of the part that comes next (or the last one done); what has run of it is dimmed
      const cur = phases[Math.min(done, phases.length - 1)], t = B.text.slice(cur.from, cur.to), tb = $('b-text'); tb.textContent = '';
      const show = (s, at) => { let n = at; for (const ch of s) { const sp = el('span', (ch === '+' ? 't-plus' : ch === '-' ? 't-minus' : ch === '[' || ch === ']' ? 't-br' : 't-mv') + (n < part ? ' ran' : ''), ch === '-' ? '−' : ch); tb.append(sp); n++; } };
      if (t.length <= 900) show(t, 0); else { show(t.slice(0, 520), 0); tb.append(el('span', 'muted', '  … ' + fmt(t.length - 780) + ' more characters …  ')); show(t.slice(-260), t.length - 260); }
      // what happens
      const said = $('b-said'); let s = '';
      const shift = shiftNow();
      if (done === 0 && part === 0) s = 'Nothing has run yet. The block must fill ' + fmt(B.K) + ' cells. Its text is ' + fmt(B.len) + ' characters: ' + (B.len / B.K).toFixed(1) + ' per cell. First: the set-up.';
      else if (part > 0) {
        const p = phases[done], cells = p.type === 'digits' ? ends[done].filter((e) => e <= part).length : 0;
        s = p.type === 'digits' ? 'Digits, part way: the text has walked over ' + fmt(cells) + ' of the ' + fmt(B.K) + ' cells of the block, from the last cell towards the first, and given each its digit. The cells it has not reached have no digit from this pass yet.' : 'Set up, part way: ' + fmt(part) + ' of its ' + fmt(p.to - p.from) + ' characters have run. The pointer steps to the right, and counting loops put the start value in every cell.';
      }
      else {
        const p = phases[done - 1];
        if (p.type === 'setup') s = 'Set up: the pointer stepped ' + B.D + ' cells to the right, and a small counting loop put the start value ' + fmt(B.b) + ' in ' + fmt(B.K) + ' cells' + (B.f ? ' (made as ' + B.b0 + ' × ' + B.f + ' × ' + B.f + ', with two short loops)' : '') + '. No cell is zero, so the loops to come will not stop early.';
        else if (p.type === 'digits') s = 'Digits: the text walked over the strip from right to left. Every "<" is one cell; the plus or minus signs behind it are that cell\'s digit' + (p.plane === B.D - 1 ? ' (the first, highest digit)' : p.plane === 0 ? ' (the last digit)' : '') + '. No signs means the digit is 0.';
        else if (!p.last) s = 'Loop: every cell times ' + p.factor + ' into its left neighbour. The whole strip has moved one cell to the left and every number is ' + p.factor + ' times as large. The loop is ' + (p.to - p.from) + ' characters, whatever the size of the block.';
        else s = 'Last loop: every cell moved one more cell to the left, to its final place, and ' + fmt(Math.abs(B.fix)) + ' was ' + (B.fix < 0 ? 'taken off' : 'added') + ' to undo the start value and put the middle value ' + fmt(B.m) + ' back.';
      }
      said.textContent = s;
      // the table: the first cells the text touches (= the last cells of the block)
      const planes = phases.filter((p) => p.type === 'digits'), tbl = $('b-table'); clearRows(tbl);
      const narrow = !!(window.matchMedia && matchMedia('(max-width: 45em)').matches), order = (cell, digs, tail) => (narrow ? [cell, ...tail, ...digs] : [cell, ...digs, ...tail]);
      const head = el('tr');
      const off = B.offset === undefined ? (W.weights.kinds.includes(B.kind) ? W.tape.weightOffset : null) : B.offset, isW = W.weights.kinds.includes(B.kind);
      head.append(...order(el('th', '', 'Cell of the tape'), planes.map((p, k) => el('th', 'n', 'Digit ' + (k + 1) + (k < planes.length - 1 ? ' (×' + phases[phases.indexOf(p) + 1].factor + ')' : ''))), [el('th', 'n', 'In the cell now'), el('th', 'n', 'Must become'), el('th', 'n wt', off === null ? '' : isW ? 'Weight' : 'Table value')]));
      tbl.append(head);
      const dts = planes.map((p) => digitTexts(p, ROWS));
      for (let r = 0; r < Math.min(ROWS, B.K); r++) {
        const i = B.K - 1 - r, tr = el('tr'), now = tape[ORG + i + shift], digs = [];
        planes.forEach((p, k) => { const ph = phases.indexOf(p), reached = ph < done || (ph === done && part > 0 && ends[ph][r] !== undefined && ends[ph][r] <= part); const td = el('td', 'n bf'); const dt = dts[k][r] || '', say = (dt ? dt.replace(/-/g, '−') : '·') + '  ' + (val(dt) > 0 ? '+' : '') + minus(val(dt)); if (reached) td.textContent = say; else td.append(el('i', 'muted', say)); digs.push(td); });   // not written yet: muted and slanted
        const fin = done === phases.length;
        const same = fin && now === B.values[i], nowTd = el('td', same ? 'n ok' : 'n');
        if (same) nowTd.append(el('b', '', fmt(now) + ' ✓')); else nowTd.textContent = fmt(now);     // equal to what it must be: a tick and bold, not colour alone
        tr.append(...order(el('td', '', fmt(B.cell + i)), digs, [nowTd, el('td', 'n muted', fmt(B.values[i])), el('td', 'n muted wt', off === null ? '' : minus(B.values[i] - off))]));
        tbl.append(tr);
      }
      // all cells
      const cv = $('b-strip'), { ctx, w, h } = fit(cv), good = cssVar('--good'), ink = cssVar('--muted'), acc = cssVar('--accent');
      const started = done > 0 || part > 0, prog = done + (part && done < phases.length ? part / (phases[done].to - phases[done].from) : 0);
      let equal = 0; const cols = Math.max(1, Math.floor(w));
      for (let x = 0; x < cols; x++) {
        const i0 = Math.floor(x / cols * B.K), i1 = Math.max(i0 + 1, Math.floor((x + 1) / cols * B.K)); let eq = 0, sum = 0;
        for (let i = i0; i < i1; i++) { const v = tape[ORG + i + shift]; if (v === B.values[i] && shift === 0) eq++; sum += Math.abs(v); }
        const frac = eq / (i1 - i0);
        ctx.fillStyle = frac === 1 ? good : !started ? cssVar('--line') : frac > 0 ? acc : ink; ctx.globalAlpha = frac === 1 ? 1 : !started ? 1 : 0.35 + 0.65 * Math.min(1, prog / phases.length);
        ctx.fillRect(x, 0, 1.05, h);
      }
      ctx.globalAlpha = 1;
      if (shift === 0) for (let i = 0; i < B.K; i++) if (tape[ORG + i] === B.values[i]) equal++;
      let clean = true; for (let i = ORG + B.K; i < tape.length; i++) if (tape[i] !== 0) { clean = false; break; }
      const v = $('b-verdict');
      if (done === phases.length) { v.className = 'verdict' + (equal === B.K ? ' ok' : ' no'); v.textContent = equal === B.K ? 'All ' + fmt(B.K) + ' cells hold exactly the numbers the tape must have (cells ' + fmt(B.cell) + ' to ' + fmt(B.cell + B.K - 1) + ').' + (clean ? ' The work cells to the right of the block are zero again.' : '') : fmt(equal) + ' of ' + fmt(B.K) + ' cells are right.'; }
      else { v.className = 'verdict'; v.textContent = 'The bar shows all ' + fmt(B.K) + ' cells of the block. It turns green, and this line says so, when every cell holds its final number.'; }
      $('b-next').disabled = $('b-end').disabled = pos >= S;
      sync();
    }
    onResize(() => { if (B) draw(); });
    async function load(id) {
      $('b-said').textContent = 'Loading the block...';
      B = await json('block-' + id);
      stopPlay(); phases = parse(B.text, B.K); buildStops();
      const R = W.regions.find((r) => r.kind === B.kind && r.layer === B.layer) || { kind: B.kind, layer: B.layer };
      const also = [...new Set((B.also || []).filter((k) => k !== B.kind))].map((k) => KIND[k].name.toLowerCase().replace(/deltanet/g, 'DeltaNet'));
      $('b-meta').textContent = 'Characters ' + fmt(B.off + 1) + ' to ' + fmt(B.off + B.len) + ' of the file · ' + B.D + ' digit position' + (B.D === 1 ? '' : 's') + (B.R.length ? ', base ' + [...B.R].reverse().join(' then ') : '') + ' · middle value ' + fmt(B.m) + ' · writes: ' + (R.from !== undefined ? regionTitle(R).replace(/ \(.*\)$/, '') : KIND[B.kind].name).toLowerCase().replace(/deltanet/g, 'DeltaNet') + (also.length ? ' (and in the same block: ' + also.join(', ') + ')' : '');
      $('b-onmap').href = mapLink(B.off, B.off + B.len);
      reset();
    }
    pick.addEventListener('change', () => load(pick.value));
    // ---- the controls along the run: a slider, Back, Play with a speed ----
    const scrub = $('b-scrub'), backBtn = $('b-back');
    const digitNo = (p) => phases.filter((q) => q.type === 'digits').indexOf(p) + 1;
    const nameOf = (p) => (p.type === 'setup' ? 'Set up' : p.type === 'digits' ? 'Digit ' + digitNo(p) : p.last ? 'Last loop' : 'Loop ×' + p.factor);
    function sync() {
      backBtn.disabled = pos <= 0;
      const n = phases.length, run = cum[stopK[pos]] + stopC[pos], total = cum[n];
      let where;
      if (pos === 0) where = 'Before the first part. Next: ' + nameOf(phases[0]).toLowerCase() + '.';
      else if (pos >= S) where = 'All ' + n + ' parts have run.';
      else if (part === 0) where = 'Between parts: ' + done + ' of ' + n + ' have run, ' + nameOf(phases[done - 1]).toLowerCase() + ' was the last. Next: ' + nameOf(phases[done]).toLowerCase() + '.';
      else { const p = phases[done]; where = 'Part ' + (done + 1) + ' of ' + n + ', ' + nameOf(p).toLowerCase() + ': ' + (p.type === 'digits' ? fmt(ends[done].filter((e) => e <= part).length) + ' of ' + fmt(B.K) + ' cells have their digit.' : fmt(part) + ' of ' + fmt(p.to - p.from) + ' characters have run.'); }
      scrub.max = S; scrub.value = pos;
      readOut(scrub, fmt(run) + ' of ' + fmt(total), fmt(run) + ' of ' + fmt(total) + ' characters. ' + where);
      $('b-where').textContent = where;
    }
    scrub.addEventListener('input', () => { stopPlay(); goTo(Number(scrub.value)); });
    backBtn.addEventListener('click', () => { stopPlay(); goTo(prevBound()); });
    $('b-next').addEventListener('click', () => { stopPlay(); step(); });
    $('b-end').addEventListener('click', () => { stopPlay(); goTo(S); });
    $('b-reset').addEventListener('click', () => { stopPlay(); reset(); });
    let u = 0;
    const uOf = (i) => { if (i >= S) return phases.length; let k = 0; while (bounds[k] <= i) k++; return k + (i - startOf(k)) / (bounds[k] - startOf(k)); };
    const stopPlay = makePlayer($('b-play'), $('b-speed'), 'run', (dt, T) => {
      u += dt / T * phases.length;
      if (u >= phases.length) { goTo(S); return true; }
      const k = Math.floor(u), f = u - k, st = startOf(k), len = bounds[k] - st;
      const i = len === 1 ? (f >= 0.4 ? bounds[k] : st) : st + Math.floor(f * len);        // a loop is one stop: it shows its result half way through its time
      if (i !== pos) goTo(i);
      return false;
    }, () => { if (pos >= S) goTo(0); u = uOf(pos); });
    await load(W.samples[0].id);

    // ---- distributions ----
    const KN = { lin: 'DeltaNet weights', lino: 'DeltaNet output', qkv: 'Attention weights', o: 'Attention output', w13: 'Feed-forward, widening', w2: 'Feed-forward, back', cls: 'Output table', all: 'All ' + words(W.weights.kinds.length) + ' together' };
    const OFFW = W.tape.weightOffset;
    let kind = 'all';
    const histOf = (k) => {
      if (k !== 'all') return W.weights.hist[k];
      let lo = Infinity, hi = -Infinity; for (const q of W.weights.kinds) { const h = W.weights.hist[q]; lo = Math.min(lo, h.from); hi = Math.max(hi, h.from + h.counts.length - 1); }
      const counts = new Array(hi - lo + 1).fill(0); for (const q of W.weights.kinds) { const h = W.weights.hist[q]; h.counts.forEach((c, i) => { counts[h.from - lo + i] += c; }); }
      return { from: lo, counts };
    };
    const dval = $('d-val');                       // a weight value to read off the chart
    const drawHist = () => {
      const H = histOf(kind), cv = $('d-hist'), { ctx, w, h } = fit(cv), pad = 22, fam = kind === 'all' ? '--accent' : FAM[KIND[kind].fam].v;
      const total = H.counts.reduce((a, b) => a + b, 0), max = Math.max(...H.counts);
      const R = 130, x0 = (v) => (v + R) / (2 * R + 1) * w;
      ctx.fillStyle = cssVar(fam);
      let inside = 0, within8 = 0;
      H.counts.forEach((c, i) => { const v = H.from + i; if (Math.abs(v) <= 8) within8 += c; if (v < -R || v > R) return; inside += c; const hh = c / max * (h - pad - 4); ctx.fillRect(x0(v), h - pad - hh, Math.max(1, w / (2 * R + 1) - 0.4), hh); });
      ctx.fillStyle = cssVar('--muted'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const v of [-128, -64, -32, 0, 32, 64, 128]) { ctx.fillText(minus(v), Math.min(w - 14, Math.max(14, x0(v + 0.5))), h - 6); ctx.fillRect(x0(v + 0.5), h - pad, 1, 4); }
      const v = Number(dval.value), n = H.counts[v - H.from] || 0, x = x0(v) + Math.max(1, w / (2 * R + 1) - 0.4) / 2;
      ctx.fillStyle = cssVar('--bg'); ctx.fillRect(x - 2.5, 0, 5, h - pad); ctx.fillStyle = cssVar('--ink'); ctx.fillRect(x - 1, 0, 2, h - pad);
      readOut(dval, 'weight ' + minus(v), 'weight ' + minus(v) + ': ' + fmt(n) + ' of ' + fmt(total) + ' (' + pct(n / total, 2) + ')');
      const mode = H.from + H.counts.indexOf(max);
      $('d-hist-note').textContent = KN[kind] + ': ' + fmt(total) + ' weights. The value that occurs most is ' + minus(mode) + ' (' + pct(max / total) + '). ' + pct(within8 / total, 0) + ' lie between −8 and 8, and ' + pct(inside / total, 1) + ' between −' + R + ' and ' + R + '. A weight can be −' + (OFFW - 1) + ' to ' + (OFFW - 1) + '; it is stored as the weight plus ' + OFFW + '.' + (QWEN ? ' The numbers of the table of word pieces, which also serve as output table, are not in this figure.' : '');
    };
    [['all'], ...W.weights.kinds.map((k) => [k])].forEach(([k]) => { const b = el('button', '', KN[k]); b.type = 'button'; b.setAttribute('aria-pressed', String(k === kind)); b.addEventListener('click', () => { kind = k; [...$('d-kinds').children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawHist(); }); $('d-kinds').append(b); });
    drawHist(); onResize(drawHist);
    dval.addEventListener('input', drawHist);
    // digits
    {
      const D = W.digits.lower, total = D.counts.reduce((a, b) => a + b, 0), max = Math.max(...D.counts), box = $('d-digits');
      let chars = 0;
      D.counts.forEach((c, i) => { const v = D.from + i; chars += Math.abs(v) * c; if (c / total < 0.0005) return; hbar(box, 'digit ' + minus(v), c / max, pct(c / total) + ' · ' + (v === 0 ? 'free' : Math.abs(v) + (Math.abs(v) === 1 ? ' char' : ' chars')), v === 0 ? cssVar('--muted') : v > 0 ? 'var(--c-plus)' : 'var(--c-minus)'); });
      $('d-digits-note').textContent = fmt(total) + ' digits below the first one were written. On average a digit costs ' + (chars / total).toFixed(2) + ' characters, plus one "<" to step to its cell.';
      const E = W.encoder;
      const cv = $('d-cost');
      const drawCost = () => {
        const C = W.digits.charsPerCell, { ctx, w, h } = fit(cv), pad = 20, n = 16, m = Math.max(...C.counts);
        ctx.fillStyle = cssVar('--accent');
        for (let i = 0; i < n; i++) { const c = C.counts[i] || 0, hh = c / m * (h - pad - 4); ctx.fillRect(i / n * w + 1, h - pad - hh, w / n - 2, hh); }
        ctx.fillStyle = cssVar('--muted'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
        for (let i = 0; i < n; i += 1) if (i % 2 === 1 || w > 300) ctx.fillText(String(C.from + i), (i + 0.5) / n * w, h - 5);
      };
      drawCost(); onResize(drawCost);
      $('d-cost-note').textContent = 'Steps to the cell plus digits, for the ' + fmt(E.blockCells) + ' cells written in blocks. The loops add ' + fmt(E.loopChars) + ' characters for all ' + fmt(E.blocks) + ' blocks together: ' + fmt(E.loopChars / E.blocks) + ' per block.';
      // comparison, on a scale of powers of ten
      const rows = [['Plain counting', W.tape.plainCounting, 'var(--k-work)'], ['This program', W.program.writer, 'var(--accent)'], ['The floor: 3 bits per character', W.tape.floorCharsAt3Bits, 'var(--good)']];
      const lg = (v) => Math.log10(v), lo = 8, hi = lg(W.tape.plainCounting) + 0.1;
      rows.forEach(([name, v, c]) => hbar($('d-compare'), name, (lg(v) - lo) / (hi - lo), short(v) + ' characters', c));
      $('d-compare-note').textContent = 'The bars are on a scale of powers of ten: drawn to scale, the lower two would be too thin to see next to the first. The tape holds ' + fmt(W.tape.nonZero) + ' cells that are not zero, with ' + W.tape.entropyBitsPerCell.toFixed(2) + ' bits of information each (measured per million cells). This program: ' + (W.program.writer / W.tape.nonZero).toFixed(2) + ' characters per cell, of which ' + pct(E.moveChars / E.chars, 0) + ' are the "<" steps and ' + pct(E.digitChars / E.chars, 0) + ' are digits.';
    }
  });

  // ---- 4. the engine
  lazy($('s4'), async () => {
    const E = EJ; await tiles();
    const items = E.sections.map((s) => ({ ...s, fam: SEC[s.id].fam, chars: s.to - s.from }));
    let sel = items.find((s) => s.id === 'sweep3' || s.key === 'sweep3');
    let hit = () => null;
    const epos = $('e-pos'), emax = Number(epos.max) || 1000;
    let ec = Math.floor((sel.from + sel.to) / 2);
    const drawBar = () => {
      hit = drawRanges($('e-bar'), items, [E.from, E.from + E.chars], { sel: [sel.from, sel.to], cursor: ec });
      epos.value = Math.round((ec - E.from) / (E.chars - 1) * emax); readOut(epos, fmt(ec + 1), 'character ' + fmt(ec + 1) + ' of the file, in: ' + SEC[sel.id].name);
    };
    const moveTo = (f) => { ec = E.from + Math.round(f * (E.chars - 1)); const it = items.find((x) => ec >= x.from && ec < x.to); if (it && it !== sel) choose(it); else drawBar(); };
    const wasDrag = dragAlong($('e-bar'), moveTo);
    epos.addEventListener('input', () => moveTo(Number(epos.value) / emax));
    $('e-bar').addEventListener('click', (e) => { if (wasDrag()) return; const it = hit(e.clientX); if (it) choose(it); });
    onResize(drawBar);
    const tbl = $('e-table'), rowOf = new Map(), maxChars = Math.max(...items.map((s) => s.chars));
    const head = el('tr'), thead = el('thead'), tbody = el('tbody'); ['Section', 'Characters', '', 'Loops', 'Deepest'].forEach((h, i) => head.append(el('th', i === 1 || i >= 3 ? 'n' : '', h))); thead.append(head); tbl.append(thead, tbody);
    let group = '';
    items.forEach((s) => {
      const m = SEC[s.id];
      if (m.group !== group) { group = m.group; const g = el('tr', 'grp'), td = el('td'); td.colSpan = 5; td.append(el('span', 'label', group)); g.append(td); tbody.append(g); }
      const tr = el('tr'), nm = el('td', 'nm'), bar = el('td'), mt = el('div', 'meter'), mb = el('i');
      nm.append(swatch(m.fam), m.name);
      mb.style.width = Math.max(2, 100 * s.chars / maxChars) + '%'; mb.style.background = 'var(' + FAM[m.fam].v + ')'; mt.append(mb); bar.append(mt);
      tr.append(nm, el('td', 'n', fmt(s.chars)), bar, el('td', 'n', fmt(s.loops)), el('td', 'n', String(s.maxDepth)));
      tr.tabIndex = 0; tr.setAttribute('role', 'button');
      tr.addEventListener('click', () => choose(s)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(s); } });
      rowOf.set(s.id, tr); tbody.append(tr);
    });
    const marksIn = (s) => E.marks.filter((m) => m.from >= s.from && m.to <= s.to).map((m) => ({ ...m, label: markLabel(m) }));
    let exTurn = 0;
    async function showExcerpt(s, ex, btn) {
      const turn = ++exTurn;
      [...$('e-excerpts').children].forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      $('e-ex-title').textContent = 'Loading...';
      const text = await textAt(ex.from, ex.len);
      if (turn !== exTurn) return;
      $('e-ex-title').textContent = ex.title + ': characters ' + fmt(ex.from + 1) + ' to ' + fmt(ex.from + ex.len) + ' of the file' + (ex.len > 3000 ? ' (' + fmt(ex.len) + ' characters, most of them steps)' : '') + '.';
      const code = $('e-code'); code.textContent = '';
      if (text === null) { code.append(el('div', 'gapline muted', 'This piece of text is not stored.')); return; }
      const rows = pretty(text, ex.from, marksIn(s));
      rows.querySelectorAll('.head').forEach((n) => n.classList.add('label'));                 // the name of a piece: the shared label
      rows.querySelectorAll('.note, .gapline').forEach((n) => n.classList.add('muted'));
      code.append(rows);
      code.scrollTop = 0;
    }
    function choose(s) {
      sel = s; if (!(ec >= s.from && ec < s.to)) ec = Math.floor((s.from + s.to) / 2);        // a section chosen from the list or by a press: the place moves into it
      drawBar();
      rowOf.forEach((tr, id) => { if (id === s.id) tr.setAttribute('aria-current', 'true'); else tr.removeAttribute('aria-current'); });
      const m = SEC[s.id];
      $('e-title').textContent = m.name;
      $('e-desc').textContent = m.desc;
      const f = $('e-facts'); f.textContent = '';
      const moves = s.counts[2] + s.counts[3];
      [[fmt(s.chars), 'characters (' + pct(s.chars / E.chars) + ' of the engine)'], [pct(moves / s.chars, 0), 'of them are steps left or right'], [fmt(s.longestMove), 'cells: its longest walk in one go'], [s.maxDepth + ' deep', 'loops inside loops, at most (' + fmt(s.loops) + ' loops)']].forEach(([a, b]) => { const d = el('div'); d.append(el('dt', '', b), el('dd', '', a)); f.append(d); });
      // pieces to read
      const exs = [{ title: 'Its first lines', from: s.from, len: Math.min(1400, s.chars) }];
      if (E.hot[s.id]) exs.unshift({ title: 'The inner loop: one weight', from: E.hot[s.id].from, len: E.hot[s.id].len });
      if (s.id === 'ask') exs.unshift({ title: 'Around the input command', from: E.comma - 420, len: 900 });
      if (s.id === 'print') exs.unshift({ title: 'Around the output command', from: E.dot - 420, len: 900 });
      const seen = new Set();
      for (const mk of marksIn(s)) {
        const key = mk.name === 'rqN' || mk.name === 'rqSplit' ? 'requantCore' : mk.name === 'lookupBig' ? 'switchTree' : mk.name === 'mulAcc' ? 'mul' : mk.name;
        if (seen.has(key) || ['sweep', 'slide', 'unsweep', 'sweepEmb', 'emitEncode', 'emitPrint'].includes(mk.name)) continue;
        if (exs.length >= 5) break;
        seen.add(key); exs.push({ title: mk.label, from: mk.from, len: Math.min(mk.to - mk.from, 2200) });
      }
      const box = $('e-excerpts'); box.textContent = '';
      exs.forEach((ex, i) => { const b = el('button', '', ex.title); b.type = 'button'; b.addEventListener('click', () => showExcerpt(s, ex, b)); box.append(b); if (i === 0) showExcerpt(s, ex, b); });
      $('e-onmap').href = mapLink(s.from, s.to);
    }
    drawBar(); choose(sel);
  });

  // ---- 5. the tape, and the journey
  lazy($('s5'), async () => {
    const W = WJ, E = EJ, m = E.model;
    const regions = W.regions.map((r) => ({ ...r, fam: KIND[r.kind].fam, alpha: r.kind === 'work' ? 0.28 : 1 }));
    const size = W.program.tape;
    // brnfck-qwen3.5-0.8b: a group of four layers (three DeltaNet, one attention), its attention layer, and a table of a DeltaNet head
    const per = m.unit ? m.unit.length : 1, LAYER = m.unit ? Math.min(3, m.groups - 1) * per - 1 : Math.min(12, m.layers - 1), FIRST = LAYER - per + 1;
    const lay = regions.filter((r) => r.layer >= FIRST && r.layer <= LAYER && r.kind !== 'cls');
    const layerView = [lay[0].from, lay[lay.length - 1].to];
    const layerName = per > 1 ? 'Layers ' + (FIRST + 1) + ' to ' + (LAYER + 1) : layerNo(LAYER);
    if (per > 1) $('t-layer').textContent = 'Four layers';
    const slots = regions.find((r) => r.kind === 'slots' && r.layer === LAYER);
    // one slot, in the order of the real tape (the engine's own addresses run the other way)
    const S = E.slot, F2 = S.fields, kv = S.kv, dim = m.dim;
    const fields = m.unit
      ? [['U', 1, 'mem', 'Flag: this slot is in use'], ['KS', kv, 'mem', 'The key: ' + fmt(kv) + ' numbers. Stays.'], ['VS', kv, 'mem', 'The value: ' + fmt(kv) + ' numbers. Stays.'], ['scr', F2.QK - F2.scr - 1, 'work', 'Work space'], ['QK', F2.WS - F2.QK - 1, 'att', 'The question of the current piece, passing through, and behind it the new key and value (' + fmt(F2.WS - F2.QK - 1) + ' cells)'], ['WS', m.qDim, 'tidy', 'How much of this slot\'s value to take, spread out (' + fmt(m.qDim) + ' cells)'], ['SM', m.qDim, 'att2', 'The sums collected so far, on their way back (' + fmt(m.qDim) + ' cells)'], ['FL', kv, 'work', 'Markers'], ['Hc', 1, 'work', 'A counter'], ['H', m.heads * S.headFrame, 'tidy', m.heads + ' small work areas, one for each "head" that looks back'], ['WC', S.size - F2.WC - 2, 'work', 'The counter of a walk over the slots']]
      : [['U', 1, 'mem', 'Flag: this slot is in use'], ['cn', 1, 'work', 'A counter'], ['scr', kv + 82, 'work', 'Work space'], ['KS', kv, 'mem', 'The key: ' + fmt(kv) + ' numbers. Stays.'], ['VS', kv, 'mem', 'The value: ' + fmt(kv) + ' numbers. Stays.'], ['QS', dim, 'att', 'The question of the current piece, passing through (' + fmt(dim) + ' cells)'], ['WS', dim, 'tidy', 'How much of this slot\'s value to take, spread out (' + fmt(dim) + ' cells)'], ['SM', dim, 'att2', 'The sums collected so far, on their way back (' + fmt(dim) + ' cells)'], ['FL', kv, 'work', 'Markers'], ['Hc', 1, 'work', 'A counter'], ['H', m.heads * S.headFrame, 'tidy', m.heads + ' small work areas, one for each "head" that looks back']];
    const slotIndex = 20, slotTo = slots.to - slotIndex * S.size, slotFrom = slotTo - S.size;
    const slotItems = fields.map(([k, len, fam, says]) => ({ from: slotTo - F2[k] - len, to: slotTo - F2[k], fam, says, name: k, alpha: fam === 'work' ? 0.28 : 1 }));
    // the first columns of the table of one DeltaNet head (engine.json deltanet.column: the offsets in a column)
    const DN = m.deltanet, COLS = 4;
    let tableReg = DN ? regions.find((r) => r.kind === 'state' && r.layer === FIRST && r.head === 0) : null, tableItems = [], tableView = [0, 1];
    const setTable = (r) => {
      tableReg = r; const co = DN.column, CS = DN.columnCells, top = r.to, parts = [['S', DN.valueSize, 'mem', 'numbers of the table. They stay from one word piece to the next.'], ['AC', DN.valueSize, 'dn2', 'sums of a pass over the columns, handed on to the next column'], ['DV', DN.valueSize, 'tidy', 'the difference that is being written into the table, handed on'], ['QU', DN.keySize, 'dn', 'the numbers of the key or the query that still have to reach their column'], ['XK', 1, 'dn', 'this column\'s number of the key, kept for the write'], ['T', co.W - co.T - 1, 'work', 'a counter, the bits of a number, scratch'], ['W', CS - co.W - 2, 'work', 'room for the walks inside the column']];
      tableItems = [];
      for (let c = 0; c < COLS; c++) for (const [k, len, fam, says] of parts) tableItems.push({ from: top - c * CS - co[k] - len, to: top - c * CS - co[k], fam, says: 'Column ' + (c + 1) + ' of ' + DN.keySize + ': ' + (k === 'S' ? fmt(len) + ' ' : '') + says + (k === 'S' ? '' : ' (' + fmt(len) + (len === 1 ? ' cell)' : ' cells)')), name: k, alpha: fam === 'work' ? 0.28 : 1 });
      tableView = [top - COLS * CS, top];
    };
    if (tableReg) setTable(tableReg);
    let view = [0, size], items = regions, mode = 'all', hit = () => null;
    const tpos = $('t-pos'), tmax = Number(tpos.max) || 1000;
    let tf = 0;
    const cursorCell = () => view[0] + tf * (view[1] - view[0] - 1);
    const itemAt = (cell) => items.find((it) => cell >= it.from && cell < it.to) || null;
    const draw = () => {
      hit = drawRanges($('t-bar'), items, view, { min: 0.6, cursor: cursorCell() });
      const c = Math.floor(cursorCell()), it = itemAt(c), says = it ? (mode === 'slot' || mode === 'table' ? it.says : regionTitle(it)) : ''; tpos.value = Math.round(tf * tmax); readOut(tpos, 'cell ' + fmt(c), 'cell ' + fmt(c) + (says ? ': ' + says : '')); $('t-hint').textContent = says;
      $('t-from').textContent = 'cell ' + fmt(view[0]); $('t-to').textContent = 'cell ' + fmt(view[1] - 1); $('t-mid').textContent = fmt(view[1] - view[0]) + ' cells';
      // table: what is in view
      const by = new Map();
      for (const it of items) { if (it.to <= view[0] || it.from >= view[1]) continue; const key = mode === 'slot' ? it.says : mode === 'table' ? it.says.replace(/^Column \d+ of \d+: (\d+ )?/, '').replace(/ \(\d+ cells?\)$/, '').replace(/^./, (c) => c.toUpperCase()) : KIND[it.kind].name; const o = by.get(key) || { cells: 0, fam: it.fam, n: 0, nz: 0 }; o.cells += it.to - it.from; o.n++; o.nz += it.nonZero || 0; by.set(key, o); }
      const tbl = $('t-table'); clearRows(tbl);
      const inner = mode === 'slot' || mode === 'table';
      const head = el('tr'); [['What', ''], ['Cells', 'n'], ['Share', 'n'], [inner ? '' : 'Filled by the program text', 'n']].forEach(([h, c]) => head.append(el('th', c, h))); tbl.append(head);
      [...by].sort((a, b) => b[1].cells - a[1].cells).forEach(([name, o]) => { const share = o.cells / (view[1] - view[0]); const tr = el('tr'), td = el('td'); td.append(swatch(o.fam), name); tr.append(td, el('td', 'n', fmt(o.cells)), el('td', 'n', share < 0.0005 ? 'under 0.1%' : pct(share)), el('td', 'n', inner ? '' : fmt(o.nz))); tbl.append(tr); });
    };
    const set = (mo) => {
      mode = mo;
      if (mo === 'all') { view = [0, size]; items = regions; $('t-said').textContent = 'The whole tape. From left to right: the output table in ' + m.chunks + ' parts, layer ' + m.layers + ' down to layer 1, the table of word pieces, and at the far right the vocabulary. Press a layer.'; }
      else if (mo === 'layer' && per > 1) { view = layerView; items = regions; $('t-said').textContent = layerName + ', ' + fmt(layerView[1] - layerView[0]) + ' cells: one group of three DeltaNet layers and one attention layer, from right to left. Each has four matrices of weights. Between those of a DeltaNet layer lie the ' + DN.valueHeads + ' tables of its heads, between those of the attention layer the ' + m.maxTokens + ' memory slots. The pale parts are free cells: the gaps the columns cross, and work space. The strips of constants are too thin to see here; the table under the figure lists them.'; }
      else if (mo === 'layer') { view = layerView; items = regions; $('t-said').textContent = layerNo(LAYER) + ', ' + fmt(layerView[1] - layerView[0]) + ' cells. Four matrices of weights, and between them the ' + m.maxTokens + ' memory slots. The pale parts are free cells: the gaps the columns cross, and work space.' + (QWEN ? ' The strips of constants are too thin to see here; the table under the figure lists them.' : ''); }
      else if (mo === 'table') { view = tableView; items = tableItems; $('t-said').textContent = 'The first ' + words(COLS) + ' of the ' + DN.keySize + ' columns of the table of head ' + (tableReg.head + 1) + ' in layer ' + (tableReg.layer + 1) + ', a DeltaNet layer. A column holds ' + DN.valueSize + ' numbers of the table and ' + fmt(DN.columnCells - DN.valueSize) + ' cells of room for the passes over it. The whole table is ' + fmt(tableReg.to - tableReg.from) + ' cells; the same ' + fmt(DN.keySize * DN.valueSize) + ' numbers stay there however long the conversation.'; }
      else { view = [slotFrom, slotTo]; items = slotItems; $('t-said').textContent = 'One memory slot of ' + layerNo(LAYER) + ': ' + fmt(S.size) + ' cells for one word piece. Only the key, the value and one flag stay between word pieces. The rest is room for what passes through when a later piece looks back.'; }
      draw();
    };
    $('t-all').addEventListener('click', () => set('all')); $('t-layer').addEventListener('click', () => set('layer')); $('t-slot').addEventListener('click', () => set('slot'));
    if ($('t-dn')) $('t-dn').addEventListener('click', () => set('table'));
    const pickRegion = (it) => { if (!it) return; if (mode === 'all') { if (it.layer >= 0 && it.kind !== 'cls') set('layer'); else $('t-said').textContent = regionTitle(it) + ': cells ' + fmt(it.from) + ' to ' + fmt(it.to - 1) + '. ' + regionSays(it); } else if (mode === 'layer') { if (it.kind === 'slots') set('slot'); else if (it.kind === 'state') { setTable(it); set('table'); } else $('t-said').textContent = regionTitle(it) + ': cells ' + fmt(it.from) + ' to ' + fmt(it.to - 1) + '. ' + regionSays(it); } else $('t-said').textContent = it.says + ' Cells ' + fmt(it.from) + ' to ' + fmt(it.to - 1) + '.'; };
    const wasDrag = dragAlong($('t-bar'), (f) => { tf = f; draw(); });
    tpos.addEventListener('input', () => { tf = Number(tpos.value) / tmax; draw(); });
    tpos.addEventListener('keydown', (e) => { if (e.key === 'Enter') pickRegion(itemAt(Math.floor(cursorCell()))); });         // Enter does what a press on the strip does
    $('t-bar').addEventListener('click', (e) => { if (wasDrag()) return; pickRegion(hit(e.clientX)); });
    $('t-bar').addEventListener('mousemove', (e) => { const it = hit(e.clientX); $('t-hint').textContent = it ? (mode === 'slot' || mode === 'table' ? it.says : regionTitle(it)) : ''; });
    onResize(draw); set('all');

    // ---- the journey ----
    const T = TR.main;
    if (!T) { $('j-card').hidden = true; return; }
    const D = T.detail, total = D.total;
    $('j-chart').setAttribute('aria-label', 'Where the pointer is on the tape during one word piece. It starts at the right end, crosses the whole tape to the left through the ' + m.layers + ' layers, and walks back. The read-out below gives the place at the chosen moment.');
    $('j-what').textContent = 'The run: "' + T.question + '", position ' + D.position + (D.printed ? ', the one that prints "' + D.printed + '"' : ', a word piece of the question') + ': ' + fmt(total) + ' steps.';
    const secFam = T.sections.map((id) => SEC[id].fam);
    // points of the path: where each section starts, and samples in between
    const pts = [];
    D.events.forEach((e, i) => pts.push([e[2], e[4], i]));
    for (let i = 0; i < D.samples.length; i += 2) pts.push([D.samples[i], D.samples[i + 1], -1]);
    pts.sort((a, b) => a[0] - b[0]);
    const evAt = (t) => { let lo = 0, hi = D.events.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (D.events[mid][2] <= t) lo = mid; else hi = mid - 1; } return D.events[lo]; };
    const ptAt = (t) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid - 1; } const a = pts[lo], b = pts[Math.min(pts.length - 1, lo + 1)]; return b[0] > a[0] ? a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]) : a[1]; };
    const regAt = (cell) => { let lo = 0, hi = regions.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (regions[mid].from <= cell) lo = mid; else hi = mid - 1; } return regions[lo]; };
    let tNow = 0;
    const drawJ = () => {
      const cv = $('j-chart'), { ctx, w, h } = fit(cv), top = 16, bot = 6, x = (c) => c / size * w, y = (t) => top + t / total * (h - top - bot);
      const col = {}; for (const k in FAM) col[k] = cssVar(FAM[k].v);
      for (const r of regions) { ctx.fillStyle = col[r.fam]; ctx.globalAlpha = r.kind === 'work' ? 0.3 : 1; ctx.fillRect(x(r.from), 0, Math.max(0.6, x(r.to) - x(r.from)), 10); ctx.globalAlpha = r.kind === 'work' ? 0.02 : 0.07; ctx.fillRect(x(r.from), 10, Math.max(0.6, x(r.to) - x(r.from)), h - 10); }
      ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      // the path, coloured by the section that is running
      let k = 0;
      for (let i = 0; i < D.events.length; i++) {
        const e = D.events[i], t1 = e[2] + e[3];
        ctx.strokeStyle = col[secFam[e[0]]]; ctx.beginPath();
        while (k < pts.length && pts[k][0] < e[2]) k++;
        ctx.moveTo(x(e[4]), y(e[2]));
        for (let q = k; q < pts.length && pts[q][0] <= t1; q++) ctx.lineTo(x(pts[q][1]), y(pts[q][0]));
        ctx.stroke();
      }
      // now
      const px = x(ptAt(tNow)), py = y(tNow);
      ctx.strokeStyle = cssVar('--ink'); ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar('--ink'); ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill(); ctx.fillStyle = cssVar('--panel'); ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill();
      const e = evAt(tNow), cell = Math.round(ptAt(tNow)), r = regAt(cell);
      $('j-said').innerHTML = '';
      $('j-said').append('Step ', el('b', '', fmt(tNow)), ' of ' + fmt(total) + ' · ' + (e[1] >= 0 ? layerNo(e[1]) + ' · ' : ''), el('b', '', SEC[T.sections[e[0]]].name), ' · the pointer is near cell ' + fmt(cell) + ', in: ' + regionTitle(r).replace(/ \(.*\)$/, '') + '.');
      readOut($('j-time'), (tNow < 1e6 ? fmt(tNow) : short(tNow)) + ' steps', $('j-said').textContent);
    };
    const jmax = Number($('j-time').max) || 1000;
    const setT = (t) => { tNow = Math.max(0, Math.min(total, t)); $('j-time').value = Math.round(jmax * tNow / total); drawJ(); };
    $('j-time').addEventListener('input', () => { stop(); setT($('j-time').value / jmax * total); });
    const stop = makePlayer($('j-play'), $('j-speed'), 'trip', (dt, T) => { setT(tNow + total * dt / T); return tNow >= total; }, () => { if (tNow >= total) setT(0); });
    // from one section of the engine to the next
    const secStart = (dir) => { const ev = D.events; let k = 0; while (k + 1 < ev.length && ev[k + 1][2] <= tNow) k++; if (dir > 0) return k + 1 < ev.length ? ev[k + 1][2] : total; return tNow > ev[k][2] + total / 5000 ? ev[k][2] : k > 0 ? ev[k - 1][2] : 0; };
    $('j-prev').addEventListener('click', () => { stop(); setT(secStart(-1)); });
    $('j-next').addEventListener('click', () => { stop(); setT(secStart(1)); });
    const jc = $('j-chart'), atY = (e) => { const r = jc.getBoundingClientRect(); stop(); setT((e.clientY - r.top - 16) / (r.height - 22) * total); };
    jc.addEventListener('click', atY);
    let down = false;
    jc.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; down = true; try { jc.setPointerCapture(e.pointerId); } catch (x) { } });
    jc.addEventListener('pointermove', (e) => { if (down) atY(e); });
    jc.addEventListener('pointerup', () => { down = false; }); jc.addEventListener('pointercancel', () => { down = false; });
    onResize(drawJ); setT(0);
  });

  // ---- 6. where the time goes
  const SWEEPS = ['sweep1', 'sweep2', 'dn.sweep1', 'dn.sweep2', 'sweep3', 'sweep4', 'cls'], sweepsOf = (ids) => SWEEPS.filter((id) => ids.includes(id));
  const STACK = ['ff', 'ff2', 'out', 'att', 'att2', 'dn', 'dn2', 'work', 'emb', 'mem', 'tidy', 'text'];        // the order of the parts in a bar of steps, from the bottom or the left
  const tagEv = (t) => el('span', 'ev', t);
  lazy($('s6'), async () => {
    const T = TR.main, P = TR.long, m = EJ.model, W = WJ;
    if (!T) {
      $('w-intro').textContent = 'No run of this program was counted step by step.';
      $('w-card').hidden = true; $('w-card2').hidden = true;
      $('w-explain').append(el('p', '', 'This program was not run under the counting interpreter, so there is no breakdown of its steps. Its times per word piece, from the project\'s log, are in the table under SmolLM2, Qwen2.5 and Qwen3.5 side by side.'));
      return;
    }
    const D = T.detail, ids = T.sections, ix = (id) => ids.indexOf(id);
    const firstP = P.positions[0], lastP = P.positions[P.positions.length - 1], full = lastP.position >= m.maxTokens - 1;
    // what was measured, in words
    {
      const q = (R) => '"' + R.question + '"', note = ' A step is one operation of the project\'s plain interpreter.';
      let s;
      if (P !== T) s = 'We ran the real program on two questions with an interpreter that counts every step: ' + q(T) + ', and ' + q(P) + (full ? ', whose answer runs on to the last position the program has room for' : '') + '.';
      else {
        const prompt = P.positions.filter((p) => !p.printed).length, printing = P.positions.length - prompt;
        s = 'We ran the real program on one question, ' + q(T) + ', with an interpreter that counts every step. ' + (P.complete !== false ? 'The whole run was counted: ' : 'The run was stopped after ') + P.positions.length + ' positions, ' + firstP.position + ' to ' + lastP.position + ' of the ' + m.maxTokens + ' the program has room for. '
          + (printing ? 'The first ' + prompt + ' take in the word pieces of the question; the other ' + printing + ' each print a piece of the answer' + (P.complete !== false ? ' ("' + P.answer + '")' : '') + '.' : 'All of them take in word pieces of the question: the run was stopped before it printed.')
          + (full ? '' : ' Later positions were not run for this program: one position takes ' + (firstP.total > 1e10 ? 'minutes' : 'about a minute') + ' in the counting interpreter.');
      }
      $('w-intro').textContent = s + note;
      $('w-pos-what').textContent = 'Each bar is one word piece of the run on ' + q(P) + ', from position ' + firstP.position + ' to position ' + lastP.position + ', stacked by part of the model as in the key.';
      $('w-layers').setAttribute('aria-label', 'Steps of the chosen section in each of the ' + m.layers + ' layers');
    }
    let pos = T.positions.find((p) => p.position === D.position), run = T, selSec = ids.indexOf('sweep3');
    const stagesBox = $('w-stages');
    const drawStages = () => {
      const steps = pos.steps, total = pos.total;
      $('w-what').textContent = 'The run: "' + run.question + '", position ' + pos.position + (pos.printed ? ', which prints "' + pos.printed + '"' : '') + ': ' + fmt(total) + ' steps. The chart by layer is always position ' + D.position + (P !== T ? ' of the first run.' : '.');
      const tb = $('w-total'); tb.textContent = '';
      const fam = new Map(); steps.forEach((s, i) => fam.set(SEC[ids[i]].fam, (fam.get(SEC[ids[i]].fam) || 0) + s));
      [...fam].sort((a, b) => b[1] - a[1]).forEach(([k, s]) => { if (!s) return; const i = el('i', '', s / total > 0.07 ? FAM[k].letter + ' ' + Math.round(100 * s / total) + '%' : ''); i.style.cssText = 'flex:' + s + ' 0 0;background:var(' + FAM[k].v + ')'; i.title = FAM[k].name + ': ' + pct(s / total); tb.append(i); });
      stagesBox.textContent = '';
      const max = Math.max(...steps);
      steps.forEach((s, i) => {
        if (s / total < 0.0001) return;
        const lab = document.createDocumentFragment(); lab.append(swatch(SEC[ids[i]].fam), SEC[ids[i]].name);
        const row = hbar(stagesBox, lab, s / max, short(s) + ' · ' + pct(s / total), 'var(' + FAM[SEC[ids[i]].fam].v + ')', true);
        row.setAttribute('aria-pressed', String(i === selSec)); row.tabIndex = 0; row.setAttribute('role', 'button');
        const go = () => { selSec = i; drawStages(); drawLayers(); };
        row.addEventListener('click', go); row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    };
    const lpick = $('w-layer'); let layerSel = 0;
    const drawLayers = () => {
      const cv = $('w-layers'), { ctx, w, h } = fit(cv), id = ids[selSec], k = D.layerSections.indexOf(id), pad = 20;
      $('w-layers-title').textContent = 'In every layer: ' + SEC[id].name;
      ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = cssVar('--muted'); ctx.textAlign = 'center';
      if (k < 0) { ctx.fillText('This section is not part of a layer: it runs once for every word piece.', w / 2, h / 2); lpick.disabled = true; readOut(lpick, 'none', 'This section is not part of a layer'); return; }
      const v = D.layers.map((l) => l[k]), max = Math.max(...v), n = v.length;
      v.forEach((s, i) => { const hh = s / max * (h - pad - 16); ctx.fillStyle = cssVar(FAM[SEC[id].fam].v); ctx.fillRect(i / n * w + 1.5, h - pad - hh, w / n - 3, hh); ctx.fillStyle = cssVar('--muted'); if (i % 5 === 0 || i === n - 1 || w > 520) ctx.fillText(String(i + 1), (i + 0.5) / n * w, h - 5); });
      lpick.disabled = false; lpick.max = n - 1; layerSel = Math.min(layerSel, n - 1); lpick.value = layerSel;
      const x = layerSel / n * w;
      ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2; ctx.strokeRect(x + 0.5, h - pad - v[layerSel] / max * (h - pad - 16) - 2, w / n - 1, v[layerSel] / max * (h - pad - 16) + 3);
      readOut(lpick, 'layer ' + (layerSel + 1) + ' · ' + short(v[layerSel]), 'layer ' + (layerSel + 1) + ': ' + fmt(v[layerSel]) + ' steps');
      ctx.textAlign = 'left'; ctx.fillText('layer by layer, position ' + D.position + ': from ' + short(Math.min(...v)) + ' to ' + short(max) + ' steps', 2, 11);
    };
    const drawPos = () => {
      const cv = $('w-pos'), { ctx, w, h } = fit(cv), ps = P.positions, padL = 4, padB = 22, top = 16;
      const max = Math.max(...ps.map((p) => p.total)), n = ps.length, bw = (w - padL) / n;
      ps.forEach((p, i) => {
        const f = {}; p.steps.forEach((s, k) => { const q = SEC[ids[k]].fam; f[q] = (f[q] || 0) + s; });
        let y = h - padB;
        for (const q of STACK) { const hh = (f[q] || 0) / max * (h - padB - top); ctx.fillStyle = cssVar(FAM[q].v); ctx.fillRect(padL + i * bw + (bw > 3 ? 0.5 : 0), y - hh, Math.max(1, bw - (bw > 3 ? 1 : 0)), hh); y -= hh; }
        if (run === P && p === pos) { ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2; ctx.strokeRect(padL + i * bw, y - 2, bw, h - padB - y + 3); }
      });
      ctx.fillStyle = cssVar('--muted'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
      const every = Math.ceil(n / Math.max(4, Math.floor(w / 60)));
      ps.forEach((p, i) => { if (i % every === 0 || i === n - 1) ctx.fillText(String(p.position), padL + (i + 0.5) * bw, h - 6); });
      ctx.textAlign = 'left'; ctx.fillText('steps per word piece, by position (the tallest: ' + short(max) + ')', 2, 11);
    };
    const pick = $('w-pick'); pick.max = P.positions.length - 1;
    const setPos = (i) => {
      pos = P.positions[i]; run = P; pick.value = i; readOut(pick, 'position ' + pos.position, 'position ' + pos.position + ', ' + fmt(pos.total) + ' steps');
      const avg = P.positions.reduce((a, p) => a + p.total, 0) / P.positions.length;
      $('w-said').textContent = '';
      $('w-said').append('"' + P.question + '": position ', el('b', '', String(pos.position)), pos.printed ? ' prints "' + pos.printed + '"' : ' (a word piece of the question)', ': ', el('b', '', fmt(pos.total)), ' steps. Over the ' + P.positions.length + ' positions that were run (' + firstP.position + ' to ' + lastP.position + ') the average is ' + fmt(avg) + '.');
      drawStages(); drawPos();
    };
    pick.addEventListener('input', () => setPos(Number(pick.value)));
    dragAlong($('w-pos'), (f) => { const n = P.positions.length, bw = ($('w-pos').clientWidth - 4) / n; setPos(Math.max(0, Math.min(n - 1, Math.floor((f * $('w-pos').clientWidth - 4) / bw)))); });          // drag along the bars
    const start = P === T ? T.positions.indexOf(pos) : Math.min(P.positions.length - 1, D.position - P.fixedPositions);
    pick.value = start;
    // kinds of step, over the whole run
    {
      const sum = new Array(T.kindNames.length).fill(0); T.kinds.forEach((r) => r.forEach((v, k) => { sum[k] += v; }));
      const groups = [['Whole simple loops done as one operation (move, copy, multiply)', sum[6] + sum[7] + sum[8] + sum[5], 'var(--accent)'], ['The question "is this cell zero?" at a bracket', sum[3] + sum[4], 'var(--c-open)'], ['Adding or taking off a fixed amount', sum[0], 'var(--c-plus)'], ['Reading or printing a letter', sum[1] + sum[2], 'var(--c-out)']];
      const tot = groups.reduce((a, g) => a + g[1], 0), max = Math.max(...groups.map((g) => g[1]));
      groups.forEach(([name, v, c]) => hbar($('w-kinds'), name, v / max, v < 1e5 ? fmt(v) + ' steps' : pct(v / tot), c));
    }
    setPos(start); drawLayers();
    onResize(() => { drawPos(); drawLayers(); });
    lpick.addEventListener('input', () => { layerSel = Number(lpick.value); drawLayers(); });
    dragAlong($('w-layers'), (f) => { if (!lpick.disabled) { layerSel = Math.max(0, Math.min(Number(lpick.max), Math.floor(f * (Number(lpick.max) + 1)))); drawLayers(); } });

    // ---- the explanation, from the same numbers ----
    {
      const box = $('w-explain'), share = (p, list) => list.reduce((a, id) => a + p.steps[ix(id)], 0) / p.total;
      const famShare = (p, fam) => p.steps.reduce((a, s, i) => a + (SEC[ids[i]].fam === fam ? s : 0), 0) / p.total;
      const cellsOf = (kinds) => W.regions.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.rows * r.cols, 0);
      const matrices = cellsOf(W.weights.kinds), table = QWEN ? cellsOf(['cls']) : 0;
      const tot = P.positions.map((p) => p.total), SW = sweepsOf(ids), perWeight = share(firstP, SW) * firstP.total / (matrices + table);
      const s0 = share(firstP, SW), s1 = share(lastP, SW), tidy = Math.max(...P.positions.map((p) => famShare(p, 'tidy')));
      const p1 = el('p'), mil = (v) => (v >= 1e9 ? (v / 1e9).toFixed(2) + ' billion' : (v / 1e6).toFixed(1) + ' million');
      p1.append('One word piece costs ' + billions(tot[0], Math.max(...tot)) + ' steps' + (full ? '' : ' at the positions that were run') + '. Most of them are "weight times number": ' + pct(s0, 0) + ' at position ' + firstP.position + (Math.abs(s0 - s1) >= 0.02 ? ', and still ' + pct(s1, 0) + ' at position ' + lastP.position : ' and at position ' + lastP.position + ' alike') + '. The model has ' + mil(matrices) + ' weights in its matrices' + (table ? ', and the output table is another ' + mil(table) + ' numbers. Every one of them' : ' and every one of them') + ' is used once for every word piece. A weight is not multiplied the way a calculator does it. The number is split into bits, and for every bit that is set, the whole column of weights is added once, doubled the right number of times. Those additions happen while the column crosses the gap, so multiplying and moving are the same loop. It comes to about ' + perWeight.toFixed(perWeight < 9.5 && perWeight > 8.5 ? 0 : 1) + ' steps per weight.');
      const p2 = el('p', '', 'Most of what is left is walking: fetching the row of the word piece' + (QWEN ? ' (' + pct(share(firstP, ['emb']), 0) + ': the table is ' + fmt(m.vocab) + ' rows long)' : '') + ', and the walk home that puts every column back. The parts that sound hard (dividing, rounding, the exponential) are together under ' + Math.ceil(100 * tidy) + '%. That is the work of the bit peel: by plain counting, one rounding alone would cost over a million steps.');
      const a0 = firstP.steps[ix('att')], a1 = lastP.steps[ix('att')], p3 = el('p');
      p3.append('The cost grows slowly with the conversation. At position ' + firstP.position + (firstP.position === T.fixedPositions && T.fixedPositions ? ', the first one after the fixed opening lines,' : ', the first one,') + ' a word piece costs ' + (firstP.total / 1e9).toFixed(2) + ' billion steps. At position ' + lastP.position + (full ? ', the last one,' : ', the last one that was run,') + ' it costs ' + (lastP.total / 1e9).toFixed(2) + ' billion. The growth is in looking back: that section goes from ' + short(a0) + ' steps to ' + short(a1) + ', because there are ' + (a1 > 5 * a0 ? words(Math.round((lastP.position + 1) / (firstP.position + 1))) + ' times as many' : 'more') + ' earlier pieces to visit. The matrices cost nearly the same every time' + (full ? '.' : '; the small differences between positions come from how many bits are set in the numbers.'));
      if (m.deltanet) {         // brnfck-qwen3.5-0.8b: only its attention layers look back
        const dn = (p) => p.steps.reduce((a, s, i) => a + (/^dn\./.test(ids[i]) ? s : 0), 0), all = P.positions.map(dn);
        p3.append(' Only ' + I.F.attLayers + ' of the ' + m.layers + ' layers look back. The ' + I.F.dnLayers + ' DeltaNet layers do the same work at every position, whatever came before: ' + short(Math.min(...all)) + ' to ' + short(Math.max(...all)) + ' steps for their own sections, which also differ only by the bits of the numbers.');
      }
      box.append(p1, p2, p3);
      if (!full && P.positions.length >= 4) {
        const xs = P.positions.map((p) => p.position), fitA = lineFit(xs, P.positions.map((p) => p.steps[ix('att')])), rest = P.positions.map((p) => p.total - p.steps[ix('att')]).sort((a, b) => a - b)[P.positions.length >> 1];
        const est = rest + fitA.k * (m.maxTokens - 1) + fitA.c, p4 = el('p');
        p4.append('How much would the last position cost? Over the positions that were run, looking back grows by ' + short(fitA.k) + ' steps for every position, in a straight line. If that line goes on, position ' + (m.maxTokens - 1) + ' costs about ' + (est / 1e9).toFixed(1) + ' billion steps, ' + pct(est / firstP.total - 1, 0) + ' more than position ' + firstP.position + '. ', tagEv('estimated'), ' For brnfck-smollm2-135m, which was run to its last position, a line through its first 26 positions gives the cost of its last one to within 2%.');
        box.append(p4);
      }
    }
  });

  // ---- 7. how it was checked
  lazy($('s7'), async () => {
    const [C, W] = await Promise.all([json('checks'), json('writer')]);
    const box = $('c-sums'), regions = W.regions, nS = C.tapeSums.length;
    box.setAttribute('aria-label', fmt(nS) + ' checksums of the tape. All ' + fmt(nS) + ' are equal in both tapes.');
    if (nS > 400) box.classList.add('many');
    const say = (i) => {
      const from = i * C.pieceCells, to = Math.min(C.tapeCells, from + C.pieceCells), kinds = new Map();
      for (const r of regions) { const a = Math.max(from, r.from), b = Math.min(to, r.to); if (b > a && r.kind !== 'work') kinds.set(regionTitle(r).replace(/ \(.*\)$/, ''), b - a); }
      const what = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).join('; ');
      $('c-said').textContent = '';
      $('c-said').append('Cells ' + fmt(from) + ' to ' + fmt(to - 1) + (what ? ' (' + what + ')' : '') + '. SHA-256 of this piece of the tape: ', el('code', '', C.tapeSums[i].slice(0, 16) + '…' + C.tapeSums[i].slice(-8)), '. The tape written by the program and the tape of the earlier version give the same sum.');
    };
    const mark = (i) => { box.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); box.children[i].classList.add('on'); $('c-pick').value = i; readOut($('c-pick'), 'piece ' + (i + 1) + ' of ' + nS); say(i); };
    C.tapeSums.forEach((s, i) => { const d = el('i', '', nS > 400 ? '' : '✓'); d.dataset.i = i; box.append(d); });
    const over = (e) => { const d = e.target.closest('i'); if (d && d.dataset.i !== undefined) mark(Number(d.dataset.i)); };
    box.addEventListener('mouseover', over); box.addEventListener('click', over);
    $('c-pick').max = nS - 1; readOut($('c-pick'), 'piece 1 of ' + nS); $('c-pick').addEventListener('input', () => mark(Number($('c-pick').value)));
    $('c-said').textContent = fmt(nS) + ' squares, one for every ' + fmt(C.pieceCells) + ' cells of the tape (the last one is a smaller piece). ' + (nS > 400 ? 'A filled square' : 'A tick') + ' means: the two tapes gave the same checksum here. All ' + fmt(nS) + ' are ' + (nS > 400 ? 'filled' : 'ticked') + '.';
    const GROUP = { 1: 'The file', 2: 'The tape', 3: 'The answers' };
    C.checks.forEach((c) => {
      const li = el('li', c.ok ? 'verdict ok' : 'verdict no'), mm = /^(.*?)\s*(\((.*)\)|\[.*\])?\s*$/.exec(c.text.replace(/^\d\s+/, ''));
      li.append(el('b', '', (c.ok ? '' : 'Not right. ') + GROUP[c.group] + ': '), mm[1].replace(/ \[scanned.*$/, '')); if (mm[3]) li.append(el('div', 'muted', mm[3].replace(/-(?= \d)/g, '−')));
      $('c-checks').append(li);
    });
    if (C.tapeRun) { const li = el('li', 'verdict ok'); li.append(el('b', '', 'The tape: '), 'the writing part was run without any input', el('div', 'muted', (C.tapeRun.loops !== null ? fmt(C.tapeRun.loops) + ' loops with ' + fmt(C.tapeRun.loopTexts) + ' different texts, in ' : 'in ') + C.tapeRun.seconds + ' seconds' + (C.tapeRun.memoryBits === 64 ? ', on a 64-bit memory' : ''))); $('c-checks').append(li); }
    if (C.restore && C.restore.cells) { const li = el('li', 'verdict ok'); li.append(el('b', '', 'The tape: '), 'after an answer, putting back the cells that an answer changes gives the starting tape again', el('div', 'muted', fmt(C.restore.cells) + ' cells put back (word piece, position, stored keys and values); all ' + fmt(nS) + ' checksums equal again')); $('c-checks').append(li); }
    const tbl = $('c-questions'), head = el('tr');
    $('c-q-cap').textContent = words(C.questions.length)[0].toUpperCase() + words(C.questions.length).slice(1) + (C.questions.length === 1 ? ' question' : ' questions') + ' put to the whole program.';
    [['Question', ''], ['Letters in', 'n'], ['Word pieces out', 'n'], ['Seconds per piece', 'n'], ['Ended by', ''], ['Equal to the reference', '']].forEach(([h, c]) => head.append(el('th', c, h))); tbl.append(head);
    const END = { end: 'the "end" piece', limit: 'the limit of 256 positions', cut: 'the check, after 30 pieces' };
    C.questions.forEach((q) => {
      const tr = el('tr'), td = el('td', 'qq');
      td.textContent = q.question === null ? '(' + q.note + ')' : '"' + q.question.replace(/\t/g, '⇥') + '"';
      tr.append(td, el('td', 'n', String(q.inputBytes)), el('td', 'n', String(q.pieces)), el('td', 'n', q.perPiece.toFixed(2)), el('td', '', END[q.end] || q.end), el('td', q.ok ? 'ok' : 'no', q.ok ? 'yes, all ' + fmt(q.outputBytes) + ' letters' : 'no'));
      tbl.append(tr);
    });
    const T = TR.main;
    const items = [
      ['The block list of the map is the file.', 'The encoder was run again on the tape while it reported every block. Its text, followed by the engine, has the SHA-256 of the program file: ' + W.program.sha256.slice(0, 16) + '…'],
      ['The section list of the engine is the file.', 'The generator was run again while it reported every named step. Its text equals the last ' + fmt(W.program.engine) + ' characters of the file, character for character.'],
    ];
    if (T) items.push(T.complete !== false
      ? ['The step counts are from a run that gave the right answer.', 'The counting interpreter uses the same operations as the project\'s own (compared instruction by instruction) and printed "' + T.answer + '", equal to the reference. ' + fmt(T.steps) + ' steps for ' + T.positions.length + ' positions.']
      : ['The step counts are from a run that was stopped on purpose.', 'The counting interpreter uses the same operations as the project\'s own (compared instruction by instruction). It was stopped after ' + T.positions.length + ' positions and ' + fmt(T.steps) + ' steps' + (T.answer ? '; what it had printed by then, "' + T.answer + '", is the start of the reference answer.' : ', before it printed anything, so its answer could not be compared.')]);
    items.push(['The blocks of the writing part are run in your browser.', 'The text of the block is carried out by a small interpreter in your browser and the cells are compared with the tape.'],
      ['The tape statistics match the build.', fmt(W.tape.nonZero) + ' cells that are not zero, ' + W.tape.entropyBitsPerCell.toFixed(2) + ' bits per cell, ' + fmt(W.tape.plainCounting) + ' characters by plain counting: counted again from the tape.']);
    items.forEach(([a, b]) => { const li = el('li', 'verdict ok'); li.append(el('b', '', a), el('div', 'muted', b)); $('c-page').append(li); });
  });

  // ---- 8. brnfck-smollm2-135m, brnfck-qwen2.5-0.5b, brnfck-qwen2.5-1.5b and brnfck-qwen3.5-0.8b side by side
  lazy($('s8'), async () => {
    const X = await get('/compare.json'), Ms = X.models.filter((M) => !M.vision), small = Ms[0];      // the four chat programs (the picture program is on the page vision/)
    const famOf = (kind) => (KIND[kind] ? KIND[kind].fam : 'work');
    // the name of a program at the left of its bar; the one this page shows is bold and has a tick
    const who = (M) => { const s = el('span', 'lab'); if (M.id === MODEL) s.append(el('b', '', M.label + ' ✓')); else s.textContent = M.label; return s; };
    const row = (box, M, segs, total, scaleMax, right) => {
      // one program: its name, a bar of coloured parts, a number
      const name = who(M), bar = el('div', 'stack'), val = el('span', '', right);
      const inner = el('div', 'in'); inner.style.width = (100 * total / scaleMax) + '%';
      for (const [cls, v, title, text] of segs) { if (!(v > 0)) continue; const i = el('i', cls.cls || '', text || ''); i.style.flex = v + ' 0 0'; if (cls.bg) i.style.background = cls.bg; i.title = title; inner.append(i); }
      bar.append(inner); box.append(name, bar, val);
    };
    const FAMS = ['out', 'ff', 'ff2', 'att', 'att2', 'dn', 'dn2', 'mem', 'tidy', 'emb', 'text', 'work'];
    const byFam = (obj) => { const f = {}; for (const k in obj) f[famOf(k)] = (f[famOf(k)] || 0) + obj[k]; return f; };
    let how = 'scale';
    const draw = () => {
      const scale = how === 'scale';
      const tb = $('x-text'); tb.textContent = '';
      const maxC = Math.max(...Ms.map((M) => M.chars));
      Ms.forEach((M) => {
        const f = byFam(M.textKinds), segs = FAMS.map((k) => [{ bg: 'var(' + FAM[k].v + ')' }, f[k] || 0, FAM[k].name + ': ' + pct((f[k] || 0) / M.chars), (f[k] || 0) / (scale ? maxC : M.chars) > 0.06 ? FAM[k].letter : '']);
        segs.push([{ cls: 'eng' }, M.engine, 'The engine: ' + pct(M.engine / M.chars), '']);
        row(tb, M, segs, M.chars, scale ? maxC : M.chars, short(M.chars) + ' characters · engine ' + pct(M.engine / M.chars));
      });
      const tp = $('x-tape'); tp.textContent = '';
      const maxT = Math.max(...Ms.map((M) => M.tape));
      Ms.forEach((M) => {
        const f = byFam(M.tapeKinds), segs = FAMS.map((k) => [{ bg: 'var(' + FAM[k].v + ')', cls: k === 'work' ? 'pale' : '' }, f[k] || 0, FAM[k].name + ': ' + pct((f[k] || 0) / M.tape), (f[k] || 0) / (scale ? maxT : M.tape) > 0.06 ? FAM[k].letter : '']);
        row(tp, M, segs, M.tape, scale ? maxT : M.tape, short(M.tape) + ' cells · ' + (M.tape * 4 / 2 ** 30).toFixed(2) + ' GiB');
      });
      [...$('x-seg').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.how === how)));
    };
    $('x-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { how = b.dataset.how; draw(); } });
    draw();
    // the mix of commands: always each to its own length
    {
      const box = $('x-cmds'), order = [...small.counts.order];
      Ms.forEach((M) => {
        const segs = CMD.slice(0, 6).map(([ch, name, v]) => { const c = M.counts.all[order.indexOf(ch)]; return [{ bg: 'var(' + v + ')', cls: 'cmd' }, c, name + ': ' + pct(c / M.chars), c / M.chars > 0.05 ? (ch === '-' ? '−' : ch) + ' ' + Math.round(100 * c / M.chars) + '%' : '']; });
        row(box, M, segs, M.chars, M.chars, 'brackets ' + pct((M.counts.all[4] + M.counts.all[5]) / M.chars, 2));
      });
      CMD.slice(0, 6).forEach(([ch, name, v]) => { const li = el('li'), sw = el('i', 'sw glyph ' + v.slice(2), ch === '-' ? '−' : ch); sw.setAttribute('aria-hidden', 'true'); li.append(sw, el('span', 'sr-only', (ch === '-' ? '−' : ch) + ' '), name); $('x-cmd-legend').append(li); });
      $('x-said').textContent = 'Characters for each cell that is written: ' + Ms.map((M) => M.label + ' ' + (M.writer / M.nonZero).toFixed(2)).join(', ') + '. The read and print commands occur once in each file.';
    }
    // steps at position 24
    {
      const box = $('y-steps'), ids = TR.main ? TR.main.sections : Object.keys(SEC);
      Ms.forEach((M) => {
        const S = M.steps;
        if (!S || !S.pos24) { box.append(who(M), el('div', 'muted small', 'not counted for this program'), el('span', '', '')); return; }
        const f = {}; S.sections.forEach((id, i) => { const k = S.fams ? S.fams[i] : SEC[id].fam; f[k] = (f[k] || 0) + S.pos24.steps[i]; });
        const segs = STACK.map((k) => [{ bg: 'var(' + FAM[k].v + ')' }, f[k] || 0, FAM[k].name + ': ' + pct((f[k] || 0) / S.pos24.total), (f[k] || 0) / S.pos24.total > 0.07 ? FAM[k].letter + ' ' + Math.round(100 * (f[k] || 0) / S.pos24.total) + '%' : '']);
        row(box, M, segs, 1, 1, (S.pos24.total / 1e9).toFixed(2) + ' billion steps');
      });
      const parts = Ms.filter((M) => M.steps).map((M) => M.label + ': "' + M.steps.question + '", ' + (M.steps.runs > 1 ? M.steps.runs + ' runs, ' : '') + 'positions ' + M.steps.from + ' to ' + M.steps.to + (M.steps.complete ? '' : ' (stopped there)'));
      $('y-what').textContent = 'What was counted: ' + parts.join('; ') + '.' + (Ms.some((M) => !M.steps) ? ' No steps were counted for ' + Ms.filter((M) => !M.steps).map((M) => M.label).join(' and ') + '.' : '');
      // growth against brnfck-smollm2-135m
      const g = $('y-grow'), big = Ms.slice(1), rows = [
        ['Numbers written on the tape', (M) => M.nonZero], ['Text of the writing part', (M) => M.writer], ['Text of the engine', (M) => M.engine],
        ['Engine without its steps left and right', (M) => M.engineOther], ['Steps for a word piece (position 24)', (M) => (M.steps && M.steps.pos24 ? M.steps.pos24.total : null)],
        ['Seconds for a word piece', (M) => M.timing.perPiece], ['Seconds to start up', (M) => M.timing.startup],
      ], top = Math.log2(16);
      rows.forEach(([name, f]) => big.forEach((M) => {
        const a = f(small), b = f(M);
        if (a === null || b === null) { hbar(g, name + ' · ' + M.label, 0, 'not counted', 'var(--muted)'); return; }
        hbar(g, name + ' · ' + M.label, Math.log2(b / a) / top, '× ' + (b / a).toFixed(1), { '0.5b': 'var(--accent)', '0.8b': 'var(--k-dn)', '1.5b': 'var(--ink)' }[M.id] || 'var(--accent)');
      }));
      $('y-said').textContent = 'Each bar says how many times larger a number is than in brnfck-smollm2-135m. The scale is in doublings: a bar twice as long is the square of the factor. Seconds are from the project\'s logs.';
    }
    // the table
    {
      const tbl = $('x-table'), head = el('tr');
      ['', ...Ms.map((M) => M.label), 'Where from'].forEach((h, i) => head.append(el('th', i && i <= Ms.length ? 'n' : '', h))); tbl.append(head);
      const order = [...small.counts.order], sh = (M, ch) => pct(M.counts.all[order.indexOf(ch)] / M.chars);
      const line = (name, f, from) => { const tr = el('tr'); tr.append(el('td', '', name)); Ms.forEach((M) => { const v = f(M); const say = v === null || v === undefined ? 'not counted' : v, td = el('td', 'n'); if (M.id === MODEL) td.append(el('b', '', say)); else td.textContent = say; tr.append(td); }); tr.append(el('td', 'muted small', from)); tbl.append(tr); };
      const grp = (t) => { const tr = el('tr', 'grp'), td = el('td'); td.colSpan = Ms.length + 2; td.append(el('span', 'label', t)); tr.append(td); tbl.append(tr); };
      grp('The model');
      line('Model', (M) => M.name, 'the model');
      line('Layers', (M) => String(M.layers), 'the model');
      line('Numbers per word piece', (M) => fmt(M.dim), 'the model');
      line('Rows of the vocabulary table', (M) => fmt(M.vocab), 'the model');
      line('Bits per weight on the tape', (M) => String(M.weightBits), 'the project\'s settings');
      grp('The file');
      line('Characters', (M) => fmt(M.chars), 'counted in the file');
      line('of which the engine', (M) => fmt(M.engine) + ' (' + pct(M.engine / M.chars) + ')', 'counted in the file');
      line('Engine without steps left and right', (M) => fmt(M.engineOther), 'counted in the file');
      line('Loops in the engine', (M) => fmt(M.engineLoops), 'counted in the file');
      for (const [ch, nm] of [['+', 'add one'], ['-', 'take one off'], ['<', 'step left'], ['>', 'step right'], ['[', 'loop start']]) line('Share of ' + (ch === '-' ? '−' : ch) + ' (' + nm + ')', (M) => sh(M, ch), 'counted in the file');
      line('Blocks in the writing part', (M) => fmt(M.blocks), 'the encoder, run again');
      grp('The tape');
      line('Cells', (M) => fmt(M.tape), 'the program\'s meta file');
      line('Memory for the tape', (M) => (M.tape * 4 / 2 ** 30).toFixed(2) + ' GiB (' + M.memoryBits + '-bit)', 'worked out; the project\'s log');
      line('Cells the text writes (not zero)', (M) => fmt(M.nonZero), 'counted on the tape');
      line('Characters per cell written', (M) => (M.writer / M.nonZero).toFixed(2), 'worked out');
      line('Information per cell written', (M) => M.entropy.toFixed(2) + ' bits', 'counted on the tape');
      grp('Running');
      line('Writing the tape, without input', (M) => M.timing.writeSeconds + ' s', 'the project\'s log');
      line('Start-up, average', (M) => M.timing.startup.toFixed(0) + ' s (' + M.timing.runs + ' runs)', 'the project\'s log');
      line('Seconds per word piece', (M) => M.timing.perPieceMin.toFixed(2) + ' to ' + M.timing.perPieceMax.toFixed(2), 'the project\'s log');
      line('Steps per word piece (first position; dearest)', (M) => (M.steps ? billions(M.steps.first, M.steps.max) : null), 'counted by trace.js');
      line('for positions', (M) => (M.steps ? M.steps.from + ' to ' + M.steps.to + (M.steps.complete ? '' : ', stopped') : null), 'what was run');
      line('"Weights × numbers" at position 24', (M) => (M.steps && M.steps.pos24 ? pct(sweepsOf(M.steps.sections).reduce((a, id) => a + M.steps.pos24.steps[M.steps.sections.indexOf(id)], 0) / M.steps.pos24.total, 0) + ' of the steps' : null), 'counted by trace.js');
      grp('This page');
      line('Order of the map', (M) => M.order + ' (' + fmt(M.side) + ' cells wide)', 'tiles.js');
      line('Data stored for the page', (M) => fmt(M.data.totalBytes / 1e6) + ' MB', 'counted on disk');
    }
    // the explanation
    {
      const box = $('x-explain'), b = Ms.reduce((a, M) => (M.nonZero > a.nonZero ? M : a)), big = Ms.slice(1), r = (f, M = b) => (f(M) / f(small)).toFixed(1), cpc = Ms.map((M) => M.writer / M.nonZero);
      // "a, b and c" over the bigger programs
      const list = (f, Ns = big) => { const t = Ns.map(f); return t.length > 1 ? t.slice(0, -1).join(', ') + ' and ' + t[t.length - 1] : t[0]; };
      const dn = Ms.find((M) => M.family === 'qwen3.5'), full = Ms.filter((M) => M !== dn), counted = big.filter((M) => M.steps && M.steps.pos24);
      const sameSecs = full.every((M) => M.engineSections === small.engineSections);
      box.append(
        el('p', '', 'What grows with the model is the writing part. It holds one number for every weight, at ' + Math.min(...cpc).toFixed(1) + ' to ' + Math.max(...cpc).toFixed(1) + ' characters each, so it grows in step with the model. The ' + b.label + ' program puts ' + r((M) => M.nonZero) + ' times as many numbers on the tape as brnfck-smollm2-135m, and its writing part is ' + r((M) => M.writer) + ' times as long.'),
        el('p', '', 'The engine does not grow in step with the model: ' + list((M) => r((N) => N.engine, M) + ' times as long in ' + M.label) + '. Most of that growth is walking. The engine\'s text is mostly runs of < and >, and a run is as long as the matrix it crosses is wide. Leave those steps out and ' + fmt(small.engineOther) + ' characters remain in brnfck-smollm2-135m, against ' + list((M) => fmt(M.engineOther) + ' in ' + M.label) + '. That is the logic: the loops, the rounding, the tables. It is larger in the Qwen programs because their engine does more: a scale for every row, gains, a vocabulary ' + list((M) => (M.vocab / small.vocab).toFixed(0), [...new Map(big.map((M) => [M.vocab, M])).values()]).replace(/ and /, ' or ') + ' times as large' + (dn ? ', and in ' + dn.label + ' the text of four layers of two kinds, written out one after another' : '') + '. It is not larger because the models have more weights.'),
        el('p', '', 'The mix of commands hardly changes. The same encoder wrote all ' + words(Ms.length) + ' writing parts, and a writing part is "step left, add or take off a little" from start to end. The tape is nearly all weights in all ' + words(Ms.length) + '. What also stays the same: the one read and the one print command, and room for 256 word pieces.' + (dn && sameSecs ? ' The engines of ' + list((M) => M.label, full) + ' also have the same ' + small.engineSections + ' sections, and 256 memory slots in every layer. That of ' + dn.label + ' has ' + dn.engineSections + ' sections, and only ' + dn.attLayers + ' of its ' + dn.layers + ' layers have memory slots.' : '')),
        el('p', '', 'The work for a word piece grows with the weights, because every weight is used once for every piece' + (counted.length ? ': ' + list((M) => r((N) => N.steps.pos24.total, M) + ' times the steps in ' + M.label, counted) : '') + '. In the bigger programs a larger share goes to the table of word pieces: it has ' + list((M) => fmt(M.vocab), [...new Map(big.map((M) => [M.vocab, M])).values()]).replace(/ and /, ' or ') + ' rows against ' + fmt(small.vocab) + ', the engine runs along all of it to fetch one row, and once more to score every piece. Start-up grows with the file, which has to be read and run once from its first character.'),
      );
    }
  });

  // ---- how to make the data again
  ready.then(() => {
    const big = MODEL === '1.5b' || MODEL === '0.8b', mem = big ? '6144' : '4096', L = TR.long;
    const lines = ['node --max-old-space-size=' + mem + ' tools/map-data/writer.js ' + MODEL, 'node tools/map-data/sections.js ' + MODEL, 'node tools/map-data/tiles.js ' + MODEL, 'node tools/map-data/depth.js ' + MODEL, 'node tools/map-data/stops.js ' + MODEL];
    if (!QWEN) lines.push('node --max-old-space-size=4096 tools/map-data/trace.js small', 'node --max-old-space-size=4096 tools/map-data/trace.js small "Why is the sky blue?" sky');
    else if (L) lines.push('node --max-old-space-size=4096 tools/map-data/trace.js ' + MODEL + ' "' + L.question + '" ' + TR.names[0] + (L.maxPositions ? ' --max ' + L.maxPositions : ''));
    else lines.push('node --max-old-space-size=4096 tools/map-data/trace.js ' + MODEL + ' "What is 12 + 30?" sum --max 25');
    lines.push('node tools/map-data/checks.js ' + MODEL, 'node tools/map-data/compare.js');
    $('n-cmd').textContent = lines.join('\n');
    $('n-cost').textContent = { small: 'For this program they take about ten minutes and 1.5 GB of memory; the long run behind the chart of steps per word piece takes another 70 minutes.', '0.5b': 'For this program they take about 40 minutes, most of it the counted run behind "Where the time goes", and 3.5 GB of memory (the tape is 2.45 GiB).', '0.8b': 'For this program writer.js takes about ten minutes, tiles.js two, and the counted run of 25 positions 74 minutes, about three minutes a position; writer.js and trace.js need the tape of 3.98 GiB in memory and refuse to start when less than 5.3 GB is free.', '1.5b': 'For this program writer.js takes about 20 minutes and the counted run several minutes for every position; both need the tape of 6.81 GiB in memory and refuse to start when less than 12 GB is free.' }[MODEL];
  });

  // ---- a link to a question opens it
  function openFromHash() {
    const t = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t && t.tagName === 'DETAILS') { t.open = true; t.scrollIntoView(); }
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
  if (location.hash.length > 1) ready.then(() => setTimeout(() => { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }, 60));

})();
