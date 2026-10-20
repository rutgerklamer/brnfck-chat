// The figures of "How it works" (how/index.html).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A = window.Article, fmt = A.fmt, minus = A.minus, el = A.el, glyph = A.glyph, drawTape = A.drawTape, slider = A.slider, scrubber = A.scrubber, runner = A.runner;

  var figs = {};

  // ---- 1. letters go in as numbers ----------------------------------------------------
  figs['fig-read'] = function () {
    var Q = 'What is the capital of France?', N = 9;
    var tape, p, at;
    var pos = slider('The letter that , reads next', 1, Q.length, 1, function (v) { return at >= Q.length ? 'none left' : v + ': ' + glyph(Q[v - 1]); });
    $('r-ctl').prepend(pos.label);
    function draw(text) {
      $('r-text').replaceChildren.apply($('r-text'), Array.from(Q, function (ch, i) { return el('span', i === at ? 'now' : '', ch); }));
      drawTape($('r-tape'), tape, p, { pick: function (i) { p = i; draw('The pointer is on cell ' + i + ', which holds ' + tape[i] + '.'); } });
      pos.input.value = Math.min(at + 1, Q.length); pos.show();
      $('r-said').textContent = text;
    }
    function press(c) {
      var m = new LearnCore.Machine(c, { bits: 8, size: N, init: tape, input: at < Q.length ? [Q.charCodeAt(at)] : [] });
      m.p = p; m.step();
      if (m.error) return draw('The row ends here. Move the other way.');
      tape = m.tape; p = m.p;
      if (c !== ',') return draw('Moved one cell to the ' + (c === '>' ? 'right' : 'left') + '. The pointer is on cell ' + p + ', which holds ' + tape[p] + '.');
      if (at >= Q.length) return draw('The question has no letters left, so , put 0 in cell ' + p + '.');
      at++;
      draw('Read “' + glyph(Q[at - 1]) + '”. Its number, ' + tape[p] + ', is now in cell ' + p + '.');
    }
    function reset() { tape = new Uint8Array(N); p = 0; at = 0; draw('Press , and watch the first box.'); }
    Array.prototype.forEach.call($('r-keys').children, function (b) { b.addEventListener('click', function () { press(b.dataset.c); }); });
    pos.input.addEventListener('input', function () { at = Number(pos.input.value) - 1; draw('The next , will read “' + glyph(Q[at]) + '”.'); });
    $('r-reset').addEventListener('click', reset);
    reset();
  };

  // ---- 2. word pieces (the pieces and numbers of this question in brnfck-smollm2-135m) ----
  figs['fig-pieces'] = function () {
    var PIECES = [['What', 1780], [' is', 314], [' the', 260], [' capital', 3575], [' of', 282], [' France', 4649], ['?', 47]];
    var letters = [], chips = [];
    function show(n) {
      letters.forEach(function (c) { c.classList.toggle('here', Number(c.dataset.p) === n); });
      chips.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === n)); });
      var text = PIECES[n][0];
      $('p-said').textContent = '“' + text.replace(' ', '␣') + '” is word piece number ' + fmt(PIECES[n][1]) + ': ' + text.length + (text.length === 1 ? ' character' : ' characters') + (text[0] === ' ' ? ', the space in front included' : '') + ', one word piece.';
    }
    PIECES.forEach(function (piece, n) {
      Array.from(piece[0]).forEach(function (ch) {
        var c = el('div', 'cell pick'); c.append(el('b', '', glyph(ch))); c.dataset.p = n;
        c.addEventListener('click', function () { show(n); });
        letters.push(c); $('p-letters').append(c);
      });
      var b = el('button', '', piece[0].replace(' ', '␣')); b.type = 'button';
      b.addEventListener('click', function () { show(n); });
      chips.push(b); $('p-chips').append(b);
    });
    show(3);
  };

  // ---- 3a. walking to a row
  figs['fig-lookup'] = function () {
    var NAMES = ['What', 'capital', 'France'], ROWS = { 1: 7, 2: 1, 4: 3, 5: 8, 7: 2, 8: 5 };
    runner($('fig-lookup'), {
      rate: 6,
      values: [{ name: 'Word piece to fetch', min: 0, max: 2, value: 2, say: function (v) { return v + ': “' + NAMES[v] + '”'; } }],
      build: function (v) {
        var k = v[0], init = Object.assign({ 0: k }, ROWS);
        return {
          code: '[[->>>+<<<]>>>-]', init: init, cells: 9,
          groups: NAMES.map(function (n, i) { return i + ': “' + n + '”'; }),
          mark: function (m, c) { return m.done && (c === m.p + 1 || c === m.p + 2); },
          end: function (m) { return 'Finished. The pointer stands on cell ' + m.p + '. The two cells to its right, ' + m.tape[m.p + 1] + ' and ' + m.tape[m.p + 2] + ', are the row of “' + NAMES[k] + '”.'; }
        };
      }
    });
  };

  // ---- 3b. multiply and add: three loops, one total --------------------------------------
  figs['fig-sum'] = function () {
    var X = [2, 1, 3];
    var w = function (i, start) { return { name: 'Weight for the ' + X[i], min: 0, max: 5, value: start, say: function (v) { return '× ' + v; } }; };
    runner($('fig-sum'), {
      rate: 12,
      values: [w(0, 3), w(1, 2), w(2, 1)],
      build: function (W) {
        var code = X.map(function (x, i) { var d = 3 - i; return '[-' + '>'.repeat(d) + '+'.repeat(W[i]) + '<'.repeat(d) + ']'; }).join('>');
        return {
          code: code, init: X.concat([0]), cells: 4, at: 'end',
          top: function (i) { return i < 3 ? 'number' : 'total'; },
          mark: function (m, c) { return c === 3; },
          end: function (m) { return 'Finished. ' + X.map(function (x, i) { return x + ' × ' + W[i]; }).join(' + ') + ' = ' + m.tape[3] + '. Drag Step to the left to see the total being made.'; }
        };
      }
    });
  };

  // ---- 4. looking back: scores become shares ------------------------------------------------
  function rows(box, list, o) {
    var parts = list.map(function (item) {
      var row = el('div', 'srow'), s = slider(item[0], o.min, o.max, item[1], String), end = el('b', 'end'), bar = null;
      row.append(s.label);
      if (o.bars) { var meter = el('div', 'meter'); bar = el('i'); meter.append(bar); row.append(meter); }
      row.append(end); box.append(row);
      s.input.addEventListener('input', function () { o.draw(parts); });
      return { name: item[0], s: s, bar: bar, end: end, row: row, get v() { return Number(s.input.value); } };
    });
    o.draw(parts);
  }
  figs['fig-attn'] = function () {
    rows($('a-rows'), [['“capital”', 8], ['“of”', 1], ['“France”', 9], ['“?”', 2]], {
      min: 0, max: 10, bars: true,
      draw: function (parts) {
        var sum = parts.reduce(function (a, p) { return a + p.v; }, 0), best = parts[0];
        parts.forEach(function (p) { var share = sum ? p.v / sum : 0; p.end.textContent = Math.round(share * 100) + '%'; p.bar.style.width = (share * 100) + '%'; if (p.v > best.v) best = p; });
        $('a-said').textContent = sum ? 'Taken in most: ' + best.name + ', for ' + best.end.textContent + '.' : 'With every score at zero nothing is taken in.';
      }
    });
  };

  // ---- 5a. the highest score wins
  figs['fig-pick'] = function () {
    rows($('k-rows'), [['“␣Paris”', 17], ['“␣London”', 9], ['“␣France”', 6], ['“␣the”', 4], ['“␣a”', 2]], {
      min: 0, max: 20,
      draw: function (parts) {
        var best = parts[0];
        parts.forEach(function (p) { if (p.v > best.v) best = p; });
        parts.forEach(function (p) { p.end.textContent = p === best ? 'highest' : ''; p.row.classList.toggle('on', p === best); });
        $('k-said').textContent = 'The program takes ' + best.name + ', with a score of ' + best.v + '. When two are equal, the one found first is kept here.';
      }
    });
  };

  // ---- 5b. printing a word piece, letter by letter
  figs['fig-print'] = function () {
    var WORD = ' Paris';
    runner($('fig-print'), {
      rate: 3, printed: true,
      values: [{ name: 'Number in cell 1', min: 65, max: 90, value: 80, say: function (v) { return v + ', the letter ' + String.fromCharCode(v); } }],
      build: function (v) {
        var init = Array.from(WORD, function (ch) { return ch.charCodeAt(0); }); init[1] = v[0];
        return {
          code: '.>.>.>.>.>.', init: init, cells: 6,
          top: function (i) { return glyph(String.fromCharCode(init[i])); },
          end: function (m) { return 'Finished. Six cells, six times the command . and six printed characters: “' + String.fromCharCode.apply(null, m.out) + '”.'; }
        };
      }
    });
  };

  // ---- 5c. the answer, one word piece each round
  figs['fig-rounds'] = function () {
    var OUT = [['The', 504], [' capital', 3575], [' of', 282], [' France', 4649], [' is', 314], [' Paris', 7042], ['.', 30]];
    var sc = scrubber($('g-ctl'), {
      max: OUT.length + 1, name: 'Round', rate: 2,
      show: function (n) {
        $('g-out').textContent = OUT.slice(0, n).map(function (p) { return p[0]; }).join('');
        $('g-said').textContent = n === 0 ? 'Nothing printed yet. The question is on the tape as 37 word pieces.'
          : n > OUT.length ? 'Round 8: the highest score goes to the “end” word piece. Nothing is printed and the program stops.'
            : 'Round ' + n + ': the highest of 49,152 scores goes to “' + OUT[n - 1][0].replace(' ', '␣') + '” (word piece number ' + fmt(OUT[n - 1][1]) + '). It is printed and goes back in, so the tape now holds ' + (37 + n) + ' word pieces.';
      }
    });
    sc.show(0);
  };

  // ---- 6. a loop that multiplies
  figs['fig-loop'] = function () {
    runner($('fig-loop'), {
      rate: 5,
      values: [
        { name: 'Left cell starts at', min: 0, max: 9, value: 3 },
        { name: 'Added to the right cell each round', min: 1, max: 9, value: 4 }
      ],
      build: function (v) {
        return {
          code: '+'.repeat(v[0]) + '[->' + '+'.repeat(v[1]) + '<]', cells: 2,
          top: function (i) { return i ? 'right' : 'left'; },
          end: function (m) { return 'Finished. The left cell is empty and the right cell holds ' + m.tape[1] + ': that is ' + v[0] + ' times ' + v[1] + '.'; }
        };
      }
    });
  };

  figs['fig-speed'] = function () {
    var CODE = '[->++++<]';
    var s = slider('Number in the left cell', 0, 60, 10, function (v) { return fmt(Math.round(Math.pow(10, v / 10))); });
    $('f-ctl').append(s.label);
    function draw() {
      var n = Math.round(Math.pow(10, Number(s.input.value) / 10));                 // 1 to 1,000,000, each step of the slider a little more
      var r = LearnCore.count(CODE, { bits: 32, size: 4, init: { 0: n }, plainMax: 5e7 });
      $('f-s1').textContent = fmt(r.plain.steps) + ' commands';
      $('f-s2').textContent = fmt(r.fast.steps) + (r.fast.steps === 1 ? ' operation' : ' operations');
      $('f-bar1').style.width = Math.max(1, 100 * Math.log10(r.plain.steps) / Math.log10(8e6 + 1)) + '%';
      $('f-bar2').style.width = Math.max(.5, 100 * Math.log10(r.fast.steps) / Math.log10(8e6 + 1)) + '%';
      $('f-said').textContent = 'Both ways were run just now. One command at a time the right cell ends at ' + fmt(r.plain.tape[1]) + '; as one operation it ends at ' + fmt(r.fast.tape[1]) + '.';
    }
    s.input.addEventListener('input', draw);
    draw();
  };

  // ---- 7b. two programs that write the same number
  figs['fig-write'] = function () {
    var s = slider('The number to write', 1, 1023, 93, fmt);
    $('w-ctl').append(s.label);
    function draw() {
      var n = Number(s.input.value), digits = [], plain = '+'.repeat(n);
      for (var v = n; v > 0; v = Math.floor(v / 5)) digits.unshift(v % 5);
      var fives = digits.map(function (d) { return '+'.repeat(d); }).join('[->+++++<]>');
      var a = LearnCore.run(plain, { bits: 16, size: 8 }), b = LearnCore.run(fives, { bits: 16, size: 8 });
      $('w-plain').textContent = n <= 48 ? plain : plain.slice(0, 40) + ' …';
      $('w-fives').textContent = minus(fives);
      $('w-plainN').textContent = fmt(plain.length); $('w-fivesN').textContent = fmt(fives.length);
      $('w-plainV').textContent = fmt(a.tape[a.p]); $('w-fivesV').textContent = fmt(b.tape[b.p]);
      var signs = digits.reduce(function (x, y) { return x + y; }, 0);
      $('w-said').textContent = fmt(n) + ' = ' + digits.map(function (d, i) { return d + ' × ' + fmt(Math.pow(5, digits.length - 1 - i)); }).join(' + ') + '. Of the ' + fmt(fives.length) + ' characters of the second program, ' + fmt(signs) + (signs === 1 ? ' is a plus sign' : ' are plus signs') + ' outside a loop; the rest is the loop that multiplies by five.';
    }
    s.input.addEventListener('input', draw);
    draw();
  };

  // ---- 7c. the four programs
  figs['fig-size'] = function () {
    var M = {
      small: ['SmolLM2-135M-Instruct', 'about 135 million', '1,030,902,380 characters', '188,012,789 cells (717 MiB)', 'about 1.5 GB', 'about 9 to 16 s', 'about 0.6 to 1.0 s'],
      '0.5b': ['Qwen2.5-0.5B-Instruct', 'about 494 million', '4,169,659,608 characters', '657,597,114 cells', 'about 4 GB', '33 to 47 s', 'about 2.3 s'],
      '0.8b': ['Qwen3.5-0.8B', 'about 752 million (the text part)', '7,709,034,855 characters', '1,067,424,772 cells (3.98 GiB)', 'about 5 GB', '2 min 10 s to 2 min 37 s in the browser; 103 s on the command line', 'about 5.6 s in the browser; 5.56 s on the command line'],
      '1.5b': ['Qwen2.5-1.5B-Instruct', 'about 1.54 billion', '11,430,468,880 characters', '1,827,870,014 cells (6.81 GiB)', 'about 8 GB', '90 to 169 s on the command line; 2 min 27 s in the browser', '7 to 12 s on the command line; 9.0 s in the browser']
    };
    var dds = $('z-facts').querySelectorAll('dd'), buttons = $('z-seg').querySelectorAll('button');
    function show(key) {
      M[key].forEach(function (t, i) { dds[i].textContent = t; });
      Array.prototype.forEach.call(buttons, function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === key)); });
    }
    Array.prototype.forEach.call(buttons, function (b) { b.addEventListener('click', function () { show(b.dataset.m); }); });
    show('small');
  };

  // ---- 8b. one comma, one full stop: where they are, in four steps ----------------------
  // stops.json (tools/map-data/stops.js) has, for each of the two, the section of the engine that holds
  // it, the mix of commands along the program, the engine and that section, and the text around it.
  figs['fig-stop'] = function () {
    var canvas = $('stop-view'), cache = {}, D = null, k = 1, model = 'small';
    var NAME = { ask: 'The part that reads the question', print: 'The part that prints a word piece' };
    var ORDER = '+-<>[].,', STACK = '<>+-[],.';                 // the walking at the bottom of a column, then the digits, then the loops
    var VAR = { '+': '--c-plus', '-': '--c-minus', '<': '--c-lt', '>': '--c-gt', '[': '--c-open', ']': '--c-close', ',': '--c-in', '.': '--c-out' };
    var probe = el('i'); probe.hidden = true; canvas.after(probe);
    var colour = function (v) { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
    var bytes = function (b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
    function load(m) {
      if (!cache[m]) cache[m] = fetch('../inside/data-hosts.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (h) {
        var base = h && typeof h[m] === 'string' && h[m] ? new URL(h[m], new URL('../inside/', location.href)).href : '../inside/data/' + m + '/';
        return fetch(base + 'stops.json').then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); });
      }).then(function (J) { J.programB = bytes(J.program); J.engineB = bytes(J.engine); J.stops.forEach(function (s) { s.mixB = bytes(s.mix); }); return J; });
      return cache[m];
    }
    // a part of the text, squeezed into a strip: every column the shares of the eight commands in it
    function strip(ctx, u, bins, x0, y, w, h, col) {
      for (var x = 0; x < Math.ceil(w); x++) {
        var b0 = Math.floor(x / w * bins), b1 = Math.max(b0 + 1, Math.floor((x + 1) / w * bins)), s = [0, 0, 0, 0, 0, 0, 0, 0], t = 0;
        for (var b = b0; b < b1 && b < bins; b++) for (var q = 0; q < 8; q++) { s[q] += u[b * 8 + q]; t += u[b * 8 + q]; }
        var yy = y + h;
        for (var j = 0; j < 8; j++) { var q2 = ORDER.indexOf(STACK[j]), hh = t ? s[q2] / t * h : 0; if (hh > 0) { ctx.fillStyle = col[STACK[j]]; ctx.fillRect(x0 + x, yy - hh, 1.02, hh); yy -= hh; } }
      }
    }
    function draw() {
      if (!D) return;
      var S = D.stops[k], W = canvas.clientWidth, n = Math.max(21, Math.min(81, 2 * Math.floor(W / (W < 500 ? 12 : 15) / 2) + 1)), half = (n - 1) / 2;
      var LAB = 20, BAR = 30, GAP = 34, cw = W / n, TXT = Math.round(Math.min(44, cw * 1.8)), top = function (i) { return i * (LAB + BAR + GAP); };
      canvas.style.height = (top(3) + LAB + TXT + 2) + 'px';
      var dpr = window.devicePixelRatio || 1, h = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(h * dpr);
      var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, h);
      var col = {}; Object.keys(VAR).forEach(function (c) { col[c] = colour(VAR[c]); });
      var ink = colour('--ink'), muted = colour('--muted'), panel = colour('--panel'), go = colour('--go'), line = colour('--line');
      // the four parts, each as [from, to) of the program, and the window of each inside it
      var P = [[0, D.chars], [D.writer, D.chars], [S.from, S.to], [S.at - half, S.at + half + 1]];
      var X = function (i, v) { return (v - P[i][0]) / (P[i][1] - P[i][0]) * W; };
      var win = function (i) { var a = X(i, P[i + 1][0]), b = X(i, P[i + 1][1]), c = (a + b) / 2; if (b - a < 4) { a = c - 2; b = c + 2; } return [Math.max(0, a), Math.min(W, b)]; };
      // the funnels from each window to the whole width of the strip under it
      for (var i = 0; i < 3; i++) {
        var w0 = win(i), y0 = top(i) + LAB + BAR, y1 = top(i + 1) + LAB;
        ctx.fillStyle = go; ctx.globalAlpha = 0.16;
        ctx.beginPath(); ctx.moveTo(w0[0], y0); ctx.lineTo(w0[1], y0); ctx.lineTo(W, y1); ctx.lineTo(0, y1); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.7; ctx.strokeStyle = go; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(w0[0], y0); ctx.lineTo(0.5, y1); ctx.moveTo(w0[1], y0); ctx.lineTo(W - 0.5, y1); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      strip(ctx, D.programB, D.bins, 0, top(0) + LAB, W, BAR, col);
      strip(ctx, D.engineB, D.bins, 0, top(1) + LAB, W, BAR, col);
      strip(ctx, S.mixB, D.bins, 0, top(2) + LAB, W, BAR, col);
      // the characters themselves, the one in question on a yellow block
      var text = S.before.slice(-half) + S.command + S.after.slice(0, half), y3 = top(3) + LAB, fs = Math.min(22, cw * 1.15);
      ctx.fillStyle = colour('--sunk'); ctx.fillRect(0, y3, W, TXT);
      ctx.font = '700 ' + fs.toFixed(1) + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var c = 0; c < text.length; c++) {
        var ch = text[c], cx = (c + 0.5) * cw;
        if (c === half) { ctx.fillStyle = go; ctx.fillRect(c * cw, y3, cw, TXT); ctx.fillStyle = '#111'; }
        else ctx.fillStyle = col[ch] || muted;
        ctx.fillText(ch === '-' ? '−' : ch, cx, y3 + TXT / 2 + 1);
      }
      // the frames: what the next strip opens up
      ctx.strokeStyle = go; ctx.lineWidth = 2;
      for (var f = 0; f < 3; f++) { var wf = win(f); ctx.strokeRect(wf[0] + 1, top(f) + LAB + 1, Math.max(2, wf[1] - wf[0] - 2), BAR - 2); }
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.strokeRect(0.5, y3 + 0.5, W - 1, TXT - 1);
      // the names over the strips, and their sizes where there is room
      var LABELS = [['The whole program', fmt(D.chars) + ' characters'], ['The engine', fmt(D.chars - D.writer) + ' characters'], [NAME[S.section] || S.section, fmt(S.to - S.from) + ' characters'], [n + ' characters around the ' + (S.command === ',' ? 'comma' : 'full stop'), 'character ' + fmt(S.at + 1)]];
      ctx.textBaseline = 'alphabetic';
      LABELS.forEach(function (L, i) {
        var y = top(i) + LAB - 6;
        ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif'; var lw = ctx.measureText(L[0]).width;
        ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace'; var rw = ctx.measureText(L[1]).width;
        ctx.fillStyle = panel; ctx.fillRect(0, y - 14, lw + 8, 18); if (lw + rw + 24 < W) ctx.fillRect(W - rw - 8, y - 14, rw + 8, 18);
        ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.fillText(L[0], 0, y);
        if (lw + rw + 24 < W) { ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillStyle = muted; ctx.fillText(L[1], W, y); }
      });
      // in words
      var said = $('stop-said'), into = S.at - D.writer, after = D.chars - S.at - 1, b = function (t) { return el('b', '', t); };
      said.replaceChildren();
      if (S.command === '.') said.append('The full stop of ' + D.label + ' is character ', b(fmt(S.at + 1)), ' of ', b(fmt(D.chars)) , ', with only ', b(fmt(after)), ' characters after it. It stands inside ', b(S.depth + (S.depth === 1 ? ' loop' : ' loops')), ', so this one character prints every letter of every answer.');
      else said.append('The comma of ' + D.label + ' is character ', b(fmt(S.at + 1)), ', ', b(fmt(into)), ' characters into the engine. It stands inside ', b(S.depth + (S.depth === 1 ? ' loop' : ' loops')), ', so this one character reads every letter of every question.');
      canvas.setAttribute('aria-label', 'From the whole program of ' + fmt(D.chars) + ' characters to the engine, then to ' + (NAME[S.section] || S.section).toLowerCase() + ', then to the ' + n + ' characters around the ' + (S.command === ',' ? 'comma' : 'full stop') + ': ' + text);
    }
    function show() {
      $('stop-said').textContent = 'Loading…';
      load(model).then(function (J) { D = J; draw(); }).catch(function () { $('stop-said').textContent = 'The data of this program could not be loaded.'; });
    }
    function pick(group, attr, set) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button'); if (!btn) return;
        Array.prototype.forEach.call(group.children, function (o) { o.setAttribute('aria-pressed', String(o === btn)); });
        set(btn.dataset[attr]); show();
      });
    }
    pick($('stop-cmd'), 'k', function (v) { k = Number(v); });
    pick($('stop-prog'), 'm', function (v) { model = v; });
    var started = false, start = function () { if (!started) { started = true; show(); } };
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '400px' }); io.observe(canvas); } else start();
    new ResizeObserver(function () { draw(); }).observe(canvas.parentNode);
    new MutationObserver(function () { draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  };

  // ---- 8c. the word piece every layer would print (a logit lens) -------------------------
  // lens-france.json (tools/map-data/lens.js): for every printed word piece, the numbers after each layer, read off the
  // tape of a real run and given to the program's own last step: the best three word pieces, and the share and place of
  // the one that was printed. For brnfck-qwen3.5-0.8b also the guesses of its multi-token prediction head.
  figs['fig-lens'] = function () {
    var grid = $('lens-grid'), said = $('lens-said'), cache = {}, D = null, model = 'small';
    var show = function (s) { return s === '<|im_end|>' || s === '<|endoftext|>' ? 'end' : s.replace(/^ /, '␣').replace(/\n/g, '⏎').replace(/ /g, '␣'); };
    var pc = function (p) { return p >= 0.995 ? '100%' : p < 0.005 ? 'below 1%' : Math.round(p * 100) + '%'; };
    var q = function (s) { return '“' + show(s) + '”'; };
    function load(m) {
      if (!cache[m]) cache[m] = fetch('../inside/data-hosts.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (h) {
        var base = h && typeof h[m] === 'string' && h[m] ? new URL(h[m], new URL('../inside/', location.href)).href : '../inside/data/' + m + '/';
        return fetch(base + 'lens-france.json').then(function (r) { if (!r.ok) throw new Error('no data'); return r.json(); });
      });
      return cache[m];
    }
    // the layer from which on the printed word piece stays first
    var settle = function (row) { var l = row.layers.length; while (l > 0 && row.layers[l - 1].rank === 0) l--; return l; };
    function summary() {
      var rows = D.rows.filter(function (r) { return D.pieces[r.next] !== '<|im_end|>'; }), s = rows.map(settle);
      var mean = s.reduce(function (a, b) { return a + b + 1; }, 0) / s.length, last = 0;
      s.forEach(function (v, i) { if (v > s[last]) last = i; });
      said.replaceChildren('In ' + D.label + ' a printed word piece comes first, and stays first, after layer ', el('b', '', mean.toFixed(1)), ' of ' + D.layers + ' on average; ' + q(D.pieces[rows[last].next]) + (s[last] + 1 === D.layers ? ' only in the last one, ' : ' only after layer '), el('b', '', String(s[last] + 1)), '. Point at a cell, or press it, for its numbers.');
      if (D.mtp) said.append(' The top row is the multi-token prediction head: its guess for the word piece after the next was right ', el('b', '', D.mtp.right + ' of ' + D.mtp.of), ' times here.');
    }
    function tellCell(row, l) {
      var r = row.layers[l], top = r.top[0], printed = D.pieces[row.next];
      said.replaceChildren('After layer ' + (l + 1) + ' of ' + D.layers + ', at word piece ' + (D.rows.indexOf(row) + 1) + ': ' + q(D.pieces[top[0]]) + ' would win with ', el('b', '', pc(top[1])), '. ');
      if (top[0] === row.next) said.append('That is the word piece the program prints.' + (r.top[1] ? ' Second: ' + q(D.pieces[r.top[1][0]]) + ', ' + pc(r.top[1][1]) + '.' : ''));
      else said.append('The printed one, ' + q(printed) + ', has ', el('b', '', pc(r.p)), ' and is in place ', el('b', '', fmt(r.rank + 1)), '.');
    }
    function tellGuess(g) {
      var at = D.rows.findIndex(function (r) { return r.position === g.position; });
      said.replaceChildren('At word piece ' + (at + 1) + ' the head guesses ' + q(D.pieces[g.guess]) + ' (' + pc(g.p) + ') for the word piece after the next. ');
      if (g.hit === null) said.append('The run stopped before that word piece.');
      else said.append(g.hit ? el('b', '', 'Right.') : el('b', '', 'Wrong'), g.hit ? '' : ': the program printed ' + q(D.pieces[g.actual]) + ' there.');
    }
    function draw() {
      if (!D) return;
      var rows = D.rows, L = D.layers, cells = [];
      grid.style.setProperty('--cols', rows.length);
      grid.replaceChildren();
      var head = function (t, cls) { var h = el('span', 'lh ' + (cls || ''), t); grid.append(h); return h; };
      head('Layer', 'corner');
      rows.forEach(function (r) { head(show(D.pieces[r.next]), 'top'); });
      var cell = function (text, cls, style, on) {
        var b = el('button', 'lc ' + cls, text); b.type = 'button'; if (style) b.style.background = style;
        b.addEventListener('mouseenter', on); b.addEventListener('focus', on); b.addEventListener('click', on);
        grid.append(b); cells.push(b);
      };
      if (D.mtp) {
        head('Two ahead', 'side mtp');
        rows.forEach(function (r) {
          var g = D.mtp.guesses.find(function (x) { return x.position === r.position; });
          if (!g) { grid.append(el('span', 'lc empty')); return; }
          cell(show(D.pieces[g.guess]), 'mtp ' + (g.hit === null ? '' : g.hit ? 'hit' : 'miss'), null, function () { tellGuess(g); });
        });
      }
      for (var l = L - 1; l >= 0; l--) {
        head(String(l + 1), 'side');
        rows.forEach(function (r) {
          var x = r.layers[l], win = x.top[0][0] === r.next, lv = l;
          cell(show(D.pieces[x.top[0][0]]), win ? 'win' : '', win ? null : 'color-mix(in srgb, var(--go) ' + Math.round(x.p * 85) + '%, var(--panel))', function () { tellCell(r, lv); });
        });
      }
      grid.setAttribute('aria-label', D.label + ', "' + D.question + '": ' + rows.length + ' printed word pieces, ' + L + ' layers each');
      summary();
    }
    function showModel() {
      said.textContent = 'Loading…';
      load(model).then(function (J) { D = J; draw(); }).catch(function () { D = null; grid.replaceChildren(); said.textContent = 'The data of this program could not be loaded.'; });
    }
    $('lens-prog').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      Array.prototype.forEach.call($('lens-prog').children, function (o) { o.setAttribute('aria-pressed', String(o === btn)); });
      model = btn.dataset.m; showModel();
    });
    grid.addEventListener('mouseleave', function () { if (D) summary(); });
    var started = false, start = function () { if (!started) { started = true; showModel(); } };
    if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '400px' }); io.observe(grid); } else start();
  };

  Object.keys(figs).forEach(function (id) { if ($(id)) figs[id](); });

  (function () {
    if (!$('c-go')) return;
    var WHERE = { name: 'small', manifestUrl: '../dist/small/manifest.json', metaUrl: '../programs/brnfck-smollm2-135m.meta.json', fileUrl: '../programs/brnfck-smollm2-135m.bf' };
    var out = function (key) { return document.querySelector('#c-table [data-c="' + key + '"]'); };
    var ctl = null;
    $('c-go').addEventListener('click', async function () {
      var src = null, status = $('c-status'), counts = new Float64Array(256), total = 0;
      $('c-go').disabled = true; $('c-stop').disabled = false;
      ctl = { stopped: false, abort: function () { this.stopped = true; if (src) src.cancel(); } };
      try {
        var P = await ProgramStart.find(WHERE), size = P.meta.programBytes, shown = 0;
        src = await ProgramSource.open({ manifest: P.manifest, manifestUrl: P.manifestUrl, fileUrl: P.fileUrl, store: true, fetchOptions: { cache: 'no-store' } });
        for (;;) {
          var part = await src.read();
          if (part.done || ctl.stopped) break;
          for (var i = 0; i < part.value.length; i++) counts[part.value[i]]++;
          total += part.value.length;
          if (total - shown > 2e7) { shown = total; status.textContent = 'Counting... ' + fmt(total / 1e6) + ' of ' + fmt(size / 1e6) + ' million characters' + (src.source === 'chunks' ? ' (' + fmt(src.netBytes / 1e6) + ' MB downloaded)' : ''); }
        }
        if (ctl.stopped) { var e = new Error('stopped'); e.name = 'AbortError'; throw e; }
        if (total !== size) throw new Error('got ' + fmt(total) + ' of ' + fmt(size) + ' characters: the download broke off');
        var other = total;
        Array.from('+-<>[].,').forEach(function (ch) { var n = counts[ch.charCodeAt(0)]; other -= n; out(ch).textContent = fmt(n); });
        out('other').textContent = fmt(other); out('total').textContent = fmt(total);
        status.textContent = (other === 0 ? 'Done: only the eight commands.' : 'Done: found characters that are not commands.') + (src.source === 'chunks' ? ' All ' + fmt(src.checked) + ' pieces were equal to their checksums.' : '');
      } catch (err) {
        status.textContent = err.name === 'AbortError' || (ctl && ctl.stopped) ? 'Stopped after ' + fmt(total / 1e6) + ' million characters.' : String(err.message || err);
      }
      ctl = null; $('c-go').disabled = false; $('c-stop').disabled = true;
    });
    $('c-stop').addEventListener('click', function () { if (ctl) ctl.abort(); });
  })();

  // an address with # that points into a fold: the figures above have their height now
  A.openFromHash();
})();
