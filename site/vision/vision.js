// The figures of "Looking at a picture" (vision/index.html).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A = window.Article, el = A.el, fmt = A.fmt, slider = A.slider;
  var reduced = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var probe = el('i'); probe.hidden = true; document.body.append(probe);
  var colour = function (v) { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };

  // ---- where every square looks (data/look.json, data/look-<picture>.bin: compiler/qwen3.5/vision/record.js) ----
  (function () {
    var canvas = $('look-view'), said = $('look-said'), INDEX = null, cache = {}, pic = 'cat', layer = 4, sq = -1, ordering = null;
    var img = {}, D = null;
    var lay = slider('Layer', 1, 12, layer, function (v) { return v + ' of 12'; });
    $('look-ctl').append(lay.label);
    function index() { if (!INDEX) INDEX = fetch('data/look.json?v=1').then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }); return INDEX; }
    function load(name) {
      if (!cache[name]) cache[name] = index().then(function (J) {
        var P = J.pictures.find(function (p) { return p.name === name; });
        var im = new Image();
        var gotImg = new Promise(function (ok, bad) { im.onload = ok; im.onerror = bad; im.src = P.file; });
        var gotBin = fetch(P.look + '?v=1').then(function (r) { if (!r.ok) throw new Error('no data'); return r.arrayBuffer(); });
        return Promise.all([gotImg, gotBin]).then(function (r) { return { J: J, P: P, img: im, look: new Uint8Array(r[1]) }; });
      });
      return cache[name];
    }
    // square number s (the program's order) <-> its place in the grid of 16 x 16
    var place = function (s) { return D.P.rc[s]; };
    var squareAt = function (row, col) { for (var s = 0; s < D.P.rc.length; s++) if (D.P.rc[s][0] === row && D.P.rc[s][1] === col) return s; return -1; };
    function draw(upTo) {
      if (!D) return;
      var W = Math.min(canvas.parentNode.clientWidth, 512), dpr = window.devicePixelRatio || 1, n = D.P.rc.length, side = 16, cw = W / side;
      canvas.style.width = W + 'px'; canvas.style.height = W + 'px';
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(W * dpr);
      var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(D.img, 0, 0, W, W);
      var go = colour('--go'), ink = colour('--ink'), night = 'rgba(13,14,16,0.62)';
      if (upTo !== undefined) {
        // the order the program reads the squares in: the ones read so far bright, their path drawn
        ctx.fillStyle = night;
        for (var s = upTo; s < n; s++) { var q = place(s); ctx.fillRect(q[1] * cw, q[0] * cw, cw, cw); }
        ctx.strokeStyle = go; ctx.lineWidth = 2; ctx.beginPath();
        for (var t = 0; t < upTo; t++) { var r = place(t), x = (r[1] + 0.5) * cw, y = (r[0] + 0.5) * cw; if (t) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      } else if (sq >= 0) {
        // what square sq takes in, in this layer: darker where less, scaled to its top square besides itself and the
        // notepad squares; those two left as they are, the notepad squares ringed in blue
        var row = (layer - 1) * n + sq, L = D.look, R = registers(), top = topOf(sq), max = L[row * n + top] || 1;
        for (var u = 0; u < n; u++) {
          if (R[u] || u === sq) continue;
          var v = Math.min(1, L[row * n + u] / max), p = place(u);
          ctx.fillStyle = 'rgba(13,14,16,' + (0.78 * (1 - Math.sqrt(v))).toFixed(3) + ')';
          ctx.fillRect(p[1] * cw, p[0] * cw, cw, cw);
        }
        ctx.strokeStyle = colour('--c-minus'); ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        for (var w = 0; w < n; w++) if (R[w]) { var pw = place(w); ctx.strokeRect(pw[1] * cw + 1.5, pw[0] * cw + 1.5, cw - 3, cw - 3); }
        ctx.setLineDash([]);
        var me = place(sq), tp = place(top);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(me[1] * cw + 1.5, me[0] * cw + 1.5, cw - 3, cw - 3);
        ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(me[1] * cw + 0.5, me[0] * cw + 0.5, cw - 1, cw - 1);
        if (held) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(me[1] * cw - 3, me[0] * cw - 3, cw + 6, cw + 6); }   // held: a second ring
        // the square it takes in most from elsewhere, in the colour of the key
        ctx.strokeStyle = go; ctx.lineWidth = 3; ctx.strokeRect(tp[1] * cw + 1.5, tp[0] * cw + 1.5, cw - 3, cw - 3);
      }
      // the grid of squares, faint; the blocks of four a little stronger
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      for (var i = 1; i < side; i++) { ctx.beginPath(); ctx.moveTo(i * cw + 0.5, 0); ctx.lineTo(i * cw + 0.5, W); ctx.moveTo(0, i * cw + 0.5); ctx.lineTo(W, i * cw + 0.5); ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.32)'; ctx.stroke(); }
    }
    // the share of what square sq takes in from the eight squares around it (and itself), in this layer
    function near() {
      var n = D.P.rc.length, row = (layer - 1) * n + sq, me = place(sq), all = 0, close = 0;
      for (var u = 0; u < n; u++) { var v = D.look[row * n + u], p = place(u); all += v; if (Math.abs(p[0] - me[0]) <= 1 && Math.abs(p[1] - me[1]) <= 1) close += v; }
      return all ? close / all : 0;
    }
    // The registers (notepad squares) of this layer: squares every square takes in whatever is in them, 3% or more on
    // average over all 256 (an even share is 0.4%).
    var regs = {};
    function registers() {
      var key = pic + ' ' + layer;
      if (!regs[key]) {
        var n = D.P.rc.length, mean = new Float64Array(n), R = new Uint8Array(n);
        for (var s = 0; s < n; s++) {
          var at = ((layer - 1) * n + s) * n, all = 0;
          for (var u = 0; u < n; u++) all += D.look[at + u];
          if (all) for (var w = 0; w < n; w++) mean[w] += D.look[at + w] / all / n;
        }
        for (var k = 0; k < n; k++) R[k] = mean[k] >= 0.03 ? 1 : 0;
        regs[key] = R;
      }
      return regs[key];
    }
    // the square that square s takes in most in this layer besides itself and the notepad squares (the first of equals),
    // and the share of a square in all that s takes in
    function topOf(s) {
      var n = D.P.rc.length, at = ((layer - 1) * n + s) * n, R = registers(), best = -1;
      for (var u = 0; u < n; u++) if (!R[u] && u !== s && (best < 0 || D.look[at + u] > D.look[at + best])) best = u;
      return best;
    }
    function shareOf(s, u) {
      var n = D.P.rc.length, at = ((layer - 1) * n + s) * n, all = 0;
      for (var w = 0; w < n; w++) all += D.look[at + w];
      return all ? D.look[at + u] / all : 0;
    }
    var where = function (s) { var p = place(s); return 'square ' + (s + 1) + ' (row ' + (p[0] + 1) + ', column ' + (p[1] + 1) + ')'; };
    function tell() {
      if (!D) return;
      if (sq < 0) { said.textContent = 'Point at a square of the picture, or press it to hold it.'; return; }
      var share = near(), top = topOf(sq), R = registers(), reg = 0, k = 0;
      for (var u = 0; u < R.length; u++) if (R[u]) { reg += shareOf(sq, u); k++; }
      said.replaceChildren(where(sq).replace('square', 'Square') + ', layer ' + layer + ': ', el('b', '', Math.round(100 * share) + '%'), ' of what it takes in comes from itself and the eight squares around it. ');
      if (k) said.append(el('b', '', Math.round(100 * reg) + '%'), ' goes to the ' + (k === 1 ? 'notepad square' : k + ' notepad squares') + ' ringed in blue. ');
      said.append('From itself it takes in ', el('b', '', Math.round(100 * shareOf(sq, sq)) + '%'), '; from anywhere else most from ' + where(top) + ', ', el('b', '', Math.round(100 * shareOf(sq, top)) + '%'), '. ',
        held ? 'Held: move the slider through the layers, or press the square again to let go.' : 'Press it to hold it while you move the slider.');
    }
    function show() { draw(); tell(); }
    // the square under the pointer; pointing moves the square only while none is held, pressing holds it or lets go
    var held = false;
    function squareOf(ev) {
      var r = canvas.getBoundingClientRect(), col = Math.floor((ev.clientX - r.left) / r.width * 16), row = Math.floor((ev.clientY - r.top) / r.height * 16);
      return row < 0 || col < 0 || row > 15 || col > 15 ? -1 : squareAt(row, col);
    }
    canvas.addEventListener('mousemove', function (ev) {
      if (!D || ordering || held) return;
      var s = squareOf(ev);
      if (s >= 0 && s !== sq) { sq = s; show(); }
    });
    canvas.addEventListener('click', function (ev) {
      if (!D || ordering) return;
      var s = squareOf(ev);
      if (s < 0) return;
      held = !(held && s === sq);
      sq = s; show();
    });
    canvas.addEventListener('keydown', function (e) {
      if (!D) return;
      var me = sq >= 0 ? place(sq) : [7, 7], d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      sq = squareAt(Math.max(0, Math.min(15, me[0] + d[0])), Math.max(0, Math.min(15, me[1] + d[1])));
      show();
    });
    lay.input.addEventListener('input', function () { layer = Number(lay.input.value); show(); });
    $('look-pic').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call($('look-pic').children, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      pic = b.dataset.p; open();
    });
    $('look-order').addEventListener('click', function () {
      if (!D) return;
      if (ordering) { clearInterval(ordering); ordering = null; $('look-order').textContent = 'Show the order'; show(); return; }
      var k = 0, n = D.P.rc.length;
      $('look-order').textContent = 'Stop';
      if (reduced()) k = n;
      var stepOn = function () {
        draw(k);
        said.replaceChildren('The program has read ', el('b', '', fmt(k)), ' of the 256 squares: ', el('b', '', fmt(k * 768)), ' of the 196,608 bytes.');
        if (k >= n) { clearInterval(ordering); ordering = null; $('look-order').textContent = 'Show the order'; return; }
        k += 1;
      };
      stepOn();
      if (k <= n) ordering = setInterval(stepOn, 40);
    });
    function open() {
      said.textContent = 'Loading…';
      load(pic).then(function (d) { D = d; if (sq < 0) sq = squareAt(8, 5); show(); }).catch(function () { said.textContent = 'The data of this figure could not be loaded.'; });
    }
    var started = false, start = function () { if (!started) { started = true; open(); } };
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '400px' }); io.observe(canvas); } else start();
    new ResizeObserver(function () { if (!ordering) draw(); }).observe(canvas.parentNode);
  })();

  // ---- what it said (data/answers.json: the program's own runs, compiler/qwen3.5/vision/verify_pure.js) ----
  (function () {
    var list = $('ans-list');
    fetch('data/answers.json?v=1').then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }).then(function (J) {
      J.answers.forEach(function (a) {
        var card = el('div', 'vis-ans'), im = el('img');
        im.src = 'pictures/' + a.picture + '.png'; im.alt = a.alt; im.width = 128; im.height = 128;
        var text = el('div');
        text.append(el('p', 'q', a.question), el('p', 'a', a.text));
        if (a.note) text.append(el('p', 'small muted', a.note));
        card.append(im, text);
        list.append(card);
      });
    }).catch(function () { list.textContent = 'The answers could not be loaded.'; });
  })();

  // ---- what it costs: the tape to scale, and the time of one question (data/answers.json) ----
  (function () {
    var bars = $('cost-bars');
    fetch('data/answers.json?v=1').then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); }).then(function (J) {
      var parts = J.tape, max = parts.reduce(function (m, p) { return Math.max(m, p.cells); }, 0);
      parts.forEach(function (p) {
        var lab = el('span', 'lab', p.name), track = el('span', 'track'), bar = el('i', 'bar'), val = el('span', 'val', fmt(p.cells) + ' cells');
        bar.style.width = Math.max(0.3, 100 * p.cells / max) + '%'; bar.style.background = 'var(' + p.colour + ')';
        track.append(bar); bars.append(lab, track, val);
      });
      $('cost-said').textContent = J.costSaid;
      $('cost-cap').textContent = J.costCap;
    }).catch(function () { $('cost-said').textContent = 'The numbers could not be loaded.'; });
  })();
})();
