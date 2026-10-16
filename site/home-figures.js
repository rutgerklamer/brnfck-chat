// The figures further down the home page: a zoom from one command to the whole program, the engine
// as text and as work, and one question answered by the four programs. Each starts when it scrolls into view.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  // start(): once el is in view, or near it (o: the options of the IntersectionObserver)
  const soon = (el, start, o = { rootMargin: '300px' }) => {
    if (!el) return;
    if (!('IntersectionObserver' in window)) return start();
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, o);
    io.observe(el);
  };
  // the data of a program for the pages inside/ and map/: in inside/data/<name>/, or where data-hosts.json says
  const INSIDE = new URL('inside/', document.currentScript ? document.currentScript.src : document.baseURI).href;
  const hosts = () => fetch(INSIDE + 'data-hosts.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  async function data(name, files) {
    const h = await hosts(), base = h && typeof h[name] === 'string' && h[name] ? new URL(h[name], INSIDE).href : INSIDE + 'data/' + name + '/';
    return Promise.all(files.map((f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); })));
  }
  const BIG = '1.5b';                                       // the figures show the largest program
  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // ---- 1. Zoom out: from one command to the whole program of brnfck-qwen2.5-1.5b ----
  // Every square has the area of its number of characters, and lies inside the square it is part of
  // (where it lies there is not where it is in the program). The text drawn is one real block of the
  // writing part, from the data of the page inside/.
  const INK = { '+': '#e69f00', '-': '#3d9bd6', '<': '#9aa3b2', '>': '#9aa3b2', '[': '#cc79a7', ']': '#cc79a7', ',': '#00b384', '.': '#e8601c' };
  soon($('fig-zoom'), async () => {
    let W, B;
    try { [W, B] = await data(BIG, ['writer.json', 'block-w13.json']); }
    catch (e) { $('fig-zoom').hidden = true; return; }
    const R = W.regions, inLayer = (r) => r.layer >= 0 && !['cls', 'work', 'glob', 'emb', 'tokbytes', 'tokids', 'toktable'].includes(r.kind);
    let w13 = 0, layer = 0, layers = 0, count = 0;
    for (const s of W.stretches) {
      const r = R[s[0]], n = s[2] - s[1];
      if (!inLayer(r)) continue;
      layers += n; count = Math.max(count, r.layer + 1);
      if (r.layer === B.layer) { layer += n; if (r.kind === 'w13') w13 += n; }
    }
    const L = 'Layer ' + (B.layer + 1);
    const LEVELS = [
      { name: 'One command', chars: 1, say: 'one character' },
      { name: 'One number, on average', chars: B.len / B.K, say: 'a block writes ' + fmt(B.K) + ' numbers with ' + fmt(B.len) + ' characters, about ' + (B.len / B.K).toFixed(1) + ' for each', row: true },
      { name: 'One block', chars: B.len, say: fmt(B.len) + ' characters that write ' + fmt(B.K) + ' numbers' },
      { name: L + ': feed-forward weights', chars: w13, say: fmt(w13) + ' characters', fill: '#123b33' },
      { name: L, chars: layer, say: fmt(layer) + ' characters', fill: '#1b3350' },
      { name: 'All ' + count + ' layers', chars: layers, say: fmt(layers) + ' characters', fill: '#3a2547' },
      { name: 'The writing part', chars: W.program.writer, say: fmt(W.program.writer) + ' characters. Outside the layers: the output table and the table of word pieces', fill: '#4a3313' },
      { name: 'The whole program', chars: W.program.chars, say: fmt(W.program.chars) + ' characters. The pink band is the engine: ' + fmt(W.program.engine), fill: '#cc79a7' },
    ];
    for (const l of LEVELS) l.side = l.row ? l.chars : Math.sqrt(l.chars);
    const text = B.text, across = Math.ceil(Math.sqrt(text.length));
    // the block as an image, one pixel per character, for every zoom where letters are too small
    const pix = document.createElement('canvas'); pix.width = across; pix.height = Math.ceil(text.length / across);
    { const c = pix.getContext('2d'), img = c.createImageData(pix.width, pix.height);
      const rgb = {}; for (const k in INK) rgb[k] = [1, 3, 5].map((i) => parseInt(INK[k].slice(i, i + 2), 16));
      for (let i = 0; i < text.length; i++) { const v = rgb[text[i]] || [60, 60, 60], o = i * 4; img.data[o] = v[0]; img.data[o + 1] = v[1]; img.data[o + 2] = v[2]; img.data[o + 3] = 255; }
      c.putImageData(img, 0, 0); }
    const mini = {};                                     // the block shrunk to n pixels, by n
    const clamp = (x) => Math.max(0, Math.min(1, x));

    const canvas = $('zoomView'), slider = $('zoomAt'), MAX = Number(slider.max);
    const vMin = 22, vMax = LEVELS[LEVELS.length - 1].side * 1.2;       // room above the whole program for its label
    const viewAt = (z) => Math.exp(Math.log(vMin) + z * (Math.log(vMax) - Math.log(vMin)));
    const zFor = (v) => (Math.log(v) - Math.log(vMin)) / (Math.log(vMax) - Math.log(vMin));
    let z = 0, anim = 0;
    const list = $('zoomLevels');
    LEVELS.forEach((l, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = l.name; b.lastChild.textContent = l.row ? 'about ' + (l.chars).toFixed(1) : fmt(l.chars);
      b.addEventListener('click', () => go(Math.max(0, Math.min(1, zFor(Math.max(vMin, l.side * 1.25)))), 900));
      li.append(b); list.append(li);
    });
    // a label: a dark plate with a chip in the colour of its square; (x, y) is its upper left corner
    const LINE = 15, PAD = 4;
    const plate = (ctx, lines) => { ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace'; return { w: Math.max(...lines.map((t) => ctx.measureText(t).width)) + 2 * PAD + 6, h: lines.length * LINE + 2 * PAD - 4 }; };
    function label(ctx, x, y, lines, chip) {
      const { w, h } = plate(ctx, lines);
      ctx.fillStyle = 'rgba(13,14,16,.92)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = chip; ctx.fillRect(x, y, 3, h);
      ctx.textBaseline = 'top';
      lines.forEach((t, i) => { ctx.fillStyle = i ? '#a9a79f' : '#f4f3ee'; ctx.fillText(t, x + PAD + 6, y + PAD - 1 + i * LINE); });
    }
    // the command in focus: the middle of the block
    const rows = Math.ceil(text.length / across), FR = Math.floor(rows / 2), FC = Math.floor(across / 2);
    function draw() {
      // the view fits the shorter side of the canvas and is centred on the command in focus; every larger
      // square is centred on the block, so each lies inside the square it is part of
      const { ctx, w, h } = fit(canvas), V = viewAt(z), k = (Math.min(w, h) - 12) / V;
      const t = LEVELS[2].side * k, bx = w / 2 - (FC + 0.5) * k, by = h / 2 - (FR + 0.5) * k, cx = bx + t / 2, cy = by + t / 2;
      const sq = (s) => [cx - s / 2, cy - s / 2, s, s];
      ctx.fillStyle = '#0d0e10'; ctx.fillRect(0, 0, w, h);
      // the squares, largest first, each in its own colour
      const top = LEVELS.length - 1;
      for (let i = top; i >= 3; i--) { ctx.fillStyle = LEVELS[i].fill; ctx.fillRect(...sq(LEVELS[i].side * k)); }
      // the writing part is made of blocks: every square shows them at their real size, as small copies of
      // the one block, until they are smaller than a pixel. They keep the scale in view all the way out.
      const gap = 1;
      ctx.globalAlpha = 0.5 * clamp((t - 2) / 3);
      if (ctx.globalAlpha > 0) {
        ctx.save(); ctx.beginPath(); ctx.rect(...sq(LEVELS[top - 1].side * k)); ctx.clip();
        ctx.imageSmoothingEnabled = true;
        if (t > 96) {                                      // a few large blocks: each drawn
          ctx.fillStyle = '#0d0e10'; ctx.fillRect(0, 0, w, h);
          for (let r = Math.floor(-by / t); by + r * t < h; r++) for (let c = Math.floor(-bx / t); bx + c * t < w; c++) ctx.drawImage(pix, bx + c * t, by + r * t, t - gap, t - gap);
        } else {                                           // many small ones: one block as a repeated pattern
          const n = Math.max(2, Math.round(t * (window.devicePixelRatio || 1)));
          if (!mini[n]) { const m = document.createElement('canvas'); m.width = m.height = n; const g = n >= 3 ? 1 : 0; const mc = m.getContext('2d'); mc.fillStyle = '#0d0e10'; mc.fillRect(0, 0, n, n); mc.imageSmoothingQuality = 'high'; mc.drawImage(pix, 0, 0, n - g, n - g); mini[n] = m; }
          const pat = ctx.createPattern(mini[n], 'repeat'); pat.setTransform(new DOMMatrix([t / n, 0, 0, t / n, bx, by]));
          ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      // the block itself: its pixels, turning into its letters as they become large enough to read
      { const a = clamp((k - 5) / 4);
        ctx.fillStyle = '#0d0e10'; ctx.fillRect(bx, by, t, t);
        if (a < 1) { ctx.globalAlpha = 1 - a; ctx.imageSmoothingEnabled = k < 1; ctx.drawImage(pix, bx, by, pix.width * k, pix.height * k); }
        if (a > 0) {
          const size = Math.min(26, k * 0.9);
          ctx.globalAlpha = a;
          ctx.font = '600 ' + size.toFixed(1) + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const r0 = Math.max(0, Math.floor(-by / k)), r1 = Math.min(rows - 1, Math.ceil((h - by) / k));
          const c0 = Math.max(0, Math.floor(-bx / k)), c1 = Math.min(across - 1, Math.ceil((w - bx) / k));
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const chr = text[r * across + c]; if (!chr) continue;
            ctx.fillStyle = INK[chr] || '#888'; ctx.fillText(chr, bx + (c + 0.5) * k, by + (r + 0.5) * k);
          }
          ctx.textAlign = 'left';
        }
        ctx.globalAlpha = 1; }
      // the outlines; at least a few pixels wide, so the eye keeps the square it came from
      ctx.strokeStyle = 'rgba(244,243,238,.6)'; ctx.lineWidth = 1;
      for (let i = top; i >= 2; i--) { const [x, y, s] = sq(Math.max(LEVELS[i].side * k, 3)); ctx.strokeRect(x + 0.5, y + 0.5, s, s); }
      // one command: outlined over the text, fading once it is too small to see
      ctx.globalAlpha = clamp(k / 3);
      ctx.strokeStyle = '#f2b01e'; ctx.lineWidth = 2; ctx.strokeRect(bx + FC * k, by + FR * k, k, k);
      // labels: each square has its own at its upper left corner, inside the band between it and the square
      // within it, so that no two labels ever cover each other; the whole program, whose band is less than a
      // pixel, has its label just above it. A label shows its numbers too when the band is deep enough, and
      // fades in and out as its room grows and shrinks.
      for (let i = top; i >= 2; i--) {
        const [x, y, s] = sq(LEVELS[i].side * k), band = i === 2 ? s / 2 : (s - LEVELS[i - 1].side * k) / 2;
        // the longest of three that fits: name and both numbers, name and characters, the name alone
        const name = LEVELS[i].name, n = fmt(LEVELS[i].chars) + ' characters';
        const outside = i === top, lx = x + (outside ? 0 : 6), room = outside ? y - 4 : band - 6, wide = outside ? w - lx - 6 : s - 12;
        const tiers = [[name, n + (i > 2 ? ' · ' + fmt(LEVELS[i].chars / B.len) + ' blocks' : '')], [name, n], [name]];
        const one = plate(ctx, [name]), lines = tiers.find((t) => { const q = plate(ctx, t); return q.h <= room && q.w <= wide; }) || [name], p = plate(ctx, lines);
        const ly = outside ? y - p.h - 4 : y + 6;
        const a = Math.min(clamp((room - one.h) / 10), clamp((wide - one.w) / 16), clamp(Math.min(lx, ly) / 8), clamp((h - ly - p.h) / 8));
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        label(ctx, lx, ly, lines, LEVELS[i].fill || '#f4f3ee');
      }
      ctx.globalAlpha = 1;
      // what is in view
      let cur = 0; LEVELS.forEach((l, i) => { if (l.side <= V * 1.001) cur = i; });
      $('zoomAcross').textContent = fmt(V) + ' characters';
      $('zoomIn').textContent = LEVELS[cur].name;
      $('zoomSay').textContent = LEVELS[cur].name + ': ' + LEVELS[cur].say + '.';
      [...list.children].forEach((li, i) => { if (i === cur) li.firstChild.setAttribute('aria-current', 'true'); else li.firstChild.removeAttribute('aria-current'); });
      slider.value = Math.round(z * MAX);
    }
    // play: z moves at the chosen speed, which may change while it plays; the button pauses it again
    let speed = 1;
    const play = $('zoomPlay'), idle = () => { play.textContent = z > 0.999 ? 'Zoom in again' : z > 0 ? 'Go on' : 'Zoom out'; };
    function go(to, ms, paced) {
      cancelAnimationFrame(anim);
      if (still || !ms) { z = to; draw(); idle(); return; }
      const from = z;
      let f = 0, last = performance.now();
      const tick = (t) => {
        f = Math.min(1, f + (t - last) * (paced ? speed : 1) / ms); last = t;
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        z = from + (to - from) * e; draw();
        if (f < 1) anim = requestAnimationFrame(tick); else { anim = 0; idle(); }
      };
      anim = requestAnimationFrame(tick);
    }
    slider.addEventListener('input', () => { cancelAnimationFrame(anim); anim = 0; z = Number(slider.value) / MAX; draw(); idle(); });
    play.addEventListener('click', () => {
      if (anim) { cancelAnimationFrame(anim); anim = 0; idle(); return; }
      // on a small screen the button is under the figure: bring the whole figure into view first
      const r = canvas.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) canvas.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      if (z > 0.999) go(0, 1600); else { play.textContent = 'Pause'; go(1, 14000 * (1 - z), true); }
    });
    document.querySelectorAll('#zoomSpeed button').forEach((b) => b.addEventListener('click', () => {
      speed = Number(b.dataset.speed);
      document.querySelectorAll('#zoomSpeed button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    }));
    new ResizeObserver(draw).observe(canvas);
    draw();
  });

  // ---- 2. The engine of brnfck-qwen2.5-1.5b: its text and its work, both to scale ----
  // Above, the characters of every section (engine.json); below, the steps of one printed word piece,
  // counted by the project's interpreter (trace-sum.json); a band joins the two of each section.
  const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' billion' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' million' : fmt(n));
  const pct = (x) => (x === 0 ? '0%' : x < 0.001 ? 'under 0.1%' : (100 * x).toFixed(x < 0.1 ? 1 : 0) + '%');
  const FAMV = { out: '--k-out', att: '--k-att', att2: '--k-att2', mem: '--k-mem', ff: '--k-ff', ff2: '--k-ff2', emb: '--k-emb', text: '--k-text', tidy: '--k-tidy', work: '--k-work' };
  // short names, written inside the bars where a section is wide enough (the full names are under the
  // figure); the first that fits is used
  const SHORT = { ask: ['Read the question', 'Read'], queue: ['Line up'], take: ['Take a piece', 'Take'], emb: ['Fetch its row', 'Fetch'], xn1: ['Scale'], sweep1: ['Question, key, value', 'Q, K, V'], qkv: ['Round'], rot: ['Turn'], store: ['Store'], att: ['Look back'], mixed: ['Divide'], hop: ['Carry'], sweep2: ['Attention out', 'Out'], xatt: ['Add'], xn2: ['Scale'], sweep3: ['Widen'], hid: ['Bend'], sweep4: ['Back'], xout: ['Add'], xnf: ['Scale'], cls: ['Score every word piece', 'Score'], return: ['Walk home', 'Home'], print: ['Print'] };
  // dark or light letters, whichever reads better on a colour as getComputedStyle gives it
  const inkOn = (css) => {
    const v = (css.match(/[\d.]+/g) || []).map(Number), k = /^color\(/.test(css) ? 1 : 255, [r, g, b] = v.slice(0, 3).map((x) => x / k);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#111' : '#fff';
  };
  soon($('fig-engine'), async () => {
    let E, S;
    try { [E, S] = await data(BIG, ['engine.json', 'trace-sum.json']); } catch (e) { $('fig-engine').hidden = true; return; }
    const SEC = window.EngineSections.of(E), printed = S.positions.filter((p) => p.printed);
    if (!printed.length) { $('fig-engine').hidden = true; return; }
    const stepsOf = new Map(S.sections.map((id, i) => [id, printed.reduce((a, p) => a + p.steps[i], 0) / printed.length]));
    const items = E.sections.map((s) => ({ id: s.id, sec: SEC[s.id], chars: s.to - s.from, steps: stepsOf.get(s.id) || 0 }));
    let C = 0, T = 0;
    for (const it of items) { it.c0 = C; C += it.chars; it.c1 = C; it.s0 = T; T += it.steps; it.s1 = T; }
    const groups = [];
    for (const it of items) { const g = groups[groups.length - 1]; if (g && g.name === it.sec.group) { g.c1 = it.c1; g.s1 = it.s1; } else groups.push({ name: it.sec.group, c0: it.c0, c1: it.c1, s0: it.s0, s1: it.s1 }); }
    $('engChars').textContent = fmt(C) + ' characters';
    $('engSteps').textContent = fmt(T) + ' steps';
    $('cap-engine').textContent = 'Above, the ' + fmt(C) + ' characters of the engine; below, the ' + fmt(T) + ' steps it takes for one printed word piece. Both are drawn to scale, and a band joins each section of the text to its steps. The sections of a layer stand in the text once and run ' + E.model.layers + ' times, once for every layer. The steps were counted by running the program on "' + S.question + '": the average of the ' + printed.length + ' word pieces of its answer.';

    const canvas = $('engView'), probe = document.createElement('i');
    probe.hidden = true; canvas.after(probe);
    const colour = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
    const BAR = 44, GAP = 100, TOP = 22;
    const geo = (w) => ({ y0: TOP, y1: TOP + BAR, y2: TOP + BAR + GAP, y3: TOP + 2 * BAR + GAP, cx: (v) => v / C * w, sx: (v) => v / T * w });
    let sel = Math.max(0, items.findIndex((it) => it.id === 'sweep3'));
    // a bracket over a group of sections, its name beside it when it fits; dir: 1 above a bar, -1 under it
    function bracket(ctx, x0, x1, y, dir, text, ink) {
      if (x1 - x0 < 4) return;
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x0 + 0.5, y + 4 * dir); ctx.lineTo(x0 + 0.5, y); ctx.lineTo(x1 - 0.5, y); ctx.lineTo(x1 - 0.5, y + 4 * dir); ctx.stroke();
      ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
      const t = text.toUpperCase(); if (ctx.measureText(t).width + 12 > x1 - x0) return;
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = dir > 0 ? 'bottom' : 'top';
      ctx.fillText(t, (x0 + x1) / 2, y - 3 * dir);
    }
    // the name and share of a section inside its stretch of a bar: both, or only the share, or nothing
    function tag(ctx, x0, x1, y, names, share, fill) {
      const room = x1 - x0 - 10, sans = '600 12px "IBM Plex Sans", system-ui, sans-serif', mono = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      if (room < 16) return;
      ctx.font = sans; const name = names.find((n) => ctx.measureText(n).width <= room) || '', nw = name ? ctx.measureText(name).width : Infinity;
      ctx.font = mono; const pw = ctx.measureText(share).width;
      ctx.fillStyle = inkOn(fill); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (nw <= room && pw <= room) { ctx.font = sans; ctx.fillText(name, x0 + 6, y + BAR / 2 - 8); ctx.font = mono; ctx.fillText(share, x0 + 6, y + BAR / 2 + 9); }
      else if (pw <= room) ctx.fillText(share, x0 + 6, y + BAR / 2);
    }
    function draw() {
      const { ctx, w, h } = fit(canvas), g = geo(w), col = {}, ink = colour('--ink'), muted = colour('--muted'), bg = colour('--panel');
      for (const k in FAMV) col[k] = colour(FAMV[k]);
      ctx.clearRect(0, 0, w, h);
      items.forEach((it, i) => {
        const a0 = g.cx(it.c0), a1 = g.cx(it.c1), b0 = g.sx(it.s0), b1 = g.sx(it.s1);
        ctx.fillStyle = col[it.sec.fam]; ctx.globalAlpha = i === sel ? 0.65 : 0.17;
        ctx.beginPath(); ctx.moveTo(a0, g.y1); ctx.lineTo(a1, g.y1); ctx.lineTo(b1, g.y2); ctx.lineTo(b0, g.y2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillRect(a0, g.y0, Math.max(0.6, a1 - a0), BAR);
        ctx.fillRect(b0, g.y2, Math.max(0.6, b1 - b0), BAR);
        ctx.fillStyle = bg;                                      // a hairline between sections that are wide enough
        if (a1 - a0 > 4) ctx.fillRect(a1 - 0.5, g.y0, 1, BAR);
        if (b1 - b0 > 4) ctx.fillRect(b1 - 0.5, g.y2, 1, BAR);
      });
      for (const s of items) {
        tag(ctx, g.cx(s.c0), g.cx(s.c1), g.y0, SHORT[s.id] || [], pct(s.chars / C), col[s.sec.fam]);
        tag(ctx, g.sx(s.s0), g.sx(s.s1), g.y2, SHORT[s.id] || [], pct(s.steps / T), col[s.sec.fam]);
      }
      const it = items[sel], box = (x0, x1, y) => ctx.strokeRect(Math.max(1, x0), y + 1, Math.max(3, Math.min(w - 1, x1) - Math.max(1, x0)), BAR - 2);
      ctx.strokeStyle = ink; ctx.lineWidth = 2; box(g.cx(it.c0), g.cx(it.c1), g.y0); box(g.sx(it.s0), g.sx(it.s1), g.y2);
      for (const gr of groups) { bracket(ctx, g.cx(gr.c0), g.cx(gr.c1), g.y0 - 6, 1, gr.name, muted); bracket(ctx, g.sx(gr.s0), g.sx(gr.s1), g.y3 + 6, -1, gr.name, muted); }
    }
    function choose(i) {
      sel = Math.max(0, Math.min(items.length - 1, i)); draw();
      const it = items[sel], s = it.sec, once = s.group === items[0].sec.group;
      $('engGroup').textContent = s.group; $('engName').textContent = s.name; $('engDesc').textContent = s.desc;
      const facts = [[fmt(it.chars), 'characters: ' + pct(it.chars / C) + ' of the text'],
        once ? ['None', 'steps for a word piece: it runs once, before the first'] : [short(it.steps), 'steps for one word piece: ' + pct(it.steps / T) + ' of the work'],
        once ? null : [fmt(it.steps / it.chars), 'steps for every character of its text']].filter(Boolean);
      const f = $('engFacts'); f.textContent = '';
      for (const [v, l] of facts) { const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = l; dd.textContent = v; d.append(dt, dd); f.append(d); }
      $('engSay').textContent = 'Two bars, to scale: above, the ' + fmt(C) + ' characters of the engine of brnfck-qwen2.5-1.5b; below, the ' + fmt(T) + ' steps of one word piece. The chosen section, ' + s.name + ', is ' + pct(it.chars / C) + ' of the text and ' + pct(it.steps / T) + ' of the work. Left and right arrows choose another section.';
      $('engPrev').disabled = sel === 0; $('engNext').disabled = sel === items.length - 1;
    }
    // which section is under the pointer: at any height, along the band between the two bars
    function at(e) {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = geo(r.width);
      const f = y <= g.y1 ? 0 : y >= g.y2 ? 1 : (y - g.y1) / (g.y2 - g.y1);
      let best = 0, far = Infinity;
      items.forEach((it, i) => {
        const l = g.cx(it.c0) + (g.sx(it.s0) - g.cx(it.c0)) * f, rr = g.cx(it.c1) + (g.sx(it.s1) - g.cx(it.c1)) * f, d = x < l ? l - x : x > rr ? x - rr : 0;
        if (d < far) { far = d; best = i; }
      });
      return best;
    }
    let down = false;
    canvas.addEventListener('pointerdown', (e) => { if (e.button) return; down = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } const i = at(e); if (i !== sel) choose(i); });
    canvas.addEventListener('pointermove', (e) => { if (!down && e.pointerType !== 'mouse') return; const i = at(e); if (i !== sel) choose(i); });      // a mouse only has to point
    canvas.addEventListener('pointerup', () => { down = false; }); canvas.addEventListener('pointercancel', () => { down = false; });
    canvas.addEventListener('keydown', (e) => {
      const to = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: items.length - 1 }[e.key];
      if (to === undefined) return; e.preventDefault(); choose(to);
    });
    $('engPrev').addEventListener('click', () => choose(sel - 1));
    $('engNext').addEventListener('click', () => choose(sel + 1));
    new ResizeObserver(draw).observe(canvas);
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    choose(sel);
  });

  // ---- 3. One question, four programs ----
  // The answers are the ones the four programs print, checked at build time (compiler/*/out/ref*.json;
  // brnfck-qwen3.5-0.8b stops at its limit of 30 word pieces, its pieces as in compare/data/step.json); the times
  // are the middle of each range in the table of this page (brnfck-qwen3.5-0.8b: 2 min 10 s to 2 min 37 s, about
  // 5.6 s a piece). Reading a word piece of the question takes about as long as printing one.
  const RACE = [
    { label: 'brnfck-smollm2-135m', startup: 12.5, piece: 0.8, question: 13, answer: ['The', ' capital', ' of', ' France', ' is', ' Paris', '.'] },
    { label: 'brnfck-qwen2.5-0.5b', startup: 40, piece: 2.3, question: 12, answer: ['The', ' capital', ' of', ' France', ' is', ' Paris', '.'] },
    { label: 'brnfck-qwen2.5-1.5b', startup: 147, piece: 9, question: 12, answer: ['The', ' capital', ' of', ' France', ' is', ' Paris', '.'] },
    { label: 'brnfck-qwen3.5-0.8b', startup: 143.5, piece: 5.6, question: 19, answer: ['The', ' capital', ' of', ' France', ' is', ' **', 'Paris', '**.', '\n\n',
      'Located', ' in', ' the', ' heart', ' of', ' the', ' country', ',', ' Paris', ' is', ' the', ' largest', ' city', ' in', ' France', ' and', ' serves', ' as', ' the', ' seat', ' of'] },
  ];
  const clock = (s) => (s < 60 ? Math.floor(s) + ' s' : Math.floor(s / 60) + ' min ' + String(Math.floor(s % 60)).padStart(2, '0') + ' s');
  soon($('fig-race'), () => {
    const box = $('race'), end = Math.max(...RACE.map((r) => r.startup + (r.question + r.answer.length) * r.piece));
    const lanes = RACE.map((r) => {
      const total = r.startup + (r.question + r.answer.length) * r.piece;
      const lane = document.createElement('div'); lane.className = 'lane';
      lane.innerHTML = '<p class="who"><b></b><span class="when"></span></p><div class="track"><i class="on"></i><i class="tip"></i></div><p class="said"><span class="whole" aria-hidden="true"></span><span><span class="out"></span><span class="cursor"></span></span></p>';
      lane.querySelector('b').textContent = r.label;
      lane.querySelector('.whole').textContent = r.answer.join('') + '\u00a0';   // keeps the room of the whole answer and the cursor, so nothing below jumps
      // the three stretches of time, to scale: one gradient with hard edges
      const a = 100 * r.startup / end, b = 100 * (r.startup + r.question * r.piece) / end, c = 100 * total / end;
      const track = lane.querySelector('.track');
      track.style.setProperty('--bands', `linear-gradient(to right, var(--c-plus) 0 ${a}%, var(--c-in) ${a}% ${b}%, var(--c-out) ${b}% ${c}%, transparent ${c}%)`);
      box.append(lane);
      return { r, total, lane, track, out: lane.querySelector('.out'), when: lane.querySelector('.when') };
    });
    let speed = 10, t = 0, last = 0, raf = 0, running = false;
    function show() {
      for (const L of lanes) {
        const { r } = L, f = Math.min(t, L.total) / end;
        L.track.style.setProperty('--f', (100 * f) + '%');
        const printed = Math.max(0, Math.min(r.answer.length, Math.floor((t - r.startup - r.question * r.piece) / r.piece)));
        L.out.textContent = r.answer.slice(0, printed).join('');
        const phase = t >= L.total ? 'done' : t < r.startup ? 'load' : t < r.startup + r.question * r.piece ? 'read' : 'write';
        L.lane.dataset.phase = phase;
        L.when.textContent = phase === 'done' ? 'answered after ' + clock(L.total) : phase === 'load' ? 'writes the model into memory' : phase === 'read' ? 'reads the question' : 'prints the answer';
      }
      $('raceClock').textContent = clock(t) + ' of real time';
    }
    function frame(now) {
      t = Math.min(end, t + (now - last) / 1000 * speed); last = now; show();
      if (t < end) raf = requestAnimationFrame(frame); else { running = false; $('racePlay').textContent = 'Run again'; }
    }
    function play() { cancelAnimationFrame(raf); if (t >= end) t = 0; running = true; last = performance.now(); $('racePlay').textContent = 'Pause'; raf = requestAnimationFrame(frame); }
    function pause() { cancelAnimationFrame(raf); running = false; $('racePlay').textContent = 'Go on'; }
    $('racePlay').addEventListener('click', () => (running ? pause() : play()));
    for (const b of $('raceSpeed').children) b.addEventListener('click', () => {
      speed = Number(b.dataset.x);
      for (const o of $('raceSpeed').children) o.setAttribute('aria-pressed', String(o === b));
    });
    if (still) { t = end; show(); $('racePlay').textContent = 'Run again'; }
    else play();
  }, { threshold: 0.5 });                                    // the race starts when it can be watched

  // ---- 4. With pencil and paper: one run of each program, one step a second, on the calendar ----
  // The steps are those the project's interpreter counted for every word piece of a real run
  // (trace-*.json): each piece of the question read, each piece of the answer printed, and the last
  // one, which decides the answer is done. The bar of a run ends now and starts as many seconds ago as
  // the run has steps. Years are calendar years: below 1 they are BCE, and there is no year 0.
  const HAND = [
    { name: 'small', label: 'brnfck-smollm2-135m', file: 'trace-france.json' },
    { name: '0.5b', label: 'brnfck-qwen2.5-0.5b', file: 'trace-sum.json' },
    { name: '1.5b', label: 'brnfck-qwen2.5-1.5b', file: 'trace-sum.json' },
  ];
  const MARKS = [
    { bce: 9700, name: 'The last ice age ends' },
    { bce: 3200, name: 'The first writing' },
    { bce: 2560, name: 'The Great Pyramid' },
    { ce: 1450, name: 'The printing press' },
  ];
  const YEAR = 31556952, Y0 = 1 - 13000;                    // seconds in a year; the left end, 13,000 BCE
  const nowYear = () => 1970 + Date.now() / 1000 / YEAR;
  const yearOf = (m) => (m.bce ? 1 - m.bce : m.ce);
  // a calendar year as people write it, rounded as far as the measure allows
  const said = (a) => { const y = Math.round(a); if (y >= 1) return 'c. ' + y; const b = 1 - y, r = b >= 1000 ? Math.round(b / 10) * 10 : b; return 'c. ' + (r >= 10000 ? fmt(r) : String(r)) + ' BCE'; };
  const span = (years) => (years >= 10 ? fmt(years) + ' years' : years >= 1 ? years.toFixed(1) + ' years' : Math.round(years * 365.2425) + ' days');
  soon($('fig-hand'), async () => {
    let runs;
    try { runs = await Promise.all(HAND.map((h) => data(h.name, [h.file]).then(([T]) => ({ ...h, T })))); }
    catch (e) { $('fig-hand').hidden = true; return; }
    const box = $('hand'), now = nowYear(), x = (a) => 100 * (a - Y0) / (now - Y0);
    // the runs: each piece is a stretch of the bar, to scale, with the calendar years it covers
    for (const r of runs) {
      const T = r.T, P = T.positions, before = T.steps - P.reduce((a, p) => a + p.total, 0);
      r.start = now - T.steps / YEAR;
      let at = r.start + before / YEAR;
      r.pieces = P.map((p, i) => { const from = at; at += p.total / YEAR; return { p, i, from, to: at, kind: p.printed ? 'print' : i === P.length - 1 ? 'end' : 'read' }; });
      r.answer = P.map((p) => p.printed).join('');
    }
    box.innerHTML = '<div class="hand-marks"></div><div class="hand-axis"></div>';
    const marks = box.firstChild, axis = box.lastChild, guides = [];
    for (const m of MARKS) {
      const d = document.createElement('div'), g = document.createElement('i');
      d.className = 'hand-mark'; d.innerHTML = '<b></b><span></span>';
      d.firstChild.textContent = m.name; d.lastChild.textContent = m.bce ? 'c. ' + m.bce + ' BCE' : 'c. ' + m.ce;
      g.className = 'hand-guide'; marks.append(d); box.append(g); guides.push([m, d, g]);
    }
    const lanes = runs.map((r) => {
      const lane = document.createElement('div'); lane.className = 'hand-lane';
      lane.innerHTML = '<p class="who"><span><b></b> <q></q></span><span class="when"></span></p><div class="hand-track" tabindex="0"></div>';
      lane.querySelector('b').textContent = r.label;
      lane.querySelector('q').textContent = r.T.question;
      lane.querySelector('.when').textContent = span(r.T.steps / YEAR) + ', since ' + said(r.start);
      const track = lane.lastChild;
      track.setAttribute('aria-label', r.label + ': ' + r.pieces.length + ' word pieces, ' + span(r.T.steps / YEAR) + ' by hand');
      for (const q of r.pieces) { const s = document.createElement('i'); s.className = q.kind; s.style.left = x(q.from) + '%'; s.style.width = (x(q.to) - x(q.from)) + '%'; track.append(s); q.el = s; }
      box.append(lane);
      return { r, lane, track };
    });
    // what a piece is, or what a whole run is, in one sentence
    const say = $('handSay');
    function tell(r, q) {
      if (!q) {
        say.innerHTML = '<b></b> needed <b></b> steps for <q></q>, which it answered with <q></q>. At one step a second that is <b></b>: started <b></b>, it would end about now.';
        const b = say.querySelectorAll('b'), qs = say.querySelectorAll('q');
        b[0].textContent = r.label; b[1].textContent = fmt(r.T.steps); b[2].textContent = span(r.T.steps / YEAR); b[3].textContent = said(r.start);
        qs[0].textContent = r.T.question; qs[1].textContent = r.answer;
        return;
      }
      const what = q.kind === 'print' ? 'prints “' + q.p.printed.replace(/ /g, '␣') + '”' : q.kind === 'end' ? 'decides the answer is done and prints nothing' : 'reads a word piece of the question';
      say.innerHTML = '<b></b>, word piece <b></b> of <b></b>: it <span></span>. <b></b> steps, so <b></b> by hand, from <b></b> to <b></b>.';
      const b = say.querySelectorAll('b');
      b[0].textContent = r.label; b[1].textContent = q.i + 1; b[2].textContent = r.pieces.length; say.querySelector('span').textContent = what;
      b[3].textContent = fmt(q.p.total); b[4].textContent = span(q.p.total / YEAR); b[5].textContent = said(q.from); b[6].textContent = q.i === r.pieces.length - 1 ? 'now' : said(q.to);
    }
    let cur = null;
    function choose(L, i) {
      if (cur) cur.el.classList.remove('on');
      cur = L && i >= 0 ? L.r.pieces[i] : null;
      if (cur) { cur.el.classList.add('on'); tell(L.r, cur); } else tell(runs[0]);
    }
    for (const L of lanes) {
      const at = (e) => { const b = L.track.getBoundingClientRect(), a = Y0 + (e.clientX - b.left) / b.width * (now - Y0); let best = 0, far = Infinity; L.r.pieces.forEach((q, i) => { const d = a < q.from ? q.from - a : a > q.to ? a - q.to : 0; if (d < far) { far = d; best = i; } }); return best; };
      L.track.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') choose(L, at(e)); });
      L.track.addEventListener('pointerdown', (e) => choose(L, at(e)));
      L.track.addEventListener('focus', () => { if (!cur || !L.r.pieces.includes(cur)) choose(L, L.r.pieces.length - 1); });
      L.track.addEventListener('keydown', (e) => {
        const n = L.r.pieces.length, i = cur && L.r.pieces.includes(cur) ? cur.i : n - 1;
        const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
        if (to === undefined) return; e.preventDefault(); choose(L, Math.max(0, Math.min(n - 1, to)));
      });
    }
    box.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') choose(null); });
    // the events above the line, each in the first row where it does not touch another; the axis
    // under them with as many years as fit
    function layout() {
      const W = box.clientWidth, rows = [], ROW = 34;
      for (const [m, d, g] of guides) {
        const px = x(yearOf(m)) / 100 * W, w = d.offsetWidth + 10, right = px + w > W;
        const a = right ? px - w : px, b = right ? px : px + w;
        let row = rows.findIndex((busy) => busy.every(([u, v]) => b < u || a > v));
        if (row < 0) { row = rows.length; rows.push([]); }
        rows[row].push([a, b]);
        d.classList.toggle('right', right);
        d.style.left = right ? 'auto' : px + 'px'; d.style.right = right ? (W - px) + 'px' : 'auto';
        d.style.top = row * ROW + 'px'; d.dataset.row = row;
        g.style.left = px + 'px';
      }
      marks.style.height = rows.length * ROW + 4 + 'px';
      for (const [, d, g] of guides) g.style.top = (Number(d.dataset.row) * ROW + 31) + 'px';
      const step = [1000, 2000, 4000, 5000].find((s) => W / ((now - Y0) / s) >= 78) || 5000;
      axis.innerHTML = '';
      // ticks on round calendar years: v < 0 is that many years BCE; 0, which the calendar skips, is 1 CE
      for (let v = -Math.floor((1 - Y0) / step) * step; v < now; v += step) {
        const t = document.createElement('i'), l = document.createElement('span'), a = v < 0 ? v + 1 : v || 1;
        t.style.left = l.style.left = x(a) + '%';
        l.textContent = v < 0 ? (-v >= 10000 ? fmt(-v) : -v) + ' BCE' : v ? String(v) : '1 CE';
        axis.append(t, l);
      }
      const n = document.createElement('span'); n.className = 'now'; n.style.left = '100%'; n.textContent = 'now'; axis.append(n);
      // a year whose label would leave the figure or touch "now" keeps its tick only
      for (const l of axis.querySelectorAll('span:not(.now)')) { const px = parseFloat(l.style.left) / 100 * W, half = l.offsetWidth / 2; if (px - half < 0 || px + half > W - n.offsetWidth - 8) l.remove(); }
    }
    new ResizeObserver(layout).observe(box);
    layout();
    choose(null);
    $('handSum').textContent = runs.map((r) => r.label + ' needed ' + fmt(r.T.steps) + ' steps for "' + r.T.question + '": ' + span(r.T.steps / YEAR) + ' at one step a second, since ' + said(r.start) + '.').join(' ');
    // the clock of this page: steps a person would have done since it opened
    const tick = $('handTick');
    const count = () => { const s = Math.floor(performance.now() / 1000); tick.textContent = 'Since you opened this page, at one step a second: ' + fmt(s) + ' of the ' + fmt(runs[0].T.steps) + ' steps of ' + runs[0].label + '.'; };
    count(); setInterval(count, 1000);
  });
})();
