// The tape of a running program on the chat page: where each part of the model lies, what is written so far, the
// pointer, and which memory slots are filled. The worker reads the tape (runtime/peek.js); this file only draws.
(function () {
  'use strict';
  const INSIDE = new URL('../inside/', document.currentScript.src).href;
  const COLS = 1024;                                  // the tape is read in this many columns (Peek.fill)
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  const FAM = { cls: 'out', qkv: 'att', o: 'att', slots: 'mem', w13: 'ff', w2: 'ff', emb: 'emb', tokbytes: 'text', tokids: 'text', toktable: 'text', bias: 'tidy', scale: 'tidy', gain: 'tidy', glob: 'work', work: 'work' };
  const layerNo = (l) => 'layer ' + (l + 1);
  function title(r, m) {
    switch (r.kind) {
      case 'cls': return 'the output table, part ' + (r.layer + 1) + ' of ' + m.chunks;
      case 'qkv': return layerNo(r.layer) + ', attention weights';
      case 'o': return layerNo(r.layer) + ', attention output weights';
      case 'w13': return layerNo(r.layer) + ', feed-forward weights, widening';
      case 'w2': return layerNo(r.layer) + ', feed-forward weights, back';
      case 'slots': return layerNo(r.layer) + ', memory slots';
      case 'emb': return 'the table of word pieces';
      case 'tokbytes': case 'tokids': case 'toktable': return 'the vocabulary';
      case 'bias': case 'scale': case 'gain': return layerNo(r.layer) + ', a strip of constants';
      case 'glob': return 'the counters of the engine';
      default: return 'free cells';
    }
  }

  // ---- where everything lies: writer.json and engine.json of the program, wherever data-hosts.json says they are
  const cache = new Map();
  function layout(name) {
    if (cache.has(name)) return cache.get(name);
    const p = (async () => {
      const hosts = await fetch(INSIDE + 'data-hosts.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const base = hosts && typeof hosts[name] === 'string' && hosts[name] ? new URL(hosts[name], INSIDE).href : INSIDE + 'data/' + name + '/';
      const get = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error('could not load ' + base + f + ' (' + r.status + ')'); return r.json(); });
      const [W, E] = await Promise.all([get('writer.json'), get('engine.json')]);
      const m = E.model, S = E.slot, size = W.program.tape;
      const runs = W.regions.map((r) => ({ from: r.from, to: r.to, fam: FAM[r.kind] || 'work', title: title(r, m) })).sort((a, b) => a.from - b.from);
      const at = (cell) => { let lo = 0, hi = runs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (runs[mid].from <= cell) lo = mid; else hi = mid - 1; } return runs[lo]; };
      const cols = new Array(COLS);
      for (let i = 0; i < COLS; i++) cols[i] = at((i + 0.5) * size / COLS).fam;
      const slots = W.regions.filter((r) => r.kind === 'slots').sort((a, b) => a.layer - b.layer);
      return {
        name, size, runs, at, cols, layers: m.layers, positions: m.maxTokens, slotCells: S.size,
        watch: { cols: COLS, slots: { ends: slots.map((r) => r.to), size: S.size, positions: m.maxTokens, u: S.fields.U, ks: S.fields.KS, kv: S.kv } },
      };
    })();
    cache.set(name, p);
    p.catch(() => cache.delete(name));
    return p;
  }

  // ---- colours: the custom properties of the page, resolved (a canvas cannot read var())
  const probe = document.createElement('i');
  function colours() {
    if (!probe.isConnected) { probe.hidden = true; document.body.append(probe); }
    const c = {};
    for (const k of ['out', 'att', 'mem', 'ff', 'emb', 'text', 'tidy', 'work']) { probe.style.color = 'var(--k-' + k + ')'; c[k] = getComputedStyle(probe).color; }
    for (const [k, v] of [['ink', '--ink'], ['dim', '--hot'], ['answer', '--c-out'], ['fixed', '--rule']]) { probe.style.color = 'var(' + v + ')'; c[k] = getComputedStyle(probe).color; }
    return c;
  }
  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // The whole tape as one strip, to scale: pale where a part will lie, full colour where not zero; the mark: the pointer.
  function drawStrip(canvas, L, s) {
    const { ctx, w, h } = fit(canvas), col = colours(), top = 9, sh = h - top, cw = w / COLS;
    for (let i = 0; i < COLS; i++) {
      const lit = s.fill ? s.fill[i] === 1 : !!s.done;
      ctx.globalAlpha = lit ? 1 : 0.2;
      ctx.fillStyle = col[L.cols[i]];
      ctx.fillRect(i * cw, top, cw + 0.4, sh);
    }
    ctx.globalAlpha = 1;
    if (s.pointer !== undefined && s.pointer !== null && !s.done) {
      const x = Math.max(0.5, Math.min(w - 0.5, s.pointer / L.size * w));
      ctx.fillStyle = col.ink;
      ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 0.75, top, 1.5, sh);
    }
  }

  // The memory slots: a row per layer (layer 1 on top), a column per position. g: which columns hold the opening lines,
  // the question and the answer; newest: the column just filled; zoom: only the filled columns and a few more.
  const shownColumns = (L, g) => (g.zoom ? Math.min(L.positions, Math.max(32, (g.limit || 0) + 4)) : L.positions);
  function drawGrid(canvas, L, mem, g) {
    const { ctx, w, h } = fit(canvas), col = colours(), P = L.positions, cw = w / shownColumns(L, g), rh = h / L.layers;
    ctx.globalAlpha = 1; ctx.fillStyle = col.dim; ctx.fillRect(0, 0, w, h);
    if (!mem) return;
    for (let p = 0; p < Math.min(P, g.limit === undefined ? P : g.limit); p++) {
      const kind = p < g.fixed ? 'fixed' : p < g.question ? 'mem' : 'answer';
      ctx.fillStyle = col[kind];
      for (let l = 0; l < L.layers; l++) {
        const i = l * P + p;
        if (!mem.used[i]) continue;
        ctx.globalAlpha = 0.3 + 0.7 * mem.shade[i];
        ctx.fillRect(p * cw, l * rh, Math.max(1, cw - (cw > 3 ? 1 : 0)), Math.max(1, rh - 1));
      }
    }
    ctx.globalAlpha = 1;
    if (g.newest > 0) { ctx.strokeStyle = col.ink; ctx.lineWidth = 1.5; ctx.strokeRect(g.newest * cw - 1, 0.75, cw + 1, h - 1.5); }
  }
  // how many positions are filled: the highest filled column of the first layer, plus one
  const filled = (L, mem) => { let n = 0; for (let p = 0; p < L.positions; p++) if (mem.used[p]) n = p + 1; return n; };

  window.TapeView = { COLS, layout, drawStrip, drawGrid, shownColumns, filled, fmt };
})();
