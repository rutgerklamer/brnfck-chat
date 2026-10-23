// The figures of "Compare the models" (compare/index.html), from the recordings in data/ written by
// compiler/qwen3.5/compare/record.js, record-parts.js (step.json, attn.json) and shapes.js (shapes.json).
(function () {
  'use strict';
  var A = window.Article, el = A.el, fmt = A.fmt;
  var $ = function (id) { return document.getElementById(id); };
  var ASK = [['france', 'What is the capital of France?'], ['nl', 'Wat is de hoofdstad van Nederland?'], ['colours', 'Name three primary colors.']];
  var V = 'r4';                      // the version of data/*.json and live/*.js: raise it when one of them changes

  // ---- the recordings ------------------------------------------------------------------
  // record.js: per word piece and head of the 18 DeltaNet layers, table size, half-life, write strength, scale, folds
  var cache = {};
  var bytes = function (b64, Type) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return Type ? new Type(u.buffer) : u; };
  function load(key) {
    if (!cache[key]) cache[key] = fetch('data/' + key + '.json?v=' + V).then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }).then(function (J) {
      J.cells = J.layers.length * J.heads;
      J.normB = bytes(J.norm.data); J.halfB = bytes(J.half.data); J.betaB = bytes(J.beta); J.renormB = bytes(J.renorm); J.scaleB = bytes(J.scale);
      // each table drawn on its own scale: its 98th percentile of the stored numbers is full colour
      J.tables.forEach(function (T) {
        T.dataB = bytes(T.data, Int8Array);
        var a = Array.from(T.dataB, Math.abs).filter(function (v) { return v > 0; }).sort(function (x, y) { return x - y; });
        T.full = a.length ? Math.max(8, a[Math.floor(a.length * 0.98)]) : 127;
      });
      // the folds so far, per head: a running count
      J.folds = new Uint16Array((J.n + 1) * J.cells);
      for (var t = 0; t < J.n; t++) for (var i = 0; i < J.cells; i++) J.folds[(t + 1) * J.cells + i] = J.folds[t * J.cells + i] + J.renormB[t * J.cells + i];
      return J;
    });
    return cache[key];
  }
  // decoded values of head i (row * heads + head) after word piece t
  var size = function (J, t, i) { var q = J.normB[t * J.cells + i]; return q ? Math.pow(10, J.norm.lo + (q - 1) / 254 * (J.norm.hi - J.norm.lo)) : 0; };
  var halfLife = function (J, t, i) { var q = J.halfB[t * J.cells + i]; return q === 0 ? 0 : q === 255 ? Infinity : Math.pow(10, J.half.lo + (q - 1) / 254 * (J.half.hi - J.half.lo)); };
  var keeps = function (h) { return h === Infinity ? 1 : h === 0 ? 0 : Math.pow(0.5, 1 / h); };
  var scaleOf = function (J, t, i) { return 0.5 + J.scaleB[t * J.cells + i] / 510; };

  // numbers in words
  function num(v) {
    if (v === 0) return '0';
    if (v >= 100) return fmt(v);
    return v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(2);
  }
  function lifeWords(h) {
    if (h === Infinity) return 'never';
    if (h < 1) return 'within this word piece';
    if (h > 1e6) return 'after more than a million word pieces';
    return 'after ' + num(h) + ' word pieces';
  }
  function pct(v) { return v >= 0.99995 ? 'more than 99.99%' : v > 0.99 ? (100 * v).toFixed(2) + '%' : Math.round(100 * v) + '%'; }

  // ---- colours from the stylesheet --------------------------------------------------------
  var probe = el('i'); probe.hidden = true; document.body.append(probe);
  function rgb(v) { probe.style.color = 'var(' + v + ')'; var m = getComputedStyle(probe).color.match(/[\d.]+/g); return [Number(m[0]), Number(m[1]), Number(m[2])]; }
  var mix = function (a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  var css = function (c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; };
  var C = null;
  function colours() {
    var panel = rgb('--panel'), d1 = rgb('--d1'), d2 = rgb('--d2'), ink = rgb('--ink');
    var dark = document.documentElement.dataset.theme === 'dark';
    // pale -> blue -> deep: the size of a table
    var stops = [mix(panel, d1, 0.06), mix(panel, d1, 0.45), d1, mix(d1, dark ? ink : [0, 0, 0], dark ? 0.75 : 0.65)];
    C = {
      rgb: { panel: panel, ink: ink, d1: d1, d2: d2, d3: rgb('--d3'), d4: rgb('--d4'), d6: rgb('--d6') }, dark: dark, bg: css(rgb('--bg')),
      ink2: css(rgb('--ink-2')), d3: css(rgb('--d3')), d4: css(rgb('--d4')), d6: css(rgb('--d6')),
      panel: panel, ink: css(ink), muted: css(rgb('--muted')), line: css(rgb('--line')), sunk: css(rgb('--sunk')), go: css(rgb('--go')),
      d1: css(d1), d2: css(d2),
      seq: function (f) { f = Math.max(0, Math.min(1, f)) * (stops.length - 1); var k = Math.min(stops.length - 2, Math.floor(f)); return css(mix(stops[k], stops[k + 1], f - k)); },
      neg: function (f) { return css(mix(panel, d1, f)); },
      pos: function (f) { return css(mix(panel, d2, f)); }
    };
  }
  colours();

  function canvasFor(c, w, h) {
    var dpr = window.devicePixelRatio || 1;
    c.style.height = h + 'px';
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  var FONT = '500 12px "IBM Plex Mono", ui-monospace, monospace', FONT_B = '600 13px "IBM Plex Sans", system-ui, sans-serif';

  // ---- one recorded conversation, played: the shared part of the figures ------------------
  // o.draw(J, t): t = -1 before the first word piece; o.load(key): the figure's own recording; o.start(J): the first shown
  var THINK = /^<\/?think>$/;
  function player(fig, o) {
    var seg = fig.querySelector('.dn-ask'), text = fig.querySelector('.dn-text'), J = null, key = seg ? ASK[0][0] : 'one', t = -1, spans = [];
    var get = o.load || load;
    if (seg) ASK.forEach(function (a, i) {
      var b = el('button', '', a[1]); b.type = 'button'; b.dataset.k = a[0]; b.setAttribute('aria-pressed', String(i === 0));
      seg.append(b);
    });
    var sc = A.scrubber(fig.querySelector('.dn-play'), { max: 1, name: 'Word piece', rate: 6, show: function (k) { t = k - 1; show(); } });
    function show() {
      if (!J) return;
      spans.forEach(function (s, i) { s.hidden = i > t; s.classList.toggle('now', i === t); });
      // keep the marked word piece in view inside the box, without moving the page
      var now = spans[t];
      if (now) { var top = now.offsetTop - text.offsetTop; if (top < text.scrollTop || top + now.offsetHeight > text.scrollTop + text.clientHeight) text.scrollTop = top - text.clientHeight + now.offsetHeight + 8; }
      else text.scrollTop = 0;
      o.draw(J, t);
    }
    function pick(k) {
      key = k;
      if (seg) Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.k === k)); });
      sc.stop();
      get(k).then(function (D) {
        if (key !== k) return;
        J = D;
        // the chat template's own word pieces as boxes; the empty think block without its empty lines
        spans = J.pieces.map(function (p, i) {
          var chip = J.special[i] || THINK.test(p), gap = i > 0 && THINK.test(J.pieces[i - 1]) && /^\n+$/.test(p);
          var text = chip ? p.replace(/^<\|?|\|?>$/g, '') : gap ? (J.pieces[i - 1] === '</think>' ? '\n' : '') : p;
          var s = el('span', (chip ? 'sp' : i >= J.prompt ? 'ans' : 'ask') + (gap ? ' gap' : ''), text);
          s.addEventListener('click', function () { sc.stop(); sc.show(i + 1); });
          return s;
        });
        text.replaceChildren.apply(text, spans);
        sc.setMax(J.n);
        o.loaded(J);
        sc.show(Math.min(J.n, t < 0 ? (o.start ? o.start(J) : 0) : t + 1));
      }).catch(function () { o.failed(); });
    }
    if (seg) seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && b.dataset.k !== key) pick(b.dataset.k); });
    var started = false, start = function () { if (!started) { started = true; pick(key); } };
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '400px' }); io.observe(fig); } else start();
    var redraw = function () { if (J) o.draw(J, t); };
    new ResizeObserver(redraw).observe(fig);
    new MutationObserver(function () { colours(); redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return { get J() { return J; }, get t() { return t; }, go: function (k) { sc.stop(); sc.show(k); }, redraw: redraw };
  }

  // where word piece t stands, in words
  function where(J, t) {
    if (t < 0) return 'Nothing read yet: every table is empty.';
    var p = J.pieces[t].replace(/\n/g, '⏎').replace(/ /g, '␣');
    return (t < J.prompt ? 'Reading the question, word piece ' + (t + 1) + ' of ' + J.prompt : 'Writing the answer, word piece ' + (t + 1 - J.prompt) + ' of ' + (J.n - J.prompt)) + ': “' + p + '”. ';
  }

  // ---- 1. one layer that looks back, one DeltaNet layer: what each keeps -------------------
  (function () {
    if (!$('fig-grow')) return;
    var PER = 2048, FIXED = 786432;      // Qwen3.8-27B: 4 key-value heads of 256 numbers, keys and values; 48 heads of 128 x 128
    var s = A.slider('Word pieces in the conversation', 0, 60, 20, function (v) { return fmt(len(v)); });
    function len(v) { return Math.round(Math.pow(10, v / 12)); }   // 1 .. 100,000
    $('w-ctl').append(s.label);
    var rows = [['Qwen3.8-27B, one layer that looks back', 'bar b2'], ['Qwen3.8-27B, one DeltaNet layer', 'bar']].map(function (r) {
      var lab = el('span', 'name', r[0]), track = el('span', 'track'), bar = el('span', r[1]), val = el('span', 'val');
      track.append(bar); $('w-bars').append(lab, track, val);
      return { bar: bar, val: val };
    });
    function draw() {
      var n = len(Number(s.input.value)), a = n * PER, b = FIXED, top = Math.max(a, b);
      rows[0].bar.style.width = (100 * a / top) + '%'; rows[0].val.textContent = fmt(a);
      rows[1].bar.style.width = (100 * b / top) + '%'; rows[1].val.textContent = fmt(b);
      s.show();
      $('w-said').textContent = n < 384 ? 'At ' + fmt(n) + (n === 1 ? ' word piece' : ' word pieces') + ', a layer of Qwen3.8-27B that looks back keeps ' + fmt(a) + ' numbers: ' + (b / a >= 10 ? fmt(b / a) : (b / a).toFixed(1)) + ' times fewer than one of its DeltaNet layers.'
        : n === 384 ? 'At 384 word pieces, both layers of Qwen3.8-27B keep 786,432 numbers.'
          : 'At ' + fmt(n) + ' word pieces, a layer of Qwen3.8-27B that looks back keeps ' + fmt(a) + ' numbers: ' + (a / b >= 10 ? fmt(a / b) : (a / b).toFixed(1)) + ' times as many as one of its DeltaNet layers, which still keeps 786,432.';
    }
    s.input.addEventListener('input', draw);
    draw();
  })();

  // ---- 2. two tables, 32 x 32 of their 128 x 128 ------------------------------------------
  (function () {
    var fig = $('fig-table'); if (!fig) return;
    var canvas = fig.querySelector('.dn-tables'), tell = fig.querySelector('.tell');
    var NAME = ['Forgets fast', 'Keeps'];
    var P = player(fig, {
      loaded: function () {}, failed: function () { tell.textContent = 'The recording could not be loaded.'; },
      draw: function (J, t) {
        var W = canvas.clientWidth, gap = W < 480 ? 12 : 28, side = Math.min(320, Math.floor((W - gap) / 2)), cell = side / J.side;
        var LAB = 22, SUB = W < 480 ? 34 : 20, H = LAB + side + SUB;
        var ctx = canvasFor(canvas, W, H), N = J.side * J.side;
        J.tables.forEach(function (T, k) {
          var x0 = k * (side + gap), at = t * N;
          ctx.fillStyle = C.sunk; ctx.fillRect(x0, LAB, side, side);
          for (var y = 0; y < J.side; y++) for (var x = 0; x < J.side; x++) {
            var v = t < 0 ? 0 : T.dataB[at + y * J.side + x];
            ctx.fillStyle = v > 0 ? C.pos(Math.min(1, v / T.full)) : v < 0 ? C.neg(Math.min(1, -v / T.full)) : css(C.panel);
            ctx.fillRect(x0 + x * cell, LAB + y * cell, Math.ceil(cell) - (cell > 4 ? 0.5 : 0), Math.ceil(cell) - (cell > 4 ? 0.5 : 0));
          }
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, LAB + 0.5, side - 1, side - 1);
          ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
          ctx.font = FONT_B; ctx.fillStyle = C.ink; ctx.fillText(NAME[k], x0, LAB - 7);
          ctx.font = FONT; ctx.fillStyle = C.muted;
          var i = T.row * J.heads + T.head, hl = t < 0 ? null : halfLife(J, t, i), lines = ['layer ' + T.layer + ', head ' + T.head, hl === null ? '' : 'half-life ' + (hl === Infinity ? 'endless' : num(hl))];
          if (W < 480) { ctx.fillText(lines[0], x0, LAB + side + 15); ctx.fillText(lines[1], x0, LAB + side + 30); }
          else ctx.fillText(lines[0] + (lines[1] ? ' · ' + lines[1] : ''), x0, LAB + side + 15);
        });
        canvas.setAttribute('aria-label', 'Two tables of 32 by 32 squares, after ' + (t + 1) + ' word pieces');
        tell.replaceChildren(where(J, t));
        if (t >= 0) {
          var a = J.tables[0], b = J.tables[1], ia = a.row * J.heads + a.head, ib = b.row * J.heads + b.head;
          tell.append('The left head keeps ', el('b', '', pct(keeps(halfLife(J, t, ia)))), ' of its table and writes with strength ', el('b', '', (J.betaB[t * J.cells + ia] / 255).toFixed(2)),
            '; the right one keeps ', el('b', '', pct(keeps(halfLife(J, t, ib)))), ' and writes with ', el('b', '', (J.betaB[t * J.cells + ib] / 255).toFixed(2)), '.');
        }
      }
    });
  })();

  // ---- the map of the heads, shared by the recorded and the live figure ------------------------
  // a row of squares per DeltaNet layer, a thin row per layer that looks back; value(i): 0 .. 1 or null if empty; ring(i): a fold
  function paintMap(map, layers, heads, sel, value, ring) {
    var W = map.parentNode.clientWidth, LABW = 34, cell = Math.max(10, Math.min(26, Math.floor((W - LABW) / heads))), THIN = Math.max(6, Math.round(cell / 3));
    var all = layers[layers.length - 1] + 1, rows = [], y = 0;
    for (var l = 0; l < all; l++) { var r = layers.indexOf(l); rows.push({ l: l, r: r, y: y, h: r < 0 ? THIN : cell }); y += (r < 0 ? THIN : cell); }
    var ctx = canvasFor(map, LABW + heads * cell, y);
    map.style.width = (LABW + heads * cell) + 'px';
    ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    rows.forEach(function (row) {
      if (row.r < 0) { ctx.fillStyle = C.sunk; ctx.fillRect(LABW, row.y + 1, heads * cell, row.h - 2); return; }
      ctx.fillStyle = C.muted; ctx.fillText(String(row.l), 4, row.y + cell / 2 + 1);
      for (var h = 0; h < heads; h++) {
        var i = row.r * heads + h, f = value(i);
        ctx.fillStyle = C.seq(f === null ? 0 : f);
        ctx.fillRect(LABW + h * cell + 1, row.y + 1, cell - 2, cell - 2);
        if (f === null) { ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(LABW + h * cell + 1.5, row.y + 1.5, cell - 3, cell - 3); }   // an empty table
        if (ring(i)) {
          ctx.strokeStyle = C.go; ctx.lineWidth = Math.max(1.5, cell / 9);
          ctx.beginPath(); ctx.arc(LABW + h * cell + cell / 2, row.y + cell / 2, cell / 2 - ctx.lineWidth / 2 - 1, 0, 2 * Math.PI); ctx.stroke();
        }
      }
    });
    if (sel >= 0) {
      var sr = rows.filter(function (row) { return row.r === Math.floor(sel / heads); })[0], sh = sel % heads;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(LABW + sh * cell - 0.5, sr.y - 0.5, cell + 1, cell + 1);
    }
    return { LABW: LABW, cell: cell, rows: rows };
  }
  // the head under a click, or -1
  function pickMap(map, geo, heads, e) {
    if (!geo) return -1;
    var b = map.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, h = Math.floor((x - geo.LABW) / geo.cell);
    var row = geo.rows.filter(function (r) { return y >= r.y && y < r.y + r.h; })[0];
    return !row || row.r < 0 || h < 0 || h >= heads ? -1 : row.r * heads + h;
  }
  // the head an arrow key moves to, or -1
  function keyMap(e, sel, rowsN, heads) {
    var d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!d) return -1;
    e.preventDefault();
    var r = Math.max(0, Math.min(rowsN - 1, Math.floor(sel / heads) + d[0])), h = Math.max(0, Math.min(heads - 1, sel % heads + d[1]));
    return r * heads + h;
  }

  // ---- 3. the map of all heads, and one head through the conversation -------------------------
  (function () {
    var fig = $('fig-heads'); if (!fig) return;
    var map = fig.querySelector('.dn-map'), hist = fig.querySelector('.dn-hist'), who = fig.querySelector('.dn-who'), said = fig.querySelector('.dn-said');
    var sel = null, geo = null;
    var P = player(fig, {
      loaded: function (J) {
        if (sel === null) sel = J.tables[0].row * J.heads + J.tables[0].head;
        fig.querySelector('.dn-lo').textContent = num(Math.pow(10, J.norm.lo));
        fig.querySelector('.dn-hi').textContent = num(Math.pow(10, J.norm.hi));
        var ramp = []; for (var f = 0; f <= 1.0001; f += 0.125) ramp.push(C.seq(f));
        fig.querySelector('.dn-ramp').style.background = 'linear-gradient(90deg,' + ramp.join(',') + ')';
      },
      failed: function () { said.textContent = 'The recording could not be loaded.'; },
      draw: function (J, t) { drawMap(J, t); drawHead(J, t); }
    });

    function drawMap(J, t) {
      geo = paintMap(map, J.layers, J.heads, sel, function (i) { var q = t < 0 ? 0 : J.normB[t * J.cells + i]; return q ? (q - 1) / 254 : null; },
        function (i) { return t >= 0 && J.renormB[t * J.cells + i]; });
      map.setAttribute('aria-label', 'The tables of 288 heads after ' + (t + 1) + ' word pieces. Chosen: layer ' + J.layers[Math.floor(sel / J.heads)] + ', head ' + (sel % J.heads) + '.');
    }
    map.addEventListener('click', function (e) { var J = P.J, i = J ? pickMap(map, geo, J.heads, e) : -1; if (i >= 0) { sel = i; P.redraw(); } });
    map.addEventListener('keydown', function (e) { var J = P.J, i = J ? keyMap(e, sel, J.layers.length, J.heads) : -1; if (i >= 0) { sel = i; P.redraw(); } });

    // the chosen head through the whole conversation: its size above, its scale below, a line at now
    function drawHead(J, t) {
      var r = Math.floor(sel / J.heads), h = sel % J.heads, W = hist.clientWidth, PADL = 4, H1 = 84, GAP = 30, H2 = 56, TOP = 18;
      var ctx = canvasFor(hist, W, TOP + H1 + GAP + H2 + 18), n = J.n, X = function (k) { return PADL + (k + 0.5) / n * (W - PADL); };
      // the question in grey under both charts
      ctx.fillStyle = C.sunk; ctx.fillRect(PADL, TOP, X(J.prompt - 0.5) - PADL, H1); ctx.fillRect(PADL, TOP + H1 + GAP, X(J.prompt - 0.5) - PADL, H2);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.strokeRect(PADL + 0.5, TOP + 0.5, W - PADL - 1, H1 - 1); ctx.strokeRect(PADL + 0.5, TOP + H1 + GAP + 0.5, W - PADL - 1, H2 - 1);
      // size, on the log scale of the map
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        var q = J.normB[k * J.cells + sel], yy = TOP + H1 - 2 - (q ? (q - 1) / 254 : 0) * (H1 - 6);
        if (k) ctx.lineTo(X(k), yy); else ctx.moveTo(X(k), yy);
      }
      ctx.strokeStyle = C.d1; ctx.lineWidth = 2; ctx.stroke();
      // scale: 1/2 at the bottom, 1 at the top; the folds as yellow ticks
      var y2 = TOP + H1 + GAP, Y2 = function (s) { return y2 + 3 + (1 - s) * 2 * (H2 - 6); };
      ctx.fillStyle = C.go;
      for (k = 0; k < n; k++) if (J.renormB[k * J.cells + sel]) ctx.fillRect(X(k) - 1.5, y2 + 1, 3, H2 - 2);
      ctx.beginPath();
      for (k = 0; k < n; k++) { var s = scaleOf(J, k, sel); if (k) ctx.lineTo(X(k), Y2(s)); else ctx.moveTo(X(k), Y2(s)); }
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
      // now
      if (t >= 0) { ctx.fillStyle = C.ink; ctx.fillRect(X(t) - 1, TOP - 4, 2, H1 + GAP + H2 + 4); }
      ctx.font = FONT; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
      ctx.fillText('Size of the table', PADL, TOP - 6);
      ctx.fillText('Scale: 1 at the top, ½ at the bottom', PADL, y2 - 6);
      ctx.fillText('question', PADL + 3, TOP + H1 + GAP + H2 + 14);
      ctx.textAlign = 'right'; ctx.fillText('answer', W, TOP + H1 + GAP + H2 + 14);
      hist.setAttribute('aria-label', 'Layer ' + J.layers[r] + ', head ' + h + ': the size of its table and its scale over all ' + n + ' word pieces');

      who.replaceChildren(el('b', '', 'Layer ' + J.layers[r] + ', head ' + h), ' (click another square)');
      said.replaceChildren(where(J, t));
      if (t < 0) return;
      var hl = halfLife(J, t, sel), folds = J.folds[(t + 1) * J.cells + sel];
      said.append('This head keeps ', el('b', '', pct(keeps(hl))), ' of its table (half of it is gone ' + lifeWords(hl) + '), writes with strength ',
        el('b', '', (J.betaB[t * J.cells + sel] / 255).toFixed(2)), ' and holds ', el('b', '', num(size(J, t, sel))), '. ',
        J.renormB[t * J.cells + sel] ? 'Its scale fell below ½ and was folded in. ' : '', 'Folded in ', el('b', '', folds === 1 ? 'once' : fmt(folds) + ' times'), ' so far.');
    }
    hist.addEventListener('click', function (e) {
      var J = P.J; if (!J) return;
      var b = hist.getBoundingClientRect(), k = Math.floor((e.clientX - b.left - 4) / (b.width - 4) * J.n);
      P.go(Math.max(1, Math.min(J.n, k + 1)));
    });
  })();

  // ---- the shapes of SmolLM2-135M, Qwen2.5-0.5B, Qwen2.5-1.5B and Qwen3.5-0.8B (data/shapes.json, compiler/qwen3.5/compare/shapes.js) ---
  var shapes = null;
  function loadShapes() { if (!shapes) shapes = fetch('data/shapes.json?v=' + V).then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }); return shapes; }
  function whenNear(fig, start) {
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '400px' }); io.observe(fig); } else start();
  }
  function onTheme(fn) { new MutationObserver(function () { colours(); fn(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); }
  var millions = function (n) { return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + ' million'; };
  // text on a coloured block
  var onRGB = function (c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55 ? '#111' : '#fff'; };

  // ---- A. Qwen2.5-0.5B and Qwen3.5-0.8B to scale: every weight the same room ------------------------------
  (function () {
    var fig = $('fig-stack'); if (!fig) return;
    var canvas = fig.querySelector('canvas'), tell = fig.querySelector('.tell'), D = null, geo = [], sel = 3;
    var PARTS = { att: ['q', 'gate', 'k', 'v', 'o', 'bias', 'qknorm'], lin: ['qkv', 'z', 'ab', 'conv', 'small', 'o'] };
    var WORDS = { q: 'questions', gate: 'output gate', k: 'keys', v: 'values', o: 'output', bias: 'bias', qknorm: 'norms of question and key',
      qkv: 'questions, keys and values', z: 'gate after the table', ab: 'decay and write strength', conv: 'window', small: 'the rest' };
    function kindColour(k) { return k === 'att' ? C.d2 : k === 'lin' ? C.d1 : k === 'ffn' ? C.d3 : C.d4; }
    function draw() {
      if (!D) return;
      var ms = [D.models[1], D.models[3]], W = canvas.clientWidth, narrow = W < 560;
      var LABW = 24, gap = narrow ? 14 : 40, colW = Math.min(300, Math.floor((W - 2 * LABW - gap) / 2)), HEAD = 46;
      var top = Math.max(ms[0].total, ms[1].total), Hmax = narrow ? 460 : 560, k = Hmax / top;
      var ctx = canvasFor(canvas, W, HEAD + Hmax + 6);
      geo = [];
      ms.forEach(function (m, c) {
        var x0 = LABW + c * (LABW + colW + gap), y = HEAD, rows = [];
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.font = FONT_B; ctx.fillStyle = C.ink; ctx.fillText(m.name, x0, 16);
        ctx.font = FONT; ctx.fillStyle = C.muted; ctx.fillText(fit(ctx, [millions(m.total) + ' weights', millions(m.total)], W - x0), x0, 33);
        // the table of word pieces: in at the start, out at the end
        var h = m.emb * k;
        ctx.fillStyle = C.d4; ctx.fillRect(x0, y, colW, h - 1);
        ctx.fillStyle = onRGB(C.rgb.d4); ctx.font = FONT;
        var lines = narrow ? ['Word pieces', fmt(m.vocab) + ' × ' + fmt(m.dim)] : ['Table of word pieces', fmt(m.vocab) + ' × ' + fmt(m.dim) + ', in and out'];
        lines.forEach(function (s, i) { ctx.fillText(s, x0 + 6, y + 16 + i * 15); });
        rows.push({ y: y, h: h, l: -1 });
        if (sel === -1) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x0 - 1, y - 1, colW + 2, h + 1); }
        y += h;
        m.layers.forEach(function (L, l) {
          var hh = (L.mixer + L.ffn + L.norm) * k, wm = colW * L.mixer / (L.mixer + L.ffn + L.norm), x = x0;
          // the parts of the mixer, side by side, with a thin line between them
          PARTS[L.kind].forEach(function (p) {
            var n = L.parts[p]; if (!n) return;
            var w = colW * n / (L.mixer + L.ffn + L.norm);
            ctx.fillStyle = kindColour(L.kind); ctx.fillRect(x, y, w, hh - 1);
            if (w > 3) { ctx.fillStyle = css(C.panel); ctx.globalAlpha = 0.55; ctx.fillRect(x + w - 1, y, 1, hh - 1); ctx.globalAlpha = 1; }
            x += w;
          });
          ctx.fillStyle = C.d3; ctx.fillRect(x0 + wm, y, colW - wm, hh - 1);
          if (hh >= 9) { ctx.fillStyle = C.muted; ctx.font = (hh >= 12 ? '500 11px' : '500 9px') + ' "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(l), x0 - 5, y + hh / 2); ctx.textAlign = 'left'; }
          if (l === sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x0 - 1, y - 1, colW + 2, hh + 1); }
          rows.push({ y: y, h: hh, l: l });
          y += hh;
        });
        geo.push({ x0: x0, w: colW, rows: rows });
      });
      canvas.setAttribute('aria-label', 'Qwen2.5-0.5B and Qwen3.5-0.8B, every weight drawn the same size: the table of word pieces, then 24 layers each');
      say();
    }
    function parts(m, L) {
      return PARTS[L.kind].filter(function (p) { return L.parts[p]; }).map(function (p) { return WORDS[p] + ' ' + fmt(L.parts[p]); }).join(', ');
    }
    function say() {
      var ms = [D.models[1], D.models[3]];
      if (sel === -1) {
        tell.replaceChildren('The table of word pieces. ', el('b', '', ms[0].name), ': ' + fmt(ms[0].vocab) + ' word pieces of ' + fmt(ms[0].dim) + ' numbers, ' + millions(ms[0].emb) + ' weights. ',
          el('b', '', ms[1].name), ': ' + fmt(ms[1].vocab) + ' of ' + fmt(ms[1].dim) + ', ' + millions(ms[1].emb) + '. Both use it twice: to look up the word piece that comes in, and to score every word piece that could come next.');
        return;
      }
      tell.replaceChildren('Layer ' + sel + '. ');
      ms.forEach(function (m) {
        var L = m.layers[sel];
        tell.append(el('b', '', m.name), ': ' + (L.kind === 'att' ? 'looks back' : 'DeltaNet') + ', ' + fmt(L.mixer) + ' weights to mix in the past (' + parts(m, L) + ') and ' + fmt(L.ffn) + ' in the feed-forward part. ');
      });
    }
    function pick(e) {
      var b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      for (var c = 0; c < geo.length; c++) {
        var g = geo[c]; if (x < g.x0 - 24 || x > g.x0 + g.w) continue;
        for (var i = 0; i < g.rows.length; i++) if (y >= g.rows[i].y && y < g.rows[i].y + g.rows[i].h) return g.rows[i].l;
      }
      return null;
    }
    canvas.addEventListener('click', function (e) { var l = pick(e); if (l !== null) { sel = l; draw(); } });
    canvas.addEventListener('keydown', function (e) {
      var d = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!d || !D) return;
      e.preventDefault(); sel = Math.max(-1, Math.min(D.models[3].layers.length - 1, sel + d)); draw();
    });
    whenNear(fig, function () { loadShapes().then(function (J) { D = J; draw(); }).catch(function () { tell.textContent = 'The shapes could not be loaded.'; }); });
    new ResizeObserver(draw).observe(fig);
    onTheme(draw);
  })();

  // ---- B. what SmolLM2-135M, Qwen2.5-0.5B, Qwen2.5-1.5B and Qwen3.5-0.8B keep, and what a word piece costs, against the length ---
  (function () {
    var fig = $('fig-cost'); if (!fig) return;
    var canvas = fig.querySelector('canvas'), tell = fig.querySelector('.tell'), read = fig.querySelector('.dn-read'), seg = fig.querySelector('.dn-view');
    var D = null, view = 'keep', MAXV = 72;
    var len = function (v) { return Math.round(Math.pow(2, v / 4)); };   // 1 .. 262,144
    var s = A.slider('Word pieces in the conversation', 0, MAXV, 32, function (v) { return fmt(len(v)); });
    fig.querySelector('.dn-len').append(s.label);
    var COL = ['--d6', '--d2', '--d4', '--d1'];
    function value(m, n) {
      return view === 'keep' ? m.keep.perPiece * n + m.keep.tables + m.keep.window : m.work.weights + m.work.tables + m.work.perPiece * n;
    }
    function draw() {
      if (!D) return;
      var W = canvas.clientWidth, narrow = W < 560, PADL = 38, PADR = narrow ? 8 : 112, PADT = 14, PADB = 30, H = narrow ? 260 : 320;
      var ctx = canvasFor(canvas, W, H), n = len(Number(s.input.value));
      var X0 = 0, X1 = 18 * Math.LN2 / Math.LN10, ys = view === 'keep' ? [3, 10] : [8, 11];
      var X = function (v) { return PADL + (Math.log10(v) - X0) / (X1 - X0) * (W - PADL - PADR); };
      var Y = function (v) { return PADT + (1 - (Math.log10(v) - ys[0]) / (ys[1] - ys[0])) * (H - PADT - PADB); };
      ctx.font = FONT; ctx.lineWidth = 1;
      // the grid: powers of ten
      ctx.strokeStyle = C.line; ctx.fillStyle = C.muted; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      for (var e = ys[0]; e <= ys[1]; e++) { var yy = Math.round(Y(Math.pow(10, e))) + 0.5; ctx.beginPath(); ctx.moveTo(PADL, yy); ctx.lineTo(W - PADR, yy); ctx.stroke(); ctx.fillText('10' + sup(e), PADL - 6, yy); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [1, 10, 100, 1000, 10000, 100000].forEach(function (v) { var xx = Math.round(X(v)) + 0.5; ctx.beginPath(); ctx.moveTo(xx, PADT); ctx.lineTo(xx, H - PADB); ctx.stroke(); ctx.fillText(v >= 1000 ? fmt(v / 1000) + 'k' : String(v), xx, H - PADB + 6); });
      // the programs stop at 256 word pieces
      var x256 = Math.round(X(256)) + 0.5;
      ctx.strokeStyle = C.muted; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x256, PADT); ctx.lineTo(x256, H - PADB); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = C.muted; ctx.fillText(narrow ? '256' : 'the chat programs: 256', x256 + 4, PADT + 2);
      // one line per model
      D.models.forEach(function (m, i) {
        ctx.strokeStyle = css(rgb(COL[i])); ctx.lineWidth = i === 3 ? 3 : 2;
        ctx.beginPath();
        for (var k = 0; k <= 180; k++) { var v = Math.pow(2, k / 10), xx = X(v), yy = Y(value(m, v)); if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
        ctx.stroke();
      });
      // the names at the right end, pushed apart where the lines meet
      if (!narrow) {
        var ends = D.models.map(function (m, i) { return { i: i, y: Y(value(m, 262144)) }; }).sort(function (a, b) { return a.y - b.y; });
        for (var j = 1; j < ends.length; j++) ends[j].y = Math.max(ends[j].y, ends[j - 1].y + 14);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ends.forEach(function (e) { ctx.fillStyle = css(rgb(COL[e.i])); ctx.fillText(D.models[e.i].name, W - PADR + 6, e.y); });
      }
      // now
      var xn = X(n);
      ctx.fillStyle = C.ink; ctx.fillRect(xn - 1, PADT, 2, H - PADT - PADB);
      D.models.forEach(function (m, i) { ctx.beginPath(); ctx.arc(xn, Y(value(m, n)), 4, 0, 2 * Math.PI); ctx.fillStyle = css(rgb(COL[i])); ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.stroke(); });
      canvas.setAttribute('aria-label', (view === 'keep' ? 'Numbers kept of the past' : 'Multiplications per word piece') + ' against the length of the conversation, for SmolLM2-135M, Qwen2.5-0.5B, Qwen2.5-1.5B and Qwen3.5-0.8B, at ' + fmt(n) + ' word pieces');
      // the readout, which is also the key
      read.replaceChildren.apply(read, D.models.map(function (m, i) {
        var row = el('span', 'r' + (i === 3 ? ' me' : '')), sw = el('i', 'sw');
        sw.style.backgroundColor = 'var(' + COL[i] + ')';
        row.append(sw, el('span', 'n', m.name + ' · ' + m.program), el('span', 'v', fmt(value(m, n))));
        return row;
      }));
      s.show();
      var me = D.models[3], half = D.models[1];
      if (view === 'keep') {
        var more = D.models.filter(function (m, i) { return i < 3 && value(m, n) > value(me, n); }).map(function (m) { return m.name; });
        tell.textContent = 'At ' + fmt(n) + (n === 1 ? ' word piece' : ' word pieces') + ', Qwen3.5-0.8B keeps ' + fmt(value(me, n)) + ' numbers: ' + fmt(me.keep.tables + me.keep.window) + ' in its DeltaNet layers, whatever the length, and ' +
          fmt(me.keep.perPiece * n) + ' in its 6 layers that look back. ' + (more.length ? more.join(' and ') + (more.length === 1 ? ' keeps' : ' keep') + ' more.' : D.models.slice(0, 3).map(function (m) { return m.name; }).join(', ').replace(/, ([^,]*)$/, ' and $1') + ' each keep less.');
      } else {
        var back = me.work.perPiece * n, rest = me.work.weights + me.work.tables;
        tell.textContent = 'At ' + fmt(n) + (n === 1 ? ' word piece' : ' word pieces') + ', a new word piece of Qwen3.5-0.8B takes ' + fmt(rest + back) + ' multiplications. Looking back is ' + fmt(back) + ' of them (' +
          (100 * back / (rest + back) < 1 ? (100 * back / (rest + back)).toFixed(2) : Math.round(100 * back / (rest + back))) + '%); for Qwen2.5-0.5B it is ' + fmt(half.work.perPiece * n) + '.';
      }
    }
    function sup(e) { return String(e).split('').map(function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]; }).join(''); }
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      view = b.dataset.v;
      Array.prototype.forEach.call(seg.children, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      draw();
    });
    s.input.addEventListener('input', draw);
    whenNear(fig, function () { loadShapes().then(function (J) { D = J; draw(); }).catch(function () { tell.textContent = 'The shapes could not be loaded.'; }); });
    new ResizeObserver(draw).observe(fig);
    onTheme(draw);
  })();

  // 16-bit numbers with one scale per vector (compiler/qwen3.5/compare/record-parts.js)
  function unpack(p, len) {
    var d = bytes(p.data, Int16Array);
    return p.scale.map(function (s, t) { var v = new Float64Array(len); for (var i = 0; i < len; i++) v[i] = d[t * len + i] / 32767 * s; return v; });
  }
  function oneRecording(file, prep) {
    var got = null;
    return function () {
      if (!got) got = fetch('data/' + file + '?v=' + V).then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }).then(function (J) { prep(J); return J; });
      return got;
    };
  }
  // colour of a signed number on a square-root scale: orange above zero, blue below
  function signed(v, full, out, at) {
    var f = Math.min(1, Math.sqrt(Math.abs(v) / full)), c = v >= 0 ? C.rgb.d2 : C.rgb.d1, p = C.rgb.panel;
    out[at] = p[0] + (c[0] - p[0]) * f; out[at + 1] = p[1] + (c[1] - p[1]) * f; out[at + 2] = p[2] + (c[2] - p[2]) * f; out[at + 3] = 255;
  }
  var off = document.createElement('canvas');
  // a table of side x side numbers, drawn into a square of s pixels
  function paintTable(ctx, M, side, full, x, y, s) {
    off.width = side; off.height = side;
    var o = off.getContext('2d'), img = o.createImageData(side, side);
    for (var i = 0; i < side * side; i++) signed(M[i], full, img.data, 4 * i);
    o.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, x, y, s, s);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }
  function paintStrip(ctx, v, full, x, y, w, h) {
    var n = v.length, px = [0, 0, 0, 0];
    for (var i = 0; i < n; i++) {
      signed(v[i], full, px, 0);
      ctx.fillStyle = 'rgb(' + Math.round(px[0]) + ',' + Math.round(px[1]) + ',' + Math.round(px[2]) + ')';
      var a = Math.floor(x + i * w / n), b = Math.floor(x + (i + 1) * w / n);
      ctx.fillRect(a, y, Math.max(1, b - a), h);
    }
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(Math.floor(x) + 0.5, y + 0.5, Math.round(w) - 1, h - 1);
  }
  // the longest label that fits
  function fit(ctx, texts, w) { for (var i = 0; i < texts.length; i++) if (ctx.measureText(texts[i]).width <= w) return texts[i]; return texts[texts.length - 1]; }

  // ---- C. one head, one word piece, step by step (data/step.json) ----------------------------------------
  (function () {
    var fig = $('fig-step'); if (!fig) return;
    var canvas = fig.querySelector('.dn-steps'), tell = fig.querySelector('.tell'), hseg = fig.querySelector('.dn-hpick'), who = 0;
    var get = oneRecording('step.json', function (J) {
      J.heads.forEach(function (H) {
        var dk = J.dk, dv = J.dv, k = unpack(H.k, dk), v = unpack(H.v, dv), q = unpack(H.q, dk), z = unpack(H.z, dv);
        // the table rebuilt word piece by word piece, as the head does it
        var T = new Float64Array(dk * dv);
        H.steps = [];
        for (var t = 0; t < J.n; t++) {
          var g = H.decay[t], b = H.beta[t], before = Float32Array.from(T), u = new Float64Array(dv), d = new Float64Array(dv), r = new Float64Array(dv), o = new Float64Array(dv);
          for (var i = 0; i < T.length; i++) T[i] *= g;
          for (i = 0; i < dk; i++) for (var c = 0; c < dv; c++) u[c] += T[i * dv + c] * k[t][i];
          for (c = 0; c < dv; c++) d[c] = (v[t][c] - u[c]) * b;
          for (i = 0; i < dk; i++) for (c = 0; c < dv; c++) T[i * dv + c] += k[t][i] * d[c];
          for (i = 0; i < dk; i++) for (c = 0; c < dv; c++) r[c] += T[i * dv + c] * q[t][i];
          // the gated norm: to one size, times the gain, times silu(z)
          var ss = 0; for (c = 0; c < dv; c++) ss += r[c] * r[c];
          var sc = 1 / Math.sqrt(ss / dv + J.eps);
          for (c = 0; c < dv; c++) o[c] = r[c] * sc * H.gain[c] * z[t][c] / (1 + Math.exp(-z[t][c]));
          var dd = 0, vv = 0;
          for (c = 0; c < dv; c++) { dd += (v[t][c] - u[c]) * (v[t][c] - u[c]); vv += v[t][c] * v[t][c]; }
          H.steps.push({ before: before, after: Float32Array.from(T), k: k[t], v: v[t], u: u, d: d, r: r, o: o, diff: Math.sqrt(dd / (vv || 1)) });
        }
        // each scale is full at the 98th percentile of the numbers it draws, as in the figure of two tables
        var p98 = function (list) { var a = []; list.forEach(function (M) { for (var i = 0; i < M.length; i += 7) a.push(Math.abs(M[i])); }); a.sort(function (x, y) { return x - y; }); return a[Math.floor(a.length * 0.98)] || 1; };
        H.full = p98(H.steps.map(function (S) { return S.after; }));
        H.vMax = p98(H.steps.map(function (S) { return S.v; }).concat(H.steps.map(function (S) { return S.u; })));
        H.rMax = p98(H.steps.map(function (S) { return S.r; })); H.oMax = p98(H.steps.map(function (S) { return S.o; }));
      });
    });
    var P = player(fig, {
      load: get,
      start: function (J) { for (var i = J.prompt; i < J.n; i++) if (J.pieces[i].indexOf('.') >= 0) return i + 1; return J.n; },
      loaded: function (J) {
        if (hseg.children.length) return;
        J.heads.forEach(function (H, i) {
          var b = el('button', '', H.name); b.type = 'button'; b.dataset.i = i; b.setAttribute('aria-pressed', String(i === who)); hseg.append(b);
        });
      },
      failed: function () { tell.textContent = 'The recording could not be loaded.'; },
      draw: draw
    });
    hseg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      who = Number(b.dataset.i);
      Array.prototype.forEach.call(hseg.children, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      P.redraw();
    });
    function draw(J, t) {
      var H = J.heads[who], S = t >= 0 ? H.steps[t] : null, W = canvas.clientWidth, narrow = W < 720;
      var gap = narrow ? 14 : 22, per = narrow ? 2 : 4, s = Math.min(240, Math.floor((W - (per - 1) * gap) / per)), LAB = 22, SUB = 20;
      var mrows = narrow ? 2 : 1, MH = mrows * (LAB + s + SUB) + (mrows - 1) * 8, STR = 5, SH = narrow ? 12 : 14, ROW = 18 + SH + 10;
      var ctx = canvasFor(canvas, W, MH + 8 + STR * ROW), N = J.dk * J.dv;
      var zero = new Float32Array(N), keep = t >= 0 ? H.decay[t] : 1;
      var faded = new Float32Array(N), wrote = new Float32Array(N);
      if (S) for (var i = 0; i < J.dk; i++) for (var c = 0; c < J.dv; c++) { faded[i * J.dv + c] = S.before[i * J.dv + c] * keep; wrote[i * J.dv + c] = S.k[i] * S.d[c]; }
      var size = function (M) { var a = 0; for (var i = 0; i < M.length; i++) a += M[i] * M[i]; return Math.sqrt(a); };
      var panels = [
        ['Before', S ? S.before : zero, S ? 'size ' + num(size(S.before)) : ''],
        ['1 Fade: × ' + (S ? (keep > 0.9999 ? keep.toFixed(6) : keep.toPrecision(3)) : '…'), S ? faded : zero, S ? 'size ' + num(size(faded)) : ''],
        ['3 Write: key × difference', S ? wrote : zero, S ? 'size ' + num(size(wrote)) : ''],
        ['After', S ? S.after : zero, S ? 'size ' + num(size(S.after)) : '']
      ];
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      panels.forEach(function (p, j) {
        var col = j % per, row = Math.floor(j / per), x = col * (s + gap), y = row * (LAB + s + SUB + 8);
        ctx.font = FONT_B; ctx.fillStyle = C.ink; ctx.fillText(fit(ctx, [p[0], p[0].replace(/^\d /, '').replace(': key × difference', '')], s + gap - 4), x, y + LAB - 7);
        paintTable(ctx, p[1], J.dk, H.full, x, y + LAB, s);
        ctx.font = FONT; ctx.fillStyle = C.muted; ctx.fillText(p[2], x, y + LAB + s + 15);
      });
      // the five vectors of 128 numbers
      var strips = [
        [['v: the value this word piece brings', 'v: the value'], S && S.v, H.vMax],
        [['2 Ask: what the faded table holds under the key', '2 Ask: the table under the key'], S && S.u, H.vMax],
        [['The difference, times the write strength ' + (S ? H.beta[t].toFixed(2) : ''), 'Difference × ' + (S ? H.beta[t].toFixed(2) : '')], S && S.d, H.vMax],
        [['4 Read: what the table gives for the question', '4 Read with the question'], S && S.r, H.rMax],
        [['Passed on: to one size, times the gate silu(z)', 'Passed on, after the gate'], S && S.o, H.oMax]
      ];
      var y0 = MH + 8;
      strips.forEach(function (st, j) {
        var y = y0 + j * ROW;
        ctx.font = FONT_B; ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic'; ctx.fillText(fit(ctx, st[0], W), 0, y + 14);
        paintStrip(ctx, st[1] || new Float64Array(J.dv), st[2], 0, y + 18, W, SH);
      });
      canvas.setAttribute('aria-label', 'Layer ' + H.layer + ', head ' + H.head + ': its table of 128 by 128 numbers before, faded, written and after word piece ' + (t + 1) + ', and the vectors of the step');
      tell.replaceChildren(where(J, t));
      if (!S) return;
      tell.append('Layer ' + H.layer + ', head ' + H.head + ' keeps ', el('b', '', pct(keep)), ' of its table. The new value differs from what the table holds under its key by ',
        el('b', '', Math.round(100 * S.diff) + '%'), '; the head writes ', el('b', '', Math.round(100 * H.beta[t]) + '%'), ' of that difference.');
    }
  })();

  // ---- D. one head that still looks back, to scale (data/attn.json) ---------------------------------------
  (function () {
    var fig = $('fig-head'); if (!fig) return;
    var canvas = fig.querySelector('.dn-att'), tell = fig.querySelector('.tell'), hseg = fig.querySelector('.dn-hpick'), head = 2;
    var OLD = { name: 'Qwen2.5-0.5B', size: 64, rot: 64, theta: 1e6 };   // config.json of Qwen2.5-0.5B: 896 / 14 numbers per head, all turned
    var get = oneRecording('attn.json', function (J) {
      J.gateB = bytes(J.gate); J.sizeB = bytes(J.size.data);
      J.gl = J.layers.indexOf(J.gateLayer);
    });
    var P = player(fig, {
      load: get,
      start: function (J) { var i = J.pieces.indexOf('Paris'); return i < 0 ? J.n : i + 1; },
      loaded: function (J) {
        if (hseg.children.length) return;
        for (var h = 0; h < J.heads; h++) { var b = el('button', '', String(h)); b.type = 'button'; b.dataset.h = h; b.setAttribute('aria-pressed', String(h === head)); b.setAttribute('aria-label', 'Head ' + h); hseg.append(b); }
      },
      failed: function () { tell.textContent = 'The recording could not be loaded.'; },
      draw: draw
    });
    hseg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      head = Number(b.dataset.h);
      Array.prototype.forEach.call(hseg.children, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      P.redraw();
    });
    var gateC = function (f) { return css(mix(C.panel, C.rgb.d3, f)); };
    function draw(J, t) {
      var W = canvas.clientWidth, narrow = W < 560, HS = J.headSize, px = W / HS, Q = J.heads * HS, gl = J.gl, gain = J.gain[gl];
      var RH = narrow ? 2 : 3, LAB = 18, SH = 14, BH = 34, MAPH = J.n * RH, PER = narrow ? 16 : 32, R = Math.max(5, Math.min(13, Math.floor(W / PER / 2) - 2)), DIAL = (32 / PER) * (2 * R + 6);
      var H = 2 * (LAB + SH + 10) + 2 * (LAB + BH + 10) + (LAB + SH + 10) + (LAB + MAPH + 10) + 2 * (LAB + DIAL + 4);
      var ctx = canvasFor(canvas, W, H), y = 0, X = function (i) { return Math.floor(i * px); };
      function label(texts) { ctx.font = FONT_B; ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, texts, W), 0, y + 13); y += LAB; }
      function cells(n, colour) { for (var i = 0; i < n; i++) { ctx.fillStyle = colour(i); ctx.fillRect(X(i), y, Math.max(1, X(i + 1) - X(i) - (px >= 3 ? 1 : 0)), SH); } }
      // the two heads to scale: turned numbers in orange
      label([OLD.name + ': one head, 64 numbers, all turned by position', OLD.name + ': 64 numbers']);
      cells(OLD.size, function () { return C.d2; }); y += SH + 10;
      label([J.model + ': one head, 256 numbers, 64 turned', J.model + ': 256 numbers, 64 turned']);
      cells(HS, function (i) { return i < J.rotDim ? C.d2 : C.sunk; });
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(X(J.rotDim) + 0.5, y + 0.5, W - X(J.rotDim) - 1, SH - 1);
      y += SH + 10;
      // the gains of the two norms
      [['q', 'Gain of the norm of the question, layer ' + J.gateLayer, 'Question norm gain'], ['k', 'Gain of the norm of the key', 'Key norm gain']].forEach(function (g) {
        label([g[1], g[2]]);
        var top = 2.4, base = y + BH;
        ctx.fillStyle = C.sunk; ctx.fillRect(0, y, W, BH);
        for (var i = 0; i < HS; i++) { var v = Math.max(0, gain[g[0]][i]), hh = v / top * BH; ctx.fillStyle = i < J.rotDim ? C.d2 : C.ink2; ctx.fillRect(X(i), base - hh, Math.max(1, X(i + 1) - X(i) - (px >= 3 ? 1 : 0)), hh); }
        var y1 = Math.round(base - BH / top) + 0.5;
        ctx.strokeStyle = C.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = FONT; ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('1', W - 2, y1 - 1); ctx.textAlign = 'left';
        y += BH + 10;
      });
      // the gate: at this word piece, and at every word piece
      var at = function (k, i) { return J.gateB[k * Q + head * HS + i] / 255; };
      label(['Output gate of head ' + head + ' at this word piece: 0 shut, 1 open', 'Gate now (0 shut, 1 open)']);
      cells(HS, function (i) { return t < 0 ? C.sunk : gateC(at(t, i)); }); y += SH + 10;
      label(['The same gate at every word piece, the question on top', 'The gate at every word piece']);
      for (var k = 0; k < J.n; k++) for (var i = 0; i < HS; i++) { ctx.fillStyle = gateC(at(k, i)); ctx.fillRect(X(i), y + k * RH, Math.max(1, X(i + 1) - X(i)), RH); }
      ctx.fillStyle = C.muted; ctx.fillRect(0, y + J.prompt * RH - 1, W, 1);
      if (t >= 0) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(1, y + t * RH - 1, W - 2, RH + 2); }
      y += MAPH + 10;
      // turned by position: the 32 pairs at this word piece
      [[OLD.name, OLD.theta, OLD.rot], [J.model, J.theta, J.rotDim]].forEach(function (m) {
        label([m[0] + ': the 32 turned pairs at position ' + Math.max(0, t), m[0] + ', position ' + Math.max(0, t)]);
        var step = W / PER;
        for (var f = 0; f < m[2] / 2; f++) {
          var cx = step * (f % PER) + step / 2, cy = y + R + 3 + Math.floor(f / PER) * (2 * R + 6), a = Math.max(0, t) * Math.pow(m[1], -2 * f / m[2]);
          ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
          ctx.strokeStyle = C.d2; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(a), cy - R * Math.cos(a)); ctx.stroke();
        }
        y += DIAL + 4;
      });
      canvas.setAttribute('aria-label', 'One head of ' + J.model + ' beside one of ' + OLD.name + ', to scale, with the gains of its norms and its output gate, at word piece ' + (t + 1));
      tell.replaceChildren(where(J, t));
      if (t < 0) return;
      var sum = 0, shut = 0;
      for (i = 0; i < HS; i++) { var g = at(t, i); sum += g; if (g < 0.1) shut++; }
      var szq = J.sizeB[(t * J.layers.length + gl) * (J.heads + J.kvHeads) + head], qsz = Math.pow(10, J.size.lo + (szq - 1) / 254 * (J.size.hi - J.size.lo));
      tell.append('Head ' + head + ' of layer ' + J.gateLayer + ' lets through ', el('b', '', Math.round(100 * sum / HS) + '%'), ' on average; ', el('b', '', String(shut)), ' of its 256 numbers get less than a tenth through. Before its norm the question has size ',
        el('b', '', num(qsz)), '; after it, 16 at every word piece, before the gains.');
    }
  })();

  // ---- 4. the model itself, in this browser ---------------------------------------------------------
  // live/worker.js runs Qwen3.5-0.8B and sends the size of every table after every word piece
  (function () {
    var fig = $('fig-live'); if (!fig) return;
    var MODEL = new URL('../models/qwen3.5-0.8b/', location.href).href, LO = -2.5, HI = 1.5;   // LO, HI: log10 colour scale of the recordings
    var q = fig.querySelector('.lv-q'), go = fig.querySelector('.lv-go'), stop = fig.querySelector('.lv-stop'), meter = fig.querySelector('.lv-meter');
    var status = fig.querySelector('.lv-status'), asked = fig.querySelector('.lv-asked'), answer = fig.querySelector('.lv-answer'), modes = fig.querySelector('.lv-mode'), io = fig.querySelector('.lv-io');
    var map = fig.querySelector('.dn-map'), hist = fig.querySelector('.dn-hist'), who = fig.querySelector('.dn-who'), said = fig.querySelector('.dn-said');
    var ramp = []; for (var k = 0; k <= 8; k++) ramp.push(C.seq(k / 8));
    fig.querySelector('.dn-ramp').style.background = 'linear-gradient(90deg,' + ramp.join(',') + ')';
    var worker = null, info = null, busy = false, mode = 'int8', sel = -1, sizes = [], prompt = 0, geo = null;
    var GB = function (n) { return (n / 1e9).toFixed(2) + ' GB'; };
    var f = function (v) { return v > 0 ? Math.max(0, Math.min(1, (Math.log10(v) - LO) / (HI - LO))) : null; };

    // are the files on this site? (the worker reads only the text part of the file: 1.50 of its 1.75 GB)
    fetch(MODEL + 'model.safetensors', { method: 'HEAD' }).then(function (r) {
      if (!r.ok) throw new Error('missing');
      go.disabled = false; go.textContent = 'Load Qwen3.5-0.8B (1.50 GB)';
      status.textContent = 'Nothing is downloaded until you press Load.';
    }).catch(function () { status.textContent = 'The files of Qwen3.5-0.8B are not on this site, so it cannot run here.'; });

    function draw() {
      if (!info) return;
      var last = sizes[sizes.length - 1];
      geo = paintMap(map, info.lin, info.heads, sel, function (i) { return last ? f(last[i]) : null; }, function () { return false; });
      map.setAttribute('aria-label', 'The tables of ' + info.lin.length * info.heads + ' heads after ' + sizes.length + ' word pieces');
      drawHead();
    }
    // the chosen head over the word pieces so far
    function drawHead() {
      var r = Math.floor(sel / info.heads), h = sel % info.heads, W = hist.clientWidth, PADL = 4, H1 = 84, TOP = 18, n = Math.max(64, sizes.length);
      var ctx = canvasFor(hist, W, TOP + H1 + 18), X = function (k) { return PADL + (k + 0.5) / n * (W - PADL); };
      if (prompt) { ctx.fillStyle = C.sunk; ctx.fillRect(PADL, TOP, X(Math.min(prompt, sizes.length) - 0.5) - PADL, H1); }
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(PADL + 0.5, TOP + 0.5, W - PADL - 1, H1 - 1);
      ctx.beginPath();
      sizes.forEach(function (s, k) { var yy = TOP + H1 - 2 - (f(s[sel]) || 0) * (H1 - 6); if (k) ctx.lineTo(X(k), yy); else ctx.moveTo(X(k), yy); });
      ctx.strokeStyle = C.d1; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = FONT; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
      ctx.fillText('Size of the table', PADL, TOP - 6);
      ctx.fillText('question', PADL + 3, TOP + H1 + 14);
      ctx.textAlign = 'right'; ctx.fillText('answer', W, TOP + H1 + 14);
      who.replaceChildren(el('b', '', 'Layer ' + info.lin[r] + ', head ' + h), ' (click another square)');
      var last = sizes[sizes.length - 1];
      said.textContent = last ? 'After ' + sizes.length + ' word pieces this head holds ' + num(last[sel]) + '.' : 'The tables are empty until the question is read.';
      hist.setAttribute('aria-label', 'Layer ' + info.lin[r] + ', head ' + h + ': the size of its table over the word pieces so far');
    }
    map.addEventListener('click', function (e) { var i = info ? pickMap(map, geo, info.heads, e) : -1; if (i >= 0) { sel = i; draw(); } });
    map.addEventListener('keydown', function (e) { var i = info ? keyMap(e, sel, info.lin.length, info.heads) : -1; if (i >= 0) { sel = i; draw(); } });
    new ResizeObserver(function () { draw(); }).observe(fig);
    new MutationObserver(function () { draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    modes.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || busy) return;
      mode = b.dataset.m;
      Array.prototype.forEach.call(modes.children, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
    });
    function setBusy(v) {
      busy = v; go.disabled = v; stop.hidden = !v || !info; q.readOnly = v;
      if (window.LeaveGuard) LeaveGuard.set('live', v);
      Array.prototype.forEach.call(modes.children, function (o) { o.disabled = v; });
    }
    function start() {
      setBusy(true); meter.hidden = false; meter.value = 0;
      status.textContent = 'Starting';
      worker = new Worker('live/worker.js?v=' + V);   // the worker hands the same version on to the files it loads
      worker.onmessage = function (e) { on(e.data); };
      worker.postMessage({ type: 'start', model: MODEL });
    }
    function ask() {
      var text = q.value.trim(); if (!text || busy) return;
      setBusy(true); sizes = []; prompt = 0;
      asked.textContent = text; answer.textContent = '';
      worker.postMessage({ type: 'ask', question: text, setting: mode, maxNew: 300 });
    }
    function on(msg) {
      switch (msg.type) {
        case 'status': status.textContent = msg.text; break;
        case 'load':
          meter.value = msg.done / msg.total;
          status.textContent = 'Downloading the weights: ' + GB(msg.done) + ' of ' + GB(msg.total);
          break;
        case 'ready':
          info = msg;
          if (sel < 0) sel = Math.max(0, info.lin.indexOf(17)) * info.heads;   // head 0 of layer 17: it lets go at every full stop
          setBusy(false); meter.hidden = true; go.textContent = 'Ask';
          io.hidden = false; fig.querySelector('.dn-two').hidden = false;
          status.textContent = 'Ready, on ' + msg.threads + (msg.threads === 1 ? ' thread' : ' threads') + '. Type a question and press Ask.';
          draw();
          break;
        case 'prompt':
          meter.hidden = false; meter.value = msg.done / msg.total; prompt = msg.total;
          sizes.push(msg.norms);
          status.textContent = 'Reading the question: word piece ' + msg.done + ' of ' + msg.total;
          draw();
          break;
        case 'text':
          meter.hidden = true;
          sizes.push(msg.norms);
          answer.textContent = msg.text;
          io.scrollTop = io.scrollHeight;   // the last line in view, without moving the page
          status.textContent = 'Writing: ' + msg.tokens + (msg.tokens === 1 ? ' word piece' : ' word pieces') + ', ' + (msg.tokens / (msg.ms / 1000)).toFixed(1) + ' a second';
          draw();
          break;
        case 'done':
          setBusy(false); meter.hidden = true;
          status.textContent = 'Done: ' + msg.promptTokens + ' word pieces read in ' + (msg.promptMs / 1000).toFixed(1) + ' s, ' + msg.tokens + ' written in ' + (msg.ms / 1000).toFixed(1) + ' s.';
          break;
        case 'error':
          setBusy(false); meter.hidden = true; go.disabled = !info;
          status.textContent = 'Something went wrong: ' + String(msg.text).split('\n')[0];
          break;
      }
    }
    go.addEventListener('click', function () { if (!worker) start(); else ask(); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && info) ask(); });
    stop.addEventListener('click', function () { if (worker) worker.postMessage({ type: 'stop' }); });
    Array.prototype.forEach.call(fig.querySelectorAll('.lv-ex button'), function (b) { b.addEventListener('click', function () { if (!busy) q.value = b.textContent; }); });
  })();

  A.openFromHash();
})();
